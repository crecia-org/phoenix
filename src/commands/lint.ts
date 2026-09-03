import { basename } from "node:path";
import type { ResolvedConfig } from "../config.ts";
import { listMigrationFiles } from "../migrations/files.ts";
import { resolveBinary } from "../vendor/binaries.ts";
import { info, ok } from "../ui.ts";

/**
 * Pasa las migraciones por squawk (NOT NULL sin default, índices sin
 * CONCURRENTLY, etc.). El baseline se excluye por default: sus reglas son para
 * cambios incrementales sobre una tabla viva, no para un snapshot que o se
 * corre una vez contra una base vacía o no se corre nunca.
 *
 * El filtrado se hace acá y NO con el `--exclude-path` de squawk: cuando el
 * patrón deja la lista vacía, squawk sale con error ("Failed to find files for
 * provided patterns") en vez de no hacer nada, y un repo que todavía solo
 * tiene el baseline haría fallar el CI sin ningún problema real.
 */
export async function lintCommand(config: ResolvedConfig): Promise<number> {
  const globs = config.lintExclude.map((pattern) => new Bun.Glob(pattern));
  const isExcluded = (path: string): boolean => {
    const name = basename(path);
    return globs.some((glob) => glob.match(name) || glob.match(path));
  };

  const all = listMigrationFiles(config.migrationsDir).map((file) => file.path);
  const files = all.filter((path) => !isExcluded(path));

  if (files.length === 0) {
    info(
      all.length === 0
        ? `no hay migraciones en ${config.migrationsDir}`
        : `nada que lintear: las ${String(all.length)} migración(es) están excluidas por lintExclude`,
    );
    return 0;
  }

  const bin = await resolveBinary("squawk");
  const proc = Bun.spawn([bin, ...files], { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode === 0) ok(`squawk no encontró problemas en ${String(files.length)} archivo(s)`);
  return exitCode;
}
