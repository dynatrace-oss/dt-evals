import { GoogleGenAI, type types } from "@google/genai";
import { EvalResponseError } from "../../errors";
import { BaseProvider } from "./base";
import type { LLMJudgeResponse, ProviderConfig } from "./types";
import { validateLLMResponse } from "./validate";

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    scoreValue: { type: "number", description: "The evaluation score" },
    summary: { type: "string", description: "Brief summary of the evaluation" },
    reasoning: { type: "string", description: "Detailed reasoning for the score" },
  },
  required: ["scoreValue", "summary", "reasoning"],
} as const;

export interface GoogleProviderConfig extends ProviderConfig {
  /** When true, routes to Vertex AI; when false, routes to Gemini Developer API */
  vertexai: boolean;
  /** GCP project ID — required for Vertex AI, ignored for Gemini Developer API */
  project?: string;
  /** GCP region — used for Vertex AI (e.g. "global" or "us-central1"), ignored for Gemini Developer API */
  location?: string;
}

export class GoogleProvider extends BaseProvider {
  private client: GoogleGenAI;

  constructor(config: GoogleProviderConfig) {
    super(config);
    // For Vertex AI with Workload Identity, apiKey is empty — the @google/genai SDK
    // falls back to Application Default Credentials (ADC) automatically when vertexai=true
    // and no apiKey is supplied. project + location are required for Vertex AI.
    this.client = new GoogleGenAI({
      vertexai: config.vertexai,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.project ? { project: config.project } : {}),
      ...(config.location ? { location: config.location } : {}),
    });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    let response: types.GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          systemInstruction:
            "You are an expert LLM evaluation judge. Respond only with the requested JSON structure.",
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          temperature: 0,
          abortSignal: this.timeout > 0 ? AbortSignal.timeout(this.timeout) : undefined,
        },
      });
    } catch (error) {
      // Normalize AbortSignal timeout/abort errors so isTimeoutError() recognizes them
      const err = error as { name?: string; code?: string; type?: string };
      if (err?.name === "TimeoutError" || err?.name === "AbortError" || err?.code === "ABORT_ERR") {
        const wrapped = new Error(
          `Google AI request timed out after ${this.timeout}ms`,
        ) as Error & {
          code?: string;
          type?: string;
          cause?: unknown;
        };
        wrapped.code = "ETIMEDOUT";
        wrapped.type = "request-timeout";
        wrapped.cause = error;
        throw wrapped;
      }
      throw error;
    }

    const text = response.text;
    if (!text) {
      throw new EvalResponseError("Google AI returned an empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new EvalResponseError(`Google AI returned invalid JSON: ${text.slice(0, 200)}`);
    }
    return validateLLMResponse(parsed);
  }
}
