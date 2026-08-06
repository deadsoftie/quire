#!/usr/bin/env bash
# Builds a distributable Quire package: release sidecar binary, built renderer, then
# electron-builder. See ELECTRON_BUILDER_PLAN.md Phase 2. Extra args (e.g. `--mac`,
# `--linux`, `--publish=always`) pass straight through to electron-builder.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f bundles/core/SHA256SUM ]; then
  echo "bundles/core/ is missing -- run: cargo run -p quire-core --example build_core_bundle" >&2
  exit 1
fi

cargo build --release --workspace
pnpm --filter @quire/ui build
pnpm --filter @quire/desktop exec electron-builder "$@"
