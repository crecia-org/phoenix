import type { ResolvedConfig } from "../config.ts";
import { parseMigrationsTable } from "../migrations/table.ts";
import { exportSchema } from "../psqldef.ts";
import { reorderForBootstrap } from "../schema/reorder.ts";
import { fail, ok } from "../ui.ts";

/**
 * Regenera el archivo de schema desde la base viva.
 *
 * Por default lo reordena para que sea ejecutable de arriba a abajo contra una
 * base vacía (ver schema/reorder.ts) — el baseline es exactamente ese caso, y
 * el orden en que psqldef exporta no sirve para eso.
 */
export async function exportCommand(config: ResolvedConfig): Promise<number> {
  const result = await exportSchema(config);
  if (result.exitCode !== 0) {
    fail(`psqldef --export falló (exit ${String(result.exitCode)}):`);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  let sql = result.stdout;
  if (config.reorderExport) {
    sql = reorderForBootstrap(sql, { migrationsSchema: parseMigrationsTable(config.migrationsTable).schema });
  }
  if (config.transformExport != null) {
    sql = await config.transformExport(sql);
  }

  await Bun.write(config.schemaFile, sql);
  ok(`schema exportado a ${config.schemaFile}`);
  return 0;
}
