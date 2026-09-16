import { describe, it, expect } from 'vitest';
import {
  parseSpanTreeRecords,
  groupSpansByTrace,
  buildSpanTree,
  segmentTurns,
  pickRepresentativeRoot,
  selectSpanTrees,
  classifySpanKind,
} from '../../src/dt/span-tree.js';
import type { GenAiSpan } from '../../src/dt/types.js';

/**
 * A recorded-style multi-span trace: an agent chat span calls a tool, gets
 * the tool result back, and produces a final chat response — all children of
 * a root `invoke_agent` span.
 */
function fixtureRecords(): unknown[] {
  return [
    {
      'trace.id': 'trace-1',
      'span.id': 'root-agent',
      'start_time': '2026-03-01T10:00:00.000Z',
      'end_time': '2026-03-01T10:00:05.000Z',
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': 'travel-planner',
      'gen_ai.input.messages': '[{"role":"user","content":"Plan my trip"}]',
      'gen_ai.output.messages': 'Here is your itinerary.',
    },
    {
      'trace.id': 'trace-1',
      'span.id': 'chat-1',
      'span.parent_id': 'root-agent',
      'start_time': '2026-03-01T10:00:00.500Z',
      'end_time': '2026-03-01T10:00:01.000Z',
      'gen_ai.operation.name': 'chat',
      'gen_ai.input.messages': '[{"role":"user","content":"Plan my trip"}]',
      'gen_ai.output.messages': 'Let me check the weather.',
    },
    {
      'trace.id': 'trace-1',
      'span.id': 'tool-1',
      'span.parent_id': 'root-agent',
      'start_time': '2026-03-01T10:00:01.500Z',
      'end_time': '2026-03-01T10:00:02.000Z',
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'get_weather',
      'gen_ai.tool.call.id': 'call-abc',
      'gen_ai.tool.type': 'function',
      'gen_ai.tool.call.arguments': '{"city":"Paris"}',
      'gen_ai.tool.call.result': '{"forecast":"sunny"}',
    },
    {
      'trace.id': 'trace-1',
      'span.id': 'chat-2',
      'span.parent_id': 'root-agent',
      'start_time': '2026-03-01T10:00:02.500Z',
      'end_time': '2026-03-01T10:00:03.000Z',
      'gen_ai.operation.name': 'chat',
      'gen_ai.input.messages': '[{"role":"user","content":"Plan my trip"}]',
      'gen_ai.output.messages': 'Here is your itinerary.',
    },
  ];
}

describe('classifySpanKind', () => {
  it('classifies execute_tool as tool', () => {
    expect(classifySpanKind('execute_tool')).toBe('tool');
  });
  it('classifies invoke_agent and create_agent as agent', () => {
    expect(classifySpanKind('invoke_agent')).toBe('agent');
    expect(classifySpanKind('create_agent')).toBe('agent');
  });
  it('classifies chat/generate_content/text_completion as chat', () => {
    expect(classifySpanKind('chat')).toBe('chat');
    expect(classifySpanKind('generate_content')).toBe('chat');
    expect(classifySpanKind('text_completion')).toBe('chat');
  });
  it('classifies anything else (or missing) as other', () => {
    expect(classifySpanKind('embeddings')).toBe('other');
    expect(classifySpanKind(undefined)).toBe('other');
  });
});

