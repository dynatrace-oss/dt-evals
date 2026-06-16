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

/**
 * Strip a leading/trailing markdown code fence (e.g. ```json ... ```) that some
 * models — notably the Nova family — wrap JSON in despite being told to return
 * only raw JSON. Returns the trimmed input unchanged when no fence is present.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

export class BedrockProvider extends BaseProvider {
  private client: BedrockRuntimeClient;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new BedrockRuntimeClient({
      region: config.region ?? "us-east-1",
      // Only construct an explicit credential object when static keys are
      // configured. Otherwise leave credentials undefined so the AWS SDK's
      // default credential provider chain resolves them — this covers SSO /
      // temporary env credentials (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY +
      // AWS_SESSION_TOKEN), IAM roles and AWS_PROFILE.
      credentials:
        config.apiKey && config.secretKey
          ? { accessKeyId: config.apiKey, secretAccessKey: config.secretKey }
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
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      throw new EvalResponseError(`Bedrock returned non-JSON content: ${text.slice(0, 200)}`);
    }
    return validateLLMResponse(parsed);
  }
}
