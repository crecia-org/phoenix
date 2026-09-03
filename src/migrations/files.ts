import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Formato de archivo de migración. Es EL MISMO que usa dbmate, a propósito:
 * las bases que ya adoptaron dbmate tienen filas en su tabla de control y
 * baselines con estos marcadores, así que cambiar el formato obligaría a
 * re-migrar todos los ambientes. El runner se reescribió (ver runner.ts); el
 * formato no.
 *
 *     -- migrate:up
 *     ...sql...
 *     -- migrate:down
 *     ...sql...
 *
 * `-- migrate:up transaction:false` desactiva la transacción para esa
 * dirección, que es lo único que permite un CREATE INDEX CONCURRENTLY — el
 * mismo que el linter recomienda.
 */
export interface MigrationFile {
  version: string;
  name: string;
  path: string;
}

export interface MigrationBlock {
  sql: string;
  transaction: boolean;
}

export interface ParsedMigration {
  up: MigrationBlock | null;
  down: MigrationBlock | null;
}

const MIGRATION_RE = /^(\d+)(?:_(.*))?\.sql$/;
const MARKER_RE = /^--\s*migrate:(up|down)\b(.*)$/i;

/** Ordenadas por versión ascendente, que es el orden en que se aplican. */
export function listMigrationFiles(dir: string): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`No se pudo leer el directorio de migraciones: ${dir}`);
  }

  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const match = MIGRATION_RE.exec(entry);
    if (match?.[1] == null) continue;
    files.push({ version: match[1], name: match[2] ?? "", path: join(dir, entry) });
  }
  files.sort((a, b) => a.version.localeCompare(b.version));

  const seen = new Map<string, string>();
  for (const file of files) {
    const previous = seen.get(file.version);
    if (previous != null) {
      throw new Error(
        `Dos migraciones comparten la versión ${file.version}:\n  ${basename(previous)}\n  ${basename(file.path)}\n` +
          `  La versión es la clave de la tabla de control: solo una de las dos quedaría registrada.`,
      );
    }
    seen.set(file.version, file.path);
  }
  return files;
}

export function parseMigration(source: string): ParsedMigration {
  const lines = source.split("\n");
  const blocks: Record<"up" | "down", { lines: string[]; transaction: boolean } | null> = { up: null, down: null };
  let current: "up" | "down" | null = null;

  for (const line of lines) {
    const marker = MARKER_RE.exec(line);
    if (marker?.[1] != null) {
      current = marker[1].toLowerCase() as "up" | "down";
      // `transaction:false` es la única opción reconocida; cualquier otra se
      // ignora en silencio igual que hace dbmate.
      blocks[current] = { lines: [], transaction: !/\btransaction:false\b/i.test(marker[2] ?? "") };
      continue;
    }
    if (current != null) blocks[current]!.lines.push(line);
  }

  const toBlock = (block: { lines: string[]; transaction: boolean } | null): MigrationBlock | null => {
    if (block == null) return null;
    return { sql: block.lines.join("\n").trim(), transaction: block.transaction };
  };

  return { up: toBlock(blocks.up), down: toBlock(blocks.down) };
}

export async function readMigration(file: MigrationFile): Promise<ParsedMigration> {
  return parseMigration(await Bun.file(file.path).text());
}

/** `20260825202210_baseline_schema.sql` -> `20260825202210_baseline_schema` */
export function displayName(file: MigrationFile): string {
  return basename(file.path, ".sql");
}
