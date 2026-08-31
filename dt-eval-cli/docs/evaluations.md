# Evaluations

## How a run works

```text
fetch gen_ai.* spans  →  sample  →  mask PII  →  evaluate  →  write bizevents
    (scope.service,      (scope.    (in memory)  (judge or    (gen_ai.evaluation.result
     scope.since)         sampling)               code check)   in Dynatrace)
```

1. **Fetch** — query `gen_ai.*` spans from Dynatrace for the configured service and window.
2. **Sample** — reduce to the traces (or conversations, in trajectory mode) to score.
3. **Mask PII** — redact sensitive values in memory before content leaves the process.
4. **Evaluate** — run each enabled metric as an LLM-as-judge or a deterministic code check.
5. **Write bizevents** — write results back to Dynatrace as `gen_ai.evaluation.result`
   business events. If `drift` is enabled, it runs afterward against the historical baseline.

> **Trajectory mode** adds steps between *fetch* and *sample*: spans are grouped into
> conversations and one representative span (with truncated history) is selected per
> conversation. See [Evaluation scope](#evaluation-scope) below.

## Two axes

An evaluation in `dt-evals` is defined along two independent axes:

- **Scope** — *how much* is scored: a single turn (`span`) or a whole
  conversation (`trajectory`).
- **Type** — *what computes the score*: an LLM-as-judge or a deterministic
  code check.

The axes compose: an LLM judge or a code check can each run in span or
trajectory mode.

---

## Evaluation scope

Set with `scope.mode` (default `span`).

### Span — single-turn

Scores one span: a single user turn and the model's reply. In span mode the
input is collapsed to the latest user message.

**Use it for** per-response quality: relevance, safety, grounding/faithfulness,
retrieval (RAG) quality, PII leakage, prompt injection.

```yaml
scope:
  mode: span   # default — can be omitted
  since: 1h
```

### Trajectory — multi-turn (agentic)

Scores a whole conversation as one unit — the mode for agentic and multi-turn
assistants, where quality is a property of the entire session rather than any
single reply. It is **opt-in**: `scope.mode` defaults to `span`, so set
`mode: trajectory` to enable it.

**Use it for** conversation-level outcomes: goal/task completion, coherence
across turns, knowledge retention, and frustration that builds over a session.

#### How it works

1. **Fetch** — the query additionally pulls `gen_ai.conversation.id` and
   `gen_ai.response.finish_reasons`, ordered by most recent.
2. **Group** — spans are grouped into conversations by `gen_ai.conversation.id`
   (falling back to `trace.id` when the attribute is absent).
3. **Select** — one representative span is picked per conversation: the span whose
   `finish_reason` is `stop` (the completed turn), or the latest span otherwise.
4. **Rebuild history** — the representative span's `gen_ai.input.messages` (a JSON
   array of role-tagged messages) is treated as the full transcript. Each
   message's `parts` are filtered to `keepPartTypes`, messages left empty are
   dropped, and if the transcript exceeds `maxMessages` only the most recent
   `maxMessages` are kept.
5. The trajectory is then sampled, masked, and evaluated like any other input,
   and written back as a `gen_ai.evaluation.result` bizevent.

```yaml
scope:
  mode: trajectory
  since: 24h
  maxConversations: 200                                 # groups to consider before sampling (default 200)
  maxMessages: 50                                       # messages kept per conversation (default 50)
  keepPartTypes: [text, tool_call, tool_call_response]  # message parts to keep (default)
```

#### What you can tune

| Key | Default | What it controls |
|-----|---------|------------------|
| `maxConversations` | `200` | How many conversation groups to consider before sampling. Raise for wider coverage, lower to cut cost. |
| `maxMessages` | `50` | Max messages kept per trajectory; the oldest are dropped first. Lower it to keep judges within a smaller context. |
| `keepPartTypes` | `[text, tool_call, tool_call_response]` | Which message part types survive into the transcript. |

For example, to score only the natural-language turns and drop tool traffic:

```yaml
scope:
  mode: trajectory
  keepPartTypes: [text]
```

