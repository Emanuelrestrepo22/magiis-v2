#!/usr/bin/env bash
# scripts/notify-teams.sh
# Postea una adaptive card a un canal de Microsoft Teams via Workflow webhook.
# Disenado para CI - lee variables de entorno del job de GitHub Actions.
#
# Inputs (env vars):
#   TEAMS_WEBHOOK_URL  - URL del webhook de Teams/Power Automate
#   PROJECT            - tag del proyecto (e.g. carrier-v2-e2e)
#   SUITE              - nombre del suite (e.g. smoke, regression, visual, a11y)
#   JOB_STATUS         - resultado del job (success|failure|cancelled|skipped)
#   GITHUB_REF_NAME    - branch (auto-provista por GitHub Actions)
#   GITHUB_SHA         - commit hash (auto-provista)
#   GITHUB_SERVER_URL  - https://github.com (auto-provista)
#   GITHUB_REPOSITORY  - owner/repo (auto-provista)
#   GITHUB_RUN_ID      - run id (auto-provista)
#
# Uso (en un step de workflow):
#   env:
#     TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}
#     PROJECT: carrier-v2-e2e
#     SUITE: smoke
#     JOB_STATUS: ${{ job.status }}
#   run: bash scripts/notify-teams.sh
#
# Salida: 0 si el POST fue exitoso, 1 si fallo. El workflow puede usar continue-on-error: true.

set -euo pipefail

if [ -z "${TEAMS_WEBHOOK_URL:-}" ]; then
  echo "TEAMS_WEBHOOK_URL no configurada - abortando notificacion Teams."
  exit 1
fi

PROJECT="${PROJECT:-unknown}"
SUITE="${SUITE:-unknown}"
JOB_STATUS="${JOB_STATUS:-unknown}"
BRANCH="${GITHUB_REF_NAME:-local}"
GITHUB_SHA_VALUE="${GITHUB_SHA:-local}"
COMMIT_SHORT="${GITHUB_SHA_VALUE:0:7}"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-unknown}/actions/runs/${GITHUB_RUN_ID:-0}"

case "$JOB_STATUS" in
  success)
    STATUS_LABEL="PASSED"
    ;;
  failure)
    STATUS_LABEL="FAILED"
    ;;
  cancelled)
    STATUS_LABEL="CANCELLED"
    ;;
  *)
    STATUS_LABEL="${JOB_STATUS^^}"
    ;;
esac

PAYLOAD="$(PROJECT="$PROJECT" \
  SUITE="$SUITE" \
  STATUS_LABEL="$STATUS_LABEL" \
  JOB_STATUS="$JOB_STATUS" \
  BRANCH="$BRANCH" \
  COMMIT_SHORT="$COMMIT_SHORT" \
  RUN_URL="$RUN_URL" \
  node <<'NODE'
const status = process.env.JOB_STATUS || 'unknown';
const statusLabel = process.env.STATUS_LABEL || status.toUpperCase();
const project = process.env.PROJECT || 'unknown';
const suite = process.env.SUITE || 'unknown';
const branch = process.env.BRANCH || 'local';
const commit = process.env.COMMIT_SHORT || 'unknown';
const runUrl = process.env.RUN_URL || 'unknown';

const colorByStatus = {
  success: 'Good',
  failure: 'Attention',
  cancelled: 'Warning',
};

const title = `[${project}] | ${suite} ${statusLabel}`;

const payload = {
  '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
  type: 'AdaptiveCard',
  version: '1.5',
  msteams: { width: 'Full' },
  fallbackText: title,
  body: [
    {
      type: 'TextBlock',
      text: title,
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
      color: colorByStatus[status] || 'Accent',
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Status', value: status },
        { title: 'Branch', value: branch },
        { title: 'Commit', value: commit },
        { title: 'Run', value: runUrl },
      ],
    },
  ],
  actions: [{ type: 'Action.OpenUrl', title: 'Open run', url: runUrl }],
};

process.stdout.write(JSON.stringify(payload));
NODE
)"

RESPONSE_BODY="$(mktemp)"
trap 'rm -f "$RESPONSE_BODY"' EXIT

declare -a CURL_EXTRA_ARGS=()
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    CURL_EXTRA_ARGS+=(--ssl-no-revoke)
    ;;
esac

set +e
HTTP_CODE="$(curl -sS \
  "${CURL_EXTRA_ARGS[@]}" \
  -o "$RESPONSE_BODY" \
  -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  --data "$PAYLOAD" \
  "$TEAMS_WEBHOOK_URL")"
CURL_EXIT=$?
set -e

if [ "$CURL_EXIT" -ne 0 ]; then
  echo "Teams notification fallo: curl exit=$CURL_EXIT"
  echo "Response body:"
  cat "$RESPONSE_BODY"
  exit 1
fi

case "$HTTP_CODE" in
  2*)
    echo "Teams notification enviada (HTTP ${HTTP_CODE})."
    exit 0
    ;;
  *)
    echo "Teams notification fallo (HTTP ${HTTP_CODE}). Response body:"
    cat "$RESPONSE_BODY"
    exit 1
    ;;
esac
