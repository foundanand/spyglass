#!/usr/bin/env bash
#
# Build, pack and vendor @spyglass/sdk into a consuming repo.
#
# The SDK is deliberately not on npm — GPL, self-hosted, air-gap — and the
# obvious local workflows all fail in ways that are silent or misleading:
#
#   npm link @spyglass/sdk
#     "Cannot read properties of null (reading 'matches')" — npm cannot parse
#     pnpm's node_modules layout. Unsupported in a pnpm project, full stop.
#
#   pnpm add link:../spyglass/sdk
#     Works for the package manager, then Turbopack resolves the symlink to its
#     REAL path and refuses anything outside the workspace root it infers from
#     the lockfile. "Module not found", while node and tsc both resolve it fine.
#
#     The apparent fix — pointing turbopack.root at the shared parent — is a
#     trap. Measured on a host app with ~11 sibling projects, each with its own
#     node_modules: first /dashboard compile 1.5s -> over 2 minutes; an API
#     route 62ms -> 51-93s. It also changes what `output: standalone` traces.
#
# The path that works is copying the built package INTO the consuming repo, so
# the real path is back inside the workspace root. That is what every consumer
# ends up hand-writing, so it is written once, here.
#
# Usage:
#   scripts/vendor.sh /path/to/your-app [vendor-dir]
#
# Then, in the consuming app:
#   pnpm add file:./vendor/spyglass-sdk
#
# If you can run a private registry (Verdaccio) or install from a git URL,
# prefer that — it sidesteps everything above.

set -euo pipefail

TARGET="${1:-}"
VENDOR_SUBDIR="${2:-vendor}"

if [[ -z "$TARGET" ]]; then
  echo "usage: scripts/vendor.sh /path/to/consuming-app [vendor-dir]" >&2
  exit 2
fi
if [[ ! -d "$TARGET" ]]; then
  echo "vendor: target directory does not exist: $TARGET" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_DIR="$REPO_ROOT/sdk"
DEST="$TARGET/$VENDOR_SUBDIR/spyglass-sdk"

echo "vendor: building the SDK"
(cd "$SDK_DIR" && node build.ts)

echo "vendor: checking the size budget and link safety"
(cd "$SDK_DIR" && node size-check.mjs)

echo "vendor: packing"
# Pack into a directory of our own so the tarball can be located unambiguously.
# npm pack prints only a filename, and globbing for "the newest .tgz" happily
# finds a stale one left in the source tree — which silently vendors an old
# build.
PACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR"' EXIT
(cd "$SDK_DIR" && npm pack --silent --pack-destination "$PACK_DIR" >/dev/null)

shopt -s nullglob
TARBALLS=("$PACK_DIR"/*.tgz)
shopt -u nullglob
if [[ ${#TARBALLS[@]} -ne 1 ]]; then
  echo "vendor: expected exactly one tarball in $PACK_DIR, found ${#TARBALLS[@]}" >&2
  exit 1
fi
TARBALL_PATH="${TARBALLS[0]}"

echo "vendor: installing into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "$TARBALL_PATH" -C "$DEST" --strip-components=1

# Provenance, so a vendored copy can always be traced back to a commit. Without
# this, "which build is this app running" is unanswerable a month later.
COMMIT="$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null || echo unknown)"
DIRTY="clean"
if ! (cd "$REPO_ROOT" && git diff --quiet && git diff --cached --quiet) 2>/dev/null; then
  DIRTY="dirty"
fi
VERSION="$(node -p "require('$SDK_DIR/package.json').version" 2>/dev/null || echo unknown)"

cat > "$DEST/VENDORED.json" <<EOF
{
  "package": "@spyglass/sdk",
  "version": "$VERSION",
  "source_commit": "$COMMIT",
  "working_tree": "$DIRTY",
  "vendored_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "vendored_from": "$REPO_ROOT"
}
EOF

echo
echo "vendor: done -> $DEST"
if [[ "$DIRTY" == "dirty" ]]; then
  echo "vendor: WARNING built from a dirty working tree; VENDORED.json records that."
fi
echo
echo "Next, in $TARGET:"
echo "  pnpm add file:./$VENDOR_SUBDIR/spyglass-sdk"
echo
echo "Copied in rather than symlinked on purpose: a linked package resolves to a"
echo "path outside your workspace root, which Turbopack refuses. See the header"
echo "of this script for the measurements."
