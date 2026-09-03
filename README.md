# phoenix

CLI de migraciones y schema para las bases de Crecia. Se distribuye como **un
solo ejecutable con psqldef y squawk adentro**: no hay que instalar nada más en
la máquina que lo usa.

## Por qué existe

Antes esto eran seis scripts de shell en `backend/scripts/` más una docena de
entradas en `package.json`, y para que funcionaran cada máquina tenía que tener
instalados **tres binarios en la versión correcta**. Uno de ellos, psqldef, no
podía salir de `go install ...@latest`: usamos un fork parcheado, y el comando
obvio lo pisa con el upstream, que no sabe parsear `CREATE CONSTRAINT TRIGGER`
y hace fallar el diff de la base **entera** en cuanto existe uno. La única
defensa era un párrafo en un CLAUDE.md pidiendo que no lo corrieras.

Acá el fork viaja adentro del ejecutable. No hay comando obvio que lo rompa.

## Instalar

Bajá el ejecutable de tu plataforma desde los [releases](https://github.com/crecia-org/phoenix/releases)
y ponelo en el PATH:

```bash
curl -sSfL https://github.com/crecia-org/phoenix/releases/latest/download/phoenix-linux-amd64 -o ~/.local/bin/phoenix
chmod +x ~/.local/bin/phoenix
phoenix versions   # confirma qué lleva adentro
```

Binarios disponibles: `phoenix-linux-amd64`, `phoenix-linux-arm64`,
`phoenix-darwin-amd64`, `phoenix-darwin-arm64`.

## Usar

En la raíz del repo, un `phoenix.config.ts` (lo scaffoldea `phoenix init`):

```ts
export default {
  migrationsDir: "database/migrations",
  schemaFile: "database/schema.sql",
  migrationsTable: "dbmate.schema_migrations",
  psqldefConfig: "database/psqldef-config.yml",
};
```

| Comando | Qué hace |
|---|---|
| `phoenix status` | qué está aplicado y qué no |
| `phoenix migrate` | aplica lo pendiente y re-exporta el schema |
| `phoenix rollback` | revierte la última aplicada |
| `phoenix new <nombre>` | crea un archivo de migración vacío |
| `phoenix diff` | SQL que llevaría la base a lo que dice el schema |
| `phoenix diff --check` | sale 1 si hay cualquier diferencia (CI, grueso) |
| `phoenix diff --review` | mismo diff, clasificado por riesgo y agrupado por tabla, con impacto real sobre los datos si hay `DATABASE_URL` |
| `phoenix pending` | igual que `diff --review`, pero de los archivos de migración pendientes |
| `phoenix export` | regenera el schema desde la base viva |
| `phoenix lint` | pasa las migraciones por squawk |
| `phoenix baseline` | genera el snapshot inicial (UNA vez por repo) |
| `phoenix versions` | qué versiones lleva este ejecutable adentro |

`DATABASE_URL` es obligatoria para todo lo que toca la base.

### El baseline

El baseline es el snapshot de todo lo que ya existía antes de adoptar esto.
Ejecutarlo tiene sentido en **un** caso —una base vacía— y en cualquier otro hay
que registrarlo como aplicado sin correrlo. `migrate` distingue los tres estados
solo:

| Estado | Qué hace |
|---|---|
| Ya figura aplicado | nada especial |
| Sin registrar + `public` vacío | base nueva: lo **ejecuta** |
| Sin registrar + `public` con tablas | preexistente: lo **registra** sin ejecutarlo |

En el tercer caso, antes de registrarlo compara la base viva contra el schema y
**aborta mostrando la diferencia si no coinciden**: marcarlo es afirmar "esta
base es igual al snapshot", y si no lo es, ese drift queda enterrado y toda
migración futura parte de una premisa falsa.

Flags para forzar la mano: `--baseline`, `--adopt`, y `--force` (registra pese
al drift; último recurso).

## Formato de migración

El mismo que dbmate, a propósito — una base ya migrada con dbmate sigue
funcionando sin tocar nada:

```sql
-- migrate:up
ALTER TABLE ...;

-- migrate:down
ALTER TABLE ...;
```

Cada dirección corre en su propia transacción junto con el registro en la tabla
de control: si el SQL falla no queda registrada, y si queda registrada es porque
pasó. `-- migrate:up transaction:false` desactiva eso, y es lo único que permite
un `CREATE INDEX CONCURRENTLY` (que es justo lo que el linter recomienda).

## Desarrollo

```bash
bun install
bun run src/cli.ts --help     # usa psqldef/squawk del PATH
bun run typecheck
```

Para un ejecutable de release:

```bash
bun run vendor linux-amd64   # compila psqldef del fork + baja squawk
bun run build linux-amd64    # los mete adentro del ejecutable
```

Los dos scripts son TypeScript con [Bun Shell](https://bun.sh/docs/runtime/shell),
no bash. Solo `git` y `go` salen a la shell: comprimir y descargar los hace el
runtime (`Bun.gzipSync`, `fetch`), así que **`gzip` y `curl` no son requisitos**
— que es exactamente el problema que este repo existe para no tener.

**Un ejecutable por plataforma, y no hay forma de evitarlo.** `bun build
--compile` cross-compila el runtime de Bun, pero los binarios embebidos son
bytes concretos: un ELF de Linux adentro de un Mach-O de macOS no sirve. Por eso
`vendor.sh` y `build.sh` toman la plataforma como argumento.

Las versiones que se vendorizan están fijas en `vendor.lock.json`.

## Qué NO lleva adentro

**dbmate.** Su trabajo —listar archivos, ver qué falta, aplicarlo en una
transacción— son unas 150 líneas, y como binario son 46MB, más que psqldef y
squawk juntos. Está reimplementado en `src/migrations/`.

**psql.** Se usa `Bun.SQL`, el cliente de Postgres del runtime. Depender de que
libpq esté instalado en la máquina destino contradice el punto de distribuir un
ejecutable: `psql` "siempre está" hasta que no está.

## El reordenamiento del export

`export` reordena lo que devuelve psqldef antes de escribirlo: extensiones y
tipos, después las tablas, después TODAS las FK, después las funciones y al
final los triggers. psqldef agrupa por tabla en orden alfabético, así que una
FK puede apuntar a algo definido más abajo. Da igual para el diff, que compara
por identidad de objeto; es fatal para el baseline, que es exactamente un
archivo que se ejecuta de principio a fin contra una base vacía.

`CREATE CONSTRAINT TRIGGER` cuenta como trigger acá. Parece obvio y no lo es:
no empieza con `CREATE TRIGGER`, así que un clasificador que compare ese
prefijo lo manda al grupo de las tablas, antes de la función que ejecuta. El
archivo resultante falla al primer constraint trigger contra una base vacía —
y solo se nota el día que alguien levanta una base desde cero.

## Releases

`.github/workflows/release.yml` corta un release al pushear un tag `v*` (o a
mano desde la pestaña Actions). Compila las cuatro plataformas y sube los
binarios — no hace falta ningún secreto propio, `GITHUB_TOKEN` (el que GitHub
provee automáticamente para ese repo) alcanza para crear el Release.

`linux-amd64` y `darwin-arm64` se prueban de verdad: el runner los EJECUTA
(`phoenix versions`) antes de subirlos — Apple Silicon nativo para el segundo,
sin emulación. `darwin-amd64` corre bajo Rosetta, instalada en el mismo paso.
`linux-arm64` es cross-compilado y solo se valida que el binario tenga la
forma correcta (ELF arm64): ejecutarlo de verdad necesita un runner arm64
nativo, que no se asume disponible en la organización.

`.github/workflows/ci.yml` corre en cada push/PR: typecheck + un build y smoke
test de linux-amd64, para que un cambio que rompe el vendorizado se note antes
de cortar una versión.

## Reporte de riesgo (`diff --review` / `pending`)

Un diff crudo de psqldef es una lista de sentencias sin jerarquía: un
`DROP COLUMN` se ve igual que un `CREATE INDEX`. `--review` clasifica cada
sentencia en cuatro buckets (🔴 destructivo, ⛔ destructivo-pero-omitido, 🟡
riesgoso, 🟢 seguro), agrupa por tabla, y si hay `DATABASE_URL` corre queries
de solo lectura para decir **cuántas filas existentes se ven afectadas de
verdad** — no solo "esto es riesgoso" sino "esto tira 78 filas".

```bash
phoenix diff --review                          # reporte en la terminal
phoenix diff --review --only-risky             # sin el bucket seguro/aditivo
phoenix diff --review --html=report.html       # + un HTML autocontenido (para una PR)
phoenix diff --review --md=report.md           # + Markdown (GitHub-flavored)
phoenix diff --review --fail-on-impact         # gate de CI: falla solo si de
                                                #   verdad rechazaría filas
```

`phoenix pending` es el mismo reporte y las mismas flags, pero leído de los
archivos de migración que todavía no se aplicaron en vez de un diff contra
`schema.sql` — para revisar una migración que alguien ya escribió, antes de
que `migrate` la corra.

Dos gates de CI, y no son intercambiables: `diff --check` falla ante
CUALQUIER diferencia (¿está sincronizado?); `diff --review --fail-on-impact`
falla solo si un `CHECK`/`UNIQUE`/`SET NOT NULL` nuevo de verdad rechazaría
filas existentes (¿esta migración es segura de aplicar?).
