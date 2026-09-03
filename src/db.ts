/**
 * Conexión a Postgres y el desarmado de la URL que psqldef necesita.
 *
 * Se usa `Bun.SQL` y no `psql`: el CLI se distribuye como un ejecutable y
 * depender de que libpq esté instalado en la máquina destino contradice el
 * punto de todo esto. `psql` "siempre está" hasta que no está.
 */

export interface PostgresParts {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url == null || url === "") {
    throw new Error("DATABASE_URL no está seteada.");
  }
  return url;
}

/**
 * psqldef no acepta una URL de conexión: quiere -U/-h/-p/--password y el nombre
 * de la base como argumento suelto. Se usa el parser de URL del runtime en vez
 * de recortar strings a mano, así una contraseña con `@` o `/` no rompe nada
 * (venían percent-encoded y `decodeURIComponent` las devuelve enteras).
 */
export function parsePostgresUrl(url: string): PostgresParts {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida (postgres://usuario:clave@host:puerto/base).");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`DATABASE_URL tiene un protocolo inesperado: ${parsed.protocol}`);
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (database === "") {
    throw new Error("DATABASE_URL no incluye el nombre de la base.");
  }

  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port === "" ? "5432" : parsed.port,
    database,
  };
}

export function connect(url: string = databaseUrl()): Bun.SQL {
  return new Bun.SQL(url);
}
