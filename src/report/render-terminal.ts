import { LABELS, ORDER, type Bucket } from "./classify.ts";
import { GENERAL, groupByTable, type Report } from "./report.ts";

// ponytail: ANSI crudo, sin chalk/picocolors — son 4 colores, no amerita una dependencia.
const ANSI: Record<Bucket, string> = {
  destructive: "\x1b[1;31m", // rojo negrita
  skipped: "\x1b[2;31m", // rojo tenue
  risky: "\x1b[1;33m", // amarillo negrita
  safe: "\x1b[1;32m", // verde negrita
};
const RESET = "\x1b[0m";
const useColor = process.stdout.isTTY || process.env.FORCE_COLOR === "1";

function highlightVerb(sql: string, bucket: Bucket): string {
  if (!useColor) return sql;
  return sql.replace(/^(\s*)(CREATE|ALTER|DROP|TRUNCATE)\b/i, (_m, ws: string, verb: string) => `${ws}${ANSI[bucket]}${verb}${RESET}`);
}

export function renderTerminalReport(report: Report, options: { onlyRisky: boolean }): void {
  const forDisplay = options.onlyRisky ? report.enriched.filter((e) => e.bucket !== "safe") : report.enriched;

  console.log(`${report.enriched.length} statement(s) en el diff${options.onlyRisky ? " (mostrando solo riesgo/destructivo)" : ""}`);
  console.log(ORDER.filter((b) => report.totals[b] > 0).map((b) => `${LABELS[b]}: ${report.totals[b]}`).join("  |  "));
  console.log("");

  for (const bucket of ORDER) {
    const items = forDisplay.filter((e) => e.bucket === bucket);
    if (items.length === 0) continue;
    console.log(`${LABELS[bucket]} — ${items.length}`);

    for (const [table, tableItems] of groupByTable(items)) {
      const rowCount = report.tableRowCounts.get(table);
      let header = table === GENERAL ? GENERAL : `  📋 ${table}`;
      if (report.hadConnection && table !== GENERAL) {
        header += rowCount == null ? " (tabla nueva)" : ` (${rowCount.toLocaleString("es")} ${rowCount === 1 ? "fila actual" : "filas actuales"})`;
      }
      console.log(header);

      for (const { sql, impact } of tableItems) {
        console.log(
          highlightVerb(sql, bucket)
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"),
        );
        if (impact != null) {
          console.log(`      → ${impact.summary}`);
          if (impact.sample != null && impact.sample.length > 0) {
            console.log(`      muestra (hasta 5 filas):`);
            console.table(impact.sample);
          }
        }
      }
    }
    console.log("");
  }
}
