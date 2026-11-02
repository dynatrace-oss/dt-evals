#!/usr/bin/env bash
# Called by the "Notify Slack of dependency vulnerabilities" step in the
# weekly dependency-audit.yml workflow. Aggregates `npm audit --json` output
# across the four workspaces with their own lockfile (dt-eval-lib,
# dt-eval-cli, dt-eval-deploy, test/e2e) and posts one Slack message if any
# of them found something. A missing or unparsable audit file counts
# as zero vulnerabilities for that workspace, not an error — `npm audit`
# itself already ran with `|| true`, so a missing file just means that step's
# own failure mode, not a vulnerability finding.
#
# Required env: SLACK_HOOK, AUDIT_FILES (space-separated paths to npm-audit
# JSON files). GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL come from
# the runner's default environment, same as notify-e2e.sh's GITHUB_REPOSITORY.
set -euo pipefail

RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

TOTAL=0
CRITICAL=0
HIGH=0
MODERATE=0
LOW=0
INFO=0
AFFECTED=""
SUMMARY_BODY=""

# Markdown table of every vulnerable package in one audit file, worst first.
# `via` holds either advisory objects (the package itself is vulnerable) or
# plain strings (it is only vulnerable through that parent package).
# `fixAvailable` is true, false, or an object {name, version, isSemVerMajor}.
SUMMARY_JQ='
  def rank: {"critical":0,"high":1,"moderate":2,"low":3,"info":4}[.] // 5;
  def esc: gsub("\\|"; "\\|") | gsub("\n"; " ");
  def via: [.via[] | if type == "string" then "via `\(.)`"
                     else "[\(.title | esc)](\(.url))" end] | join("<br>");
  def fix:
    if .fixAvailable == true then "`npm audit fix`"
    elif (.fixAvailable | type) == "object" then
      (if .fixAvailable.isSemVerMajor then "breaking: " else "" end)
      + "`\(.fixAvailable.name)@\(.fixAvailable.version)`"
    else "no fix" end;
  "| Package | Severity | Via | Fix |",
  "|---|---|---|---|",
  ([.vulnerabilities | to_entries[] | .value + {pkg: .key}]
    | sort_by([(.severity | rank), .pkg])[]
    | "| `\(.pkg)`\(if .isDirect then " (direct)" else "" end) | \(.severity) | \(via) | \(fix) |")
'

for FILE in ${AUDIT_FILES:-}; do
  [ -f "$FILE" ] || continue

  # npm audit's JSON schema (v7+) nests severity counts under .metadata.vulnerabilities.
  # A file that fails to parse (e.g. empty, or an npm error dumped instead of audit
  # JSON) is treated as zero findings rather than crashing the notify step.
  WS_TOTAL="$(jq -r '.metadata.vulnerabilities.total // 0' "$FILE" 2>/dev/null || echo 0)"
  [ "$WS_TOTAL" = "null" ] && WS_TOTAL=0

  if [ "$WS_TOTAL" -gt 0 ] 2>/dev/null; then
    WS_NAME="$(basename "$FILE" -audit.json)"
    AFFECTED="${AFFECTED}${AFFECTED:+, }${WS_NAME} (${WS_TOTAL})"

    CRITICAL=$((CRITICAL + $(jq -r '.metadata.vulnerabilities.critical // 0' "$FILE")))
    HIGH=$((HIGH + $(jq -r '.metadata.vulnerabilities.high // 0' "$FILE")))
    MODERATE=$((MODERATE + $(jq -r '.metadata.vulnerabilities.moderate // 0' "$FILE")))
    LOW=$((LOW + $(jq -r '.metadata.vulnerabilities.low // 0' "$FILE")))
    INFO=$((INFO + $(jq -r '.metadata.vulnerabilities.info // 0' "$FILE")))
    TOTAL=$((TOTAL + WS_TOTAL))

    SUMMARY_BODY="${SUMMARY_BODY}
### ${WS_NAME} (${WS_TOTAL})

$(jq -r "$SUMMARY_JQ" "$FILE")
"
  fi
done

if [ "$TOTAL" -eq 0 ]; then
  echo "No vulnerabilities found across audited workspaces."
  exit 0
fi

echo "Found ${TOTAL} vulnerabilities: ${AFFECTED}"

# Job summary: full per-package list, shown on the run page. Written before the
# Slack step so it is there even when SLACK_HOOK is unset or delivery fails.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '## npm audit: %d vulnerabilities\n%s\n' "$TOTAL" "$SUMMARY_BODY" >> "$GITHUB_STEP_SUMMARY"
fi

TEXT="$(printf ':rotating_light: *npm audit found %d vulnerabilit%s* in `%s`\n*By severity:* critical %d, high %d, moderate %d, low %d, info %d\n*Workspaces:* %s\n*Details:* <%s|vulnerable packages and fixes (job summary)>' \
  "$TOTAL" "$([ "$TOTAL" -eq 1 ] && echo y || echo ies)" "$GITHUB_REPOSITORY" \
  "$CRITICAL" "$HIGH" "$MODERATE" "$LOW" "$INFO" \
  "$AFFECTED" "$RUN_URL")"

# "channel" only takes effect for legacy custom-integration webhooks; modern
# Slack-app incoming webhooks are bound to one fixed channel and ignore it.
# Harmless to send either way — jq -n keeps TEXT from ever breaking out of
# the JSON string the way hand-escaped shell interpolation could.
PAYLOAD="$(jq -n --arg text "$TEXT" --arg channel "#int-team-ai-observability-evals" '{text: $text, channel: $channel}')"

if [ -z "${SLACK_HOOK:-}" ]; then
  echo "SLACK_HOOK secret not set — skipping vulnerability notification"
  exit 0
fi

curl --fail --silent --show-error -X POST \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD" \
  "$SLACK_HOOK"
