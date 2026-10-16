# La propiedad del proceso de creación de skills, y los choques entre sistemas

## El problema, medido

Este plugin **no es el único que escribe skills en el puesto**. Medido el 2026-10-16 en la máquina del
usuario responsable (`node bin/skill-compiler.mjs systems`):

| Sistema | Almacén | Skills |
|---|---|---:|
| skill-compiler (nuestro) | `~/.dsh/skill-compiler/projects` | 29 |
| DSH · biblioteca curada | `~/.dsh/skills` | 22 |
| Hermes · perfil `byron-saas-corporative` | `~/AppData/Local/hermes/profiles/…/skills` | 1 |
| Hermes · perfil por defecto | `~/AppData/Local/hermes/skills` | 0 |
| Claude Code · usuario | `~/.claude/skills` | no existe |
| Codex · usuario | `~/.codex/skills` | no existe |
| Cursor · usuario | `~/.cursor/skills` | no existe |

Dos hechos que el plugin no estaba mirando:

1. **En la biblioteca curada hay skills que no escribió este plugin** (medido: 22 carpetas, **2 nuestras y 20
   ajenas**). Escriben otras herramientas y el propio humano. El anti-solapamiento ya se niega a pisar un id
   curado que no sea nuestro, pero eso es una defensa por id, no una política de puesto. Y al revés: los dos
   ids que hoy viven en la curada **y** en nuestro almacén (`dsh-local-mcp-integration`,
   `php-pdo-mariadb-local-contracts`) son nuestras propias publicaciones, leídas como una sola copia efectiva.
2. **Nada declaraba quién manda sobre qué.** El plugin asumía que el puesto era suyo —un defecto de
   alcance—, y con otros agentes instalados el mismo id podía acabar viviendo en dos sitios con contenido
   distinto: dos verdades sobre lo mismo, y ninguna señal.

## Lo que se declara

Una respuesta, en un fichero del almacén (`ownership.json`), con dos valores posibles y **ningún valor por
defecto**:

| `ownership` | Qué significa | Qué hace el plugin |
|---|---|---|
| `dsh-only` | sólo se trabaja con DSH | escribe **sólo** en su almacén y en la biblioteca curada de DSH, y **rechaza** un id que ya viva fuera: no compite con los demás sistemas |
| `machine` | el proceso entero del PC | además **mira** los otros sistemas, avisa de cada choque de id con su sitio, y puede traer lo ajeno como propuesta con procedencia — sin sobrescribir jamás |

Sin respuesta, la propiedad es `null`: **elegir «todo el PC» solo no es una decisión del motor**. Mientras
no esté declarada, el plugin lo dice donde importa —al proponer, en `/skill-propiedad` y en
`doctor`/`ownership`— y sigue trabajando como `dsh-only` en la práctica, sin bloquear trabajo por una
respuesta que nadie ha pedido.

### Las tres invariantes

1. **Nunca se escribe en el almacén de otro sistema.** Ni con `machine`. Lo ajeno se lee, se cita y —como
   mucho— se copia **hacia dentro** como propuesta con procedencia.
2. **Nunca se sobrescribe lo que no es nuestro**, tampoco dentro de la biblioteca curada: el id curado sin
   nuestro `origin` no se toca; se rechaza la propuesta y se dice con quién choca.
3. **Una copia publicada no es una colisión.** Nuestra skill publicada vive en la curada (`--global`) y
   deja constancia en `published/`: es **una sola copia efectiva**, y el inventario la lee así en vez de
   acusarse a sí misma.

## Cómo se declara

En cualquier sesión del harness:

```
/skill-propiedad                      # sin argumento: dice lo declarado, o pregunta
/skill-propiedad dsh-only             # sólo DSH
/skill-propiedad machine              # todo el PC
```

Y en el menú `/`, sin teclear nada: las filas `skill-propiedad-dsh-only` y `skill-propiedad-machine`
declaran su respuesta **al seleccionarlas** —mismo contrato que las filas de las pendientes: un comando sin
argumentos se ejecuta en el acto—.

Desde el terminal, con el mismo efecto (una sola implementación: `lib/scope.mjs`):

```
node bin/skill-compiler.mjs ownership              # estado, con la pregunta si falta
node bin/skill-compiler.mjs ownership machine      # declararla
```

### «Que al instalarse me pregunte»

El harness donde vive este plugin no tiene un diálogo de instalación que el plugin pueda bloquear: un
plugin se carga, no se instala con asistente. Así que la pregunta se pone **donde el humano la ve y donde
la respuesta tiene efecto**, en vez de fingir un asistente:

- `node bin/skill-compiler.mjs doctor` y `ownership` la imprimen mientras no haya respuesta.
- `/skill-propiedad` la imprime entera —las dos opciones, explicadas— y la declara con un argumento.
- Las dos filas del menú `/` la resuelven **en un clic**.
- La primera propuesta de una skill nueva, si el id ya vive fuera, la menciona en el aviso.
- El protocolo del plugin le dice al agente que la propiedad existe y cómo se declara (una sola línea).

Lo que **no** hace: preguntarla una y otra vez, ni elegir por ti. Se declara una vez.

## El inventario y los choques

```
node bin/skill-compiler.mjs systems      ·      /skill-sistemas
```

Lista cada sistema con su ruta y sus skills, y los **ids que viven en más de un sistema**, con el sitio
exacto de cada copia. Marca cuáles son nuestros. No escribe nada.

### Almacenes que este módulo no puede adivinar

Un agente o un editor recién instalado, o con la carpeta en otro disco, no está en la lista. Se declara por
entorno, separando por el delimitador del sistema (`;` en Windows):

```
SKILL_COMPILER_SISTEMAS="D:\skills-de-otro-agente;E:\mas-skills" node bin/skill-compiler.mjs systems
```

Lo declarado así se **mira**; nunca se escribe.

## Lo que decide la puerta al proponer

Sólo para una propuesta **nueva** (actualizar lo nuestro no puede ser una colisión), si el id ya vive en
otro sistema:

| Propiedad | Qué hace la puerta |
|---|---|
| sin declarar | propone, con el aviso de que falta la respuesta y las dos opciones para darla |
| `dsh-only` | **rechaza** con el sitio de la otra copia; elige otro id o cambia la propiedad |
| `machine` | propone, con el aviso del sitio y la constancia de que la nuestra es una copia con procedencia |

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| La declaración | `<almacén>/ownership.json` (`{ ownership, declaredAt, declaredBy }`) |
| La política y la medida | `lib/scope.mjs` |
| La puerta | `lib/compiler.mjs` (`propose`, tras el anti-solapamiento) |
| Los comandos y el CLI | `lib/commands.mjs` · `bin/skill-compiler.mjs` |
| Las pruebas | `tests/scope.test.mjs` (14, incluidos los tres casos de la puerta) |
