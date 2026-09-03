/**
 * Cuánto le pasa a los datos EXISTENTES si una sentencia riesgosa/destructiva
 * de verdad corriera — la parte que Atlas deja atrás de un paywall.
 *
 * Solo cubre los patrones donde "cuántas filas" tiene una respuesta sin
 * ambigüedad (DROP TABLE/COLUMN, SET NOT NULL, ADD CONSTRAINT CHECK/UNIQUE).
 * `ALTER COLUMN ... TYPE` NO está cubierto: si los valores existentes
 * sobreviven un cast arbitrario no se puede responder en general.
 */
import { IDENT } from "./classify.ts";

export type ImpactTarget =
  | { kind: "table_count"; table: string }
  | { kind: "column_not_null_count"; table: string; column: string }
  | { kind: "null_count"; table: string; column: string }
  | { kind: "check_violation_count"; table: string; expr: string }
  | { kind: "duplicate_count"; table: string; columns: string[] };

export function extractImpactTarget(sql: string): ImpactTarget | null {
  const flat = sql.replace(/\s+/g, " ").trim();

  let m = new RegExp(`^DROP TABLE\\s+${IDENT}`, "i").exec(flat);
  if (m?.[1] != null) return { kind: "table_count", table: m[1] };

  m = new RegExp(`^ALTER TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+DROP COLUMN\\s+"?(\\w+)"?`, "i").exec(flat);
  if (m?.[1] != null && m[2] != null) return { kind: "column_not_null_count", table: m[1], column: m[2] };

  m = new RegExp(`^ALTER TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ALTER COLUMN\\s+"?(\\w+)"?\\s+SET NOT NULL`, "i").exec(flat);
  if (m?.[1] != null && m[2] != null) return { kind: "null_count", table: m[1], column: m[2] };

  m = new RegExp(`^ALTER TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ADD CONSTRAINT\\s+"?[\\w]+"?\\s+CHECK\\s*\\((.+)\\);?$`, "i").exec(flat);
  if (m?.[1] != null && m[2] != null) return { kind: "check_violation_count", table: m[1], expr: m[2] };

  m = new RegExp(`^ALTER TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ADD CONSTRAINT\\s+"?[\\w]+"?\\s+UNIQUE\\s*\\(([^)]+)\\)`, "i").exec(flat);
  if (m?.[1] != null && m[2] != null) {
    return { kind: "duplicate_count", table: m[1], columns: m[2].split(",").map((c) => c.trim().replace(/"/g, "")) };
  }

  return null;
}

/**
 * (tabla, columna) que se crean en ALGÚN lugar de este mismo diff — vía la
 * lista de columnas de un CREATE TABLE o un ADD COLUMN suelto. Deja que
 * `computeImpact` distinga "esta columna no existe TODAVÍA porque una
 * sentencia anterior la crea" (pase silencioso) de "esta columna no existe,
 * punto" (migración realmente vieja/rota — sí amerita advertencia).
 */
export function collectAddedColumns(rawStatements: string[]): Map<string, Set<string>> {
  const added = new Map<string, Set<string>>();
  const add = (table: string, column: string): void => {
    if (!added.has(table)) added.set(table, new Set());
    added.get(table)!.add(column);
  };

  for (const raw of rawStatements) {
    const flat = raw.replace(/\s+/g, " ").trim();

    const createMatch = new RegExp(`^CREATE TABLE\\s+${IDENT}\\s*\\((.+)\\);?$`, "i").exec(flat);
    if (createMatch?.[1] != null && createMatch[2] != null) {
      const table = createMatch[1];
      for (const colMatch of createMatch[2].matchAll(/"(\w+)"\s+\S/g)) add(table, colMatch[1]!);
      continue;
    }

    const addColMatch = new RegExp(`^ALTER TABLE\\s+(?:ONLY\\s+)?${IDENT}\\s+ADD COLUMN\\s+"?(\\w+)"?`, "i").exec(flat);
    if (addColMatch?.[1] != null && addColMatch[2] != null) add(addColMatch[1], addColMatch[2]);
  }
  return added;
}

export interface ImpactResult {
  summary: string;
  count?: number;
  sample?: Record<string, unknown>[];
}

function truncateRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "string" && v.length > 40 ? `${v.slice(0, 37)}...` : v;
  }
  return out;
}

export async function tableRowCount(sql: Bun.SQL, table: string): Promise<number | null> {
  try {
    const rows = (await sql.unsafe(`SELECT COUNT(*)::text AS n FROM "${table}"`)) as { n: string }[];
    return Number(rows[0]?.n);
  } catch {
    return null; // tabla nueva, todavía no existe
  }
}

/** `errno` es el SQLSTATE de Postgres en el error de Bun.SQL (`42P01`
 *  undefined_table, `42703` undefined_column) — más confiable que parsear el
 *  mensaje, que sí hace falta para sacar el nombre de la columna. */
function sqlState(error: unknown): string | null {
  return error != null && typeof error === "object" && "errno" in error ? String((error as { errno: unknown }).errno) : null;
}

export async function computeImpact(
  sql: Bun.SQL,
  target: ImpactTarget,
  addedColumns: Map<string, Set<string>>,
): Promise<ImpactResult> {
  const t = `"${target.table}"`;
  try {
    let where = "";
    let summaryFor: (n: number) => string;

    switch (target.kind) {
      case "table_count":
        where = "";
        summaryFor = (n) => `${n.toLocaleString("es")} filas se pierden`;
        break;
      case "column_not_null_count":
        where = `WHERE "${target.column}" IS NOT NULL`;
        summaryFor = (n) => `${n.toLocaleString("es")} filas pierden el dato de esa columna`;
        break;
      case "null_count":
        where = `WHERE "${target.column}" IS NULL`;
        summaryFor = (n) => (n > 0 ? `${n.toLocaleString("es")} filas fallarían (NULL en "${target.column}")` : "ninguna fila falla");
        break;
      case "check_violation_count":
        where = `WHERE NOT (${target.expr})`;
        summaryFor = (n) => (n > 0 ? `${n.toLocaleString("es")} filas violan el CHECK` : "ninguna fila viola el CHECK");
        break;
      case "duplicate_count": {
        const cols = target.columns.map((c) => `"${c}"`).join(", ");
        const countRows = (await sql.unsafe(
          `SELECT COUNT(*)::text AS n FROM (SELECT 1 FROM ${t} GROUP BY ${cols} HAVING COUNT(*) > 1) d`,
        )) as { n: string }[];
        const n = Number(countRows[0]?.n);
        if (n === 0) return { summary: "sin duplicados", count: 0 };
        const sample = (await sql.unsafe(
          `SELECT * FROM ${t} WHERE (${cols}) IN (SELECT ${cols} FROM ${t} GROUP BY ${cols} HAVING COUNT(*) > 1) ORDER BY ${cols} LIMIT 5`,
        )) as Record<string, unknown>[];
        return { summary: `${n.toLocaleString("es")} grupos duplicados`, count: n, sample: sample.map(truncateRow) };
      }
    }

    const rows = (await sql.unsafe(`SELECT COUNT(*)::text AS n FROM ${t} ${where}`)) as { n: string }[];
    const n = Number(rows[0]?.n);
    if (n === 0) return { summary: summaryFor(n), count: 0 };
    const sample = (await sql.unsafe(`SELECT * FROM ${t} ${where} LIMIT 5`)) as Record<string, unknown>[];
    return { summary: summaryFor(n), count: n, sample: sample.map(truncateRow) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const state = sqlState(err);

    // La tabla entera todavía no existe — se crea antes en este mismo diff.
    // Nada que violar contra cero filas: pase silencioso.
    if (state === "42P01") {
      return { summary: "tabla nueva — sin filas existentes que validar", count: 0 };
    }
    // Una columna referenciada no existe todavía. Podría ser el mismo caso de
    // arriba, o una referencia realmente vieja/rota (ej. una columna borrada
    // por un cambio anterior sin relación). Solo se trata como pase
    // silencioso cuando se puede confirmar que ESTE diff la agrega.
    if (state === "42703") {
      const colMatch = /^column "(\w+)" does not exist/i.exec(message);
      if (colMatch?.[1] != null && addedColumns.get(target.table)?.has(colMatch[1]) === true) {
        return {
          summary: `no verificable aún ("${colMatch[1]}" se crea en este mismo diff) — se valida recién al aplicar`,
          count: 0,
        };
      }
    }
    return { summary: `no se pudo calcular (${message.split("\n")[0]})` };
  }
}
