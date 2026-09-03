import { existsSync } from "node:fs";
import type { ResolvedConfig } from "./config.ts";
import { databaseUrl, parsePostgresUrl } from "./db.ts";
import { resolveBinary } from "./vendor/binaries.ts";

/**
 * psqldef es el motor de diff y de export. Acá va el fork parcheado
 * (`ceftx/sqldef`, rama support-constraint-triggers): el upstream no sabe
 * parsear CREATE CONSTRAINT TRIGGER y revienta el diff de la base ENTERA en
 * cuanto existe uno. Embeberlo es justamente lo que evita que alguien lo pise
 * con `go install ...@latest` sin enterarse.
 */
export interface PsqldefResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(config: ResolvedConfig, args: string[], stdin?: string): Promise<PsqldefResult> {
  const bin = await resolveBinary("psqldef");
  const parts = parsePostgresUrl(databaseUrl());

  const flags = ["-U", parts.user, "-h", parts.host, "-p", parts.port, `--password=${parts.password}`];
  if (config.psqldefConfig !== "") {
    if (!existsSync(config.psqldefConfig)) {
      throw new Error(`psqldefConfig apunta a un archivo que no existe: ${config.psqldefConfig}`);
    }
    flags.push(`--config=${config.psqldefConfig}`);
  }

  const proc = Bun.spawn([bin, ...flags, ...args, parts.database], {
    stdin: stdin != null ? new TextEncoder().encode(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** El SQL que haría falta para llevar la base viva a lo que dice el schema. */
export async function dryRunDiff(config: ResolvedConfig): Promise<PsqldefResult> {
  const schema = await Bun.file(config.schemaFile).text();
  return run(config, ["--dry-run"], schema);
}

/** El schema reconstruido desde la base viva. */
export async function exportSchema(config: ResolvedConfig): Promise<PsqldefResult> {
  return run(config, ["--export"]);
}

export async function psqldefVersion(): Promise<string> {
  const bin = await resolveBinary("psqldef");
  const proc = Bun.spawnSync([bin, "--version"]);
  return new TextDecoder().decode(proc.stdout).trim();
}

/**
 * Ruido fijo del `--dry-run` que NO es una diferencia. Se enumera línea por
 * línea en vez de descartar todos los comentarios: psqldef se niega por
 * default a los cambios destructivos y los emite como `-- Skipped: ...`, así
 * que el drift más peligroso —que la base tenga algo que el schema no— viaja
 * justamente en una línea comentada. Filtrar comentarios en general dejaría
 * ciego al chequeo para exactamente el caso que existe para detectar.
 */
const DRY_RUN_NOISE = /^(?:-- dry run --|-- Nothing is modified --|BEGIN;|COMMIT;|\s*)$/;

export function meaningfulDiffLines(stdout: string): string[] {
  return stdout.split("\n").filter((line) => !DRY_RUN_NOISE.test(line));
}
