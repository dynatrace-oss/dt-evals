import OpenAI from "openai";
import { EvalResponseError } from "../../errors";
import { BaseProvider } from "./base";
import type { LLMJudgeResponse, ProviderConfig } from "./types";
import { validateLLMResponse } from "./validate";

interface ResponseSchema {
  name: string;
  strict: boolean;
  schema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: readonly string[];
    additionalProperties: boolean;
  };
}

const RESPONSE_SCHEMA = {
  name: "eval_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      scoreValue: { type: "number", description: "The evaluation score" },
      summary: { type: "string", description: "Brief summary of the evaluation" },
      reasoning: { type: "string", description: "Detailed reasoning for the score" },
    },
    required: ["scoreValue", "summary", "reasoning"],
    additionalProperties: false,
  },
} as const satisfies ResponseSchema;

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      timeout: this.timeout,
      maxRetries: 0,
    });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert LLM evaluation judge. Respond only with the requested JSON structure.",
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: RESPONSE_SCHEMA,
      },
      temperature: 0,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new EvalResponseError("OpenAI returned an empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new EvalResponseError(`OpenAI returned non-JSON content: ${content.slice(0, 200)}`);
    }
    return validateLLMResponse(parsed);
  }
}
