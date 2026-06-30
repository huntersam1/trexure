#!/usr/bin/env bash
# scripts/release.sh — Railway release/pre-deploy step.
set -euo pipefail

echo "[release] applying migrations with prisma migrate deploy"
pnpm db:deploy

# Guarded one-time seed: only when RUN_SEED_ONCE=true is set on the deploy.
# Unset it after the first successful production deploy so re-deploys don't re-seed.
if [ "${RUN_SEED_ONCE:-false}" = "true" ]; then
  echo "[release] RUN_SEED_ONCE=true → running idempotent seed"
  pnpm db:seed
else
  echo "[release] skipping seed (RUN_SEED_ONCE not true)"
fi

echo "[release] done"
