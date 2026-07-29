import OpenAI from "openai";
import { EvalConfigError, EvalResponseError } from "../../errors";
import { BaseProvider } from "./base";
import type { LLMJudgeResponse, ProviderConfig } from "./types";
import { validateLLMResponse } from "./validate";

export class OpenAICompatibleProvider extends BaseProvider {
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    super(config);
    if (!config.baseUrl) {
      throw new EvalConfigError(
        "openai-compatible requires baseUrl (e.g. http://localhost:11434/v1 for Ollama)",
      );
    }
    this.client = new OpenAI({
      // LiteLLM and other servers require a real key; Ollama accepts any non-empty string.
      apiKey: config.apiKey || "ollama",
      baseURL: config.baseUrl,
      timeout: config.timeout,
      maxRetries: 0,
    });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    // Use json_object mode — broadly supported by LiteLLM, Ollama (≥0.1.15), and most
    // OpenAI-compatible servers. Temperature is omitted for compatibility with reasoning models.
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            'You are an expert LLM evaluation judge. Respond only with valid JSON: {"scoreValue": <number 0-1>, "summary": "<string>", "reasoning": "<string>"}',
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new EvalResponseError("OpenAI-compatible endpoint returned an empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new EvalResponseError(
        `OpenAI-compatible endpoint returned non-JSON content: ${content.slice(0, 200)}`,
      );
    }
    return validateLLMResponse(parsed);
  }
}
