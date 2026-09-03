import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, info, ok } from "../ui.ts";

const TEMPLATE = `import { defineConfig } from "phoenix";

export default defineConfig({
  migrationsDir: "database/migrations",
  schemaFile: "database/schema.sql",

  // Fuera de \`public\` para que no aparezca en el diff de psqldef ni en el
  // codegen de Kysely.
  migrationsTable: "dbmate.schema_migrations",

  // psqldefConfig: "database/psqldef-config.yml",
  // lintExclude: ["*_baseline_schema.sql"],
});
`;

export async function initCommand(cwd: string): Promise<number> {
  const path = join(cwd, "phoenix.config.ts");
  if (existsSync(path)) {
    fail(`ya existe ${path}`);
    return 1;
  }
  await Bun.write(path, TEMPLATE);
  ok(`creado ${path}`);
  info("  Ajustá los paths y probá con: phoenix status");
  return 0;
}
