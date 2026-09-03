#!/usr/bin/env bash
#
# Produce el ejecutable de release: el CLI compilado CON psqldef y squawk
# adentro.
#
# Un ejecutable por plataforma, y no hay forma de evitarlo: `bun build
# --compile` cross-compila el runtime de Bun, pero los binarios embebidos son
# bytes concretos — un ELF de Linux adentro de un Mach-O de macOS no sirve de
# nada. Por eso cada build toma los binarios de vendor-bin/<plataforma>/.
#
# Uso:
#   ./scripts/build.sh                 # plataforma actual
#   ./scripts/build.sh linux-amd64 darwin-arm64
#
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

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

bun_target() {
  case "$1" in
    linux-amd64)  echo bun-linux-x64 ;;
    linux-arm64)  echo bun-linux-arm64 ;;
    darwin-amd64) echo bun-darwin-x64 ;;
    darwin-arm64) echo bun-darwin-arm64 ;;
    *) echo "plataforma desconocida: $1" >&2; exit 1 ;;
  esac
}

platforms=("$@")
[ ${#platforms[@]} -eq 0 ] && platforms=("$(detect_platform)")

mkdir -p dist build

for platform in "${platforms[@]}"; do
  vendor="vendor-bin/$platform"
  if [ ! -f "$vendor/psqldef.gz" ] || [ ! -f "$vendor/squawk.gz" ]; then
    echo "faltan binarios para $platform — corré primero: ./scripts/vendor.sh $platform" >&2
    exit 1
  fi

  # El entrypoint se genera acá y no vive en src/: los `with { type: "file" }`
  # apuntan a rutas que solo existen después de vendorizar, y un import
  # estático a un archivo ausente rompería `bun run src/cli.ts` en desarrollo.
  entry="build/entry-$platform.ts"
  cat > "$entry" <<TS
import psqldefGz from "../$vendor/psqldef.gz" with { type: "file" };
import squawkGz from "../$vendor/squawk.gz" with { type: "file" };
import { registerEmbedded } from "../src/vendor/binaries.ts";
import { run } from "../src/cli.ts";

registerEmbedded({ psqldef: psqldefGz, squawk: squawkGz });
await run();
TS

  out="dist/crecia-db-$platform"
  echo "==> $platform"
  bun build --compile --minify --sourcemap "$entry" --target="$(bun_target "$platform")" --outfile "$out"
  echo "    $(du -h "$out" | cut -f1)  $out"
done
