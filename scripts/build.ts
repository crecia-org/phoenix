#!/usr/bin/env bun
/**
 * Produce el ejecutable de release: el CLI compilado CON psqldef y squawk
 * adentro.
 *
 * Un ejecutable por plataforma, y no hay forma de evitarlo: `bun build
 * --compile` cross-compila el runtime de Bun, pero los binarios embebidos son
 * bytes concretos — un ELF de Linux adentro de un Mach-O de macOS no sirve de
 * nada. Por eso cada build toma los suyos de `vendor-bin/<plataforma>/`.
 *
 *   bun run scripts/build.ts                            # plataforma actual
 *   bun run scripts/build.ts linux-amd64 darwin-arm64
 */
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BUN_TARGET, currentPlatform, parsePlatform, type Platform } from "./platforms.ts";

const root = join(import.meta.dir, "..");

/**
 * El entrypoint se genera y no vive en `src/`: los `with { type: "file" }`
 * apuntan a rutas que solo existen después de vendorizar, y un import estático
 * a un archivo ausente rompería `bun run src/cli.ts` en desarrollo.
 */
function entrypointSource(platform: Platform): string {
  return `import psqldefGz from "../vendor-bin/${platform}/psqldef.gz" with { type: "file" };
import squawkGz from "../vendor-bin/${platform}/squawk.gz" with { type: "file" };
import { registerEmbedded } from "../src/vendor/binaries.ts";
import { run } from "../src/cli.ts";

registerEmbedded({ psqldef: psqldefGz, squawk: squawkGz });
await run();
`;
}

async function build(platform: Platform): Promise<void> {
  const vendor = join(root, "vendor-bin", platform);
  for (const name of ["psqldef.gz", "squawk.gz"]) {
    if (!existsSync(join(vendor, name))) {
      throw new Error(
        `faltan binarios para ${platform} (${name}).\n` +
          `  Corré primero: bun run scripts/vendor.ts ${platform}`,
      );
    }
  }

  const entry = join(root, "build", `entry-${platform}.ts`);
  await Bun.write(entry, entrypointSource(platform));

  const out = join(root, "dist", `phoenix-${platform}`);
  console.log(`==> ${platform}`);
  await $`bun build --compile --minify --sourcemap ${entry} --target=${BUN_TARGET[platform]} --outfile ${out}`;

  console.log(`    ${(Bun.file(out).size / 1024 / 1024).toFixed(0)}M  ${out.replace(`${root}/`, "")}`);
}

async function main(): Promise<void> {
  const platforms = process.argv.slice(2).map(parsePlatform);
  if (platforms.length === 0) platforms.push(currentPlatform());

  mkdirSync(join(root, "build"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  for (const platform of platforms) await build(platform);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
