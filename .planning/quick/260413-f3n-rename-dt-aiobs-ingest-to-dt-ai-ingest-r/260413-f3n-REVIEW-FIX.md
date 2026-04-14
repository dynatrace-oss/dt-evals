---
phase: 260413-f3n-rename-dt-aiobs-ingest-to-dt-ai-ingest-r
fixed_at: 2026-04-13T00:00:00Z
review_path: .planning/quick/260413-f3n-rename-dt-aiobs-ingest-to-dt-ai-ingest-r/260413-f3n-REVIEW.md
iteration: 1
findings_in_scope: 15
fixed: 15
skipped: 0
status: all_fixed
---

# Phase 260413-f3n: Code Review Fix Report

**Fixed at:** 2026-04-13
**Source review:** `.planning/quick/260413-f3n-rename-dt-aiobs-ingest-to-dt-ai-ingest-r/260413-f3n-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 15
- Fixed: 15
- Skipped: 0

## Fixed Issues

| ID | Title | Files Modified | Commit |
|----|-------|----------------|--------|
| WR-01 | Wrong `event.provider` in DeepEval error-event path | `dt-ai-ingest/src/dt_ai_ingest/deepeval/evaluation.py` | `97c0002` |
| WR-02 | `build_eval_result_event` trailing blank line in dict literal | `dt-ai-ingest/src/dt_ai_ingest/schema.py` | `df0efc8` |
| WR-03 | `mlflow/evaluation.py` silently produces no events without warning | `dt-ai-ingest/src/dt_ai_ingest/mlflow/evaluation.py` | `e42d8a4` |
| WR-04 | `JSON.parse` not guarded in OpenAI provider | `dt-eval-lib/src/engine/providers/openai.ts` | `ee82e22` |
| WR-05 | Unreachable `throw lastError` after `callWithRetry` loop | `dt-eval-lib/src/engine/evaluate.ts` | `df8e960` |
| WR-06 | `_sync.py` re-raises `BaseException` without narrowing | `dt-ai-ingest/src/dt_ai_ingest/_sync.py` | `fe9beb2` |
| WR-07 | `dev` dependencies incomplete in `[project.optional-dependencies]` | `dt-ai-ingest/pyproject.toml` | `1d944aa` |
| WR-08 + IN-02 | Track provider object for idempotency; hash access token in `_otel.py` | `dt-ai-ingest/src/dt_ai_ingest/_otel.py` | `8f6416b` |
| IN-01 | `test_schema.py` tests non-existent `adapter_name` parameter | `dt-ai-ingest/src/dt_ai_ingest/schema.py` | `72487d5` |
| IN-03 | `renderPrompt` lacks comment on function-form `replace()` | `dt-eval-lib/src/engine/evaluate.ts` | `f966d72` |
| IN-04 | `_build_events` has unused `num_test_cases` parameter | `dt-ai-ingest/src/dt_ai_ingest/deepeval/evaluation.py` | `c02fefa` |
| IN-05 | `mlflow/tracing.py` — `_atexit_registered` not resettable in tests | `dt-ai-ingest/src/dt_ai_ingest/mlflow/tracing.py` | `667627e` |
| IN-06 | `callWithRetry` backoff unbounded | `dt-eval-lib/src/engine/evaluate.ts` | `775ee31` |
| IN-07 | Stale `AsyncClient` comment lacks GC trade-off and mitigation | `dt-ai-ingest/src/dt_ai_ingest/client.py` | `998f1b5` |

### WR-01: Wrong `event.provider` in DeepEval error-event path

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/deepeval/evaluation.py`
**Commit:** `97c0002`
**Applied fix:** Changed `"event.provider": "dt-eval-lib"` to `"event.provider": "deepeval"` in the manual error-case event dict inside `_build_events`.

### WR-02: `build_eval_result_event` trailing blank line in dict literal

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/schema.py`
**Commit:** `df0efc8`
**Applied fix:** Collapsed the multi-line dict literal with trailing blank line to a single-line `event: dict[str, Any] = {"event.type": "gen_ai.evaluation.result"}`.

### WR-03: `mlflow/evaluation.py` silently produces no events without warning

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/mlflow/evaluation.py`
**Commit:** `e42d8a4`
**Applied fix:** Added `import logging` and `logger = logging.getLogger(__name__)`, then added an `else` branch to the `if events:` block that emits `logger.warning(...)` when all metrics are filtered out.

### WR-04: `JSON.parse` not guarded in OpenAI provider

