import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../config.ts";
import { listMigrationFiles } from "../migrations/files.ts";
import { fail, info, ok } from "../ui.ts";
import { versionStamp } from "./new.ts";
import { exportCommand } from "./export.ts";

/**
 * Genera el baseline: el snapshot de todo lo que ya existía antes de que este
 * CLI llevara la cuenta de nada. Se corre UNA vez, cuando el repo de verdad
 * empieza a usar esto.
 *
 * Re-exporta el schema primero, a propósito: el baseline tiene que reflejar lo
 * que es cierto EN ESE MOMENTO en la base, no lo que era cuando alguien armó
 * el workflow. Y se niega a correr si ya existe uno: cada ambiente tiene que
 * marcar exactamente la misma versión como aplicada, así que regenerarlo
 * después de que alguno lo adoptó los desincroniza en silencio.
 */
export async function baselineCommand(config: ResolvedConfig, args: string[]): Promise<number> {
  const existing = listMigrationFiles(config.migrationsDir).find((file) => file.name === config.baselineName);
  if (existing != null) {
    fail(`ya existe un baseline: ${existing.path}`);
    info("  Solo puede haber uno: todos los ambientes tienen que marcar la MISMA versión");
    info("  como aplicada. Si de verdad querés reemplazarlo (ningún ambiente adoptó el");
    info("  viejo todavía), borralo primero.");
    return 1;
  }

  if (!args.includes("--no-export")) {
    info("re-exportando el schema desde la base viva primero...");
    const exported = await exportCommand(config);
    if (exported !== 0) return exported;
  }

  const schema = await Bun.file(config.schemaFile).text();
  const version = versionStamp();

  const content = `-- Baseline: captura todo lo que ya existía en la base antes de que este
-- workflow llevara la cuenta de nada. No es un cambio nuevo: es el punto de
-- partida para tener historial real desde acá en adelante.
--
-- El contenido de migrate:up es un volcado literal del schema al momento de
-- generar este archivo (phoenix baseline).
--
-- No hace falta marcarlo a mano en ningún lado: "phoenix migrate" distingue
-- solo entre una base vacía (lo ejecuta) y una que ya tiene este schema (lo
-- registra sin ejecutarlo, después de verificar que de verdad coincidan).
--
-- De acá en adelante, todo cambio de schema es una migración nueva
-- (phoenix new <nombre>) generada desde phoenix diff — no se edita este
-- archivo, y no se genera otro baseline.

-- migrate:up
${schema.replace(/\n+$/, "")}

-- migrate:down
DO $$ BEGIN
  RAISE EXCEPTION 'Rollback del baseline deshabilitado a propósito: revertirlo dropearía todo el schema previo. Si de verdad necesitás una base vacía, hacelo explícito (DROP SCHEMA public CASCADE; CREATE SCHEMA public;) en vez de con un rollback.';
END $$;
`;

  mkdirSync(config.migrationsDir, { recursive: true });
  const path = join(config.migrationsDir, `${version}_${config.baselineName}.sql`);
  await Bun.write(path, content);

  ok(`baseline generado: ${path}`);
  info("  Commitealo, y en cada ambiente corré: phoenix migrate");
  return 0;
}
