/**
 * El pase de enriquecimiento compartido: clasifica, agrupa por tabla y —si
 * hay conexión— calcula el impacto real sobre los datos. Un solo pase
 * alimenta los tres formatos de salida (terminal, HTML, Markdown) y el modo
 * `--check`, para no repetir las queries de impacto por cada uno.
 */
import { classify, ORDER, splitStatements, tableForStatement, type Bucket, type Statement } from "./classify.ts";
import { collectAddedColumns, computeImpact, extractImpactTarget, tableRowCount, type ImpactResult, type ImpactTarget } from "./impact.ts";

export const GENERAL = "(general — sin tabla)";

export interface Enriched {
  sql: string;
  bucket: Bucket;
  table: string;
  target: ImpactTarget | null;
  impact: ImpactResult | null;
}

export interface Report {
  enriched: Enriched[];
  totals: Record<Bucket, number>;
  tableRowCounts: Map<string, number | null>;
  /** `null` cuando no había `DATABASE_URL` o no se pudo conectar — los
   *  consumidores lo usan para decidir si mencionan que el impacto no se
   *  calculó. */
  hadConnection: boolean;
}

export function groupByTable(enriched: Enriched[]): Map<string, Enriched[]> {
  const byTable = new Map<string, Enriched[]>();
  for (const e of enriched) {
    if (!byTable.has(e.table)) byTable.set(e.table, []);
    byTable.get(e.table)!.push(e);
  }
  return byTable;
}

/**
 * `sql` es opcional: sin conexión se clasifica igual, solo que sin el
 * impacto real sobre filas existentes.
 */
export async function buildReport(diffText: string, sql: Bun.SQL | null): Promise<Report> {
  const rawStatements = splitStatements(diffText);
  const statements: Statement[] = rawStatements.map((raw) => classify(raw.trim()));
  const addedColumns = collectAddedColumns(rawStatements.map((raw) => raw.trim()));

  const totals: Record<Bucket, number> = { destructive: 0, skipped: 0, risky: 0, safe: 0 };
  for (const s of statements) totals[s.bucket]++;

  const enriched: Enriched[] = [];
  const tableRowCounts = new Map<string, number | null>();
  for (const s of statements) {
    const table = tableForStatement(s.sql) ?? GENERAL;
    if (sql != null && table !== GENERAL && !tableRowCounts.has(table)) {
      tableRowCounts.set(table, await tableRowCount(sql, table));
    }
    const target = extractImpactTarget(s.sql);
    const impact = sql != null && s.bucket !== "safe" && target != null ? await computeImpact(sql, target, addedColumns) : null;
    enriched.push({ sql: s.sql, bucket: s.bucket, table, target, impact });
  }

  return { enriched, totals, tableRowCounts, hadConnection: sql != null };
}

/** Para `--check`: los únicos targets donde "impacto > 0" significa "esto
 *  rechazaría filas reales al aplicarse", no solo "esto no es aditivo". */
const GATING_KINDS: ImpactTarget["kind"][] = ["null_count", "check_violation_count", "duplicate_count"];

export interface CheckResult {
  /** `null` cuando no había nada que verificar (ningún CHECK/UNIQUE/SET NOT
   *  NULL nuevo en el diff) — distinto de "se verificó y pasó todo". */
  gating: { statement: Enriched; failed: boolean }[] | null;
}

export function runCheck(report: Report): CheckResult {
  const gating = report.enriched.filter((e) => e.target != null && GATING_KINDS.includes(e.target.kind));
  if (gating.length === 0) return { gating: null };

  return {
    gating: gating.map((statement) => ({
      statement,
      failed: statement.impact?.count === undefined || statement.impact.count > 0,
    })),
  };
}

export { ORDER, type Bucket };
