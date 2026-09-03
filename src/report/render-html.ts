import { LABELS, ORDER } from "./classify.ts";
import { GENERAL, groupByTable, type Report } from "./report.ts";

const HTML_COLOR: Record<string, string> = {
  destructive: "#c0392b",
  skipped: "#a35a52",
  risky: "#b8860b",
  safe: "#2e7d32",
};

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function htmlHighlightVerb(sql: string, bucket: string): string {
  const escaped = escapeHtml(sql);
  return escaped.replace(/^(\s*)(CREATE|ALTER|DROP|TRUNCATE)\b/i, (_m, ws: string, verb: string) => `${ws}<b style="color:${HTML_COLOR[bucket]}">${verb}</b>`);
}

function htmlSampleTable(rows: Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0]!);
  const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(r[c])}</td>`).join("")}</tr>`).join("");
  return `<table class="sample"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderHtmlReport(report: Report, options: { onlyRisky: boolean }): string {
  const forDisplay = options.onlyRisky ? report.enriched.filter((e) => e.bucket !== "safe") : report.enriched;

  const sections = ORDER.map((bucket) => ({ bucket, bucketItems: forDisplay.filter((e) => e.bucket === bucket) }))
    .filter(({ bucketItems }) => bucketItems.length > 0)
    .map(({ bucket, bucketItems }) => {
      const tableBlocks = [...groupByTable(bucketItems).entries()]
        .map(([table, items]) => {
          const rowCount = report.tableRowCounts.get(table);
          const header =
            table === GENERAL
              ? GENERAL
              : `📋 ${escapeHtml(table)}` +
                (rowCount == null
                  ? ' <span class="muted">(tabla nueva)</span>'
                  : ` <span class="muted">(${rowCount.toLocaleString("es")} ${rowCount === 1 ? "fila actual" : "filas actuales"})</span>`);
          const stmts = items
            .map((e) => {
              let block = `<pre class="stmt">${htmlHighlightVerb(e.sql, e.bucket)}</pre>`;
              if (e.impact != null) {
                block += `<div class="impact">→ ${escapeHtml(e.impact.summary)}</div>`;
                if (e.impact.sample != null && e.impact.sample.length > 0) block += htmlSampleTable(e.impact.sample);
              }
              return block;
            })
            .join("");
          return `<div class="table-block"><h3>${header}</h3>${stmts}</div>`;
        })
        .join("");
      return `<section><h2 style="color:${HTML_COLOR[bucket]}">${escapeHtml(LABELS[bucket])} — ${String(bucketItems.length)}</h2>${tableBlocks}</section>`;
    })
    .join("");

  const summary = ORDER.filter((b) => report.totals[b] > 0)
    .map((b) => `<span style="color:${HTML_COLOR[b]}">${escapeHtml(LABELS[b])}: ${String(report.totals[b])}</span>`)
    .join(" &nbsp;|&nbsp; ");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Migration diff review</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; } h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: .3rem; }
  h3 { font-size: .95rem; margin: 1.25rem 0 0; }
  .table-block { margin-left: .5rem; }
  .muted { color: #888; font-weight: normal; font-size: .85em; }
  pre.stmt { background: #f6f8fa; padding: .5rem .75rem; border-radius: 4px; overflow-x: auto; margin: .5rem 0 .25rem; }
  .impact { color: #444; font-size: .9em; margin-bottom: .5rem; }
  table.sample { border-collapse: collapse; font-size: .8em; margin-bottom: 1rem; display: block; overflow-x: auto; white-space: nowrap; }
  table.sample th, table.sample td { border: 1px solid #ddd; padding: .25rem .5rem; text-align: left; }
  table.sample th { background: #f0f0f0; }
</style></head>
<body>
<h1>Migration diff review</h1>
<p>${String(ORDER.reduce((n, b) => n + report.totals[b], 0))} statement(s) en el diff &nbsp;—&nbsp; ${summary}</p>
${sections}
</body></html>`;
}
