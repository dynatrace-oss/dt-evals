# Configuration

Full configuration reference for `dt-evals`. For evaluation concepts and the
types of supported evals (code evals or LLM-as-judge), see
[Evaluations](evaluations.md).

Config is resolved in this order:

| Priority | Source |
|----------|--------|
| 1 | Environment variables |
| 2 | Project config, usually `.dt-eval.yaml` |
| 3 | Global config, `~/.dt-eval/config.yaml` |
| 4 | Built-in defaults |

## Example config

```yaml
schemaVersion: 3
name: travel-assistant-prod

dynatrace:
  environmentUrl: https://your-env.live.dynatrace.com
  dtctlContext: my-prod-context

judge:
  provider: openai
  model: gpt-4.1
  timeout: 30000
  maxRetries: 2
  concurrency: 5

scope:
  service: travel-assistant
  since: 1h
  operationNames: [chat, text_completion, generate_content]
  sampling:
    strategy: random
    percent: 10

metrics:
  enabled:
    - faithfulness
    - hallucination
    - relevance
    - answer-completeness
    - id: valid-json
      method: json_schema
      params:
        schema:
          type: object
          required: [answer]
    - drift

alerts:
  thresholds:
    faithfulness: 0.7
    relevance: 0.7
    answer-completeness: 0.8

storeEvaluatedPrompt: false
```

## Scope

`scope` selects which spans to evaluate.

