import type { ResolvedConfig } from "../config.ts";
import { dryRunDiff, meaningfulDiffLines } from "../psqldef.ts";
import { fail, info, ok } from "../ui.ts";

/**
 * Qué le falta a la base para parecerse al schema. El SQL va a stdout para
 * poder pipearlo o pegarlo en una migración; los mensajes a stderr.
 *
 * `--check` lo vuelve apto para CI: sale 1 si hay cualquier diferencia.
 */
export async function diffCommand(config: ResolvedConfig, args: string[]): Promise<number> {
  const check = args.includes("--check");
  const result = await dryRunDiff(config);

  if (result.exitCode !== 0) {
    fail(`psqldef falló (exit ${String(result.exitCode)}):`);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  const differences = meaningfulDiffLines(result.stdout);
  if (differences.length === 0) {
    ok("la base coincide con el schema");
    return 0;
  }

  if (check) {
    fail(`la base NO coincide con ${config.schemaFile}:`);
    info(differences.join("\n"));
    return 1;
  }

  process.stdout.write(result.stdout);
  return 0;
}
