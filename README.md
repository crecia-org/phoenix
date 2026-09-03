# crecia-db

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

Bajá el ejecutable de tu plataforma desde los releases y ponelo en el PATH:

```bash
curl -sSfL <url-del-release>/crecia-db-linux-amd64 -o ~/.local/bin/crecia-db
chmod +x ~/.local/bin/crecia-db
crecia-db versions   # confirma qué lleva adentro
```

## Usar

En la raíz del repo, un `crecia-db.config.ts` (lo scaffoldea `crecia-db init`):

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
| `crecia-db status` | qué está aplicado y qué no |
| `crecia-db migrate` | aplica lo pendiente y re-exporta el schema |
| `crecia-db rollback` | revierte la última aplicada |
| `crecia-db new <nombre>` | crea un archivo de migración vacío |
| `crecia-db diff` | SQL que llevaría la base a lo que dice el schema |
| `crecia-db diff --check` | sale 1 si hay cualquier diferencia (CI) |
| `crecia-db export` | regenera el schema desde la base viva |
| `crecia-db lint` | pasa las migraciones por squawk |
| `crecia-db baseline` | genera el snapshot inicial (UNA vez por repo) |
| `crecia-db versions` | qué versiones lleva este ejecutable adentro |

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
./scripts/vendor.sh linux-amd64   # compila psqldef del fork + baja squawk
./scripts/build.sh linux-amd64    # los mete adentro del ejecutable
```

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
