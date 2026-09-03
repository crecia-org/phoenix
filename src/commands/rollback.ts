import type { ResolvedConfig } from "../config.ts";
import { displayName } from "../migrations/files.ts";
import { rollbackLast, withRunner } from "../migrations/runner.ts";
import { parseMigrationsTable } from "../migrations/table.ts";
import { info, ok } from "../ui.ts";
import { exportCommand } from "./export.ts";

/** Revierte la última migración aplicada. Una sola, a propósito. */
export async function rollbackCommand(config: ResolvedConfig, args: string[]): Promise<number> {
  const table = parseMigrationsTable(config.migrationsTable);
  const skipExport = args.includes("--no-export");

  const reverted = await withRunner({ migrationsDir: config.migrationsDir, table }, (ctx) => rollbackLast(ctx));

  if (reverted == null) {
    info("no hay ninguna migración aplicada para revertir");
    return 0;
  }
  ok(`revertida ${displayName(reverted)}`);

  return skipExport ? 0 : exportCommand(config);
}
