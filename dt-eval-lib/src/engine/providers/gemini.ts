import { GoogleGenAI } from "@google/genai";
import { EvalResponseError } from "../../errors";
import { BaseProvider } from "./base";
import type { LLMJudgeResponse, ProviderConfig } from "./types";
import { validateLLMResponse } from "./validate";

const SYSTEM_INSTRUCTION =
  "You are an expert LLM evaluation judge. Respond only with the requested JSON structure.";

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    scoreValue: { type: "number" as const, description: "The evaluation score" },
    summary: { type: "string" as const, description: "Brief summary of the evaluation" },
    reasoning: { type: "string" as const, description: "Detailed reasoning for the score" },
  },
  required: ["scoreValue", "summary", "reasoning"],
};

export class GeminiProvider extends BaseProvider {
  private client: GoogleGenAI;

  constructor(config: ProviderConfig) {
    super(config);
    if (!config.apiKey) {
      throw new Error("Gemini requires an API key (GEMINI_API_KEY or GOOGLE_API_KEY)");
    }
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    });

    const text = response.text;
    if (!text) {
      throw new EvalResponseError("Gemini returned an empty response");
    }

    const parsed = JSON.parse(text);
    return validateLLMResponse(parsed);
  }
}
