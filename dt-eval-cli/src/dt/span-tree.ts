import type { GenAiSpan } from './types.js';
import type { ParseSpanOptions } from './dql.js';
import {
  resolveFields,
  pickFirstMatch,
  asString,
  extractRolesFromJsonMessages,
  PROMPT_SLOTS,
  PARENT_ID_FIELD,
  TOOL_NAME_FIELD,
  TOOL_CALL_ID_FIELD,
  TOOL_TYPE_FIELD,
  TOOL_ARGUMENTS_FIELD,
  TOOL_RESULT_FIELDS,
} from './dql.js';

/**
 * Classify a span's coarse kind from its `gen_ai.operation.name`.
 * `execute_tool` → tool call; `invoke_agent`/`create_agent` → agent
 * orchestration span; the chat/text-generation operations → chat; anything
 * else (or missing) → other.
 */
export function classifySpanKind(operationName: string | undefined): NonNullable<GenAiSpan['kind']> {
  switch (operationName) {
    case 'execute_tool':
      return 'tool';
    case 'invoke_agent':
    case 'create_agent':
      return 'agent';
    case 'chat':
    case 'generate_content':
    case 'text_completion':
      return 'chat';
    default:
      return 'other';
  }
}

/**
 * Like `parseSpanResults`, but for `agent-trajectory` level: keeps
 * `execute_tool` spans (which have no input/output messages, only
 * `gen_ai.tool.*` attributes) instead of dropping them, and populates the
 * additive `parentId` / `kind` / `tool*` fields needed to reconstruct a span
 * tree. Spans with neither chat content (input+output) nor a tool identity
 * are still dropped — there's nothing to evaluate on them.
 */
export function parseSpanTreeRecords(
  records: unknown[],
  options: ParseSpanOptions = {},
): GenAiSpan[] {
  const fields = resolveFields(options.spanFields);
  const spans: GenAiSpan[] = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;

    const r = record as Record<string, unknown>;
    const traceId = asString(r['trace.id']);
    if (!traceId) continue;

    const operationName = asString(r['gen_ai.operation.name']);
    const toolName = asString(r[TOOL_NAME_FIELD]);
    const kind = classifySpanKind(operationName);

    const inputMatch = pickFirstMatch(r, fields.input);
    let input = inputMatch?.value;
    const context = pickFirstMatch(r, fields.context)?.value;
    let systemInstruction = pickFirstMatch(r, fields.systemInstruction)?.value;
    let userPrompt: string | undefined;

    const messages: string[] = [];
    for (let i = 0; i < PROMPT_SLOTS; i++) {
      const content = asString(r[`gen_ai.prompt.${i}.content`]);
      const role = asString(r[`gen_ai.prompt.${i}.role`]);
      if (!content) continue;
      if (role === 'system') {
        systemInstruction ??= content;
      } else {
        if (role === 'user') {
          userPrompt = content;
        }
        messages.push(role ? `${role}: ${content}` : content);
      }
    }
    if (!input && messages.length > 0) {
      input = messages.join('\n');
    }

    const inputRoles = extractRolesFromJsonMessages(input);
    if (inputRoles) {
      systemInstruction ??= inputRoles.system;
      userPrompt ??= inputRoles.user;
      if (inputRoles.user) input = inputRoles.user;
    }

    let output = pickFirstMatch(r, fields.output)?.value;
    const outputRoles = extractRolesFromJsonMessages(output);
    if (outputRoles?.assistant) {
      output = outputRoles.assistant;
    }

    const hasChatContent = !!input && !!output;
    const isToolSpan = !!toolName && !hasChatContent;

    // Drop spans with neither usable chat content nor a tool identity —
    // mirrors parseSpanResults' `if (!input || !output) continue` net, but
    // widened to let tool-only spans through.
    if (!hasChatContent && !isToolSpan) continue;

    const statusCode = asString(r['status.code']);

    const span: GenAiSpan = {
      traceId,
      spanId: asString(r['span.id']),
      parentId: asString(r[PARENT_ID_FIELD]),
      startTime: asString(r['start_time']),
      endTime: asString(r['end_time']),
      input: input ?? '',
      output: output ?? '',
      context,
      systemInstruction,
      userPrompt,
      system: asString(r['gen_ai.system']) ?? asString(r['gen_ai.provider.name']),
      operationName,
      requestModel: pickFirstMatch(r, fields.model)?.value,
      responseModel: asString(r['gen_ai.response.model']),
      agentName: asString(r['gen_ai.agent.name']),
      isError: statusCode === 'ERROR' || undefined,
      conversationId: asString(r['gen_ai.conversation.id']),
      finishReasons: asString(r['gen_ai.response.finish_reasons']),
      kind,
    };

    if (isToolSpan) {
      span.toolName = toolName;
      span.toolCallId = asString(r[TOOL_CALL_ID_FIELD]);
      span.toolType = asString(r[TOOL_TYPE_FIELD]);
      span.toolArguments = asString(r[TOOL_ARGUMENTS_FIELD]);
      span.toolResult = pickFirstMatch(r, TOOL_RESULT_FIELDS)?.value;
    }

    spans.push(span);
  }

  return spans;
}

