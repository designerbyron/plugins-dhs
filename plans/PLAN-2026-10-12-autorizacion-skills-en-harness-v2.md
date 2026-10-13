# Plan — autorización real de skills dentro del harness, y disponibilidad inmediata

| | |
|---|---|
| **Fecha** | 2026-10-12 23:52 (hora local, UTC-6) |
| **Autor** | Hermes, para Byron |
| **Sujeto** | `C:\xampp\htdocs\plugins-dhs\skill-compiler` (plugin DSH **v1.1.2**, commit `8bd0103`) |
| **Estado** | **PROPUESTO — no se ejecuta nada hasta aprobación explícita** |
| **Versión** | 2 (sustituye a la 1) |

## 0. Versionado

- **Supersede**: `plans/PLAN-2026-10-12-autorizacion-skills-en-harness.md`, versión 1,
  SHA-256 `40d9172dbf828c72e8ec7469fe8566429a97acdb7bbca3c0a2c19b1a9a6f30d6` — intacta byte a byte
  (verificada con `sha256sum -c` antes de escribir esta).
- **Cambios de la v1 a la v2**:
  1. **Requisito nuevo (§1.3)**: una skill aprobada tiene que poder **usarse sin reiniciar** ni forzar un
     refresco. Se formula de forma medible y se añade el diseño que lo consigue.
  2. **Hechos medidos nuevos (§3.4)**: dónde se cachea el catálogo de skills, qué lo invalida hoy, y por qué
     una skill recién aprobada no llegaba a usarse sin reinicio.
  3. **Fase F2 ampliada** con la invalidación dirigida por el provider y la observación del almacén; criterio
     de frescura añadido a F2.4 y a la verificación en vivo (F3).
  4. **Decisiones D6 y D7** (nuevas) y presupuesto de escritura actualizado.
- **Lo que NO cambió**: el objetivo 1 (cerrar el defecto de esquema y su clase), la fase F1, la elección de
  `dsh-commands` como superficie humana, el descarte medido de la aprobación nativa, y el tratamiento de F4
  como la única fase con riesgo de datos.

## 1. Objetivo

1. **Cerrar el defecto que impide proponer skills** (`skill_propose` falla al devolver su resultado) y cerrar
   la *clase* de defecto, no el caso.
2. **Autorizar skills desde dentro del harness**, con feedback real: ver la propuesta, leerla entera,
   aprobarla o rechazarla — sin CLI, sin servidor local aparte y sin que el modelo pueda decidir por ti.
3. **Disponibilidad inmediata**: una skill aprobada queda utilizable **en el mismo proceso y la misma
   sesión**, sin reiniciar la app y sin ningún refresco manual. Con precisión, porque la frase importa:

   > Aprobada una skill, el **agente la ve en su siguiente paso** (su catálogo se reemplaza solo) y
   > **`/nombre` la carga**, sin reiniciar el harness ni forzar nada.

   Esto no es un matiz de comodidad: sin ello, aprobar no sirve de nada hasta el próximo arranque, y el flujo
   entero —proponer, revisar, aprobar, usar— se rompe en su último paso.

## 2. Lo que este plan NO hace

- **No cambia la regla de fondo**: aprobar no es una herramienta del modelo. Lo que cambia es *dónde* se
  decide.
- **No construye un panel de UI dedicado** (opción B de D1): es la superficie más rica y la única que no puedo
  verificar sin mirar la interfaz. Queda evaluada, no ejecutada.
- **No toca la biblioteca global de skills** (`~/.dsh/skills`) sin autorización explícita aparte (F4.2).
- **No modifica paquetes del harness** (viven dentro de `app.asar` y no son nuestros): lo que no se puede
  arreglar desde el plugin se declara como límite medido, no se parchea por fuera.
- **No publica nada**: commits locales, sin `push`.

## 3. Hechos medidos (con la prueba de cada uno)

### 3.1 El defecto que bloquea proponer

`skill_propose`, en la rama `proposed`, devuelve un campo que su esquema de salida no declara:

- `skill-compiler/lib/definitions.mjs:146` → `updatesProposal: result.updatesProposal`
- `skill-compiler/lib/definitions.mjs:100-114` → el esquema declara `status`, `summary`, `id`, `project`,
  `projectKey`, `path`, `updatesApproved`, `conflicts`, `relatedElsewhere`, `warnings`, `errors`… y **no**
  `updatesProposal`; la raíz lleva `additionalProperties: false`.

Lo rechaza el validador del propio harness (`node_modules/@deepseek-ai/dsh-tools/lib/index.js:468`):

