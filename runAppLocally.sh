#!/usr/bin/env bash
# ============================================================================
# runAppLocally.sh — run YEROME Ledger locally on SQLite.
#
# All values you configure live in `.env.local` (see `.env.local.example`).
# Nothing secret/credential is hardcoded here.
#
# Usage:
#   cp .env.local.example .env.local   # first time — then edit values
#   ./runAppLocally.sh
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; RED="$(printf '\033[31m')"; RESET="$(printf '\033[0m')"
say() { printf "%s\n" "$*"; }
fail() { say "${RED}✖ $*${RESET}"; exit 1; }

# --- Ensure .env.local exists -----------------------------------------------
if [ ! -f .env.local ]; then
  if [ ! -f .env.local.example ]; then
    fail "Missing .env.local and .env.local.example. Cannot start."
  fi
  cp .env.local.example .env.local
  say "${BOLD}Created .env.local from .env.local.example${RESET}"
  say "${DIM}Edit .env.local with your Admin password and other settings, then re-run.${RESET}"
  say ""
  say "  Required at minimum: ADMIN_EMAIL, ADMIN_PASSWORD, OWNER_SEED_PASSWORD, LOCAL_JWT_SECRET"
  say ""
  exit 1
fi

# --- Load .env.local into the environment -----------------------------------
# Supports KEY=value and KEY="quoted value". Does not override vars already set
# in the shell (so you can still temporarily override for one run).
load_env_file() {
  local file="$1"
  while IFS= read -r line || [ -n "$line" ]; do
    # trim leading whitespace
    local trimmed="${line#"${line%%[![:space:]]*}"}"
    [ -z "$trimmed" ] && continue
    [[ "$trimmed" == \#* ]] && continue
    [[ "$trimmed" != *=* ]] && continue

    local key="${trimmed%%=*}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"

    local value="${trimmed#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    # Strip matching surrounding quotes (bash 3.2-safe; no negative offsets).
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac

    # Do not override an already-exported shell value.
    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < "$file"
}

load_env_file .env.local

# --- Required variables (must be set in .env.local) -------------------------
require_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "Missing required variable ${name} in .env.local (see .env.local.example)."
  fi
}

require_var VITE_BACKEND
require_var LOCAL_PORT
require_var LOCAL_DB_FILE
require_var LOCAL_JWT_SECRET
require_var ADMIN_EMAIL
require_var ADMIN_PASSWORD
require_var OWNER_SEED_PASSWORD
require_var OWNER_AUTH_DOMAIN
require_var DEFAULT_TAX_YEAR

if [ "$VITE_BACKEND" != "local" ]; then
  fail "VITE_BACKEND must be \"local\" in .env.local for this script (got: ${VITE_BACKEND})."
fi

# Derived only when not provided — URL from port; absolute DB path from relative.
export LOCAL_BACKEND_URL="${LOCAL_BACKEND_URL:-http://localhost:${LOCAL_PORT}}"
case "$LOCAL_DB_FILE" in
  /*) ;; # already absolute
  *) export LOCAL_DB_FILE="$(pwd)/${LOCAL_DB_FILE#./}" ;;
esac

# --- Prerequisite checks -----------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. Install Node 22+ from https://nodejs.org and retry."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node $(node -v) detected. Local mode needs Node 22+ (built-in SQLite)."
fi

# --- Install dependencies (once) --------------------------------------------
if [ ! -d node_modules ]; then
  say "${BOLD}Installing dependencies…${RESET}"
  npm install
fi

mkdir -p "$(dirname "$LOCAL_DB_FILE")"

# --- Start the local SQLite backend -----------------------------------------
say "${BOLD}Starting local SQLite backend on :${LOCAL_PORT}…${RESET}"
node --experimental-sqlite server/localBackend.mjs &
BACKEND_PID=$!

cleanup() {
  if kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# --- Wait for the backend to be healthy -------------------------------------
say "${DIM}Waiting for backend…${RESET}"
for i in $(seq 1 40); do
  if command -v curl >/dev/null 2>&1; then
    if curl -sf "http://localhost:${LOCAL_PORT}/local/health" >/dev/null 2>&1; then break; fi
  else
    if node -e "fetch('http://localhost:${LOCAL_PORT}/local/health').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi
  fi
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    fail "Local backend failed to start. See the output above."
  fi
  sleep 0.25
done

say ""
say "${BOLD}▸ App:${RESET}     http://localhost:5173"
say "${BOLD}▸ Backend:${RESET} http://localhost:${LOCAL_PORT} ${DIM}(SQLite: ${LOCAL_DB_FILE})${RESET}"
say "${BOLD}▸ Sign in (from .env.local):${RESET}"
say "    Admin → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
say "    Owner → owner_a / ${OWNER_SEED_PASSWORD}   (also owner_b)"
say "${DIM}(Edit .env.local to change credentials. Delete ${LOCAL_DB_FILE} to reset demo data. Ctrl-C stops everything.)${RESET}"
say ""

# --- Start Vite (foreground). Ctrl-C stops both via the trap. ---------------
npm run dev