/** Group spans by traceId, preserving first-seen order of both traces and spans within a trace. */
export function groupSpansByTrace(spans: GenAiSpan[]): Map<string, GenAiSpan[]> {
  const groups = new Map<string, GenAiSpan[]>();
  for (const span of spans) {
    const group = groups.get(span.traceId);
    if (group) {
      group.push(span);
    } else {
      groups.set(span.traceId, [span]);
    }
  }
  return groups;
}

function timeMs(span: GenAiSpan): number {
  const raw = span.startTime ?? span.endTime;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Link a flat list of spans (expected to belong to a single trace — see
 * `groupSpansByTrace`) into a tree via `parentId`, and return the roots
 * (spans with no `parentId`).
 *
 * Fails loud rather than silently dropping/misplacing spans:
 *  - a span whose `parentId` doesn't resolve to another span in the input
 *    list throws (a genuinely missing parent looks different from "no
 *    parent" — the latter is simply `parentId === undefined`);
 *  - a parent/child cycle throws.
 *
 * Spans without a `spanId` can't be referenced as anyone's parent, so they
 * are always treated as roots.
 */
export function buildSpanTree(spans: GenAiSpan[]): GenAiSpan[] {
  const byId = new Map<string, GenAiSpan>();
  for (const span of spans) {
    if (span.spanId) {
      byId.set(span.spanId, { ...span, children: [] });
    }
  }

  const roots: GenAiSpan[] = [];
  for (const span of spans) {
    const node = span.spanId ? byId.get(span.spanId)! : { ...span, children: [] };
    if (!span.parentId) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(span.parentId);
    if (!parent) {
      throw new Error(
        `span-tree: span ${span.spanId ?? '<no id>'} references missing parent ${span.parentId} (trace ${span.traceId})`,
      );
    }
    parent.children!.push(node);
  }

  for (const node of byId.values()) {
    node.children!.sort((a, b) => timeMs(a) - timeMs(b));
  }
  roots.sort((a, b) => timeMs(a) - timeMs(b));

  // Cycle detection: DFS with a coloring scheme over the linked tree.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const state = new Map<string, number>();
  const visit = (node: GenAiSpan): void => {
    const id = node.spanId;
    if (id) state.set(id, GRAY);
    for (const child of node.children ?? []) {
      const childId = child.spanId;
      if (!childId) {
        visit(child);
        continue;
      }
      const childState = state.get(childId) ?? WHITE;
      if (childState === GRAY) {
        throw new Error(`span-tree: cycle detected involving span ${childId} (trace ${node.traceId})`);
      }
      if (childState === WHITE) visit(child);
    }
    if (id) state.set(id, BLACK);
  };
  for (const root of roots) visit(root);

  // A well-formed forest reaches every span from some root. A span whose
  // parent-chain loops back on itself with no root anywhere in the chain
  // (e.g. a <-> b, both pointing at each other) is never visited above —
  // catch that here rather than silently building an incomplete tree.
  for (const [id, node] of byId) {
    if (state.get(id) !== BLACK) {
      throw new Error(`span-tree: cycle detected involving span ${id} (trace ${node.traceId})`);
    }
  }

  return roots;
}

/**
 * A single turn in a reconstructed trajectory: one chat/agent exchange plus
 * any tool calls made while producing it. `spans` holds every span in the
 * turn, time-ordered; `chat` is the primary chat/agent span (undefined for a
 * leading run of tool calls with no preceding chat span); `toolCalls` is the
 * subset of `spans` classified as `kind: 'tool'`.
 */
export interface SpanTurn {
  index: number;
  chat?: GenAiSpan;
  toolCalls: GenAiSpan[];
  spans: GenAiSpan[];
  startTime?: string;
  endTime?: string;
}

/**
 * Flatten a span tree (rooted at `root`) into time-ordered turns. A new turn
 * starts at each `chat`/`agent`-kind span; any `tool`/`other`-kind spans that
 * follow are attached to the current turn until the next chat/agent span.
 */
export function segmentTurns(root: GenAiSpan): SpanTurn[] {
  const flat: GenAiSpan[] = [];
  const visit = (span: GenAiSpan): void => {
    flat.push(span);
    for (const child of span.children ?? []) visit(child);
  };
  visit(root);
  flat.sort((a, b) => timeMs(a) - timeMs(b));

  const turns: SpanTurn[] = [];
  let current: SpanTurn | undefined;
  for (const span of flat) {
    const kind = span.kind ?? 'other';
    if (kind === 'chat' || kind === 'agent') {
      current = { index: turns.length, chat: span, toolCalls: [], spans: [span] };
      turns.push(current);
    } else {
      if (!current) {
        current = { index: turns.length, toolCalls: [], spans: [] };
        turns.push(current);
      }
      if (kind === 'tool') current.toolCalls.push(span);
      current.spans.push(span);
    }
  }

  for (const turn of turns) {
    const starts = turn.spans.map(s => s.startTime).filter((t): t is string => !!t);
    const ends = turn.spans.map(s => s.endTime ?? s.startTime).filter((t): t is string => !!t);
    turn.startTime = starts[0];
    turn.endTime = ends[ends.length - 1];
  }

  return turns;
}

/**
 * Pick one representative root span per trace after tree reconstruction —
 * preferring a `chat`-kind root (or one with usable input+output) at the
 * latest end/start time, falling back to any root when none qualify. The
 * chosen root carries its `.children` (and therefore the whole tree) so
 * downstream consumers (e.g. PR2 trajectory judges) can walk it, while a
 * single `GenAiSpan` still flows through the existing sampling/masking/
 * scoring pipeline unchanged.
 */
export function pickRepresentativeRoot(roots: GenAiSpan[]): GenAiSpan | undefined {
  if (roots.length === 0) return undefined;
  const qualifies = (s: GenAiSpan) => s.kind === 'chat' || (!!s.input && !!s.output);
  const pool = roots.some(qualifies) ? roots.filter(qualifies) : roots;
  return pool.reduce((a, b) => (timeMs(a) >= timeMs(b) ? a : b));
}

/**
 * End-to-end helper for the `agent-trajectory` runner branch: group spans by
 * trace, build a tree per trace, and return one representative root per
 * trace with its `.children` tree attached.
 */
export function selectSpanTrees(spans: GenAiSpan[]): GenAiSpan[] {
  const representatives: GenAiSpan[] = [];
  for (const traceSpans of groupSpansByTrace(spans).values()) {
    const roots = buildSpanTree(traceSpans);
    const rep = pickRepresentativeRoot(roots);
    if (rep) representatives.push(rep);
  }
  return representatives;
}
