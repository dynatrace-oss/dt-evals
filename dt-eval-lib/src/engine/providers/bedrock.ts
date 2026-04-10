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
  "You are an expert LLM evaluation judge. Respond with a JSON object containing exactly three fields: scoreValue (number), summary (string), reasoning (string). No markdown, no code fences — just raw JSON.";

export class BedrockProvider extends BaseProvider {
  private client: BedrockRuntimeClient;

  constructor(config: ProviderConfig) {
    super(config);
    const region = config.region ?? process.env["AWS_REGION"] ?? "us-east-1";
    this.client = new BedrockRuntimeClient({ region });
  }

  async call(prompt: string): Promise<LLMJudgeResponse> {
    const messages: Message[] = [{ role: "user", content: [{ text: prompt }] }];

    const command = new ConverseCommand({
      modelId: this.model,
      messages,
      system: [{ text: SYSTEM_PROMPT }],
      inferenceConfig: { temperature: 0, maxTokens: 1024 },
    });

    const response = await this.client.send(command);

    const outputMessage = response.output?.message;
    const textBlock = outputMessage?.content?.find((b) => b.text !== undefined);

    if (!textBlock?.text) {
      throw new EvalResponseError("Bedrock returned an empty response");
    }

    // Strip optional markdown code fences that some models add
    const raw = textBlock.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    const parsed = JSON.parse(raw);
    return validateLLMResponse(parsed);
  }
}
