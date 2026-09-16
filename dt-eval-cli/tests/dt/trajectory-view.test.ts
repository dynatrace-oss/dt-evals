import { describe, it, expect } from 'vitest';
import { serializeTrajectory } from '../../src/dt/trajectory-view.js';
import { parseSpanTreeRecords, selectSpanTrees } from '../../src/dt/span-tree.js';
import type { GenAiSpan } from '../../src/dt/types.js';

/**
 * Reuses the shared fixture shape from span-tree.test.ts: an agent chat span
 * calls a tool, gets the tool result back, and produces a final chat response
 * — all children of a root `invoke_agent` span.
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

describe('serializeTrajectory', () => {
  it('renders a readable trajectory string containing the tool name and turns', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const [root] = selectSpanTrees(spans);
    const { trajectory } = serializeTrajectory(root!);

    expect(trajectory).toContain('Turn 1:');
    expect(trajectory).toContain('get_weather');
    expect(trajectory).toContain('{"city":"Paris"}');
    expect(trajectory).toContain('{"forecast":"sunny"}');
  });

  it('produces a flat structured toolCalls list with name/arguments/result', () => {
    const spans = parseSpanTreeRecords(fixtureRecords());
    const [root] = selectSpanTrees(spans);
    const { toolCalls } = serializeTrajectory(root!);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({
      name: 'get_weather',
      arguments: '{"city":"Paris"}',
      result: '{"forecast":"sunny"}',
    });
  });

  it('handles a tree with no tool calls (empty toolCalls, no tool lines)', () => {
    const chatOnly: GenAiSpan = {
      traceId: 't', spanId: 'root', input: 'hi', output: 'hello', kind: 'chat',
      startTime: '2026-01-01T00:00:00.000Z',
    };
    const { trajectory, toolCalls } = serializeTrajectory(chatOnly);
    expect(toolCalls).toHaveLength(0);
    expect(trajectory).toContain('Turn 1:');
    expect(trajectory).not.toContain('- tool');
  });

  it('truncates oversized values to avoid unbounded prompts', () => {
    const huge = 'x'.repeat(5000);
    const tool: GenAiSpan = {
      traceId: 't', spanId: 'tool', input: '', output: '', kind: 'tool',
      toolName: 'big_tool', toolArguments: huge, toolResult: huge,
      startTime: '2026-01-01T00:00:00.000Z',
    };
    const { trajectory } = serializeTrajectory(tool);
    // Rendered line should be far shorter than 2×5000 chars.
    expect(trajectory.length).toBeLessThan(6000);
  });
});
