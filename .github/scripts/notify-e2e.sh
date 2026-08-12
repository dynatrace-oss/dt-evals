#!/usr/bin/env bash
# Called by the notify job in e2e-live-weekly.yml after a scheduled run.
# Keeps exactly one open issue per label: comments while the failure
# persists, creates it if there is none, closes it once clean again.
#
# Four conditions, reported differently: (1) blocking lane failed — hard
# alert; (2) verdict lane failed — alerts but doesn't redden the run; (3)
# blocking lane cancelled — almost always its 120-min timeout, must alert but
# never close; (4) verdict lane cancelled — same idea, its own 30-min timeout.
#
# Required env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, E2E_RESULT,
#               VERDICT_OUTCOME
set -euo pipefail

REPO="${GITHUB_REPOSITORY}"
RUN_URL="https://github.com/${REPO}/actions/runs/${GITHUB_RUN_ID}"
LABEL="e2e-alert"

# Only "skipped" is genuinely nothing to say: the job never ran, no evidence either way.
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

VERDICT_CANCELLED=false
[ "${VERDICT_OUTCOME:-}" = "cancelled" ] && VERDICT_CANCELLED=true

SHOULD_ALERT=false
if [ "$BLOCKING_FAILED" = "true" ] || [ "$BLOCKING_CANCELLED" = "true" ] || [ "$VERDICT_FAILED" = "true" ] || [ "$VERDICT_CANCELLED" = "true" ]; then
  SHOULD_ALERT=true
fi

echo "blocking lane: ${E2E_RESULT:-unknown} | verdict lane: ${VERDICT_OUTCOME:-not run} | alert: ${SHOULD_ALERT}"

# --repo passed explicitly: persist-credentials: false means gh can't infer it from the remote.
# stderr captured separately: OPEN_ISSUES is word-split into issue numbers,
# and gh writes noise like update notices to stderr even on success.
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
  # Every matching issue, not just the newest, in case a duplicate appeared.
  for issue in $OPEN_ISSUES; do
    # RUN_URL as a %s argument, not baked into the format string, in case it ever contains a literal %.
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
if [ "$VERDICT_CANCELLED" = "true" ]; then
  BODY_PARTS="${BODY_PARTS}$(printf '%b' "\n## Verdict lane was cancelled\n\nIt hit its own 30-minute timeout before finishing, so the toxicity fixtures were never actually checked this run. A slow or rate-limited judge is the usual cause.\n")"
fi

# Same reasoning as above: RUN_URL and BODY_PARTS as %s arguments, not interpolated.
BODY="$(printf '**Run:** %s\n%s' "$RUN_URL" "$BODY_PARTS")"

if [ -n "${OPEN_ISSUES:-}" ]; then
  for issue in $OPEN_ISSUES; do
    gh issue comment "$issue" \
      --body "$BODY" \
      --repo "$REPO" || echo "Warning: failed to comment on issue #${issue}"
  done
  exit 0
fi

# `gh issue create --label` fails if the label doesn't exist yet; harmless if it already does.
gh label create "$LABEL" \
  --description "Automated alerts from the weekly E2E run" \
  --color B60205 \
  --repo "$REPO" >/dev/null 2>&1 || true

TITLE="Weekly E2E alert"
[ "$BLOCKING_CANCELLED" = "true" ] && TITLE="Weekly E2E did not finish (cancelled or timed out)"
[ "$BLOCKING_FAILED" = "true" ] && [ "$VERDICT_FAILED" = "false" ] && TITLE="Weekly E2E failure: blocking lane"
[ "$BLOCKING_FAILED" = "false" ] && [ "$BLOCKING_CANCELLED" = "false" ] && [ "$VERDICT_FAILED" = "true" ] && TITLE="Weekly E2E: judge verdicts did not match the fixtures"
[ "$BLOCKING_FAILED" = "false" ] && [ "$BLOCKING_CANCELLED" = "false" ] && [ "$VERDICT_FAILED" = "false" ] && [ "$VERDICT_CANCELLED" = "true" ] && TITLE="Weekly E2E: verdict lane timed out"

# Unlike the close/comment calls above, a failure here must redden this job: creating
# the alert is this script's one required job, and swallowing it with `|| echo` would
# leave a run that needs an alert silently unreported.
gh issue create \
  --title "$TITLE" \
  --body "$BODY" \
  --label "$LABEL" \
  --repo "$REPO"