```
"value.updatesProposal" is not a declared property (additionalProperties: false)
```

**La asimetría que lo explica**: `skill_vendor` **sí** declara ese campo (`lib/definitions.mjs:306`). Por eso
vendorizar funcionaba y proponer no: no es un error de concepto, es un esquema que se quedó atrás.

### 3.2 El síntoma engaña: el efecto sí ocurrió

La herramienta escribe en disco **antes** de devolver el valor, así que la propuesta existe
(`~/.dsh/skill-compiler/projects/saas-corporative-a3c393fa/proposed/shell-and-source-editing-traps/meta.json`,
`createdAt 2026-10-13T04:59:35.236Z`) aunque el modelo recibió un error y la conclusión fue «no se ha creado
nada». Hay que cerrar las dos mitades: la escritura y la respuesta.

### 3.3 Hoy no hay ningún punto humano dentro del harness

- `bin/skill-compiler.mjs` — `list`, `show`, `check`, `approve`, `reject` (CLI).
- `lib/review.mjs` — servidor local en `127.0.0.1` con token de un solo uso (`bin/skill-compiler.mjs:338-365`).

### 3.4 Por qué una skill aprobada no llegaba a usarse sin reiniciar *(medido, y es el corazón de la v2)*

Tres cachés distintos entre la aprobación y el uso, y el plugin sólo influye en uno:

**a) El registro de skills cachea el catálogo, y no tiene TTL.**
`@deepseek-ai/dsh-skill` guarda los catálogos completos por `(cwd, cadena de ámbito, revisión)` — hasta
`collectCacheMaxEntries` (128). Su propio README lo dice sin rodeos (`dsh-skill/README.md:103`):

> «The registry has no TTL: only a provider calling its registration-scoped `invalidate()`, or a runtime
> registration or disposal, clears completed catalogs.»

Y añade la obligación que estábamos incumpliendo (`:138`):

> «Invalidation is provider-driven — … each mutable provider must retain and call its registration-scoped
> `invalidate()` from its own observation mechanism.»

El mecanismo existe y es explícito: `registerProvider(create)` entrega a la fábrica un
`control = { signal, invalidate }` (`dsh-skill/lib/index.js:142-160`), y ese `invalidate()` incrementa la
revisión, limpia la caché y **emite `skills/change`** (`dsh-skill/lib/index.js:376-402`).

**Nuestro provider no lo usa**: `index.js` registra `ctx.skills.registerProvider(() => skillProvider({ root }))`
— ignora el `control`. Consecuencia: el catálogo cacheado no cambia al aprobar, así que nada aguas abajo se
entera.

**b) El agente sí se actualizaría solo… si la caché cambiara.** En cada paso,
`@deepseek-ai/dsh-tool-skill` toma un `ctx.skills.snapshot(...)`, compara un digest y, cuando cambia,
**inyecta un catálogo de reemplazo completo** (`dsh-tool-skill/lib/index.js:204-232`; el README lo llama
«Live catalog updates», `:55`). Es decir: la máquina de frescura ya está construida; lo único que falta es
invalidar en el origen.

**c) El humano con `/nombre` lo resuelve el host, y depende del mismo catálogo.** El listener de gestos
recibe el texto literal y busca el nombre en el catálogo del workspace (`dsh-tool-skill/README.md:88`), así
que se beneficia igual del arreglo.

**d) Límite real del harness, medido, que no está en nuestra mano.** El **menú desplegable** del compositor
(`dsh-client-ui-skill`) cachea el catálogo **por sesión** y sólo lo invalida con dos eventos:
`agent-preset/selected` y `connection/reset` (`dsh-client-ui-skill/lib/client.js:364-372, 429-430`). No
escucha `skills/change`. Por tanto: **escribir `/nombre` funciona en cuanto el host lo sabe, pero la lista
sugerida puede tardar en mostrarlo** hasta uno de esos dos eventos (cambio de preset, reconexión o recarga de
la página). Eso es del harness, no del plugin, y se declara en lugar de disimularse (D7).

**Dato que reduce el problema**: «Definitions are never cached — every load asks the provider for the current
body» (`dsh-skill/README.md:99`). Editar el **cuerpo** de una skill ya aprobada surte efecto de inmediato; la
invalidación sólo hace falta cuando cambia la **membresía o la descripción** (el catálogo).

### 3.5 Lo que el harness ofrece para decidir (medido)

`dsh --profile web --dump-config` (1265 líneas, sólo lectura) monta: `commands`
(`@deepseek-ai/dsh-commands`), `approval` (`dsh-user-approval`), `ui-approval`, `skill`,
`skill-filesystem`, `ui-commands`, `ui-skill`.

