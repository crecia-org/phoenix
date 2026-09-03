import { psqldefVersion } from "../psqldef.ts";
import { hasEmbedded, resolveBinary } from "../vendor/binaries.ts";
import { dim, info } from "../ui.ts";

/**
 * Qué versiones lleva este ejecutable adentro.
 *
 * Existe por una razón concreta: cuando psqldef estaba en el PATH, cualquiera
 * podía correr `psqldef --version` y ver cuál tenía. Embebido queda invisible,
 * y una versión vieja del CLI contra un schema nuevo no da ninguna señal. Esto
 * la devuelve, y sirve para que CI falle si no coincide con lo esperado.
 */
export async function versionsCommand(cliVersion: string): Promise<number> {
  info(`crecia-db ${cliVersion}`);
  info(`bun       ${Bun.version}`);

  const source = (name: "psqldef" | "squawk"): string =>
    hasEmbedded(name) ? dim("(embebido)") : dim("(del PATH — build de desarrollo)");

  try {
    info(`psqldef   ${await psqldefVersion()} ${source("psqldef")}`);
  } catch (e) {
    info(`psqldef   no disponible — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }

  try {
    const bin = await resolveBinary("squawk");
    const out = new TextDecoder().decode(Bun.spawnSync([bin, "--version"]).stdout).trim();
    info(`squawk    ${out} ${source("squawk")}`);
  } catch (e) {
    info(`squawk    no disponible — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }

  return 0;
}
