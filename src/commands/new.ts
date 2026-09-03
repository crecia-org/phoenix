import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../config.ts";
import { fail, ok } from "../ui.ts";

/** `20260903142530` — UTC, y con segundos: dos migraciones creadas el mismo
 *  minuto no pueden compartir versión (la versión es la PK de la tabla). */
export function versionStamp(now: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return (
    String(now.getUTCFullYear()) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const TEMPLATE = `-- migrate:up

-- migrate:down

`;

export async function newCommand(config: ResolvedConfig, args: string[]): Promise<number> {
  const name = args.find((a) => !a.startsWith("-"));
  if (name == null) {
    fail("falta el nombre: crecia-db new <nombre>");
    return 1;
  }

  const slug = slugify(name);
  if (slug === "") {
    fail(`el nombre ${JSON.stringify(name)} no deja nada utilizable como slug`);
    return 1;
  }

  mkdirSync(config.migrationsDir, { recursive: true });
  const path = join(config.migrationsDir, `${versionStamp()}_${slug}.sql`);
  await Bun.write(path, TEMPLATE);
  ok(`creada ${path}`);
  return 0;
}
