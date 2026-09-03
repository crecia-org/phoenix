#!/usr/bin/env bun
/**
 * Deja los binarios que el ejecutable de release se lleva adentro, comprimidos,
 * en `vendor-bin/<plataforma>/`.
 *
 * psqldef NO sale de `go install ...@latest`: se compila desde el fork
 * (ceftx/sqldef, rama support-constraint-triggers), porque el upstream no sabe
 * parsear CREATE CONSTRAINT TRIGGER y revienta el diff de la base entera en
 * cuanto existe uno. Que este script sea el único camino es justamente lo que
 * evita que alguien lo pise sin enterarse.
 *
 *   bun run scripts/vendor.ts                 # plataforma actual
 *   bun run scripts/vendor.ts linux-amd64     # una en particular
 *
 * Solo `git` y `go` salen a la shell. Comprimir y descargar se hacen con el
 * runtime (Bun.gzipSync, fetch): `gzip` y `curl` dejaron de ser requisitos.
 */
import { $ } from "bun";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentPlatform, parsePlatform, type Platform } from "./platforms.ts";

const root = join(import.meta.dir, "..");

interface VendorLock {
  sqldefRepo: string;
  sqldefRef: string;
  squawkVersion: string;
}

/**
 * Los nombres de asset de squawk usan `x64`/`arm64`, NO `x86_64`/`aarch64`
 * (que es lo que devuelve `uname`). No se derivan de la arquitectura: hay que
 * mirar el release. Derivarlos daba 404 en las cuatro plataformas.
 */
const SQUAWK_ASSET: Record<Platform, string> = {
  "linux-amd64": "squawk-linux-x64",
  "linux-arm64": "squawk-linux-arm64",
  "darwin-amd64": "squawk-darwin-x64",
  "darwin-arm64": "squawk-darwin-arm64",
};

/** Se comprime con el runtime y no con `gzip` para no depender de que esté
 *  instalado. Toma el ArrayBuffer directo: un Uint8Array construido sobre él
 *  se tipa como `Uint8Array<ArrayBufferLike>`, que no encaja en la firma. */
async function writeCompressed(target: string, bytes: ArrayBuffer): Promise<void> {
  await Bun.write(target, Bun.gzipSync(bytes, { level: 9 }));
}

async function buildPsqldef(lock: VendorLock, platform: Platform, out: string): Promise<void> {
  const [os, arch] = platform.split("-") as [string, string];
  const work = mkdtempSync(join(tmpdir(), "phoenix-vendor-"));

  try {
    console.log(`--> clonando ${lock.sqldefRepo} (${lock.sqldefRef})`);
    await $`git clone --quiet --depth 1 --branch ${lock.sqldefRef} ${lock.sqldefRepo} ${work}/sqldef`;

    const ref = (await $`git -C ${work}/sqldef rev-parse --short HEAD`.text()).trim();
    console.log(`--> compilando psqldef desde ${ref} para ${platform}`);
    await $`go build -trimpath -ldflags=${"-s -w"} -o ${work}/psqldef ./cmd/psqldef`
      .cwd(`${work}/sqldef`)
      .env({ ...process.env, GOOS: os, GOARCH: arch });

    await writeCompressed(join(out, "psqldef.gz"), await Bun.file(`${work}/psqldef`).arrayBuffer());
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function downloadSquawk(lock: VendorLock, platform: Platform, out: string): Promise<void> {
  const asset = SQUAWK_ASSET[platform];
  const url = `https://github.com/sbdchd/squawk/releases/download/${lock.squawkVersion}/${asset}`;
  console.log(`--> bajando ${asset} (${lock.squawkVersion})`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`no se pudo bajar ${url}: HTTP ${String(response.status)}`);
  }
  await writeCompressed(join(out, "squawk.gz"), await response.arrayBuffer());
}

async function main(): Promise<void> {
  const platform = process.argv[2] != null ? parsePlatform(process.argv[2]) : currentPlatform();
  const lock = (await Bun.file(join(root, "vendor.lock.json")).json()) as VendorLock;
  const out = join(root, "vendor-bin", platform);

  console.log(`==> vendorizando para ${platform}`);
  mkdirSync(out, { recursive: true });

  await buildPsqldef(lock, platform, out);
  await downloadSquawk(lock, platform, out);

  console.log(`\nlisto en vendor-bin/${platform}:`);
  for (const name of ["psqldef.gz", "squawk.gz"]) {
    console.log(`  ${name.padEnd(14)} ${(Bun.file(join(out, name)).size / 1024 / 1024).toFixed(1)}M`);
  }
}

await main().catch((error: unknown) => {
  // Sin esto, un throw sale como stack trace de Bun con el código fuente
  // alrededor, y el mensaje —que es lo único accionable— queda enterrado.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