> **Sampling** here applies to conversations, not individual spans: `scope.sampling`
> selects a share of the grouped conversations (each represented by one span), drawn
> from at most `maxConversations`. See [Configuration](configuration.md#scope).

See [`examples/trajectory.dt-eval.yaml`](../examples/trajectory.dt-eval.yaml)
for a complete config.

#### Limitations and assumptions

- **Full history must be inlined in the span.** Trajectory mode assumes the
  representative span's `gen_ai.input.messages` carries the full conversation.
  This holds for stateless APIs that re-send history on each call, but **breaks
  for stateful APIs** (e.g. the OpenAI Responses API with `previous_response_id`)
  that keep history server-side.
- **Grouping degrades without `gen_ai.conversation.id`** — each trace becomes
  its own "conversation".
- **`maxConversations` is best-effort**, in first-seen order — not a strict
  most-recent-N guarantee.
- **Full-history extraction only applies to the default `gen_ai.input.messages`
  attribute.** Custom `scope.spanFields.input` mappings are not expanded into
  history.
- **Truncation is message-count based** (`maxMessages`), not token based.
- **Config-driven only** — there is no trajectory CLI flag; set `scope.mode`.

---

## Evaluation types

Set per metric in `metrics.enabled`. Omitting `method` selects the LLM-as-judge
default; adding a `method` selects a deterministic code check.

### LLM-as-judge

A judge model scores the span against a prompt. Use it for **subjective or
nuanced quality where there is no ground truth** — relevance, faithfulness,
tone, completeness.

`dt-evals` ships 14 built-in judge evaluators:

| Evaluator | Measures | Fields used |
|-----------|----------|-------------|
| `answer-completeness` | Whether all parts of the request were answered | `input`, `output` |
| `bias` | Harmful bias or unfair framing | `input`, `output` |
| `conciseness` | Whether the answer avoids filler and unnecessary padding | `input`, `output` |
| `context-relevance` | Retrieval quality for supplied context | `input` |
| `factual-accuracy` | Accuracy using world knowledge | `input`, `output` |
| `faithfulness` | Whether the answer is grounded in provided context | `input`, `output` |
| `fluency` | Grammar, clarity, and natural language quality | `input`, `output` |
| `hallucination` | Unsupported or fabricated claims | `input`, `output` |
| `pii-leakage` | Personally identifiable information in the answer | `input`, `output` |
| `prompt-injection` | Prompt injection attempts in the input | `input` |
| `relevance` | Whether the answer addresses the user request | `input`, `output` |
| `summarization-quality` | Summary faithfulness, coverage, and conciseness | `input`, `output` |
| `toxicity` | Harmful, offensive, or unsafe output | `output` |
| `user-frustration` | Frustration signals in the user's message | `input` |

#### Custom evaluators

Create a custom judge metric with `dt-evals evaluators add`, then enable it in
`metrics.enabled` like any built-in. Definitions are stored locally:

```json
{
  "id": "answer-style",
  "version": "1",
  "name": "Answer Style",
  "description": "Checks whether the answer is concise, direct, and well structured.",
  "prompt": "Evaluate the answer style for this request. User request: {{input}} Answer: {{output}} Return a continuous score from 0.0 to 1.0.",
  "requiredFields": ["input", "output"],
  "scoring": { "type": "continuous", "range": [0, 1], "threshold": 0.7 }
}
```

```bash
dt-evals evaluators add
dt-evals evaluators list
dt-evals evaluators show answer-style
dt-evals evaluators test answer-style
```

### Code (deterministic) evals

Not every check needs an LLM. Add a `method` to a metric entry to run a fast,
reproducible, **zero-cost** code check instead of a judge call. Each check
scores the span output as pass (`1.0`) or fail (`0.0`).

**Use it for** objective, structural checks — valid JSON, required keywords,
forbidden phrases, exact/regex matches — where the answer is unambiguous.

Available methods:

| Method | How it works | Suggested use |
|--------|--------------|---------------|
| `exact_match` | Passes when the output equals an expected value (routed via `inputs.expectedOutput`); `caseSensitive` / `trim` options | Check a fixed, canonical answer |
| `must_contain` | Passes when the output contains the keyword(s) — `mode: any` (one) or `all` (every) | Require a citation, disclaimer, or required token |
| `must_not_contain` | Fails when the output contains a forbidden keyword (`mode: any` / `all`) | Block refusals, confidential markers, or banned terms |
| `regex` | Passes when the output matches the `pattern` | Enforce a required format (ID, date, currency) |
| `must_not_match` | Fails when the output matches the `pattern` | Catch leaked patterns (IPs, emails, secrets) |
| `json_schema` | Passes when the output is bare JSON matching the `schema` | Validate structured or tool output |

```yaml
metrics:
  enabled:
    - id: cites-a-source
      method: must_contain
      params:
        keywords: ["source", "reference", "according to"]
        mode: any          # any = pass if one present; all = require every keyword

    - id: no-harmful-words
      method: must_not_contain
      params:
        keywords: ["harmful_word_1", "harmful_word_2"]
        mode: any          # fail if ANY blocked word appears (case-insensitive by default)

    - id: no-ip-leaked
      method: must_not_match
      params:
        pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b"

    - id: valid-response-object
      method: json_schema
      params:
        schema:
          type: object
          required: [answer]

    - id: exact-answer
      method: exact_match
      params:
        caseSensitive: false
        trim: true
      inputs:
        expectedOutput: context   # route the expected value to a canonical span field
```

Use `regex` for the opposite of `must_not_match` — pass only when the output
**does** match the pattern.

See [`examples/code-evals.dt-eval.yaml`](../examples/code-evals.dt-eval.yaml)
for a complete config.

#### Limitations

- **`json_schema` parses raw output**, so the output must be **bare** JSON — a
  response wrapped in markdown fences (` ```json … ``` `) will not parse.
- **Optional dependencies:** `json_schema` needs `ajv`; `regex` /
  `must_not_match` need `recheck` (for ReDoS safety).

---

## Drift detection

`drift` is a statistical metric (no LLM call) that compares current score
distributions against a 7-day baseline of prior evaluation events. Use it for
regressions that show up gradually rather than as single-run threshold breaches.

```yaml
metrics:
  enabled:
    - drift
```
