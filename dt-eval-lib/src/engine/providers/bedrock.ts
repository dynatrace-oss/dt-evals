import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { EvalResponseError } from "../../errors";
import { BaseProvider } from "./base";
import type { LLMJudgeResponse, ProviderConfig } from "./types";
import { validateLLMResponse } from "./validate";

const SYSTEM_PROMPT =
  'You are an expert LLM evaluation judge. Respond only with valid JSON: {"scoreValue": <number>, "summary": "<string>", "reasoning": "<string>"}';

export class BedrockProvider extends BaseProvider {
  private client: BedrockRuntimeClient;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new BedrockRuntimeClient({
      region: config.region ?? "us-east-1",
      credentials: config.apiKey
        ? {
            accessKeyId: config.apiKey,
            secretAccessKey: config.secretKey ?? "",
          }
        : undefined,
    });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    const messages: Message[] = [{ role: "user", content: [{ text: prompt }] }];

    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.model,
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        inferenceConfig: { temperature: 0, maxTokens: 1024 },
      }),
      { abortSignal: AbortSignal.timeout(this.timeout) },
    );

    const content = response.output?.message?.content?.[0];
    const text = content && "text" in content ? content.text : undefined;

    if (!text) {
      throw new EvalResponseError("Bedrock returned an empty response");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new EvalResponseError(`Bedrock returned non-JSON content: ${text.slice(0, 200)}`);
    }
    return validateLLMResponse(parsed);
  }
}