| Key | Default | Description |
|-----|---------|-------------|
| `service` | — | `service.name` filter |
| `since` | `1h` | Look-back window, e.g. `1h`, `24h` |
| `operationNames` | `[chat, text_completion, generate_content]` | GenAI operations to keep; `[]` disables the filter |
| `sampling` | random @ 5% | See below |
| `mode` | `span` | `span` (single-turn) or `trajectory` (multi-turn) — see [Evaluations](evaluations.md#evaluation-scope) |
| `maxConversations` | `200` | Trajectory only: conversation groups to consider before sampling |
| `maxMessages` | `50` | Trajectory only: max messages kept per conversation (oldest dropped) |
| `keepPartTypes` | `[text, tool_call, tool_call_response]` | Trajectory only: message part types to keep |

By default the runner keeps only chat/text-generation spans (`chat`,
`text_completion`, `generate_content`). Set `scope.operationNames` to narrow or
extend that keep-list; set it to `[]` only to disable the filter entirely.

Sampling strategies:

| Strategy | Example |
|----------|---------|
| Random percentage | `strategy: random`, `percent: 10` |
| Most recent traces | `strategy: latest`, `count: 200` |
| Error traces only | `strategy: errors-only` |

## Cross-tenant configuration

`dynatrace.environmentUrl` / `dynatrace.apiToken` describe a single tenant that
handles both reads and writes. To split them — fetch GenAI spans from one tenant
and write evaluation bizevents to another — use `origin` (read) and
`destination` (write):

```yaml
dynatrace:
  origin:
    environmentUrl: https://prod.live.dynatrace.com
  destination:
    environmentUrl: https://eval-results.dev.apps.dynatracelabs.com
```

Top-level `environmentUrl` / `apiToken` act as fallbacks — if either side omits
a field, the top-level value is used. A single-tenant config is just the
cross-tenant form with both sides empty.

The `validate` command probes each side separately, including a real
`fetch spans | limit 1` against the origin to catch a missing
`storage:spans:read` scope before a run is attempted.

## Required token scopes

| Scope | Required for |
|---|---|
| `storage:spans:read` | Reading GenAI spans (origin) |
| `storage:buckets:read` | Grail prerequisite — without this, DQL returns empty results silently |
| `storage:bizevents:read` | Drift detection baseline (reads past eval bizevents) |
| `storage:events:write` | Writing evaluation results as bizevents (destination) |
| `storage:metrics:write` | Writing evaluation metrics *(optional)* |
| `storage:logs:read` | `dt-evals validate` connectivity probe |

For `dt-evals alerts apply` (Dynatrace Workflows), grant these additionally on
the dtctl OAuth client:

| Scope | Required for |
|---|---|
| `automation:workflows:read` | `list`, `diff`, idempotent `apply` |
| `automation:workflows:write` | `apply`, `delete` |
| `automation:workflows:run` | Manual execution from the UI *(optional)* |

## Custom span field mapping

By default, the CLI reads OTel GenAI semconv (`gen_ai.input.messages`,
`gen_ai.output.messages`, …). It also probes a small set of legacy fallback
attributes (`gen_ai.prompt.N.*`, `gen_ai.completion.0.content`) for
compatibility with older emitters. If your spans expose the LLM I/O under
different attribute names — for example OpenInference (`llm.input_messages`,
`llm.output_messages`, `llm.model_name`) — point the CLI at them via
`scope.spanFields`. See the
[`dynatrace-ai-agent-instrumentation-examples`](https://github.com/dynatrace-oss/dynatrace-ai-agent-instrumentation-examples)
for end-to-end instrumentation examples.

Each entry accepts a single attribute or a list of candidates; the first
non-null value wins, with the built-in defaults appended as fallback.

**Example 1 — explicit legacy output mapping:**

```yaml
scope:
  service: pydantic-ai-music-agent
  spanFields:
    output: gen_ai.completion.0.content
```

The default output mapping uses `gen_ai.output.messages`. `spanFields` lets you
opt into legacy or emitter-specific attributes explicitly.

**Example 2 — OTel spans not following the GenAI SemConv (OpenInference):**

```yaml
scope:
  service: my-openinference-service
  since: 30m
  spanFields:
    input: [llm.input_messages, input.value]
    output: [llm.output_messages, output.value]
    model: llm.model_name
```

OpenInference usually stores chat turns in `llm.input_messages` /
`llm.output_messages` and plain-text payloads in `input.value` / `output.value`,
so listing both keeps the mapping resilient across instrumentations.

## Per-metric input routing

`dt-evals` ships multiple built-in metrics, or you can define your own — see
[Evaluations](evaluations.md#evaluation-types) for the catalog and details.

Metric entries in `metrics.enabled` accept either a string id (the legacy form)
or an object with `inputs` that overrides which canonical span field feeds each
evaluator input slot. This is useful when a metric should score only part of the
conversation — e.g. `user-frustration` evaluates the user's turn in isolation,
not the joined transcript:

```yaml
metrics:
  enabled:
    - faithfulness                                  # plain string form
    - id: user-frustration
      inputs:
        input: userPrompt
    - id: hallucination
      inputs:
        context: context
```

Available canonical fields: `input`, `output`, `context`, `systemInstruction`,
`model`, `userPrompt` (latest user-role prompt slot, extracted from
`gen_ai.prompt.N.role == "user"`). `context` has no built-in default span
attribute — if a span does not provide it, evaluator context is omitted unless
you explicitly route `inputs.context` elsewhere.

## Environment variables

```bash
DT_ENV_URL=https://your-env.live.dynatrace.com
DT_API_TOKEN=dt0c01.xxxxx
DT_DTCTL_CONTEXT=my-prod-context

# Cross-tenant overrides (optional — when set, these win over the top-level pair)
DT_ORIGIN_ENV_URL=https://prod.live.dynatrace.com
DT_ORIGIN_API_TOKEN=dt0s16.xxxxx
DT_DESTINATION_ENV_URL=https://eval-results.dev.apps.dynatracelabs.com
DT_DESTINATION_API_TOKEN=dt0s16.yyyyy

JUDGE_PROVIDER=openai
JUDGE_MODEL=gpt-4.1

OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://your-gateway.example.com/v1

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://your-proxy.example.com

# Google Gemini Enterprise Platform (Vertex AI)
GOOGLE_API_KEY=...
# Or authenticate via Workload Identity / Application Default Credentials instead of an API key.
# Set the target project and region (or judge.project / judge.location in config):
GOOGLE_CLOUD_PROJECT=my-gcp-project
GOOGLE_CLOUD_LOCATION=global
```

## Results in Dynatrace

Evaluation results are written as business events with
`event.type == "gen_ai.evaluation.result"`.

| Field | Meaning |
|-------|---------|
| `gen_ai.evaluation.name` | Evaluator name, for example `faithfulness` |
| `gen_ai.evaluation.score.value` | Numeric score |
| `gen_ai.evaluation.score.label` | `pass` or `fail` |
| `gen_ai.evaluation.score.explanation` | Short summary from the judge |
| `dt.eval.run_id` | Evaluation run identifier |
| `trace_id` | Source trace ID |
| `dt.service.name` | Service filter when configured |

Example DQL:

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
| summarize avg_score = avg(gen_ai.evaluation.score.value), by: { gen_ai.evaluation.name }
| sort avg_score asc
```

Drift results are written back as the same event type with
`gen_ai.evaluation.type == "drift"`.

## PII handling

For CLI trace evaluation runs, the following are masked in memory before content
is sent to an external judge model:

- email addresses
- phone numbers
- credit card numbers
- social security numbers

The original values are not sent to the judge by the CLI path.

## Data expectations

The CLI reads OTel GenAI semconv fields by default:

| Canonical field | Default attributes read |
|----------------|------------------------|
| `input` | `gen_ai.input.messages` |
| `output` | `gen_ai.output.messages` |
| `model` | `gen_ai.request.model` |
| `systemInstruction` | `gen_ai.system_instruction` |

This makes the CLI a good fit for apps instrumented with OpenTelemetry GenAI
conventions. For other tracing schemas — including OpenInference — use
`scope.spanFields` to map their attributes to the canonical fields above. A
small set of legacy fallback attributes (`gen_ai.prompt.<n>.content/role`,
`gen_ai.completion.0.content`) is also probed for compatibility with older
emitters.
