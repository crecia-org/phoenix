/**
 * Clasifica cada sentencia de un diff de psqldef en un bucket de riesgo.
 * Puramente sintáctico — patrones de SQL genéricos de Postgres, nada
 * específico de ningún dominio.
 */

export type Bucket = "destructive" | "skipped" | "risky" | "safe";

export interface Statement {
  sql: string;
  bucket: Bucket;
}

export const LABELS: Record<Bucket, string> = {
  destructive: "🔴 DESTRUCTIVO (borra datos/objetos)",
  skipped: "⛔ DESTRUCTIVO PERO OMITIDO (necesita --enable-drop-table para correr)",
  risky: "🟡 CREACIÓN CON RIESGO (puede fallar o bloquear, no borra datos)",
  safe: "🟢 CREACIÓN SEGURA (aditivo)",
};

export const ORDER: Bucket[] = ["destructive", "risky", "skipped", "safe"];

/**
 * Parte el texto de un diff en sentencias individuales. Un `$tag$ ... $tag$`
 * (cuerpo de función) puede contener `;` sueltos que no terminan la sentencia,
 * así que se rastrea el tag mientras esté abierto.
 *
 * Un comentario suelto entre sentencias (marcador de archivo, banner de
 * psqldef) nunca es parte de la sentencia siguiente y se descarta — con la
 * excepción de `-- Skipped: ...`, que es como psqldef expone una sentencia
 * destructiva deshabilitada: ahí el comentario ES la sentencia.
 */
export function splitStatements(input: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let dollarTag: string | null = null;

  for (const rawLine of input.split("\n")) {
    const line = rawLine.trimEnd();

    if (
      buf === "" &&
      (line === "" || line === "BEGIN;" || line === "COMMIT;" || (line.startsWith("--") && !line.startsWith("-- Skipped:")))
    ) {
      continue;
    }

    buf += (buf ? "\n" : "") + line;

    if (dollarTag != null) {
      if (line.includes(dollarTag)) dollarTag = null;
      continue;
    }

    const tagMatch = /\$(\w*)\$/.exec(line);
    if (tagMatch != null && !line.trim().endsWith(`${tagMatch[0]};`)) {
      dollarTag = tagMatch[0];
      continue;
    }

    if (buf.trimEnd().endsWith(";")) {
      statements.push(buf);
      buf = "";
    }
  }
  if (buf.trim() !== "") statements.push(buf);
  return statements;
}

export function classify(sql: string): Statement {
  const skipped = /^-- Skipped: (.+)$/m.exec(sql);
  if (skipped?.[1] != null) {
    const inner = skipped[1];
    return { sql: inner, bucket: /DROP |TRUNCATE /i.test(inner) ? "skipped" : "risky" };
  }

  if (/\b(DROP TABLE|DROP COLUMN|DROP TYPE|DROP FUNCTION|DROP TRIGGER|DROP INDEX|TRUNCATE)\b/i.test(sql)) {
    return { sql, bucket: "destructive" };
  }

  const hasDefault = /\bDEFAULT\b/i.test(sql);
  const isRisky =
    /ALTER COLUMN .* TYPE/i.test(sql) ||
    /SET NOT NULL/i.test(sql) ||
    /ADD CONSTRAINT .*(CHECK|UNIQUE)/i.test(sql) ||
    /DROP CONSTRAINT/i.test(sql) ||
    /RENAME/i.test(sql) ||
    /CREATE UNIQUE INDEX/i.test(sql) ||
    (/ADD COLUMN/i.test(sql) && /NOT NULL/i.test(sql) && !hasDefault);

  return { sql, bucket: isRisky ? "risky" : "safe" };
}

// Identificador con esquema opcional y comillas opcionales: "public"."foo" | public.foo | foo
export const IDENT = `"?(?:\\w+"?\\.)?"?(\\w+)"?`;

/** Mejor esfuerzo: a qué tabla toca una sentencia, para agrupar el reporte por
 *  tabla en vez de una lista plana. Sin tabla (CREATE EXTENSION/TYPE/FUNCTION,
 *  ALTER TYPE ... ADD VALUE) cae en un bucket "general". */
export function tableForStatement(sql: string): string | null {
  const flat = sql.replace(/\s+/g, " ").trim();
  let m = new RegExp(`^CREATE TABLE\\s+${IDENT}`, "i").exec(flat);
  if (m?.[1] != null) return m[1];
  m = new RegExp(`^DROP TABLE\\s+${IDENT}`, "i").exec(flat);
  if (m?.[1] != null) return m[1];
  m = new RegExp(`^ALTER TABLE\\s+(?:ONLY\\s+)?${IDENT}`, "i").exec(flat);
  if (m?.[1] != null) return m[1];
  m = new RegExp(`\\bON\\s+${IDENT}`, "i").exec(flat); // CREATE INDEX/TRIGGER ... ON table
  if (m?.[1] != null) return m[1];
  return null;
}
