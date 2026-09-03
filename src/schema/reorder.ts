/**
 * Reordena el export de psqldef para que el archivo se pueda ejecutar de
 * arriba a abajo contra una base vacía.
 *
 * psqldef agrupa las sentencias por tabla, en orden alfabético de tabla. Eso
 * hace que una FK apunte a una tabla que aparece más abajo en el archivo
 * (`assistant_conversations` → `users`, `cities` → `states`) y que el cuerpo
 * de una función referencie una tabla definida después. Da igual para el
 * diff, que compara por identidad de objeto y es independiente del orden;
 * pero es fatal para el baseline, que es exactamente un archivo que se
 * ejecuta de principio a fin contra una base vacía.
 *
 * No cambia el contenido, solo el orden: extensiones/tipos/dominios, después
 * las tablas con sus índices y constraints no-FK, después TODAS las FK (una
 * vez que existen todas las tablas), después las funciones (una vez que
 * existen las tablas que tocan) y al final los triggers.
 */

/**
 * Además saca todo lo que cuelgue del esquema de migraciones. El
 * `target_schema: public` del config de psqldef mantiene la tabla de control
 * fuera del DIFF, pero no del `--export`: si ese esquema existe en la base de
 * la que se exporta, psqldef vuelca un `CREATE SCHEMA "dbmate";` pelado, sin
 * IF NOT EXISTS. Inofensivo suelto, fatal adentro del baseline — el CLI crea
 * ese mismo esquema antes de correr cualquier migración, así que el CREATE
 * choca y la migración entera se revierte.
 */
function isMigrationsBookkeeping(block: string, schema: string): boolean {
  const quoted = `"?${schema}"?`;
  return new RegExp(`${quoted}\\.`).test(block) || new RegExp(`^CREATE SCHEMA ${quoted};?$`, "m").test(block);
}

type Group = "extension" | "type" | "domain" | "rest" | "fk" | "fn" | "trigger";

const ORDER: Group[] = ["extension", "type", "domain", "rest", "fk", "fn", "trigger"];

function classify(block: string): Group {
  const head = block.trimStart();
  if (head.startsWith("CREATE EXTENSION")) return "extension";
  if (head.startsWith("CREATE TYPE")) return "type";
  if (head.startsWith("CREATE DOMAIN")) return "domain";
  if (head.startsWith("CREATE OR REPLACE FUNCTION") || head.startsWith("CREATE FUNCTION")) return "fn";
  if (head.startsWith("CREATE TRIGGER") || head.startsWith("CREATE CONSTRAINT TRIGGER")) return "trigger";
  if (head.startsWith("ALTER TABLE") && /FOREIGN KEY/.test(block)) return "fk";
  return "rest";
}

export function reorderForBootstrap(sql: string, options: { migrationsSchema: string }): string {
  const blocks = sql
    .split(/\n\n+/)
    .map((block) => block.replace(/\n+$/, ""))
    .filter((block) => block.length > 0)
    .filter((block) => !isMigrationsBookkeeping(block, options.migrationsSchema));

  const groups: Record<Group, string[]> = {
    extension: [],
    type: [],
    domain: [],
    rest: [],
    fk: [],
    fn: [],
    trigger: [],
  };

  for (const block of blocks) groups[classify(block)].push(block);

  return `${ORDER.map((key) => groups[key].join("\n\n"))
    .filter((chunk) => chunk !== "")
    .join("\n\n")}\n`;
}
