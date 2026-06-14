#!/usr/bin/env sh
# spyglass installer — fetches the right prebuilt spyglassd binary for this
# machine and drops it in PREFIX (default /usr/local/bin). Override with:
#
#   REPO=youruser/spyglass PREFIX=$HOME/.local/bin sh install.sh
#
# No prebuilt release yet? Build from source instead: `make build`.
set -eu

REPO="${REPO:-foundanand/spyglass}"
PREFIX="${PREFIX:-/usr/local/bin}"
VERSION="${VERSION:-latest}"
BIN="spyglassd"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "spyglass: unsupported arch: $arch" >&2; exit 1 ;;
esac
case "$os" in
  linux|darwin) ;;
  *) echo "spyglass: unsupported OS: $os (build from source with 'make build')" >&2; exit 1 ;;
esac

asset="${BIN}-${os}-${arch}"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

echo "spyglass: downloading ${asset} (${VERSION})…"
tmp="$(mktemp)"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url"
else
  echo "spyglass: need curl or wget" >&2; exit 1
fi

chmod +x "$tmp"
dest="${PREFIX}/${BIN}"
if [ -w "$PREFIX" ]; then
  mv "$tmp" "$dest"
else
  echo "spyglass: ${PREFIX} not writable, using sudo"
  sudo mv "$tmp" "$dest"
fi

echo "spyglass: installed ${dest}"
echo "next: write spyglass.config.json (see spyglass.config.example.json), then run:"
echo "  ${BIN} --config spyglass.config.json"
