# Operación

Referencia de uso: herramientas, CLI, variables y qué hacer cuando algo no cuadra.

## Herramientas (las llama el modelo)

| Herramienta | Parámetros | Devuelve |
|---|---|---|
| `skill_propose` | `id`, `description`, `body` (obligatorios) · `whenToUse`, `evidence[]`, `tags[]` | `status`: `proposed` · `conflict` · `invalid` · `no-project`, con el resumen y, si las hay, las colisiones |
| `skill_vendor` | `url` (obligatorio) · `id`, `description`, `whenToUse`, `localNote`, `tags[]` | `status`: `proposed` · `blocked` · `conflict` · `needs-choice` · `bad-url` · `fetch-failed` · `invalid` · `no-project` |
| `skill_review` | ninguno | Las pendientes y las aprobadas **del proyecto actual**. Solo lectura: no aprueba |
| `skill_upstream_check` | `id` | `changed: true/false`, los dos SHA-256 y la URL |

El **ámbito no es un parámetro**: lo calcula el plugin desde el `cwd` de la sesión. Es lo que impide que
una skill aterrice en el proyecto equivocado.

## CLI (la usas tú)

```sh
cd C:\xampp\htdocs\plugins-dhs\skill-compiler
node bin/skill-compiler.mjs <comando> [argumentos] [opciones]
```

| Comando | Qué hace | Exit 1 cuando… |
|---|---|---|
| `where` | El ámbito de este directorio y dónde está el almacén | — |
| `list` | Qué hay propuesto, aprobado y rechazado, por proyecto | — |
| `show <id>` | Imprime una propuesta entera, tal cual | No existe |
| `check [<id>]` | Pasa la puerta de validación a las pendientes (o a una) | Alguna falla |
| `approve <id>` | **Activa** la skill en su proyecto | No pasa `check`, o tiene avisos y falta `--force` |
| `reject <id>` | La aparta sin borrarla | No existe |
| `active` | Qué se está sirviendo de verdad en este directorio | — |
| `vendor <url>` | Nuestra versión de una skill externa | Bloqueado, conflicto, o el enlace pide elegir carpeta |
| `upstream <id>` | ¿Se movió el origen? | No se pudo comprobar, o no es vendorizada |
| `provenance <id>` | La procedencia guardada, entera | No es vendorizada |
| `doctor` | Comprueba que las dependencias del harness están declaradas, instaladas y **se cargan**, y que las cuatro herramientas compilan | Algo falta o no carga |
| `where` | El ámbito de este directorio y dónde está el almacén | — |

**`doctor` es el primer comando que hay que ejecutar cuando el plugin no se activa.** Distingue tres cosas
que se ven iguales desde fuera y se arreglan distinto: que falte una dependencia (`npm install`), que no se
pueda cargar por un *peer* sin instalar, y que un esquema de herramienta no compile. El porqué de todo
esto, en [`DEPENDENCIAS.md`](DEPENDENCIAS.md).

## Qué se ve en la interfaz

Una píldora en la zona del compositor que aparece **solo cuando hay algo que decir**:

- **Engranaje girando** mientras `skill_propose` o `skill_vendor` están en vuelo.
- **Al terminar**: «Nueva skill», «Skill actualizada», «Sin cambios», «No se creó» u «Origen bloqueado»,
  con el nombre de la skill y, si en la sesión hubo varias, un `×N` con el acumulado.

El estado se deriva de la traza de la sesión, no de un registro aparte, así que **se ve igual al reabrir
una sesión antigua**. Los detalles de diseño y sus límites están en
[`FEEDBACK-VISUAL.md`](FEEDBACK-VISUAL.md).

Opciones: `--project-key <clave>` (actuar sobre otro proyecto sin cambiar de directorio), `--force`
(aprobar con avisos; **nunca** si `check` falla), `--id <id>`, `--note "<texto>"` (solo en `vendor`).

Ejemplos:

```sh
# proponer desde el modelo, revisar y aprobar
node bin/skill-compiler.mjs list
node bin/skill-compiler.mjs show measured-decision-check
node bin/skill-compiler.mjs check
node bin/skill-compiler.mjs approve measured-decision-check

# nuestra versión de una skill de un repositorio, con nota de adaptación
node bin/skill-compiler.mjs vendor https://github.com/alguien/skills/tree/main/mi-skill \
     --note "adaptada a los gates de este repositorio"

# auditar una vendorizada
node bin/skill-compiler.mjs provenance mi-skill
node bin/skill-compiler.mjs upstream mi-skill
```

## Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `DSH_HOME` | Dónde está el almacén (`$DSH_HOME/skill-compiler`) y la biblioteca curada (`$DSH_HOME/skills`) | `~/.dsh` |
| `SKILL_COMPILER_CLI` | La ruta que el plugin le dice al usuario para aprobar | `C:\xampp\htdocs\plugins-dhs\skill-compiler\bin\skill-compiler.mjs` |

`SKILL_COMPILER_CLI` existe porque el plugin instalado vive en el perfil y no puede deducir dónde está el
repositorio. En otra máquina, expórtala tras clonar.

