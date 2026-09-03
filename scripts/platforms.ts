/** Las plataformas para las que se puede vendorizar y compilar. */
export const PLATFORMS = ["linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64"] as const;

export type Platform = (typeof PLATFORMS)[number];

/** El target que entiende `bun build --compile`, que nombra las arquitecturas
 *  distinto que Go (`x64` en vez de `amd64`). */
export const BUN_TARGET: Record<Platform, string> = {
  "linux-amd64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "darwin-amd64": "bun-darwin-x64",
  "darwin-arm64": "bun-darwin-arm64",
};

export function parsePlatform(value: string): Platform {
  if ((PLATFORMS as readonly string[]).includes(value)) return value as Platform;
  throw new Error(`plataforma desconocida: ${value}\n  válidas: ${PLATFORMS.join(", ")}`);
}

export function currentPlatform(): Platform {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
  if (os == null || arch == null) {
    throw new Error(`plataforma no soportada: ${process.platform}/${process.arch}`);
  }
  return `${os}-${arch}` as Platform;
}
