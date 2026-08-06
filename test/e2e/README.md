# dt-evals E2E Tests

End-to-end tests that run the **built** dt-evals CLI as a subprocess against a real
Dynatrace tenant and a real judge provider, and assert what comes out — exit codes,
structured output, and the state left behind. Nothing in the eval path is mocked.

Owner: `group:default/team-ai-observability`.

## Why this is a separate workspace

It has its own `package.json` so that real secrets and judge spend stay off the
pull-request path *by construction*. `dt-eval-cli/vitest.config.ts` includes
`tests/**/*.test.ts` and `ci-cli.yml` runs `npm test` on every PR touching
`dt-eval-cli/**` — putting these tests there would have made one deleted exclude
glob enough to start billing a judge on every pull request.

## Prerequisites

| Tool | Version | Required for |
|------|---------|--------------|
| Node | 20+ | running the suite |
| A built CLI | — | `npm ci && npm run build` in `dt-eval-cli` |
| Dynatrace tenant | — | all tenant-backed suites |
| Judge credentials | — | the `validate` suite |

## Setup

```bash
# 1. build the artifact under test
cd dt-eval-cli && npm ci && npm run build

# 2. configure and run
cd ../test/e2e && npm ci
cp .env.sample .env      # fill in DT_API_TOKEN and judge credentials
npm run test:e2e
```

Without credentials the affected suites **skip** and log which variables are missing.
Set `E2E_REQUIRE_ENV=1` to turn that into a failure — CI must do this, since a suite
that skips everything still reports green.

`E2E_REQUIRE_ENV` covers *every* credential gate, tenant and judge alike. That matters:
the tenant variables and the judge credentials are separate gates, and a version of
this that only guarded the tenant let a CI run with `E2E_REQUIRE_ENV=1` skip the
`validate` and `run` suites — half the suite — and still exit 0. Both now route through
`reportMissingCredentials()` in `src/env.ts`, so there is one place to get this right.
`E2E_REQUIRE_ENV=0`, `false` and `no` all mean off.

## Suites

| Suite | What it covers | Needs |
|---|---|---|
| `cli.e2e.test.ts` | Harness self-checks: the CLI runs from an isolated HOME and cwd, inherits nothing from the developer's environment, and `assertNoSecrets` detects a real leak | nothing |
| `tenant.e2e.test.ts` | Tenant reachability, both directions: a valid token connects, a bad one is rejected | tenant |
| `contract.e2e.test.ts` | The cross-repo contract with the fixture dataset — every attribute dt-evals depends on | tenant |
| `validate.e2e.test.ts` | `dt-evals validate`: every probe passing, and every probe failing except the spans-bucket scope | tenant + judge |
| `run.e2e.test.ts` | `dt-evals run`: `--dry-run` writing nothing, `--ci` output and run log, the destination round-trip, and threshold behaviour per mode | tenant + judge, **writes to the tenant** |
| `evallogic.e2e.test.ts` | Whether the evaluation is *correct*: the toxic fixture conversation is flagged and the clean one passes | tenant + judge, **writes to the tenant** |

Run one at a time with `npm run test:contract`, `npm run test:validate`, and so on.
`npm run typecheck` checks the workspace without running anything.

`e2e-pr.yml` runs the typecheck and the whole suite on every pull request, with no
credentials — so everything tenant-backed skips and only `cli.e2e.test.ts` plus the
conversation-id block of `contract.e2e.test.ts` actually execute. That gate exists
because the credentialed suite only runs weekly: without it a type error or a stale
assertion would sit undetected until Monday. It invokes the suite whole rather than
naming those two files, so a credential-free test added later is covered
automatically instead of running nowhere.

`run.e2e.test.ts` is the only suite that writes. It evaluates whichever service
`E2E_RUN_SERVICE` names, defaulting to the fixture service. Its assertions are about
shape and behaviour — output fields, exit codes, the run log, what lands in the tenant —
so it works against any tenant with GenAI traffic, which is handy when the fixture tenant
is not to hand. Assertions that depend on fixture *content* belong in `contract.e2e.test.ts`.

