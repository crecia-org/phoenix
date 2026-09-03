import type { ResolvedConfig } from "../config.ts";
import { displayName, listMigrationFiles, type MigrationFile } from "../migrations/files.ts";
import { applyMigration, pendingMigrations, withRunner, type RunnerContext } from "../migrations/runner.ts";
import { meaningfulDiffLines } from "../psqldef.ts";
import { dryRunDiff } from "../psqldef.ts";
import { appliedVersions, publicTableCount, recordVersion, parseMigrationsTable } from "../migrations/table.ts";
import { bold, dim, fail, indent, info, ok, warn } from "../ui.ts";
import { exportCommand } from "./export.ts";

/**
 * Aplica lo pendiente, resolviendo el baseline solo.
 *
 * El baseline tiene sentido EJECUTARLO en exactamente un caso —una base
 * vacía— y en cualquier otro hay que registrarlo como aplicado sin correrlo,
 * porque si no intenta recrear un schema que ya está. Los tres estados se
 * distinguen sin preguntarle nada a nadie:
 *
 *   1. ya figura aplicado          -> no hay nada que decidir
 *   2. sin registrar + public vacío -> base nueva: se ejecuta
 *   3. sin registrar + public con tablas -> preexistente: se adopta
 *
 * En el caso 3 NO alcanza con marcarlo. Marcarlo es afirmar "esta base es
 * igual al snapshot", y si no lo es, ese drift queda enterrado y toda
 * migración futura parte de una premisa falsa. Por eso primero se compara la
 * base viva contra el schema, y si no coinciden se muestra la diferencia y se
 * corta.
 */
type Decision = "auto" | "baseline" | "adopt";

export async function migrateCommand(config: ResolvedConfig, args: string[]): Promise<number> {
  const decision: Decision = args.includes("--baseline") ? "baseline" : args.includes("--adopt") ? "adopt" : "auto";
  const force = args.includes("--force");
  const skipExport = args.includes("--no-export");

  const unknown = args.filter((a) => !["--baseline", "--adopt", "--force", "--no-export"].includes(a));
  if (unknown.length > 0) {
    fail(`opciones desconocidas: ${unknown.join(", ")}`);
    info("  válidas: --baseline, --adopt, --force, --no-export");
    return 1;
  }

  const table = parseMigrationsTable(config.migrationsTable);

  const exitCode = await withRunner({ migrationsDir: config.migrationsDir, table }, async (ctx) => {
    const resolved = await resolveBaseline(ctx, config, { decision, force });
    if (resolved !== 0) return resolved;

    const pending = await pendingMigrations(ctx);
    if (pending.length === 0) {
      ok("no hay migraciones pendientes");
      return 0;
    }

    for (const file of pending) {
      info(`${dim("aplicando")} ${displayName(file)}`);
      const applied = await applyMigration(ctx, file);
      ok(`${displayName(file)} ${dim(`(${applied.durationMs.toFixed(0)}ms)`)}`);
    }
    return 0;
  });

  if (exitCode !== 0) return exitCode;

  // Se re-exporta siempre: así el schema refleja la base incluso para una
  // migración escrita a mano que nunca pasó por el archivo.
  return skipExport ? 0 : exportCommand(config);
}

function findBaseline(config: ResolvedConfig): MigrationFile | null {
  return listMigrationFiles(config.migrationsDir).find((file) => file.name === config.baselineName) ?? null;
}

async function resolveBaseline(
  ctx: RunnerContext,
  config: ResolvedConfig,
  options: { decision: Decision; force: boolean },
): Promise<number> {
  const baseline = findBaseline(config);
  if (baseline == null) return 0; // sin baseline no hay nada especial que resolver

  const applied = await appliedVersions(ctx.sql, ctx.table);
  if (applied.has(baseline.version)) return 0;

  let decision = options.decision;
  if (decision === "auto") {
    const tables = await publicTableCount(ctx.sql);
    if (tables === 0) {
      info(`base vacía — se ejecuta el baseline ${baseline.version}`);
      decision = "baseline";
    } else {
      info(`la base ya tiene ${String(tables)} tablas — se adopta el baseline ${baseline.version} sin ejecutarlo`);
      decision = "adopt";
    }
  }

  // Ejecutarlo es aplicar una migración más: la deja el loop de pendientes.
  if (decision === "baseline") return 0;

  if (!options.force) {
    info(`verificando que la base coincida con ${config.schemaFile} antes de adoptarlo...`);
    const result = await dryRunDiff(config);
    if (result.exitCode !== 0) {
      fail(`no se pudo verificar (psqldef salió ${String(result.exitCode)}):`);
      process.stderr.write(result.stderr);
      return result.exitCode;
    }

    const differences = meaningfulDiffLines(result.stdout);
    if (differences.length > 0) {
      fail(bold(`ABORTADO — la base no coincide con ${config.schemaFile}.`));
      info("");
      info("Adoptar el baseline acá registraría que esta base es igual al snapshot");
      info("cuando no lo es, y ese drift quedaría enterrado. Diferencias:");
      info("");
      info(indent(differences.join("\n")));
      info("");
      info("Opciones:");
      info("  - Si la base está bien y el que quedó viejo es el schema:  crecia-db export");
      info("  - Si al schema le falta algo que la base ya tiene:         crecia-db new <nombre>");
      info("  - Si sabés lo que hacés y querés registrarlo igual:        crecia-db migrate --adopt --force");
      info("");
      return 1;
    }
  } else {
    warn("--force: se registra el baseline sin verificar que la base coincida con el schema");
  }

  await recordVersion(ctx.sql, ctx.table, baseline.version);
  ok(`baseline ${baseline.version} registrado como aplicado (no se ejecutó)`);
  return 0;
}
