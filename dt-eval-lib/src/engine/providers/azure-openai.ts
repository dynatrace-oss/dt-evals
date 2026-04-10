import { AzureOpenAI } from "openai";
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

export class AzureOpenAIProvider extends BaseProvider {
  private client: AzureOpenAI;

  constructor(config: ProviderConfig) {
    super(config);
    if (!config.apiKey) {
      throw new Error("AzureOpenAI requires an API key (AZURE_OPENAI_API_KEY)");
    }
    if (!config.baseUrl) {
      throw new Error("AzureOpenAI requires an endpoint (AZURE_OPENAI_ENDPOINT)");
    }
    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.baseUrl,
      // Use a recent stable API version; can be overridden via baseUrl if needed
      apiVersion: "2024-02-01",
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
      throw new EvalResponseError("Azure OpenAI returned an empty response");
    }

    const parsed = JSON.parse(content);
    return validateLLMResponse(parsed);
  }
}
