#!/usr/bin/env bash
# Builds a distributable Quire package: release sidecar binary, built renderer, then
# electron-builder. Extra args (e.g. `--mac`, `--linux`, `--publish=always`) pass straight
# through to electron-builder.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# Local-only mac signing/notarization credentials (CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY,
# APPLE_API_KEY_ID, APPLE_API_ISSUER) - gitignored, absent on Linux/CI unless explicitly provided.
if [ -f "$SCRIPT_DIR/.mac-signing.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.mac-signing.env"
  set +a
fi

if [ ! -f bundles/core/SHA256SUM ]; then
  echo "bundles/core/ is missing - run: cargo run -p quire-core --example build_core_bundle" >&2
  exit 1
fi

# pnpm forwards the literal `--` separator from `pnpm package -- --mac` as part of "$@" (unlike
# many other tools, which strip it) - electron-builder's own CLI then treats that `--` as its
# own "end of options" marker and silently ignores every flag after it, falling back to its
# default (current host platform) instead of erroring. Strip a single leading `--` here so both
# `pnpm package -- --mac` and a direct `bash scripts/package.sh --mac` behave the same.
if [ "${1-}" = "--" ]; then
  shift
fi

cargo build --release --workspace
pnpm --filter @quire/ui build
pnpm --filter @quire/desktop exec electron-builder "$@"
