import { segmentTurns } from './span-tree.js';
import type { GenAiSpan } from './types.js';
import type { ToolCallView } from '@dynatrace-oss/dt-eval-lib';

/** Cap on any single rendered value (chat content, tool arguments/result) to keep prompts bounded. */
const MAX_VALUE_LENGTH = 2000;

function truncate(value: string | undefined): string {
  if (!value) return '';
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

/**
 * Serialize a reconstructed span tree (rooted at `root`) into:
 *  - `trajectory`: a compact, human/LLM-readable rendering of the turns and
 *    tool calls, for LLM judges (via the `{{trajectory}}` prompt placeholder).
 *  - `toolCalls`: a flat structured list of every tool call in the tree, for
 *    the deterministic `tool_called` / `tool_not_called` methods.
 *
 * Pure function — no I/O, no side effects.
 */
export function serializeTrajectory(root: GenAiSpan): { trajectory: string; toolCalls: ToolCallView[] } {
  const turns = segmentTurns(root);
  const lines: string[] = [];
  const toolCalls: ToolCallView[] = [];

  turns.forEach((turn, i) => {
    lines.push(`Turn ${i + 1}:`);
    if (turn.chat) {
      if (turn.chat.userPrompt) {
        lines.push(`  user: ${truncate(turn.chat.userPrompt)}`);
      } else if (turn.chat.input) {
        lines.push(`  user: ${truncate(turn.chat.input)}`);
      }
      if (turn.chat.output) {
        lines.push(`  assistant: ${truncate(turn.chat.output)}`);
      }
    }
    for (const call of turn.toolCalls) {
      const name = call.toolName ?? '';
      const args = truncate(call.toolArguments);
      const result = truncate(call.toolResult);
      lines.push(`  - tool ${name}(${args}) -> ${result}`);
      toolCalls.push({
        name,
        ...(call.toolArguments !== undefined ? { arguments: call.toolArguments } : {}),
        ...(call.toolResult !== undefined ? { result: call.toolResult } : {}),
      });
    }
  });

  return { trajectory: lines.join('\n'), toolCalls };
}
