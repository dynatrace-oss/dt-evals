import { AzureOpenAI } from "openai";
import { EvalConfigError, EvalResponseError } from "../../errors";
import { BaseProvider } from "./base";
import type { LLMJudgeResponse, ProviderConfig } from "./types";
import { validateLLMResponse } from "./validate";

export class AzureOpenAIProvider extends BaseProvider {
  private client: AzureOpenAI;

  constructor(config: ProviderConfig) {
    super(config);
    if (!config.baseUrl) {
      throw new EvalConfigError(
        "azure-openai requires baseUrl (e.g. https://my-resource.openai.azure.com/)",
      );
    }
    if (!config.apiVersion) {
      throw new EvalConfigError(
        "azure-openai requires apiVersion (e.g. 2025-04-01-preview). Check your Azure deployment's supported API versions.",
      );
    }
    this.client = new AzureOpenAI({
      endpoint: config.baseUrl.replace(/\/$/, ""),
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      deployment: config.model,
      timeout: config.timeout,
      maxRetries: 0,
    });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    // Use json_object mode — Azure deployment model versions vary in structured-output support.
    // temperature is omitted intentionally: reasoning models (o-series, gpt-5.x) only accept the
    // default value and will reject an explicit 0.
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            'You are an expert LLM evaluation judge. Respond only with valid JSON: {"scoreValue": <number>, "summary": "<string>", "reasoning": "<string>"}',
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new EvalResponseError("Azure OpenAI returned an empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new EvalResponseError(
        `Azure OpenAI returned non-JSON content: ${content.slice(0, 200)}`,
      );
    }
    return validateLLMResponse(parsed);
  }
}