describe('parseSpanTreeRecords', () => {
  it('keeps execute_tool spans (dropped by parseSpanResults) and populates tool fields', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const tool = spans.find(s => s.spanId === 'tool-1');
    expect(tool).toBeDefined();
    expect(tool!.kind).toBe('tool');
    expect(tool!.toolName).toBe('get_weather');
    expect(tool!.toolCallId).toBe('call-abc');
    expect(tool!.toolType).toBe('function');
    expect(tool!.toolArguments).toBe('{"city":"Paris"}');
    expect(tool!.toolResult).toBe('{"forecast":"sunny"}');
  });

  it('resolves toolResult from either gen_ai.tool.result or gen_ai.tool.call.result (two SDKs, complementary coverage)', () => {
    const records: unknown[] = [
      {
        'trace.id': 'trace-dual',
        'span.id': 'tool-new-sdk',
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.result': '{"hits":3}',
      },
      {
        'trace.id': 'trace-dual',
        'span.id': 'tool-old-sdk',
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.call.result': '{"hits":5}',
      },
    ];
    const spans = parseSpanTreeRecords(records);
    const newSdk = spans.find(s => s.spanId === 'tool-new-sdk');
    const oldSdk = spans.find(s => s.spanId === 'tool-old-sdk');
    expect(newSdk!.toolResult).toBe('{"hits":3}');
    expect(oldSdk!.toolResult).toBe('{"hits":5}');
  });

  it('prefers gen_ai.tool.result over gen_ai.tool.call.result when both are present', () => {
    const records: unknown[] = [
      {
        'trace.id': 'trace-both',
        'span.id': 'tool-both',
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'search',
        'gen_ai.tool.result': '{"primary":true}',
        'gen_ai.tool.call.result': '{"primary":false}',
      },
    ];
    const spans = parseSpanTreeRecords(records);
    expect(spans[0]!.toolResult).toBe('{"primary":true}');
  });

  it('populates parentId and kind on chat/agent spans', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const root = spans.find(s => s.spanId === 'root-agent')!;
    const chat1 = spans.find(s => s.spanId === 'chat-1')!;
    expect(root.parentId).toBeUndefined();
    expect(root.kind).toBe('agent');
    expect(chat1.parentId).toBe('root-agent');
    expect(chat1.kind).toBe('chat');
  });

  it('drops spans with neither chat content nor a tool identity', () => {
    const records = [
      { 'trace.id': 'trace-2', 'span.id': 'empty-span', 'gen_ai.operation.name': 'chat' },
    ];
    expect(parseSpanTreeRecords(records)).toHaveLength(0);
  });

  it('keeps a trace.id-less-safe record count consistent with fixture size', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    expect(spans).toHaveLength(4);
  });
});

describe('groupSpansByTrace', () => {
  it('groups spans by traceId, preserving order', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const groups = groupSpansByTrace(spans);
    expect([...groups.keys()]).toEqual(['trace-1']);
    expect(groups.get('trace-1')).toHaveLength(4);
  });
});

describe('buildSpanTree', () => {
  it('links children to their parent and returns roots', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const roots = buildSpanTree(spans);
    expect(roots).toHaveLength(1);
    const root = roots[0]!;
    expect(root.spanId).toBe('root-agent');
    expect(root.children).toHaveLength(3);
    expect(root.children!.map(c => c.spanId)).toEqual(['chat-1', 'tool-1', 'chat-2']);
  });

  it('sorts children by startTime', () => {
    const spans = parseSpanTreeRecords(fixtureRecords()).reverse();
    const roots = buildSpanTree(spans);
    expect(roots[0]!.children!.map(c => c.spanId)).toEqual(['chat-1', 'tool-1', 'chat-2']);
  });

  it('treats a span with no parentId as a root', () => {
    const spanA: GenAiSpan = { traceId: 't', spanId: 'a', input: 'i', output: 'o' };
    const spanB: GenAiSpan = { traceId: 't', spanId: 'b', input: 'i', output: 'o' };
    const roots = buildSpanTree([spanA, spanB]);
    expect(roots).toHaveLength(2);
  });

  it('throws on a parentId pointing to a missing ancestor', () => {
    const orphan: GenAiSpan = { traceId: 't', spanId: 'child', parentId: 'does-not-exist', input: 'i', output: 'o' };
    expect(() => buildSpanTree([orphan])).toThrow(/missing parent/);
  });

  it('throws on a parent/child cycle', () => {
    const a: GenAiSpan = { traceId: 't', spanId: 'a', parentId: 'b', input: 'i', output: 'o' };
    const b: GenAiSpan = { traceId: 't', spanId: 'b', parentId: 'a', input: 'i', output: 'o' };
    expect(() => buildSpanTree([a, b])).toThrow(/cycle detected/);
  });
});