- **`ctx.commands.register({ name, description, input, handler })`** — el handler corre **contra el agente sin
  crear mensaje del modelo** (`{kind:'success'|'error', text}`), el resultado lo pinta la UI fuera del
  historial del modelo y el run queda en el log de la sesión. **Mecanismo elegido** (D1).
- **`ctx.userApproval.request(...)`** — **descartado para aprobar skills**: exige turno abierto y su política
  es `ask|never`; tu perfil usa el preset `danger-full-access` con `approval: never`
  (`profiles/desktop/cordis.patch.yml`), así que toda petición se rechazaría sin preguntarte. Una vía que
  falla en silencio no sirve para autorizar.
- **El catálogo del compositor** (`ui-skill`) ya es feedback real para lo aprobado: lista lo que sirve
  `ctx.skills` —nuestro provider incluido— y abre el `SKILL.md` en el sidebar.

## 4. Arquitectura

```
modelo ──skill_propose──▶ propuesta en disco ─────────────────────┐
                                                                  │ estado: proposed
tú ──/skill-propuestas──▶ lista lo pendiente ─────────────────────┤
tú ──/skill-ver <id>────▶ lee la propuesta entera ─────────────────┤
tú ──/skill-aprobar <id>▶ validación + aprobar ──┬─────────────────┘
tú ──/skill-rechazar <id>▶ apartar (no borra) ────┤
                                                 │
                          ┌──────────────────────┴───────────────────────┐
                          │ el catálogo del proyecto cambió              │
                          │  · invalidación explícita (mutación propia)   │
                          │  · observación del almacén (mutación ajena)   │
                          └──────────────┬───────────────────────────────┘
                                         ▼
                            ctx.skills control.invalidate()
                                         ▼
                        revisión++ · caché limpia · skills/change
                                         ▼
        ┌────────────────────────────────┴──────────────────────────────┐
        ▼                                                               ▼
  el agente recibe el catálogo de reemplazo            `/nombre` resuelve en el host
  en su siguiente paso  (sin reiniciar)                (sin reiniciar)
```

Un solo contrato de aprobación para las tres superficies: la lógica vive en `lib/compiler.mjs`; la validación
previa —hoy `checkSkill` dentro de `bin/skill-compiler.mjs`— **se mueve a `lib/`** para que comandos, CLI y
página compartan exactamente la misma puerta.

Y una sola señal de catálogo, con dos disparadores, porque hay dos formas de que cambie:

| Disparador | Cubre | Cómo |
|---|---|---|
| **Invalidación explícita** | Lo que muta el propio proceso: `/skill-aprobar`, `/skill-rechazar`, y la aprobación desde la página de revisión si corre en el mismo proceso | tras la mutación, avisar a la señal |
| **Observación del almacén** | Lo que muta **fuera** del proceso: la CLI, la página servida aparte, una edición manual del almacén | vigilar `<root>/projects/*/approved` con `fs.watch` (recursivo, nativo, sin dependencia nueva), con debounce, y avisar a la señal |

El segundo disparador no es un lujo: es el contrato del seam escrito en su README («from its own observation
mechanism»), y es lo que hace que la promesa de §1.3 sea cierta por **cualquier** vía, no sólo por la que
nosotros ejecutamos. Si el sistema no ofreciera vigilancia recursiva, el plugin **degrada** a la invalidación
explícita y lo dice — nunca se cae por esto.

## 5. Fases

### F0 · Cerrar el defecto del contrato de salida *(bloqueante)*

- Declarar en el esquema de `skill_propose` todo campo que su `execute` devuelve en **cada** rama, o dejar de
  devolverlo si no aporta. Decisión: declararlo — el dato existe y el marcador del feedback visual lo usa
  (`lib/definitions.mjs:71`, congelado por `tests/presentation.test.mjs:56`).
- **Aceptación**: ejecutar `skill_propose` real contra su esquema declarado con el **validador real** del
  harness → 0 violaciones, en todas las ramas.

### F1 · La puerta que cierra la clase, no el caso

- `tests/output-contract.test.mjs` (nuevo): para las **cuatro** herramientas, ejecutar cada rama alcanzable y
  validar el `value` con `validateJsonSchemaValue(...)` —exportado por `@deepseek-ai/dsh-tools`, medido—
  contra su esquema declarado (`valueSchemaSpecToJsonSchema`). El juez es el del harness, no uno propio.
