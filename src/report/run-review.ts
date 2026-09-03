import { connect } from "../db.ts";
import { fail, info } from "../ui.ts";
import { buildReport, runCheck } from "./report.ts";
import { renderHtmlReport } from "./render-html.ts";
import { renderMarkdownReport } from "./render-markdown.ts";
import { renderTerminalReport } from "./render-terminal.ts";

export interface ReviewOptions {
  onlyRisky: boolean;
  htmlPath: string | null;
  mdPath: string | null;
  /** Gate de CI: falla solo si un CHECK/UNIQUE/SET NOT NULL nuevo rechazaría
   *  filas reales — no cualquier diferencia (eso ya lo cubre `diff --check`). */
  failOnImpact: boolean;
}

export function parseReviewOptions(args: string[]): ReviewOptions {
  const htmlArg = args.find((a) => a.startsWith("--html="));
  const mdArg = args.find((a) => a.startsWith("--md="));
  return {
    onlyRisky: args.includes("--only-risky"),
    htmlPath: htmlArg != null ? htmlArg.slice("--html=".length) : null,
    mdPath: mdArg != null ? mdArg.slice("--md=".length) : null,
    failOnImpact: args.includes("--fail-on-impact"),
  };
}

/**
 * El motor detrás de `diff --review` y `pending`: conecta (si hay
 * DATABASE_URL) para calcular impacto real sobre los datos, clasifica, y
 * renderiza en los formatos pedidos. Un solo pase de enriquecimiento
 * alimenta terminal + HTML + Markdown + el gate de `--fail-on-impact`.
 */
export async function runReview(diffText: string, options: ReviewOptions): Promise<number> {
  if (diffText.trim() === "") {
    info("(sin diff — nada que clasificar)");
    return 0;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null && options.failOnImpact) {
    fail("--fail-on-impact necesita DATABASE_URL para poder correr las queries de impacto.");
    return 1;
  }

  let sql: Bun.SQL | null = null;
  if (databaseUrl != null) {
    try {
      sql = connect(databaseUrl);
      await sql`SELECT 1`;
    } catch (err) {
      info(`(no se pudo conectar a la DB para calcular impacto: ${err instanceof Error ? err.message : String(err)})\n`);
      sql = null;
    }
  } else {
    info("(sin DATABASE_URL — no se calcula impacto en filas, solo clasificación)\n");
  }

  const report = await buildReport(diffText, sql);
  if (sql != null) await sql.end();

  if (options.failOnImpact) {
    const { gating } = runCheck(report);
    if (gating == null) {
      info("--fail-on-impact: nada que verificar (sin CHECK/UNIQUE/SET NOT NULL nuevos en este diff).");
      return 0;
    }
    let failures = 0;
    for (const { statement, failed } of gating) {
      if (failed) {
        fail(`${statement.sql.trim()} → ${statement.impact?.summary ?? "no se pudo verificar"}`);
        failures++;
      } else {
        info(`✓ ${statement.sql.trim()}`);
      }
    }
    if (failures > 0) {
      fail(`\n${String(failures)} de ${String(gating.length)} fallarían al aplicar. No guardes/apliques esta migración así.`);
      return 1;
    }
    info(`\n${String(gating.length)} constraint(s) nuevos, todos pasan contra los datos actuales.`);
    return 0;
  }

  if (options.htmlPath != null) {
    await Bun.write(options.htmlPath, renderHtmlReport(report, options));
    info(`Reporte HTML escrito en ${options.htmlPath}\n`);
  }
  if (options.mdPath != null) {
    await Bun.write(options.mdPath, renderMarkdownReport(report, options));
    info(`Reporte Markdown escrito en ${options.mdPath}\n`);
  }

  renderTerminalReport(report, options);

  if (report.totals.destructive > 0) {
    fail("Hay statements destructivos activos en este diff — revisá antes de guardarlo como migración.");
    return 1;
  }
  return 0;
}
