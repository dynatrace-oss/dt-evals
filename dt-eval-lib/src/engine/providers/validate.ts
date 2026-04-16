import { EvalResponseError } from "../../errors";
import type { LLMJudgeResponse } from "./types";

export function validateLLMResponse(parsed: unknown): LLMJudgeResponse {
  const response = parsed as Record<string, unknown>;

  // Standard format: { scoreValue, summary, reasoning }
  if (
    typeof response?.scoreValue === "number" &&
    Number.isFinite(response.scoreValue) &&
    typeof response?.summary === "string" &&
    typeof response?.reasoning === "string"
  ) {
    return {
      scoreValue: response.scoreValue as number,
      summary: response.summary as string,
      reasoning: response.reasoning as string,
    };
  }

  // Alternative format produced by some reasoning models:
  // { score: { value, label }, explanation: { summary, reasoning?, claims?, ... } }
  const score = response?.score as Record<string, unknown> | undefined;
  const explanation = response?.explanation as Record<string, unknown> | undefined;
  if (
    typeof score?.value === "number" &&
    Number.isFinite(score.value) &&
    typeof explanation?.summary === "string"
  ) {
    // Use reasoning if present; otherwise serialize the full explanation object
    // (models like Claude/gpt-5.x may return structured claims instead of free-text reasoning)
    const reasoning =
      typeof explanation?.reasoning === "string"
        ? explanation.reasoning
        : JSON.stringify(explanation);
    return {
      scoreValue: score.value as number,
      summary: explanation.summary as string,
      reasoning,
    };
  }

  const preview = JSON.stringify(parsed).slice(0, 200);
  throw new EvalResponseError(
    `Malformed LLM response: expected { scoreValue: number, summary: string, reasoning: string }, got ${preview}`,
  );
}
