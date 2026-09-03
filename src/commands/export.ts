import type { ResolvedConfig } from "../config.ts";
import { exportSchema } from "../psqldef.ts";
import { fail, ok } from "../ui.ts";

/**
 * Regenera el archivo de schema desde la base viva. Pasa por
 * `transformExport` del config antes de escribir: hay repos cuyo baseline se
 * ejecuta de arriba a abajo contra una base vacía, y psqldef exporta por orden
 * alfabético de tabla, así que una FK puede referenciar algo definido más
 * abajo. Reordenar eso es asunto del repo, no del CLI.
 */
export async function exportCommand(config: ResolvedConfig): Promise<number> {
  const result = await exportSchema(config);
  if (result.exitCode !== 0) {
    fail(`psqldef --export falló (exit ${String(result.exitCode)}):`);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  const sql = config.transformExport != null ? await config.transformExport(result.stdout) : result.stdout;
  await Bun.write(config.schemaFile, sql);
  ok(`schema exportado a ${config.schemaFile}`);
  return 0;
}