## Dónde está todo

```
$DSH_HOME/skill-compiler/projects/<clave>/
  proposed/<id>/   SKILL.md · meta.json · provenance.json · upstream/
  approved/<id>/   lo que el proveedor sirve
  rejected/<id>/   apartado
  superseded/<id>-<fecha>/   versión anterior
```

La `<clave>` de proyecto se deriva del `cwd`: `<último-tramo>-<hash8>`. Para saber la de un directorio:
`node bin/skill-compiler.mjs where`.

## Cuando algo no cuadra

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El plugin no aparece y la fila dice `failed` | Casi siempre, una dependencia: o no está declarada, o no está instalada, o no se puede cargar | **`node bin/skill-compiler.mjs doctor`** desde la carpeta del plugin. Dice qué falta y con qué comando se arregla. Casi siempre es `npm install` |
| El diálogo de instalación dice `Installed` pero al encender dice `failed to import` | El bundle se instaló **enlazando** la carpeta del repositorio, y las dependencias del plugin no están ahí | `npm install` en la carpeta del plugin y vuelve a encenderlo. El motivo completo, en [`DEPENDENCIAS.md`](DEPENDENCIAS.md) |
| Cambié el código y el comportamiento no cambia | El perfil puede tener **su propia copia** del paquete, o conservar el módulo cargado | Si se instaló por ruta, el perfil enlaza el repositorio y el cambio es inmediato tras un ciclo de encendido; si no, reinstala el bundle y reinicia cuando el resultado diga `restart-required` |
| Cambié el código del **navegador** (`client.js`) y no se ve | El artefacto de interfaz lo carga la página | Recarga la página (F5) después de cambiar el fichero |
| La apruebo y el modelo no la ve | No es su proyecto, o hay una skill curada con el mismo nombre que gana por rango | `node bin/skill-compiler.mjs active` desde el directorio del proyecto; `where` para comprobar la clave |
| `vendor` dice `needs-choice` | El enlace apunta a una carpeta con varias skills | Llama otra vez con el enlace a la subcarpeta concreta |
| `vendor` dice `fetch-failed` con HTTP 403 | Límite de peticiones de GitHub sin autenticar (60/hora) | Espera, o usa el enlace `raw` del fichero, que no pasa por la API |
| `vendor` dice `blocked` | El origen trae credenciales, órdenes al agente o texto invisible | **No hay forma de saltarlo desde la CLI, a propósito.** Sanea el origen (o usa otro `ref`) y vendoriza una versión limpia |
| `propose` o `vendor` dice `conflict` | Ya existe ese id o ese tema | Mejora esa skill, o elige otro tema; si es una versión mejorada de la existente, se decide como actualización |
| `check` falla en una propuesta que escribí a mano | Una edición posterior rompió el contrato | El propio `check` dice qué regla; edita y repite |
| `upstream` dice que cambió y quiero la versión nueva | Nuestra versión está adaptada | Vendoriza otra vez con el mismo id: se propone como actualización y, al aprobar, la anterior se aparta en `superseded/` |
| La píldora del feedback visual no aparece nunca | El perfil no resolvió `zod`, o el servicio de proyección no está, o la unidad no cumplió el contrato (entonces **no se registra**) | `node bin/skill-compiler.mjs doctor`: dice si la proyección cumple el contrato y si el registro real proyecta. Con las herramientas funcionando, es un adorno ausente, no una avería |
| **El historial de sesiones no carga**, con `Failed to load history: failed to project session … def.wire.viewSchema.parse is not a function` | Una unidad de proyección registrada con esquemas que **no validan** (no son Zod). El registro no valida lo que recibe, así que el fallo aparece al leer sesiones | Es el defecto que cerró la 1.1.2: no puede volver desde este plugin, porque la unidad se comprueba antes de registrarse. Si reaparece, **otro** bundle está registrando una unidad con esquemas que no validan: `node bin/skill-compiler.mjs doctor` y revisa el `wire.viewSchema` del bundle sospechoso |
| La píldora se queda en «Analizando…» | Una llamada quedó sin resultado (cancelada). Un `turn/end` la cierra; si no, el siguiente prompt humano la retira | Es el estado real de la traza, no un fallo de dibujo |

## Revertir

- **Una aprobación**: no hay «desaprobar»; la versión anterior está en `superseded/`. Para retirar una
  skill del catálogo, la vía limpia es silenciarla (`disable-model-invocation: true`) o retirar su
  carpeta de `approved/` y volver a proponerla.
- **Todo**: borrar `$DSH_HOME/skill-compiler/`. No toca la biblioteca curada ni ningún repositorio.

## Comprobaciones de salud

```sh
npm test                # 132 pruebas automáticas, en caja de arena
npm run test:hermetic   # las mismas + huella del almacén real antes y después
node tests/vendor-real.e2e.mjs   # la cadena completa contra la red real (necesita internet)
```

Las dos primeras no necesitan red ni tocan tus datos.
