import type { ResolvedConfig } from "../config.ts";
import { displayName, listMigrationFiles, readMigration } from "../migrations/files.ts";
import { appliedVersions, ensureMigrationsTable, parseMigrationsTable } from "../migrations/table.ts";
import { connect } from "../db.ts";
import { parseReviewOptions, runReview } from "../report/run-review.ts";
import { warn } from "../ui.ts";

/**
 * Mismo reporte que `diff --review`, pero sourceado de los archivos de
 * migración PENDIENTES en vez de un diff contra `schema.sql` — para revisar
 * una migración que alguien ya escribió (a mano, o pendiente de aplicar)
 * antes de que `migrate` la corra. Reemplaza el viejo
 * extract-pending-migrations.ts + classify-migration-diff.ts en pipe.
 *
 * Un archivo sin el marcador `-- migrate:up` se salta con una advertencia en
 * vez de romper el reporte — `status` ya lo señala como roto, acá solo se
 * ignora para poder seguir revisando el resto.
 */
export async function pendingCommand(config: ResolvedConfig, args: string[]): Promise<number> {
  const table = parseMigrationsTable(config.migrationsTable);
  const sql = connect();

  let blocks: string[];
  try {
    await ensureMigrationsTable(sql, table);
    const applied = await appliedVersions(sql, table);
    const files = listMigrationFiles(config.migrationsDir).filter((file) => !applied.has(file.version));

    blocks = [];
    for (const file of files) {
      const parsed = await readMigration(file);
      if (parsed.up == null || parsed.up.sql === "") {
        warn(`${displayName(file)}: no tiene un bloque "-- migrate:up" válido, se ignora`);
        continue;
      }
      if (/^BEGIN;/.test(parsed.up.sql) && /COMMIT;\s*$/.test(parsed.up.sql)) {
        warn(
          `${displayName(file)}: el bloque "-- migrate:up" tiene su propio BEGIN;/COMMIT; — cada migración ya corre en su ` +
            `propia transacción, y ese COMMIT; la cierra antes de tiempo. Sacalo del archivo.`,
        );
      }
      blocks.push(`-- ${displayName(file)}.sql\n${parsed.up.sql}`);
    }
  } finally {
    await sql.end();
  }

  const diffText = blocks.length > 0 ? `-- dry run --\nBEGIN;\n${blocks.join("\n")}\nCOMMIT;` : "";
  return runReview(diffText, parseReviewOptions(args));
}
