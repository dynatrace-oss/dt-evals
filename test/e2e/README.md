# dt-evals E2E Tests

Runs the **built** dt-evals CLI as a subprocess against a real Dynatrace tenant and a
real judge provider, and asserts what comes out — exit codes, structured output, and the
state left behind. Nothing in the eval path is mocked.

Internal quality gate, not a user-facing example. Owner: `group:default/team-ai-observability`.

Its own `package.json` keeps real secrets and judge spend off the pull-request path *by
construction*: `dt-eval-cli/vitest.config.ts` includes `tests/**/*.test.ts` and `ci-cli.yml`
runs `npm test` on every PR touching `dt-eval-cli/**`, so putting these tests there would
have made one deleted exclude glob enough to start billing a judge on every PR.

## Setup

Needs Node 20+, a Dynatrace tenant, and judge credentials (`validate`, `run`, `evallogic`).

```bash
cd dt-eval-cli && npm ci && npm run build   # the artifact under test
cd ../test/e2e && npm ci
cp .env.sample .env                          # fill in tenant + judge
npm run test:e2e
```

Without credentials the affected suites **skip** and log which variables are missing.
`E2E_REQUIRE_ENV=1` turns that into a failure — CI must set it, since a suite that skips
everything still reports green. It covers *every* credential gate, tenant and judge alike:
an earlier version guarded only the tenant, which let a CI run with the flag set skip the
`validate` and `run` suites and still exit 0. Both route through `reportMissingCredentials()`
in `src/env.ts`. `0`, `false` and `no` all mean off.

Non-default judge providers (`openai`, `anthropic`, `azure-openai`, `gemini`, `vertex`) read
the variables listed in `judgeFromEnv()` in `src/config.ts`. Azure needs `E2E_JUDGE_MODEL`
too, since the deployment name is the model. Vertex uses ADC, and
`GOOGLE_APPLICATION_CREDENTIALS` must be an absolute path — the CLI runs with a throwaway HOME.

## Suites

| Suite | What it covers | Needs |
|---|---|---|
| `harness.e2e.test.ts` | The suite's own logic: skip-vs-fail gate, redaction, leak detection, JSON parsing | nothing |
| `cli.e2e.test.ts` | Harness self-checks: isolated HOME and cwd, nothing inherited from the developer's environment, `assertNoSecrets` detects a real leak | nothing |
| `tenant.e2e.test.ts` | Tenant reachability both ways: a valid token connects, a bad one is rejected | tenant |
| `contract.e2e.test.ts` | The cross-repo contract with the fixture dataset — every attribute dt-evals depends on | tenant |
| `validate.e2e.test.ts` | `dt-evals validate`: every probe passing, and every probe failing | tenant + judge |
| `run.e2e.test.ts` | `dt-evals run`: `--dry-run` writing nothing, `--ci` output and run log, the destination round-trip, threshold behaviour per mode | tenant + judge, **writes** |
| `evallogic.e2e.test.ts` | Whether the evaluation is *correct*: the toxic fixture conversation is flagged and the clean one passes | tenant + judge, **writes** |

Run one with `npm run test:contract`, `npm run test:validate`, and so on. `npm run typecheck`
checks the workspace without running anything.

`e2e-pr-checks.yml` runs the typecheck and the whole suite on every PR with no credentials, so
only `harness`, `cli` and the conversation-id block of `contract` execute. It invokes the suite
whole rather than naming those files, so a credential-free test added later is covered
automatically instead of running nowhere.

`run.e2e.test.ts` and `evallogic.e2e.test.ts` are the two that write to the tenant.
`run.e2e.test.ts` evaluates whichever service `E2E_RUN_SERVICE` names, defaulting to the
fixture service; its assertions are structural, so it works against any tenant with GenAI
traffic. Assertions that depend on fixture *content* belong in `contract.e2e.test.ts`.

## Where the test data comes from

