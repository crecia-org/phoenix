import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * De dónde salen psqldef y squawk.
 *
 * En un ejecutable de release vienen EMBEBIDOS: `scripts/build.sh` genera un
 * entrypoint que importa los `.gz` con `with { type: "file" }` y llama a
 * `registerEmbedded` antes de arrancar el CLI. Ese es el punto de todo esto —
 * que nadie tenga que instalar el fork parcheado de sqldef a mano, ni acordarse
 * de NO correr `go install ...@latest` encima (ver el README).
 *
 * Corriendo desde el fuente (`bun run src/cli.ts`) no hay nada embebido y se
 * usan los del PATH, o los de PHOENIX_BIN_DIR si está seteada.
 */
export type BinaryName = "psqldef" | "squawk";

/** Rutas a los `.gz` embebidos, que el entrypoint de release registra acá. */
let embedded: Partial<Record<BinaryName, string>> = {};

export function registerEmbedded(paths: Partial<Record<BinaryName, string>>): void {
  embedded = paths;
}

export function hasEmbedded(name: BinaryName): boolean {
  return embedded[name] != null;
}

/**
 * Los binarios embebidos se descomprimen UNA vez a un directorio de caché
 * versionado por el hash del contenido: así una versión nueva del CLI no reusa
 * el binario viejo, y dos versiones distintas conviven sin pisarse.
 */
function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "phoenix", "bin");
}

async function unpack(name: BinaryName, gzPath: string): Promise<string> {
  const gz = new Uint8Array(await Bun.file(gzPath).arrayBuffer());
  const bytes = Bun.gunzipSync(gz);
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);

  const dir = cacheDir();
  const target = join(dir, `${name}-${digest}`);
  if (existsSync(target)) return target;

  mkdirSync(dir, { recursive: true });
  // Se escribe a un nombre temporal y se renombra: si dos procesos del CLI
  // arrancan a la vez, ninguno alcanza a ejecutar un archivo a medio escribir.
  const tmp = `${target}.${process.pid}.tmp`;
  await Bun.write(tmp, bytes);
  chmodSync(tmp, 0o755);
  await Bun.$`mv -f ${tmp} ${target}`.quiet();
  return target;
}

/** Devuelve la ruta ejecutable de un binario, o lanza con qué hacer al respecto. */
export async function resolveBinary(name: BinaryName): Promise<string> {
  const gzPath = embedded[name];
  if (gzPath != null) return unpack(name, gzPath);

  const overrideDir = process.env.PHOENIX_BIN_DIR;
  if (overrideDir != null) {
    const candidate = join(overrideDir, name);
    if (existsSync(candidate)) return candidate;
  }

  const onPath = Bun.which(name);
  if (onPath != null) return onPath;

  throw new Error(
    `${name} no está disponible.\n` +
      `  Este build del CLI no lo trae embebido (se está corriendo desde el fuente).\n` +
      `  Instalalo en el PATH, apuntá PHOENIX_BIN_DIR a donde esté, o usá un\n` +
      `  ejecutable de release (pnpm build) que ya lo lleva adentro.`,
  );
}