- `doctor`: la misma comprobación, para que la puerta exista **antes** de instalar.
- **Aceptación**: la prueba se demuestra **roja** contra el código de hoy y verde después. Una puerta que
  nunca se vio fallar no está probada.

### F2 · Superficie humana en el harness **y frescura sin reinicio**

- **F2.0 (descubrimiento, antes de escribir nada)**: contrato real de `ctx.commands.register` en el harness —
  ¿devuelve disposer?, ¿se ata al *fiber* del plugin (una recarga no debe chocar con «nombre ya registrado»)?,
  ¿hay tope para el texto devuelto?
- **F2.1**: mover `checkSkill` de `bin/` a `lib/`, y que la CLI y la página la importen de ahí.
- **F2.2**: registrar los comandos **de forma opcional** (`ctx.inject(['commands'], …)`: en perfiles sin
  comandos —headless, sdk— el servicio no está y el plugin no puede caerse por una superficie):
  - `/skill-propuestas` — qué hay pendiente y aprobado, con id, descripción y antigüedad.
  - `/skill-ver <id>` — la propuesta entera (su `SKILL.md`).
  - `/skill-aprobar <id>` — exige que la validación pase; si pasa, activa, **invalida el catálogo** y devuelve
    el resultado; si no, `{kind:'error'}` con la regla que falló.
  - `/skill-rechazar <id>` — aparta sin borrar (mismo `reject`) e invalida.
- **F2.3 · La señal de catálogo** (nuevo módulo `lib/catalog-signal.mjs`, sin dependencias):
  - El plugin registra el provider reteniendo su capacidad: `ctx.skills.registerProvider((control) => { signal.attach(control.invalidate); return skillProvider({ root }); })`.
  - Cada mutación del catálogo avisa a la señal; la señal llama a `invalidate()` una sola vez por lote.
  - Observación del almacén (`<root>/projects`) con `fs.watch` recursivo + debounce → misma señal. Se apaga al
    descargar el plugin (todo dentro de sus efectos) y es tolerante a fallos.
- **F2.4 · La puerta de la frescura**, contra el **registro real** (es la lección del incidente anterior: no
  vale un doble): con un almacén de arena y el registro real montado, se fija la secuencia
  1. listar → catálogo cacheado (sin la skill nueva),
  2. aprobar por fuera (escribiendo en el almacén, como haría la CLI),
  3. **sin** invalidar: la lista sigue sin verla — **el rojo que demuestra el defecto de frescura**,
  4. la señal observa el cambio → la lista la ve.
  Y una segunda prueba: la invalidación explícita por el camino del comando.
- **Aceptación de la fase**: `npm test` verde incluidas las dos puertas nuevas; `doctor` en verde; el `/` del
  compositor lista los cuatro comandos; y la puerta de frescura demuestra su rojo antes de su verde.

### F3 · Verificación en el harness vivo *(con evidencia del proceso, no por inferencia)*

1. Recargar la app (procedimiento ya establecido) y usar los comandos **desde el compositor**: captura del
   `/` con los comandos y del resultado de `/skill-propuestas`.
2. Aprobar una skill con `/skill-aprobar <id>` y comprobar **en el log de la sesión** que el catálogo del
   agente se reemplazó: el host inyecta un mensaje durable de catálogo cuando el digest cambia
   (`dsh-tool-skill`), y ese mensaje es verificable descomprimiendo el `session.v4.jsonl.zstd` y buscando la
   entrada `skill-catalog` con el nombre nuevo. Es la prueba objetiva de «sin reiniciar».
3. Comprobar `/nombre` de la skill recién aprobada en la misma sesión: el host inyecta `<skill_content>`.
- **Aceptación**: los tres puntos con su evidencia; y se dirá explícitamente qué se verificó en el proceso
  vivo y qué no (el menú desplegable, D7).

### F4 · Activar lo que está pendiente *(requiere tu OK explícito; toca datos)*

- **F4.1 `shell-and-source-editing-traps`**: validar con `check` y activarla por la vía nueva. Rollback:
  `reject`/`superseded`, que aparta sin borrar.
- **F4.2 Las tres skills globales de tenants** (`hostinger-tenant-release`, `tenant-onboarding-provision`,
  `tenant-maintenance-update`): viven en `~/.dsh/skills`, servidas por `dsh-skill-filesystem` — **fuera de la
  jurisdicción del plugin**. El contenido está preservado en `saas-corporative`, commit `b669192`
  (`SKILL-PROPOSAL-shell-and-tenants-2026-10.md`, 139 líneas). Aplicarlo es editar esos `SKILL.md`: **respaldo
  con copia fuera del árbol + hash antes de tocar**, y verificación de que el catálogo sigue sirviéndolas.
  *(Nota útil: ese provider ya vigila sus raíces e invalida solo, `dsh-skill-filesystem/README.md:81`, así que
  estas ediciones sí llegan sin reinicio.)* Rollback: restaurar del respaldo.

