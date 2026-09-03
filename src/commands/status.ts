import type { ResolvedConfig } from "../config.ts";
import { displayName, listMigrationFiles, readMigration } from "../migrations/files.ts";
import { withRunner } from "../migrations/runner.ts";
import { appliedVersions, parseMigrationsTable } from "../migrations/table.ts";
import { dim, green, info, warn, yellow } from "../ui.ts";

/** Qué está aplicado y qué no. Marca además los archivos rotos —sin el
 *  marcador `-- migrate:up`— en vez de esperar a que `migrate` se caiga. */
export async function statusCommand(config: ResolvedConfig): Promise<number> {
  const table = parseMigrationsTable(config.migrationsTable);

  return withRunner({ migrationsDir: config.migrationsDir, table }, async (ctx) => {
    const applied = await appliedVersions(ctx.sql, ctx.table);
    const files = listMigrationFiles(config.migrationsDir);

    if (files.length === 0) {
      info(`no hay migraciones en ${config.migrationsDir}`);
      return 0;
    }

    let broken = 0;
    for (const file of files) {
      const isApplied = applied.has(file.version);
      const parsed = await readMigration(file);
      const mark = isApplied ? green("aplicada ") : yellow("pendiente");
      const note = parsed.up == null ? dim("  ← sin marcador -- migrate:up") : "";
      if (parsed.up == null) broken++;
      info(`  ${mark}  ${displayName(file)}${note}`);
    }

    const orphans = [...applied].filter((v) => !files.some((f) => f.version === v));
    if (orphans.length > 0) {
      info("");
      warn(
        `${String(orphans.length)} versión(es) registradas en la base sin archivo en el repo: ${orphans.join(", ")}`,
      );
      info("  (una migración borrada después de aplicarse, o un repo desactualizado)");
    }

    if (broken > 0) {
      info("");
      warn(`${String(broken)} archivo(s) sin "-- migrate:up": migrate va a fallar al llegar al primero`);
      return 1;
    }
    return 0;
  });
}