describe('segmentTurns', () => {
  it('orders spans by time and groups tool calls under the preceding chat/agent turn', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const [root] = buildSpanTree(spans);
    const turns = segmentTurns(root!);

    // root-agent (chat/agent kind) starts its own turn; chat-1 starts a new
    // turn; tool-1 attaches to chat-1's turn; chat-2 starts a third turn.
    expect(turns).toHaveLength(3);
    expect(turns[0]!.chat!.spanId).toBe('root-agent');
    expect(turns[1]!.chat!.spanId).toBe('chat-1');
    expect(turns[1]!.toolCalls.map(t => t.spanId)).toEqual(['tool-1']);
    expect(turns[2]!.chat!.spanId).toBe('chat-2');
    expect(turns[2]!.toolCalls).toHaveLength(0);
  });

  it('attaches a tool call to the enclosing agent/chat turn it was invoked from', () => {
    const tool: GenAiSpan = {
      traceId: 't', spanId: 'tool-only', input: '', output: '',
      kind: 'tool', toolName: 'lookup', startTime: '2026-01-01T00:00:00.000Z',
    };
    const chat: GenAiSpan = {
      traceId: 't', spanId: 'chat-after', input: 'i', output: 'o',
      kind: 'chat', startTime: '2026-01-01T00:00:01.000Z',
    };
    const root: GenAiSpan = {
      traceId: 't', spanId: 'root', input: 'i', output: 'o', kind: 'agent',
      startTime: '2026-01-01T00:00:00.000Z',
      children: [tool, chat],
    };
    const turns = segmentTurns(root);
    // root (agent) starts turn 0; the tool span immediately following it (and
    // preceding the next chat span) attaches to that same turn; chat-after
    // starts turn 1.
    expect(turns).toHaveLength(2);
    expect(turns[0]!.chat!.spanId).toBe('root');
    expect(turns[0]!.toolCalls.map(t => t.spanId)).toEqual(['tool-only']);
    expect(turns[1]!.chat!.spanId).toBe('chat-after');
    expect(turns[1]!.toolCalls).toHaveLength(0);
  });

  it('attaches a genuinely leading tool call (no chat/agent span at all) to a chat-less turn', () => {
    const tool: GenAiSpan = {
      traceId: 't', spanId: 'tool-only', input: '', output: '',
      kind: 'tool', toolName: 'lookup', startTime: '2026-01-01T00:00:00.000Z',
    };
    const chat: GenAiSpan = {
      traceId: 't', spanId: 'chat-after', input: 'i', output: 'o',
      kind: 'chat', startTime: '2026-01-01T00:00:01.000Z',
      children: [],
    };
    tool.children = [chat];
    const turns = segmentTurns(tool);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.chat).toBeUndefined();
    expect(turns[0]!.toolCalls.map(t => t.spanId)).toEqual(['tool-only']);
    expect(turns[1]!.chat!.spanId).toBe('chat-after');
  });
});

describe('pickRepresentativeRoot', () => {
  it('returns undefined for an empty root list', () => {
    expect(pickRepresentativeRoot([])).toBeUndefined();
  });

  it('prefers a chat-kind (or usable input+output) root at the latest time', () => {
    const toolRoot: GenAiSpan = { traceId: 't', spanId: 'r1', input: '', output: '', kind: 'tool', endTime: '2026-01-01T00:00:10.000Z' };
    const chatRoot: GenAiSpan = { traceId: 't', spanId: 'r2', input: 'i', output: 'o', kind: 'chat', endTime: '2026-01-01T00:00:05.000Z' };
    const rep = pickRepresentativeRoot([toolRoot, chatRoot]);
    expect(rep!.spanId).toBe('r2');
  });

  it('falls back to any root when none qualify as chat', () => {
    const toolRoot: GenAiSpan = { traceId: 't', spanId: 'r1', input: '', output: '', kind: 'tool', endTime: '2026-01-01T00:00:10.000Z' };
    const rep = pickRepresentativeRoot([toolRoot]);
    expect(rep!.spanId).toBe('r1');
  });
});

describe('selectSpanTrees', () => {
  it('returns one representative root per trace with its tree attached', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const reps = selectSpanTrees(spans);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.spanId).toBe('root-agent');
    expect(reps[0]!.children).toHaveLength(3);
  });

  it('regression: mirrors the runner path (parse -> selectSpanTrees, NO op-name filter) and keeps tool spans in the tree', () => {
    // This is the exact sequence the agent-trajectory runner branch uses:
    // parseSpanTreeRecords(rawRecords) -> selectSpanTrees(...) — deliberately
    // WITHOUT filterSpansByOperationName, since the default keep-list
    // (['chat', 'text_completion', 'generate_content']) excludes execute_tool
    // and invoke_agent, and applying it here would strip every tool/agent
    // span trajectory mode exists to keep (see runner/index.ts).
    const spans = parseSpanTreeRecords(fixtureRecords());
    const [rep] = selectSpanTrees(spans);
    expect(rep).toBeDefined();
    const toolChildren = rep!.children!.filter(c => c.kind === 'tool');
    expect(toolChildren).toHaveLength(1);
    expect(toolChildren[0]!.toolName).toBe('get_weather');
    const agentChildren = rep!.children!.filter(c => c.kind === 'chat');
    expect(agentChildren.length).toBeGreaterThan(0);
  });

  it('handles multiple traces independently', () => {
    const recordsB = fixtureRecords().map(r => ({ ...(r as Record<string, unknown>), 'trace.id': 'trace-2' }));
    const spans = parseSpanTreeRecords([...fixtureRecords(), ...recordsB]);
    const reps = selectSpanTrees(spans);
    expect(reps.map(r => r.traceId).sort()).toEqual(['trace-1', 'trace-2']);
  });
});
