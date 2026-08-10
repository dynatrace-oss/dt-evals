#!/usr/bin/env bash
# Called by the notify job in live_weekly_e2e.yml after a scheduled run.
#
# Keeps exactly one open issue per label, following the same pattern as
# notify-nightly.sh in dynatrace-ai-agent-instrumentation-examples: comment on
# the open issue while the failure persists, create it if there is none, and
# close it once the run is clean again. A weekly workflow that nobody watches
# needs this — a red run with no notification is the same as no run at all.
#
# Three conditions are reported, because the design doc treats them differently:
#   1. The blocking lane failed — auth, connectivity, contract, pipeline. Hard.
#   2. The verdict lane failed — the judge disagreed about a fixture's expected
#      pass/fail direction. Alerts, but does not turn the run red by itself.
#   3. The job was cancelled. Almost always the 30-minute job timeout, since
#      nobody is at a keyboard at 06:00 on a Monday to press the button. That
#      has to alert: a run that hangs and says nothing is exactly the failure
#      this script exists to prevent. It must never *close* an issue, though —
#      a cancelled run proves nothing about recovery.
#
# Required env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, E2E_RESULT,
#               VERDICT_OUTCOME
set -euo pipefail

REPO="${GITHUB_REPOSITORY}"
RUN_URL="https://github.com/${REPO}/actions/runs/${GITHUB_RUN_ID}"
LABEL="e2e-alert"

# `needs.<job>.result` is success | failure | cancelled | skipped. Only skipped
# is genuinely nothing to say: the job never ran, so there is no evidence either
# way — most likely the environment's branch policy rejected it.
case "${E2E_RESULT:-}" in
  success | failure | cancelled) ;;
  *)
    echo "e2e was ${E2E_RESULT:-unknown} (never ran) — leaving any open issue untouched"
    exit 0
    ;;
esac

BLOCKING_FAILED=false
BLOCKING_CANCELLED=false
[ "${E2E_RESULT:-}" = "failure" ] && BLOCKING_FAILED=true
[ "${E2E_RESULT:-}" = "cancelled" ] && BLOCKING_CANCELLED=true

VERDICT_FAILED=false
[ "${VERDICT_OUTCOME:-}" = "failure" ] && VERDICT_FAILED=true

SHOULD_ALERT=false
if [ "$BLOCKING_FAILED" = "true" ] || [ "$BLOCKING_CANCELLED" = "true" ] || [ "$VERDICT_FAILED" = "true" ]; then
  SHOULD_ALERT=true
fi

echo "blocking lane: ${E2E_RESULT:-unknown} | verdict lane: ${VERDICT_OUTCOME:-not run} | alert: ${SHOULD_ALERT}"

# --repo is passed explicitly everywhere: the checkout runs with
# persist-credentials: false, so gh cannot infer it from the git remote.
#
# A failed lookup must not be read as "no issue is open" — that is how a
# transient gh error opens a duplicate and orphans the original, which nothing
# afterwards would ever comment on or close again.
#
# stdout and stderr are captured separately, not merged with 2>&1: OPEN_ISSUES
# is later word-split into issue numbers to close or comment on, and gh is
# known to write things like update-available notices to stderr even on a
# successful call. Merging them would feed that noise in as if it were a real
# issue number.
GH_STDERR="$(mktemp)"
trap 'rm -f "$GH_STDERR"' EXIT

if ! OPEN_ISSUES=$(gh issue list \
  --label "$LABEL" \
  --state open \
  --limit 100 \
  --json number \
  --jq '.[].number' \
  --repo "$REPO" 2>"$GH_STDERR"); then
  if [ "$SHOULD_ALERT" = "true" ]; then
    echo "::error::could not list issues, and this run needs to alert: $(cat "$GH_STDERR")"
    exit 1
  fi
  echo "::warning::could not list issues, but the run is green so there is nothing to report"
  exit 0
fi

if [ "$SHOULD_ALERT" = "false" ]; then
  if [ -z "${OPEN_ISSUES:-}" ]; then
    echo "All clear. No open issue to close."
    exit 0
  fi
  # Every matching issue, not just the newest: if a duplicate ever appeared,
  # acting only on the first would leave the other open forever.
  for issue in $OPEN_ISSUES; do
    # RUN_URL goes in as a %s argument, not baked into the format string: it is
    # built only from GITHUB_REPOSITORY/GITHUB_RUN_ID today, but a value with a
    # literal % in it would otherwise be interpreted as a printf directive.
    gh issue close "$issue" \
      --comment "$(printf '## E2E recovered\n\nBoth lanes are green again.\n\n**Run:** %s' "$RUN_URL")" \
      --repo "$REPO" || echo "Warning: failed to close issue #${issue}"
  done
  exit 0
fi

BODY_PARTS=""
if [ "$BLOCKING_FAILED" = "true" ]; then
  BODY_PARTS="${BODY_PARTS}$(printf '%b' "\n## Blocking lane failed\n\nOne of the hard checks did not pass — credentials, tenant connectivity, the fixture contract, or the run pipeline. This needs a look; it does not clear on its own.\n")"
fi
if [ "$BLOCKING_CANCELLED" = "true" ]; then
  BODY_PARTS="${BODY_PARTS}$(printf '%b' "\n## Run was cancelled\n\nOn a schedule this almost always means the job hit its 30-minute timeout rather than someone stopping it. Check where it stalled — a hanging tenant query and a judge being rate-limited both look like this.\n")"
fi
if [ "$VERDICT_FAILED" = "true" ]; then
  BODY_PARTS="${BODY_PARTS}$(printf '%b' "\n## Verdict lane failed\n\nThe judge did not return the expected pass/fail direction for the toxicity fixtures. Judges wobble, so re-run once before treating this as a regression. If it repeats, the evaluator or the fixture has genuinely changed.\n")"
fi

# Same reasoning as the close-comment above: RUN_URL and BODY_PARTS travel as
# %s arguments rather than interpolated into the format string. The format
# string's own \n is interpreted by printf regardless of which specifier
# handles the arguments.
BODY="$(printf '**Run:** %s\n%s' "$RUN_URL" "$BODY_PARTS")"

if [ -n "${OPEN_ISSUES:-}" ]; then
  for issue in $OPEN_ISSUES; do
    gh issue comment "$issue" \
      --body "$BODY" \
      --repo "$REPO" || echo "Warning: failed to comment on issue #${issue}"
  done
  exit 0
fi

# `gh issue create --label` fails outright if the label does not exist yet, so
# make sure it does. Harmless when it already does.
gh label create "$LABEL" \
  --description "Automated alerts from the weekly E2E run" \
  --color B60205 \
  --repo "$REPO" >/dev/null 2>&1 || true

TITLE="Weekly E2E alert"
[ "$BLOCKING_CANCELLED" = "true" ] && TITLE="Weekly E2E did not finish (cancelled or timed out)"
[ "$BLOCKING_FAILED" = "true" ] && [ "$VERDICT_FAILED" = "false" ] && TITLE="Weekly E2E failure: blocking lane"
[ "$BLOCKING_FAILED" = "false" ] && [ "$BLOCKING_CANCELLED" = "false" ] && [ "$VERDICT_FAILED" = "true" ] && TITLE="Weekly E2E: judge verdicts did not match the fixtures"

gh issue create \
  --title "$TITLE" \
  --body "$BODY" \
  --label "$LABEL" \
  --repo "$REPO" || echo "Warning: failed to create issue"