**Files modified:** `dt-eval-lib/src/engine/providers/openai.ts`
**Commit:** `ee82e22`
**Applied fix:** Wrapped `JSON.parse(content)` in a `try/catch` block that throws `EvalResponseError` with the first 200 characters of content on `SyntaxError`.

### WR-05: Unreachable `throw lastError` after `callWithRetry` loop

**Files modified:** `dt-eval-lib/src/engine/evaluate.ts`
**Commit:** `df8e960`
**Applied fix:** Removed the unreachable `throw lastError` statement after the loop, and also removed the now-unused `let lastError: unknown` declaration and its assignment inside the catch block.

### WR-06: `_sync.py` re-raises `BaseException` without narrowing

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/_sync.py`
**Commit:** `fe9beb2`
**Applied fix:** Split the single `if isinstance(result, BaseException): raise result` into two checks: first `if isinstance(result, Exception): raise result` for normal exceptions, then `if isinstance(result, BaseException): raise result from None` for true `BaseException` types (e.g., `KeyboardInterrupt`, `SystemExit`), with an explanatory comment.

### WR-07: `dev` dependencies incomplete in `[project.optional-dependencies]`

**Files modified:** `dt-ai-ingest/pyproject.toml`
**Commit:** `1d944aa`
**Applied fix:** Added `"pytest-asyncio>=1.3.0"` and `"pytest-httpx>=0.36.0"` to `[project.optional-dependencies].dev` so `pip install dt-ai-ingest[dev]` installs all test dependencies.

### WR-08 + IN-02: Track provider object for idempotency; hash access token in `_otel.py`

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/_otel.py`
**Commit:** `8f6416b`
**Applied fix (WR-08):** Added `_configured_provider: TracerProvider | None = None` module-level variable. Updated the fast-path check to `_configured_provider is current` so that if an external framework replaces the global provider, the function falls through and attaches the Dynatrace exporter to the new provider. Updated `_reset_configured_params()` to also reset `_configured_provider`.
**Applied fix (IN-02):** Added `import hashlib` and a `_hash_token()` helper. All three `_configured_params` assignments now store `token_hash` (SHA-256 hex digest) instead of the raw token string. The fast-path comparison uses the hash too.

### IN-01: `test_schema.py` tests non-existent `adapter_name` mapping

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/schema.py`
**Commit:** `72487d5`
**Applied fix:** Added `"adapter_name": "event.provider"` to `_EVAL_RESULT_FIELD_MAP` so the `test_adapter_name_field` test correctly maps `adapter_name` to `event.provider` in the resulting event dict.

### IN-03: `renderPrompt` lacks comment on function-form `replace()`

**Files modified:** `dt-eval-lib/src/engine/evaluate.ts`
**Commit:** `f966d72`
**Applied fix:** Added a multi-line comment before the `replace()` calls in `renderPrompt` explaining that the function form `() => value` is intentional to prevent `$` special-character (`$$`, `$&`, `$'`, `` $` ``, `$n`) backreference interpretation that would corrupt user-supplied strings.

### IN-04: `_build_events` has unused `num_test_cases` parameter

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/deepeval/evaluation.py`
**Commit:** `c02fefa`
**Applied fix:** Removed `num_test_cases: int` from the `_build_events` signature and updated the call site in `export_deepeval_results` to omit it. The value is still computed and stored in `shared_ctx["deepeval.num_test_cases"]` in the outer function.

### IN-05: `mlflow/tracing.py` — `_atexit_registered` not resettable in tests

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/mlflow/tracing.py`
**Commit:** `667627e`
**Applied fix:** Added `_reset_atexit_flag()` test-only helper function that resets `_atexit_registered` to `False`, analogous to `_otel._reset_configured_params()`.

### IN-06: `callWithRetry` backoff unbounded

**Files modified:** `dt-eval-lib/src/engine/evaluate.ts`
**Commit:** `775ee31`
**Applied fix:** Changed `const delay = 100 * 2 ** attempt` to `const delay = Math.min(100 * 2 ** attempt, 5000)` to cap the backoff at 5000ms, and updated the comment to document the cap.

### IN-07: Stale `AsyncClient` comment lacks GC trade-off and mitigation

**Files modified:** `dt-ai-ingest/src/dt_ai_ingest/client.py`
**Commit:** `998f1b5`
**Applied fix:** Expanded the one-line `"GC will clean up the socket."` comment into a full block comment documenting: (1) why `aclose()` cannot be called on a dead loop, (2) the trade-off of relying on CPython's reference-counting GC in long-lived processes or notebooks, and (3) the mitigation path of using `DynatraceClient` as an async context manager.

## Skipped Issues

None — all findings were fixed.

---

_Fixed: 2026-04-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
