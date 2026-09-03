import { loadConfig } from "./config.ts";
import { diffCommand } from "./commands/diff.ts";
import { exportCommand } from "./commands/export.ts";
import { initCommand } from "./commands/init.ts";
import { lintCommand } from "./commands/lint.ts";
import { migrateCommand } from "./commands/migrate.ts";
import { newCommand } from "./commands/new.ts";
import { rollbackCommand } from "./commands/rollback.ts";
import { statusCommand } from "./commands/status.ts";
import { versionsCommand } from "./commands/versions.ts";
import { bold, dim, fail, info } from "./ui.ts";

export const CLI_VERSION = "0.1.0";

const HELP = `${bold("crecia-db")} ${dim(CLI_VERSION)} — migraciones y schema, con psqldef y squawk adentro

${bold("USO")}
  crecia-db <comando> [opciones]

${bold("COMANDOS")}
  status              qué está aplicado y qué no
  migrate             aplica lo pendiente y re-exporta el schema
  rollback            revierte la última migración aplicada
  new <nombre>        crea un archivo de migración vacío
  diff                SQL que llevaría la base a lo que dice el schema
  export              regenera el schema desde la base viva
  lint                pasa las migraciones por squawk
  init                crea un crecia-db.config.ts en el directorio actual
  versions            qué versiones lleva este ejecutable adentro

${bold("OPCIONES DE migrate")}
  --baseline          fuerza EJECUTAR el baseline (base nueva)
  --adopt             fuerza REGISTRARLO sin ejecutarlo (base preexistente)
  --force             con --adopt, lo registra aunque la base tenga drift
  --no-export         no re-exporta el schema al terminar

${bold("OPCIONES DE diff")}
  --check             sale 1 si hay cualquier diferencia (para CI)

${bold("GLOBALES")}
  --config <path>     usa ese config en vez de buscar crecia-db.config.ts
  -h, --help          esta ayuda
  -v, --version       la versión del CLI

${bold("ENTORNO")}
  DATABASE_URL        obligatoria para todo lo que toca la base
  CRECIA_DB_BIN_DIR   dónde buscar psqldef/squawk si el build no los trae
`;

/** Comandos que no necesitan config ni base. */
const STANDALONE = new Set(["init", "versions", "help"]);

export async function main(argv: string[]): Promise<number> {
  const args = [...argv];

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    info(HELP);
    return 0;
  }
  if (args.includes("-v") || args.includes("--version")) {
    info(CLI_VERSION);
    return 0;
  }

  const command = args.shift()!;

  // --config <path> se saca de la lista antes de que lo vea el comando.
  let configPath: string | undefined;
  const configIndex = args.indexOf("--config");
  if (configIndex !== -1) {
    configPath = args[configIndex + 1];
    if (configPath == null) {
      fail("--config necesita una ruta");
      return 1;
    }
    args.splice(configIndex, 2);
  }

  if (command === "init") return initCommand(process.cwd());
  if (command === "versions") return versionsCommand(CLI_VERSION);
  if (command === "help") {
    info(HELP);
    return 0;
  }

  if (STANDALONE.has(command)) return 0;

  const config = await loadConfig({ configPath });

  switch (command) {
    case "status":
      return statusCommand(config);
    case "migrate":
      return migrateCommand(config, args);
    case "rollback":
      return rollbackCommand(config, args);
    case "new":
      return newCommand(config, args);
    case "diff":
      return diffCommand(config, args);
    case "export":
      return exportCommand(config);
    case "lint":
      return lintCommand(config);
    default:
      fail(`comando desconocido: ${command}`);
      info(`  Probá: crecia-db --help`);
      return 1;
  }
}

export async function run(argv: string[] = Bun.argv.slice(2)): Promise<never> {
  try {
    process.exit(await main(argv));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    if (process.env.CRECIA_DB_DEBUG != null && error instanceof Error) {
      process.stderr.write(`\n${error.stack ?? ""}\n`);
    }
    process.exit(1);
  }
}

if (import.meta.main) await run();
