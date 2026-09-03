import { LABELS, ORDER } from "./classify.ts";
import { GENERAL, groupByTable, type Report } from "./report.ts";

// GFM descarta el atributo `style` inline en GitHub, así que el color no es
// portable en markdown — se pone la verbo en negrita y el emoji del bucket
// hace de color de riesgo.
function mdHighlightVerb(sql: string): string {
  return sql.replace(/^(\s*)(CREATE|ALTER|DROP|TRUNCATE)\b/i, (_m, ws: string, verb: string) => `${ws}**${verb}**`);
}

// Un `|` rompe columnas y un salto de línea rompe filas en una celda GFM.
function escapeMdCell(v: unknown): string {
  return String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function mdSampleTable(rows: Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0]!);
  const head = `| ${cols.join(" | ")} |`;
  const divider = `|${cols.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${cols.map((c) => escapeMdCell(r[c])).join(" | ")} |`).join("\n");
  return `${head}\n${divider}\n${body}\n`;
}

export function renderMarkdownReport(report: Report, options: { onlyRisky: boolean }): string {
  const forDisplay = options.onlyRisky ? report.enriched.filter((e) => e.bucket !== "safe") : report.enriched;

  const summary = ORDER.filter((b) => report.totals[b] > 0)
    .map((b) => `${LABELS[b]}: ${String(report.totals[b])}`)
    .join(" | ");

  const sections = ORDER.map((bucket) => ({ bucket, bucketItems: forDisplay.filter((e) => e.bucket === bucket) }))
    .filter(({ bucketItems }) => bucketItems.length > 0)
    .map(({ bucket, bucketItems }) => {
      const tableBlocks = [...groupByTable(bucketItems).entries()]
        .map(([table, items]) => {
          const rowCount = report.tableRowCounts.get(table);
          const header =
            table === GENERAL
              ? GENERAL
              : `📋 ${table}` + (rowCount == null ? " *(tabla nueva)*" : ` *(${rowCount.toLocaleString("es")} ${rowCount === 1 ? "fila actual" : "filas actuales"})*`);
          const stmts = items
            .map((e) => {
              let block = `\`\`\`sql\n${mdHighlightVerb(e.sql)}\n\`\`\`\n`;
              if (e.impact != null) {
                block += `→ ${e.impact.summary}\n\n`;
                if (e.impact.sample != null && e.impact.sample.length > 0) block += `${mdSampleTable(e.impact.sample)}\n`;
              }
              return block;
            })
            .join("\n");
          return `#### ${header}\n\n${stmts}`;
        })
        .join("\n");
      return `## ${LABELS[bucket]} — ${String(bucketItems.length)}\n\n${tableBlocks}`;
    })
    .join("\n");

  return `# Migration diff review\n\n${String(ORDER.reduce((n, b) => n + report.totals[b], 0))} statement(s) en el diff — ${summary}\n\n${sections}\n`;
}
