/** Salida del CLI. Los mensajes van a stderr salvo lo que es DATO (el SQL de
 *  `diff`, el schema de `export`), que va a stdout para poder pipearlo. */
const useColor = process.stderr.isTTY === true && process.env.NO_COLOR == null;

const paint = (code: string, text: string): string => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const dim = (t: string): string => paint("2", t);
export const bold = (t: string): string => paint("1", t);
export const red = (t: string): string => paint("31", t);
export const green = (t: string): string => paint("32", t);
export const yellow = (t: string): string => paint("33", t);

export function info(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${yellow("!")} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${red("✗")} ${message}\n`);
}

export function ok(message: string): void {
  process.stderr.write(`${green("✓")} ${message}\n`);
}

export function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? line : prefix + line))
    .join("\n");
}
