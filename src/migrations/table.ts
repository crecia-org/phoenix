/**
 * La tabla de control. Mismo shape que crea dbmate MÁS `applied_at`: dbmate
 * registra QUÉ migración corrió pero no CUÁNDO, y esa columna es la única
 * forma de reconstruir después en qué orden real se aplicó cada cosa en un
 * ambiente. Todo esto es idempotente, así que corre antes de cada comando.
 */

export interface MigrationsTable {
  schema: string;
  table: string;
  /** `"dbmate"."schema_migrations"`, ya citado, para interpolar en SQL. */
  qualified: string;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * El nombre de la tabla sale del config del repo consumidor y termina
 * interpolado en SQL (no puede ir como parámetro: es un identificador, no un
 * valor). Se valida en vez de escapar para que un nombre raro falle de entrada
 * y no se convierta en una inyección por la puerta de atrás.
 */
export function parseMigrationsTable(value: string): MigrationsTable {
  const parts = value.split(".");
  const [schema, table] = parts.length === 1 ? ["public", parts[0]!] : [parts[0]!, parts[1]!];

  if (parts.length > 2 || !IDENT_RE.test(schema) || !IDENT_RE.test(table)) {
    throw new Error(
      `migrationsTable inválida: ${JSON.stringify(value)}.\n` +
        `  Se espera "tabla" o "esquema.tabla", con letras, números y guión bajo.`,
    );
  }
  return { schema, table, qualified: `"${schema}"."${table}"` };
}

export async function ensureMigrationsTable(sql: Bun.SQL, target: MigrationsTable): Promise<void> {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${target.schema}"`);
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${target.qualified} (version varchar(255) PRIMARY KEY)`,
  );
  await sql.unsafe(
    `ALTER TABLE ${target.qualified} ADD COLUMN IF NOT EXISTS applied_at timestamptz NOT NULL DEFAULT now()`,
  );
}

export async function appliedVersions(sql: Bun.SQL, target: MigrationsTable): Promise<Set<string>> {
  const rows = (await sql.unsafe(`SELECT version FROM ${target.qualified}`)) as { version: string }[];
  return new Set(rows.map((row) => row.version));
}

export async function recordVersion(sql: Bun.SQL, target: MigrationsTable, version: string): Promise<void> {
  await sql.unsafe(`INSERT INTO ${target.qualified} (version) VALUES ($1) ON CONFLICT DO NOTHING`, [version]);
}

export async function forgetVersion(sql: Bun.SQL, target: MigrationsTable, version: string): Promise<void> {
  await sql.unsafe(`DELETE FROM ${target.qualified} WHERE version = $1`, [version]);
}

/** Cuántas tablas hay en `public`: es cómo se distingue una base nueva de una
 *  preexistente al resolver el baseline (ver commands/migrate.ts). */
export async function publicTableCount(sql: Bun.SQL): Promise<number> {
  const rows = (await sql.unsafe(
    `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`,
  )) as { count: number }[];
  return rows[0]?.count ?? 0;
}
