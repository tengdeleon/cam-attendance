#!/usr/bin/env bash
#
# idempotency.sh — automate the scriptable parts of the POST /attendance
# idempotency rollout. Companion to docs/plans/idempotency-implementation.txt.
#
# What THIS script does (the automatable steps):
#   test        Backend pytest + client `tsc --noEmit` (the correctness gates).
#   migrate     Apply migration 0003 to the DB (idempotent — safe to re-run).
#   verify-db   Confirm the column + index exist and NO key maps to >1 row.
#   all         test -> migrate -> verify-db  (migrate/verify need DATABASE_URL).
#
# What CANNOT be scripted here (do these yourself — see the runbook):
#   • Deploy the FastAPI backend to Render/Fly.
#   • Ship the Expo client (use app/scripts/ship-fix.sh --ota / --build).
#   • Device E2E: double-tap, offline->online, lost-ack, migration-on-upgrade
#     (runbook §6.2).
#
# DB access: set DATABASE_URL to your Supabase Postgres connection string
# (Supabase dashboard → Project Settings → Database → Connection string / URI).
# psql must be on PATH. If DATABASE_URL is unset, `migrate`/`verify-db` explain
# how to apply 0003 by hand instead.
#
# Usage:
#   ./scripts/idempotency.sh test
#   DATABASE_URL=postgres://... ./scripts/idempotency.sh migrate
#   DATABASE_URL=postgres://... ./scripts/idempotency.sh verify-db
#   DATABASE_URL=postgres://... ./scripts/idempotency.sh all
#   ./scripts/idempotency.sh migrate --dry-run
#
set -Eeuo pipefail

# ----- resolve paths (script lives in <repo>/scripts) ------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend/api"
APP_DIR="$REPO_DIR/app"
MIGRATION="$REPO_DIR/backend/supabase/migrations/0003_attendance_idempotency.sql"

err()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
info() { printf '\033[36m• %s\033[0m\n' "$*"; }
trap 'err "failed at line $LINENO"; exit 1' ERR

DRY_RUN=0
CMD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    test|migrate|verify-db|all) CMD="$1" ;;
    --dry-run)   DRY_RUN=1 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "unknown arg: $1"; exit 2 ;;
  esac
  shift
done
[[ -n "$CMD" ]] || { err "no subcommand. one of: test | migrate | verify-db | all (see --help)"; exit 2; }

# ----- steps -----------------------------------------------------------------
run_test() {
  info "== gate 1/2: backend tests =="
  command -v python3 >/dev/null || { err "python3 not found"; exit 1; }
  cd "$BACKEND_DIR"
  if ! python3 -c 'import pytest' 2>/dev/null; then
    err "pytest missing. Install deps first:  (cd backend/api && pip install -r requirements.txt)"
    exit 1
  fi
  python3 -m pytest -q
  ok "backend tests passed"

  info "== gate 2/2: client typecheck =="
  command -v npx >/dev/null || { err "npx not found"; exit 1; }
  cd "$APP_DIR"
  [[ -f tsconfig.json ]] || { err "not the Expo app dir: $APP_DIR"; exit 1; }
  npx tsc --noEmit
  ok "client typecheck passed"
}

require_db() {
  [[ -n "${DATABASE_URL:-}" ]] || {
    err "DATABASE_URL is unset — cannot reach the database."
    cat <<EOF
  Set it to your Supabase Postgres URI, e.g.:
     export DATABASE_URL='postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'
  …or apply the migration by hand instead:
     - Supabase SQL editor: paste $MIGRATION and run, OR
     - supabase db push   (from repo root, project linked)
EOF
    exit 1
  }
  command -v psql >/dev/null || { err "psql not on PATH (install libpq / postgresql-client)"; exit 1; }
}

run_migrate() {
  info "== apply migration 0003 (idempotent: ADD COLUMN / INDEX IF NOT EXISTS) =="
  [[ -f "$MIGRATION" ]] || { err "migration file not found: $MIGRATION"; exit 1; }
  if [[ "$DRY_RUN" -eq 1 ]]; then
    info "[dry-run] would run: psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -f $MIGRATION"
    return 0
  fi
  require_db
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"
  ok "migration 0003 applied"
}

run_verify_db() {
  info "== verify DB state =="
  require_db

  local col idx dupes
  col=$(psql "$DATABASE_URL" -tA -c \
    "select count(*) from information_schema.columns
       where table_name='attendance' and column_name='idempotency_key';")
  [[ "$col" == "1" ]] && ok "column attendance.idempotency_key present" \
                       || { err "column attendance.idempotency_key MISSING — run: $0 migrate"; exit 1; }

  idx=$(psql "$DATABASE_URL" -tA -c \
    "select count(*) from pg_indexes
       where tablename='attendance' and indexname='uq_attendance_idempotency_key';")
  [[ "$idx" == "1" ]] && ok "partial unique index present" \
                       || { err "unique index uq_attendance_idempotency_key MISSING — run: $0 migrate"; exit 1; }

  # The invariant that matters: no non-null key maps to more than one row.
  dupes=$(psql "$DATABASE_URL" -tA -c \
    "select count(*) from (
        select idempotency_key from attendance
          where idempotency_key is not null
          group by idempotency_key having count(*) > 1
     ) d;")
  [[ "$dupes" == "0" ]] && ok "no duplicate keys — idempotency invariant holds" \
                        || { err "$dupes idempotency key(s) map to multiple rows — INVARIANT VIOLATED"; exit 1; }
}

case "$CMD" in
  test)      run_test ;;
  migrate)   run_migrate ;;
  verify-db) run_verify_db ;;
  all)       run_test; run_migrate; run_verify_db ;;
esac

echo
ok "done ($CMD)."
if [[ "$CMD" == "all" || "$CMD" == "migrate" ]]; then
  cat <<EOF

Not scripted here (do next):
  1. Deploy the FastAPI backend to Render/Fly (migration must already be live — it is).
  2. Ship the client:  ./app/scripts/ship-fix.sh --ota   (or --build)
  3. Device E2E per runbook §6.2 (double-tap / offline / lost-ack / upgrade migration).
EOF
fi