## 6. Presupuesto de escritura

| Fichero | Fase | Cambio |
|---|---|---|
| `lib/definitions.mjs` | F0 | esquemas de salida completos (4 herramientas) |
| `tests/output-contract.test.mjs` *(nuevo)* | F1 | ramas × esquema, con el validador real |
| `lib/catalog-signal.mjs` *(nuevo)* | F2.3 | señal de catálogo: invalidación explícita + observación del almacén |
| `lib/commands.mjs` *(nuevo)* | F2.2 | los cuatro comandos, sobre `lib/compiler.mjs` |
| `lib/compiler.mjs` | F2.1 | recibe la validación previa (`checkSkill`) |
| `bin/skill-compiler.mjs` | F2.1 | usa la validación compartida; `doctor` cubre F1 y F2 |
| `index.js` | F2.2/F2.3 | registra el provider **reteniendo `control.invalidate`** y los comandos (opcionales) |
| `tests/commands.test.mjs`, `tests/catalog-freshness.test.mjs` *(nuevos)* | F2.3/F2.4 | descriptor y cinco casos por comando; la puerta de frescura contra el registro real |
| `package.json` | F2 | **1.2.0** (capacidad nueva, no parche) |
| `docs/OPERACION.md`, `docs/DESARROLLO.md`, `docs/FEEDBACK-VISUAL.md`, `README.md`, `CHANGELOG.md` | todas | comandos, frescura, límite del menú, diagnóstico y conteo de pruebas |

Sin dependencias nuevas: los comandos se usan por el **servicio inyectado** (`ctx.commands`) y la vigilancia
por `node:fs`, no por paquetes añadidos.

## 7. Decisiones abiertas (las resuelves tú al aprobar)

- **D1 · Superficie**: comandos en el harness (recomendado) **o** además un panel propio en el cliente (más
  rico, no verificable sin mirar la interfaz).
- **D2 · Nombres**: `/skill-propuestas`, `/skill-ver`, `/skill-aprobar`, `/skill-rechazar`. ¿En español, en
  inglés, o más cortos?
- **D3 · Política de aprobación**: tu preset `danger-full-access` trae `approval: never`. Con comandos no
  afecta; lo señalo porque descarta la vía nativa de aprobación. ¿Se queda?
- **D4 · F4.2**: ¿aplico las adiciones a las tres skills globales de `~/.dsh/skills` (con respaldo y hash), o
  las dejo como documento?
- **D5 · «Autorización hasta la integración real»**: leo que las propuestas pendientes quedan autorizadas a
  activarse por la vía actual (CLI) **mientras** F2 no esté verde, y que después la vía normal es el harness.
  ¿Correcto?
- **D6 · Alcance de la frescura**: sólo invalidación explícita (más simple; la CLI seguiría exigiendo
  reinicio) **o** explícita **+** observación del almacén (recomendado: es lo que hace cierta la promesa por
  cualquier vía, y es lo que el contrato del seam pide al provider).
- **D7 · Menú del compositor**: el caché por sesión del cliente (`agent-preset/selected` /
  `connection/reset`) **no está en nuestra mano**. ¿Lo aceptamos, documentándolo (recomendado: `/nombre` ya
  funciona y el agente ya la ve), o quieres que evalúe una superficie de cliente propia que sí se refresque?

## 8. Rollback global

- F0–F3: revertir el commit local. Sin datos en juego: el almacén de skills no se toca salvo en F4.
- F4.1: `reject`/`superseded` aparta sin borrar.
- F4.2: respaldo fuera del árbol con hash; restauración del respaldo. Si el respaldo no se puede verificar,
  la fase **no se ejecuta**.

## 9. Autorización

- **Artefacto**: `plans/PLAN-2026-10-12-autorizacion-skills-en-harness-v2.md`
- **Versión**: 2 · **Hash**: en el sidecar `…-v2.md.sha256` (verificable con `sha256sum -c`)
- **Supersede**: v1 (hash arriba, intacta)
- **Estado**: PROPUESTO. Nada se ejecuta hasta que respondas.
- **Cómo apruebas**: «aprobado v2» (con o sin D1–D7 resueltas). Si quieres más cambios, emito la **v3**; la v1
  y la v2 quedan intactas.