This suite **does not seed**. The spans come from `dt-evals-fixtures/opentelemetry/` in
[`dynatrace-ai-agent-instrumentation-examples`](https://github.com/dynatrace-oss/dynatrace-ai-agent-instrumentation-examples),
whose E2E workflow replays 28 deterministic conversations into the tenant nightly at
~03:00 UTC and again on every PR, under `service.name = dt-evals-fixtures`.

Two things about that cross-repo dependency:

- **Point `DT_APPS_ENDPOINT` at the tenant *that* repo's CI seeds.** Using your usual
  dt-evals tenant is the most common cause of a red contract suite.
- **Judge the seeding by its own job, not the nightly's overall result.** That workflow runs
  ~20 suites and is frequently red for unrelated ones while `dt-evals-fixtures-opentelemetry`
  passes.

## Contract findings

Verified against live fixture spans. One seeding emits **32 spans** — 28 cases, 24 single-turn
and 4 with two turns — so a lookback window usually holds several runs' worth. These are why
the baseline config looks the way it does:

| Attribute | Observed | What dt-evals needs |
|---|---|---|
| `gen_ai.operation.name` | `"chat"` on every span | Already in the CLI's default keep-list — no `scope.operationNames` override needed |
| `gen_ai.provider.name` / `gen_ai.system` | every span / none | Provider filter passes. Reads `"langchain"`, because the fixture model is a fake and vendor detection falls back to the framework |
| `gen_ai.input.messages` / `gen_ai.output.messages` | every span / every span | Match the CLI's defaults, no mapping needed |
| `gen_ai.system_instructions` | every span, **plural** | The CLI defaults to the singular `gen_ai.system_instruction`, so this needs `scope.spanFields.systemInstruction` |
| `gen_ai.context`, `gen_ai.reference` | grounding cases only | Non-semconv attributes that exist purely for dt-evals; need `scope.spanFields.context` |
| `gen_ai.conversation.id` | every span | Present, but `buildGenAiSpanQuery` never selects it — see below |

## CI

Secret scoping, the blocking-vs-verdict split and the notify issue lifecycle are documented as
comments in `.github/workflows/live_weekly_e2e.yml` and `.github/scripts/notify-e2e.sh`, next
to the code they govern.

Three jobs: `e2e` (blocking lane), `verdict` (evallogic, `continue-on-error` at *job* level so
it cannot turn the run red), and `notify`. The verdict lane is a separate job rather than a
step because `continue-on-error` masks a step failure but not a job timeout — sharing a cap
meant a slow blocking lane could cancel the job and get the verdict lane reported as a hard
failure.

### Accepted risk: no GitHub environment around the secrets

The five `E2E_*` credentials are plain **repository** secrets, not scoped to a GitHub
environment. `workflow_dispatch` lets the dispatcher choose any ref, and the workflow that
runs is the one on *that* ref — so anyone with push access can in principle run modified
workflow code with these secrets in scope, and runner log masking does not survive a
`base64`. There is no branch protection or ruleset on `main` either.

An `e2e` environment with a deployment branch policy limited to `main` would close this, but
creating one needs admin rights nobody working on this currently has, and the team decided
the extra setup cost isn't worth it right now — the same tradeoff already recorded for the
tenant/judge secrets in `ccb95a9`. Revisit if that changes; the repo's existing `release`
environment is the precedent for how it would look. GitHub OIDC would additionally remove the
static AWS keys, independent of the environment question.

### Known gap: `sampling: latest` is only "latest" on a small service

`buildGenAiSpanQuery` appends `| limit 1000` with no `sort` (`dt-eval-cli/src/dt/dql.ts`), so
the sampler picks the latest spans out of an arbitrary thousand rather than out of everything
in the window. Irrelevant for the fixture service, which produces 32 spans per seeding — but it
quietly invalidates the `latest` strategy for anyone who points `E2E_RUN_SERVICE` at real
traffic, which this suite explicitly invites. Product-side.

### Known gap: test records cannot be tagged

The design doc asks for every test record to be tagged so it can be found and cleaned up.
dt-evals has no mechanism: the bizevent payload is built from two fixed object literals
(`dt-eval-cli/src/dt/bizevent.ts`), and nothing in the config or flags adds custom attributes.
The only handles are `dt.service.name` (which changes *what* is evaluated, so it is not free),
the evaluator name, and the generated `dt.eval.run_id`, which `--ci` prints.

The flip side is retention: `run.e2e.test.ts` and `evallogic.e2e.test.ts` write real bizevents
into the tenant every week, indefinitely, with no cleanup job. Finding and deleting them needs
exactly the tagging this gap describes — closing one closes both.

### Known gap: evaluators cannot be scoped to the cases tagged for them

The design doc asks the suite to run evaluator *X* only against the cases whose `targets` name
*X*, so judge calls stay proportional to tagged spans. Not expressible today: `ScopeConfig`
(`dt-eval-cli/src/config/schema.ts`) offers `service`, `since`, `operationNames`, `sampling`
and `spanFields`, none of which filters by span attribute.

`evallogic.e2e.test.ts` works around it by scoring the most recent seeding in full and
asserting only on the two toxicity conversations — correct, but it spends ~40 judge calls where
two would do. Closing this needs a scope-level attribute filter in the product; the
operation-name filter is the precedent. Until then `targets` and `expect` go unused for the
other 13 evaluators.

### Known gap: multi-turn conversations do not group

Each fixture turn is its own root span in its own trace: a two-turn case measures as *n* turns
across *n* distinct traces. `dt-eval-cli/src/dt/dql.ts` selects `trace.id` without ever
selecting `gen_ai.conversation.id`, so dt-evals sees *n* single-turn conversations instead of
one *n*-turn thread. `contract.e2e.test.ts` asserts the shape so the gap stays documented;
closing it is a product change tracked separately.

Two things size it. The fixture app resends the accumulated history on every turn, so the
transcript *is* on the span — but `dql.ts` collapses `gen_ai.input.messages` to the last user
message before an evaluator sees it, so the resend does not compensate. On the other hand only
4 of the 28 cases have more than one turn, so the blast radius today is four conversations.
Worth fixing, not urgent.

## Conventions

- **`DT_APPS_ENDPOINT` vs `DT_ENV_URL`.** The suite prefers the former (the
  instrumentation-examples convention) and accepts the latter, which is what the CLI reads.
  Same host, translated in `tenantCliEnv()` in `src/cli.ts`.
- **Config in the file, credentials in the environment.** `saveConfig` strips secrets before
  writing, so a token in the YAML would test a shape the product never produces.
- **Configs are emitted as JSON.** YAML 1.2 is a superset of JSON, so this avoids a YAML
  dependency and hand-rolled quoting bugs. Deliberate — see `toConfigFile()`.
- **Never assert a score value.** Only pass/fail direction and structural shape. Judges are
  non-deterministic near the decision boundary; asserting a number buys flake.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `built CLI not found` | Run `npm ci && npm run build` in `dt-eval-cli`. The suite drives `dist/index.js`. |
| `no dt-evals-fixtures spans` | The message lists what to check in order: wrong tenant, then the upstream `dt-evals-fixtures-opentelemetry` job, then `E2E_FIXTURE_LOOKBACK`. |
| Everything skipped, suite green | Credentials are missing — the default locally. Set `E2E_REQUIRE_ENV=1` to make it a failure. |
| `origin cannot read spans bucket` | The token lacks `storage:spans:read` / `storage:buckets:read`. Grail answers a missing-scope query with SUCCEEDED and zero records rather than a 403, which is why the CLI probes it explicitly. |
