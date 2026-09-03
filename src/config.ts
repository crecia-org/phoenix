import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Lo que cada repo consumidor declara en su `phoenix.config.ts`. Todo tiene
 * default salvo los dos paths que de verdad dependen del repo.
 */
export interface CreciaDbConfig {
  /** Dónde viven los archivos de migración. */
  migrationsDir: string;
  /** El snapshot del schema que `diff` compara y `export` regenera. */
  schemaFile: string;
  /**
   * Tabla de control. `esquema.tabla` a propósito, y fuera de `public`, para
   * que no aparezca en el diff de psqldef ni en el codegen de Kysely.
   */
  migrationsTable?: string;
  /** El `--config` de psqldef (target_schema, skip_tables, etc.). */
  psqldefConfig?: string;
  /** Globs que `lint` no le pasa a squawk. El baseline siempre sobra acá. */
  lintExclude?: string[];
  /**
   * Sufijo del archivo de baseline: `<version>_<baselineName>.sql`. El baseline
   * es el snapshot de todo lo que ya existía antes de adoptar este CLI, y
   * `migrate` lo trata distinto del resto (ver commands/migrate.ts).
   */
  baselineName?: string;
  /**
   * Reordenar el export para que sea ejecutable de arriba a abajo contra una
   * base vacía (ver schema/reorder.ts). Prendido por default: el baseline es
   * exactamente ese caso, y sin esto queda inservible de una forma que no se
   * nota hasta que alguien intenta levantar una base desde cero.
   */
  reorderExport?: boolean;
  /**
   * Filtro propio del repo sobre el SQL que sale de `export`, aplicado
   * DESPUÉS del reordenamiento.
   */
  transformExport?: (sql: string) => string | Promise<string>;
}

export interface ResolvedConfig extends Required<Omit<CreciaDbConfig, "transformExport">> {
  transformExport?: (sql: string) => string | Promise<string>;
  /** Raíz del repo consumidor: todo path relativo cuelga de acá, no del cwd. */
  rootDir: string;
  configPath: string;
}

const CONFIG_NAMES = ["phoenix.config.ts", "phoenix.config.js", "phoenix.config.json"];

/** Busca el config hacia arriba desde `from`, como hacen git o tsconfig. */
function findConfigFile(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function loadConfig(options: { cwd?: string; configPath?: string } = {}): Promise<ResolvedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath != null ? resolve(cwd, options.configPath) : findConfigFile(cwd);

  if (configPath == null) {
    throw new Error(
      `No se encontró phoenix.config.ts (ni .js/.json) desde ${cwd} hacia arriba.\n` +
        `  Creá uno con: phoenix init`,
    );
  }
  if (!existsSync(configPath)) {
    throw new Error(`El config indicado no existe: ${configPath}`);
  }

  const mod = (await import(configPath)) as { default?: CreciaDbConfig };
  const raw = mod.default;
  if (raw == null || typeof raw !== "object") {
    throw new Error(`${configPath} no exporta un objeto por default.`);
  }
  for (const key of ["migrationsDir", "schemaFile"] as const) {
    if (typeof raw[key] !== "string" || raw[key] === "") {
      throw new Error(`${configPath}: falta "${key}" (string no vacío).`);
    }
  }

  const rootDir = resolve(configPath, "..");
  const fromRoot = (p: string): string => (isAbsolute(p) ? p : join(rootDir, p));

  return {
    rootDir,
    configPath,
    migrationsDir: fromRoot(raw.migrationsDir),
    schemaFile: fromRoot(raw.schemaFile),
    migrationsTable: raw.migrationsTable ?? "dbmate.schema_migrations",
    psqldefConfig: raw.psqldefConfig != null ? fromRoot(raw.psqldefConfig) : "",
    lintExclude: raw.lintExclude ?? ["*_baseline_schema.sql"],
    baselineName: raw.baselineName ?? "baseline_schema",
    reorderExport: raw.reorderExport ?? true,
    transformExport: raw.transformExport,
  };
}

/** Azúcar para que el config del repo consumidor tenga autocompletado. */
export function defineConfig(config: CreciaDbConfig): CreciaDbConfig {
  return config;
}
