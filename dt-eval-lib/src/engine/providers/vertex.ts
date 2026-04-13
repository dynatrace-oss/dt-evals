import { GoogleGenAI } from "@google/genai";
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

export class VertexProvider extends BaseProvider {
  private client: GoogleGenAI;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new GoogleGenAI({ vertexai: true, apiKey: config.apiKey });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    const response = await this.client.models.generateContent({
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

    const text = response.text;
    if (!text) {
      throw new EvalResponseError("Vertex AI returned an empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new EvalResponseError(`Vertex AI returned invalid JSON: ${text.slice(0, 200)}`);
    }
    return validateLLMResponse(parsed);
  }
}