## Where the test data comes from

This suite **does not seed**. The GenAI spans it reads are produced by
`dt-evals-fixtures/opentelemetry/` in
[`dynatrace-oss/dynatrace-ai-agent-instrumentation-examples`](https://github.com/dynatrace-oss/dynatrace-ai-agent-instrumentation-examples),
whose E2E workflow replays 28 deterministic conversations into the tenant nightly at
~03:00 UTC and again on every pull request. They land under
`service.name = dt-evals-fixtures`.

That is a real cross-repo dependency, and two things about it are worth knowing:

- **Point `DT_APPS_ENDPOINT` at the tenant *that* repo's CI seeds.** Pointing at your
  usual dt-evals tenant is the most common cause of a red contract suite — the spans
  simply are not there.
- **Judge the seeding by its own job, not by the nightly's overall result.** That
  workflow runs ~20 suites; it is frequently red for unrelated ones while
  `dt-evals-fixtures-opentelemetry` passes. The overall conclusion is a poor proxy.

## Contract findings

Verified against live fixture spans. One seeding emits **32 spans** — 28 cases, of
which 24 are single-turn and 4 have two turns — so a lookback window usually holds
several runs' worth. The counts below are ratios against whatever the window holds,
not absolute numbers. These are the reasons the suite's baseline config looks the
way it does:

| Attribute | Observed | What dt-evals needs |
|---|---|---|
| `gen_ai.operation.name` | `"chat"` on every span | Already in the CLI's default keep-list — no `scope.operationNames` override needed |
| `gen_ai.provider.name` / `gen_ai.system` | 96 / 0 | Provider filter passes. The value reads `"langchain"`, because the fixture model is a fake and vendor detection falls back to the framework |
| `gen_ai.input.messages` / `gen_ai.output.messages` | 96 / 96 | Match the CLI's defaults, no mapping needed |
| `gen_ai.system_instructions` | 96, **plural** | The CLI defaults to the singular `gen_ai.system_instruction`, so this needs `scope.spanFields.systemInstruction` |
| `gen_ai.context`, `gen_ai.reference` | present on grounding cases only | Non-semconv attributes that exist purely for dt-evals; need `scope.spanFields.context` |
| `gen_ai.conversation.id` | on every span | Present, but `buildGenAiSpanQuery` never selects it — see below |

## Provisioning CI and the two lanes

Environment setup, secret scoping, the blocking-vs-verdict split, and the notify
issue lifecycle are all documented as comments directly in `.github/workflows/e2e-weekly.yml`
and `.github/scripts/notify-e2e.sh`, next to the code they govern — start there.

### Known gap: `sampling: latest` is only "latest" on a small service

`buildGenAiSpanQuery` appends `| limit 1000` with no `sort`
(`dt-eval-cli/src/dt/dql.ts`), so the sampler picks the latest spans out of an
arbitrary thousand rather than out of everything in the window. Irrelevant for
the fixture service, which produces 32 spans per seeding — but it quietly
invalidates the `latest` strategy for anyone who points `E2E_RUN_SERVICE` at
real traffic, which this suite explicitly invites. Product-side.

### The spans-bucket failure test needs a second token

The test exists and skips until `E2E_DT_MISSCOPED_TOKEN` is set. It needs a
*second* tenant token, because you cannot provoke this failure by breaking the
good one: a wholly invalid token fails the connection probe first and the run
never reaches the bucket check.

Mint one with `storage:logs:read` (so the connection probe still passes) and
**without** `storage:spans:read`. Anything else is optional. Store it as the
`E2E_DT_MISSCOPED_TOKEN` environment secret.

It is the probe most worth having a negative case for: Grail answers a query
whose token lacks the scope with SUCCEEDED-and-zero-records rather than a 403, so
a regression that made this probe always report OK would turn a misscoped token
into "the tenant looks empty".

### Known gap: test records cannot be tagged

The design doc asks for every test record to be tagged so it can be found and
cleaned up. dt-evals has no mechanism for it: the bizevent payload is built from
two fixed object literals (`dt-eval-cli/src/dt/bizevent.ts`), and nothing in the
config or the flags adds custom attributes. The only handles are `dt.service.name`
(which changes *what* is evaluated, so it is not free), the evaluator name, and
the generated `dt.eval.run_id` — which the `--ci` output prints, so a run's
records can at least be found after the fact by run id.

### Known gap: evaluators cannot be scoped to the cases tagged for them

The design doc asks the suite to run evaluator *X* only against the cases whose
`targets` name *X*, so judge calls stay proportional to tagged spans. That is not
implemented, because it is not currently expressible: `ScopeConfig`
(`dt-eval-cli/src/config/schema.ts`) offers `service`, `since`, `operationNames`,
`sampling` and `spanFields`, and none of them filters by span attribute.

`evallogic.e2e.test.ts` works around it by scoring the most recent seeding in full
and asserting only on the two toxicity conversations — correct, but it spends ~40
judge calls where two would do. Closing this needs a scope-level attribute filter
in the product; the operation-name filter is the precedent for how that looks.
Until then, `targets` and `expect` go unused for the other 13 evaluators.

### Known gap: multi-turn conversations do not group

Each fixture turn is its own root span in its own trace: a two-turn case measures as
*n* turns across *n* distinct traces. `dt-eval-cli/src/dt/dql.ts` selects `trace.id`
without ever selecting `gen_ai.conversation.id`, so dt-evals sees *n* single-turn
conversations instead of one *n*-turn thread. `contract.e2e.test.ts` asserts the shape
so the gap is documented rather than forgotten; closing it is a product change tracked
separately.

Two things size it. The fixture app resends the accumulated history on every turn, so
the transcript *is* on the span — but `dql.ts` collapses `gen_ai.input.messages` to the
last user message before an evaluator sees it, so the resend does not compensate. On the
other hand only 4 of the 28 cases have more than one turn, so the blast radius today is
four conversations. Worth fixing, not urgent.

## Conventions worth knowing

- **`DT_APPS_ENDPOINT` vs `DT_ENV_URL`.** The suite prefers the former (the
  instrumentation-examples convention) and accepts the latter as a fallback, which is
  what the CLI reads and what this repo's existing tenant workflow already stores as a
  secret. Same host, translated in `tenantCliEnv()` in `src/cli.ts`.
- **Config in the file, credentials in the environment.** `saveConfig` strips secrets
  before writing, so a token in the YAML would test a shape the product never produces.
- **Configs are emitted as JSON.** YAML 1.2 is a superset of JSON, so a JSON document
  is valid input for the CLI's parser. This avoids a YAML dependency and hand-rolled
  quoting bugs. Deliberate — see `toConfigFile()`.
- **Never assert a score value.** Only pass/fail direction and structural shape. Judges
  are non-deterministic near the decision boundary; asserting a number buys flake.

## Troubleshooting

**`built CLI not found`**
Run `npm ci && npm run build` in `dt-eval-cli`. The suite drives `dist/index.js`, the
artifact `package.json#bin` maps `dt-evals` to.

**Contract suite fails with "no dt-evals-fixtures spans"**
The message lists what to check, in order of likelihood: wrong tenant, then the upstream
`dt-evals-fixtures-opentelemetry` job, then `E2E_FIXTURE_LOOKBACK`.

**Everything skipped, suite still green**
Credentials are missing. That is the default behaviour locally; set `E2E_REQUIRE_ENV=1`
to make it a failure.

**`origin cannot read spans bucket`**
The token lacks `storage:spans:read` / `storage:buckets:read`. Grail answers a
missing-scope query with SUCCEEDED and zero records rather than a 403, which is exactly
why the CLI probes this explicitly instead of inferring it from an empty result.
