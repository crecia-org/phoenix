#!/usr/bin/env bash
#
# Deja los binarios que el ejecutable de release se lleva adentro, comprimidos,
# en vendor-bin/<plataforma>/.
#
# psqldef NO sale de `go install ...@latest`: se compila desde el fork
# (ceftx/sqldef, rama support-constraint-triggers), porque el upstream no sabe
# parsear CREATE CONSTRAINT TRIGGER y revienta el diff de la base entera en
# cuanto existe uno. Que este script sea el único camino es justamente lo que
# evita que alguien lo pise sin enterarse.
#
# Uso:
#   ./scripts/vendor.sh                      # plataforma actual
#   ./scripts/vendor.sh linux-amd64          # una en particular
#
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
lock="$root/vendor.lock.json"

read_lock() { grep -oP "(?<=\"$1\": \")[^\"]+" "$lock"; }

SQLDEF_REPO="$(read_lock sqldefRepo)"
SQLDEF_REF="$(read_lock sqldefRef)"
SQUAWK_VERSION="$(read_lock squawkVersion)"

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
  esac
  echo "$os-$arch"
}

platform="${1:-$(detect_platform)}"
os="${platform%%-*}"
arch="${platform##*-}"
out="$root/vendor-bin/$platform"
mkdir -p "$out"

echo "==> vendorizando para $platform"

# ── psqldef, desde el fork ──────────────────────────────────────────────────
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "--> clonando $SQLDEF_REPO ($SQLDEF_REF)"
git clone --quiet --depth 1 --branch "$SQLDEF_REF" "$SQLDEF_REPO" "$work/sqldef"
(cd "$work/sqldef" && GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags="-s -w" \
  -o "$work/psqldef" ./cmd/psqldef)

built_ref="$(cd "$work/sqldef" && git rev-parse --short HEAD)"
echo "--> psqldef compilado desde $built_ref"
gzip -9 -c "$work/psqldef" > "$out/psqldef.gz"

# ── squawk, release oficial ─────────────────────────────────────────────────
case "$platform" in
  linux-amd64)  squawk_asset="squawk-linux-x86_64" ;;
  linux-arm64)  squawk_asset="squawk-linux-aarch64" ;;
  darwin-amd64) squawk_asset="squawk-darwin-x86_64" ;;
  darwin-arm64) squawk_asset="squawk-darwin-aarch64" ;;
  *) echo "no sé qué asset de squawk corresponde a $platform" >&2; exit 1 ;;
esac

echo "--> bajando $squawk_asset ($SQUAWK_VERSION)"
curl -sSfL "https://github.com/sbdchd/squawk/releases/download/$SQUAWK_VERSION/$squawk_asset" -o "$work/squawk"
chmod +x "$work/squawk"
gzip -9 -c "$work/squawk" > "$out/squawk.gz"

echo ""
echo "listo en vendor-bin/$platform:"
ls -lh "$out" | tail -n +2 | awk '{printf "  %-14s %s\n", $9, $5}'
