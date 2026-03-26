#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f ".env" ]]; then
    set -a
    source .env
    set +a
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f ".env.local" ]]; then
    set -a
    source .env.local
    set +a
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Export it or set it in .env before running."
  exit 1
fi

echo "⚠️  This will DROP schema public and recreate it."
echo "Target: ${DATABASE_URL%%\\?*}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
drop schema public cascade;
create schema public;
SQL

npx prisma db push --skip-generate

echo "✅ Schema applied."
