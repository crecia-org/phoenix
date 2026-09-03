import { connect } from "../db.ts";
import { displayName, listMigrationFiles, readMigration, type MigrationFile } from "./files.ts";
import {
  appliedVersions,
  ensureMigrationsTable,
  forgetVersion,
  recordVersion,
  type MigrationsTable,
} from "./table.ts";

/**
 * El que aplica y revierte migraciones — reemplaza a dbmate.
 *
 * Se reescribió por dos razones, y ninguna es "porque sí": dbmate son 46MB de
 * binario Go (más que psqldef y squawk juntos) que habría que embeber en cada
 * ejecutable, y era la tercera dependencia externa que cada máquina tenía que
 * instalar en la versión correcta. Lo que hace son tres cosas —listar archivos,
 * mirar qué versiones faltan, aplicarlas en una transacción— y el formato de
 * archivo y de tabla se mantienen idénticos, así que una base migrada con
 * dbmate sigue funcionando con esto sin tocar nada.
 */

export interface RunnerContext {
  sql: Bun.SQL;
  table: MigrationsTable;
  migrationsDir: string;
}

export interface AppliedMigration {
  file: MigrationFile;
  durationMs: number;
}

export async function pendingMigrations(ctx: RunnerContext): Promise<MigrationFile[]> {
  const applied = await appliedVersions(ctx.sql, ctx.table);
  return listMigrationFiles(ctx.migrationsDir).filter((file) => !applied.has(file.version));
}

/**
 * Cada migración corre en su propia transacción junto con el INSERT que la
 * registra: si el SQL falla, no queda registrada, y si se registra es porque
 * el SQL pasó. Las dos cosas separadas es como una base termina diciendo que
 * aplicó algo que no aplicó.
 *
 * `transaction:false` en el marcador es la excepción, y existe para
 * `CREATE INDEX CONCURRENTLY`, que Postgres prohíbe dentro de una transacción.
 * Ahí el registro va después, sin atomicidad — es el precio de ese comando, y
 * por eso una migración así conviene que sea la única del archivo.
 */
export async function applyMigration(ctx: RunnerContext, file: MigrationFile): Promise<AppliedMigration> {
  const parsed = await readMigration(file);
  if (parsed.up == null) {
    throw new Error(
      `${displayName(file)} no tiene el marcador "-- migrate:up".\n` +
        `  Sin él no se sabe qué parte del archivo aplicar. Agregalo (y su\n` +
        `  "-- migrate:down") o sacá el archivo de migrations/.`,
    );
  }

  const started = Bun.nanoseconds();
  if (parsed.up.transaction) {
    await ctx.sql.begin(async (tx) => {
      await tx.unsafe(parsed.up!.sql);
      await recordVersion(tx as unknown as Bun.SQL, ctx.table, file.version);
    });
  } else {
    await ctx.sql.unsafe(parsed.up.sql);
    await recordVersion(ctx.sql, ctx.table, file.version);
  }

  return { file, durationMs: (Bun.nanoseconds() - started) / 1e6 };
}

/** Revierte SOLO la última aplicada, como hace dbmate: revertir varias de
 *  corrido es la clase de comando que se ejecuta sin querer. */
export async function rollbackLast(ctx: RunnerContext): Promise<MigrationFile | null> {
  const applied = await appliedVersions(ctx.sql, ctx.table);
  const files = listMigrationFiles(ctx.migrationsDir).filter((file) => applied.has(file.version));
  const last = files.at(-1);
  if (last == null) return null;

  const parsed = await readMigration(last);
  if (parsed.down == null || parsed.down.sql === "") {
    throw new Error(
      `${displayName(last)} no tiene "-- migrate:down" con contenido: no se puede revertir.`,
    );
  }

  if (parsed.down.transaction) {
    await ctx.sql.begin(async (tx) => {
      await tx.unsafe(parsed.down!.sql);
      await forgetVersion(tx as unknown as Bun.SQL, ctx.table, last.version);
    });
  } else {
    await ctx.sql.unsafe(parsed.down.sql);
    await forgetVersion(ctx.sql, ctx.table, last.version);
  }

  return last;
}

export async function withRunner<T>(
  options: { migrationsDir: string; table: MigrationsTable },
  fn: (ctx: RunnerContext) => Promise<T>,
): Promise<T> {
  const sql = connect();
  try {
    await ensureMigrationsTable(sql, options.table);
    return await fn({ sql, table: options.table, migrationsDir: options.migrationsDir });
  } finally {
    await sql.end();
  }
}
