import type { ResolvedConfig } from "../config.ts";
import { dryRunDiff, meaningfulDiffLines } from "../psqldef.ts";
import { parseReviewOptions, runReview } from "../report/run-review.ts";
import { fail, info, ok } from "../ui.ts";

/**
 * Qué le falta a la base para parecerse al schema.
 *
 * Por default el SQL crudo va a stdout, para poder pipearlo o pegarlo en una
 * migración. `--review` cambia la salida entera a un reporte clasificado por
 * riesgo y agrupado por tabla (ver report/), con el impacto real sobre los
 * datos existentes cuando hay `DATABASE_URL` — es la otra cara de este mismo
 * comando, no algo aparte, porque los dos parten del mismo diff.
 *
 * Dos gates de CI distintos y no intercambiables: `--check` (sin --review)
 * falla si hay CUALQUIER diferencia — grueso, para "¿está sincronizado?".
 * `--fail-on-impact` (con --review) falla solo si un CHECK/UNIQUE/SET NOT
 * NULL nuevo de verdad rechazaría filas — fino, para "¿esta migración
 * específica es segura de aplicar?".
 */
export async function diffCommand(config: ResolvedConfig, args: string[]): Promise<number> {
  const result = await dryRunDiff(config);
  if (result.exitCode !== 0) {
    fail(`psqldef falló (exit ${String(result.exitCode)}):`);
    process.stderr.write(result.stderr);
    return result.exitCode;
  }

  if (args.includes("--review")) {
    return runReview(result.stdout, parseReviewOptions(args));
  }

  const differences = meaningfulDiffLines(result.stdout);
  if (differences.length === 0) {
    ok("la base coincide con el schema");
    return 0;
  }

  if (args.includes("--check")) {
    fail(`la base NO coincide con ${config.schemaFile}:`);
    info(differences.join("\n"));
    return 1;
  }

  process.stdout.write(result.stdout);
  return 0;
}
