export interface GenAiSpan {
  traceId: string;
  spanId?: string;
  startTime?: string;
  endTime?: string;
  input: string;              // evaluator input after span-field/default parsing
  output: string;             // parsed evaluator output
  context?: string;           // evaluator context from scope.spanFields.context
  systemInstruction?: string; // gen_ai.system_instruction
  system?: string;            // gen_ai.provider.name (e.g. "openai")
  operationName?: string;     // gen_ai.operation.name (e.g. "chat", "text_completion")
  requestModel?: string;      // gen_ai.request.model
  /** Latest user-role content extracted from prompt slots or structured messages.
   * Useful for metrics that should score the user's turn alone. */
  userPrompt?: string;
  isError?: boolean;
}

export interface BizeventPayload {
  'event.type': 'gen_ai.evaluation.result';
  'event.provider'?: string;
  'trace_id': string;
  'span_id'?: string;
  'gen_ai.response.id'?: string;
  'span.start_time'?: string;
  'span.end_time'?: string;
  'timestamp'?: string;
  'gen_ai.evaluation.name': string;
  'gen_ai.evaluation.type': 'ready_made';
  'gen_ai.evaluation.version': string;
  'gen_ai.evaluation.spec_id': string;
  'gen_ai.evaluation.scoring_format': string;
  'gen_ai.evaluation.score.value': number;
  'gen_ai.evaluation.score.label': 'pass' | 'fail';
  'gen_ai.evaluation.explanation': string;
  'gen_ai.evaluation.method': 'llm_as_judge';
  /** Only present when `storeEvaluatedPrompt` is enabled. */
  'gen_ai.evaluation.input.question'?: string;
  /** Only present when `storeEvaluatedPrompt` is enabled. */
  'gen_ai.evaluation.input.answer'?: string;
  /** Only present when `storeEvaluatedPrompt` is enabled. */
  'gen_ai.evaluation.input.system_prompt'?: string;
  'gen_ai.request.model'?: string;
  'gen_ai.provider.name'?: string;
  'dt.service.name'?: string;
  'dt.eval.run_id': string;
  'gen_ai.eval.client': string;
  'gen_ai.eval.client.version': string;
}
