import { EvalConfigError, EvalInputError, EvalResponseError, EvalTimeoutError } from "../errors";
import { getPrompt } from "../prompts/index";
import type { BuiltInMetric, PromptDefinition } from "../prompts/types";
import { computeScore } from "../scoring/index";
import { createProvider } from "./providers/index";
import type { LLMJudgeResponse } from "./providers/types";
import type { EvalConfig, EvalInput, EvalResult } from "./types";

/**
 * Main evaluation function.
 * Resolves the metric, validates input, renders the prompt,
 * calls the LLM provider, and computes the final score.
 */
export async function evaluate(
  metric: BuiltInMetric | PromptDefinition,
  input: EvalInput,
  config: EvalConfig,
): Promise<EvalResult> {
  const { provider: providerOptions, scoring } = config;

  const prompt = typeof metric === "string" ? getPrompt(metric) : metric;
  validateInput(input, prompt);

  const maxRetries = providerOptions.maxRetries ?? 2;
  if (maxRetries < 0 || !Number.isInteger(maxRetries)) {
    throw new EvalConfigError(`maxRetries must be a non-negative integer, got ${maxRetries}`);
  }

  const provider = await createProvider(providerOptions);
  const renderedPrompt = renderPrompt(prompt.prompt, input);

  const response = await callWithRetry(() => provider.call(renderedPrompt), maxRetries);

  const score = computeScore(response.scoreValue, prompt.scoring, scoring?.thresholdOverride);

  return {
    score,
    explanation: {
      summary: response.summary,
      reasoning: response.reasoning,
    },
  };
}

function validateInput(input: EvalInput, prompt: PromptDefinition): void {
  const missing: string[] = [];
  for (const field of prompt.requiredFields) {
    if (input[field as keyof EvalInput] == null) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new EvalInputError(
      `Missing required fields for metric "${prompt.id}": ${missing.join(", ")}`,
    );
  }
}

function renderPrompt(template: string, input: EvalInput): string {
  let rendered = template;
  // NOTE: The function form `() => value` is intentional on all replace() calls below.
  // Using a plain string replacement (e.g. `.replace(pattern, input.input)`) would
  // cause JavaScript to interpret `$$`, `$&`, `$'`, `` $` ``, and `$n` sequences in
  // the replacement string as special backreferences, silently corrupting any user
  // input that contains those characters. The function form bypasses this entirely.
  rendered = rendered.replace(/\{\{\s*input\s*\}\}/g, () => input.input);
  rendered = rendered.replace(/\{\{\s*output\s*\}\}/g, () => input.output);
  if (input.context != null) {
    const ctx = input.context;
    rendered = rendered.replace(/\{\{\s*context\s*\}\}/g, () => ctx);
  }
  if (input.expectedOutput != null) {
    const expected = input.expectedOutput;
    rendered = rendered.replace(/\{\{\s*expectedOutput\s*\}\}/g, () => expected);
  }
  rendered = rendered.replace(/\{\{\s*[\w_]+\s*\}\}/g, "");
  return rendered;
}

function isTransientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as Record<string, unknown>;
  const status = typeof err.status === "number" ? err.status : undefined;
  const code = typeof err.code === "string" ? err.code : undefined;
  // HTTP 429 (rate limit) or 5xx (server error)
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }
  // Network-level transient errors
  const transientCodes = ["ECONNRESET", "ECONNREFUSED", "EPIPE", "UND_ERR_CONNECT_TIMEOUT"];
  if (code !== undefined && transientCodes.includes(code)) return true;
  return false;
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as Record<string, unknown>;
  const code = typeof err.code === "string" ? err.code : undefined;
  const type = typeof err.type === "string" ? err.type : undefined;
  const nestedError =
    typeof err.error === "object" && err.error !== null
      ? (err.error as Record<string, unknown>)
      : undefined;
  const nestedType =
    nestedError && typeof nestedError.type === "string" ? nestedError.type : undefined;
  return code === "ETIMEDOUT" || type === "request-timeout" || nestedType === "timeout";
}

async function callWithRetry(
  fn: () => Promise<LLMJudgeResponse>,
  maxRetries: number,
): Promise<LLMJudgeResponse> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      // Don't retry non-transient errors
      if (error instanceof EvalResponseError || error instanceof EvalConfigError) {
        throw error;
      }

      if (isTimeoutError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        throw new EvalTimeoutError(`Request timed out: ${message}`);
      }

      if (!isTransientError(error) || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff capped at 5000ms: 100ms, 200ms, 400ms, ... up to 5s.
      const delay = Math.min(100 * 2 ** attempt, 5000);
      await sleep(delay);
    }
  }
  // Unreachable: the final attempt always throws above
  throw new EvalConfigError("callWithRetry: exhausted retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
