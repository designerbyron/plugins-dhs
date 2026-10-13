# Plan — autorización real de skills dentro del harness

| | |
|---|---|
| **Fecha** | 2026-10-12 23:39 (hora local, UTC-6) |
| **Autor** | Hermes, para Byron |
| **Sujeto** | `C:\xampp\htdocs\plugins-dhs\skill-compiler` (plugin DSH **v1.1.2**, commit `8bd0103`) |
| **Estado** | **PROPUESTO — no se ejecuta nada hasta aprobación explícita** |
| **Versión** | 1 |

## 1. Objetivo

Dos cosas, en este orden, porque la primera bloquea a la segunda:

1. **Cerrar el defecto que impide proponer skills** (`skill_propose` falla al devolver su resultado) y
   cerrar la *clase* de defecto, no el caso.
2. **Autorizar skills desde dentro del harness**, con feedback real: ver la propuesta, leerla entera,
   aprobarla o rechazarla — sin CLI, sin servidor local aparte y sin que el modelo pueda decidir por ti.

## 2. Lo que este plan NO hace

- **No cambia la regla de fondo**: aprobar no es una herramienta del modelo. La decisión sigue siendo
  humana; lo que cambia es *dónde* se toma.
- **No construye un panel de UI dedicado** (opción B de la decisión D1): sería la superficie más rica y
  también la única que no puedo verificar sin mirar la interfaz. Queda evaluada, no ejecutada.
- **No toca la biblioteca global de skills** (`~/.dsh/skills`) sin autorización explícita aparte (F4.2).
- **No publica nada**: commits locales, sin `push`.
- **No reescribe** la CLI ni la página local de revisión: se conservan como vías alternativas.

## 3. Hechos medidos (con la prueba de cada uno)

### 3.1 El defecto, y por qué su síntoma miente

`skill_propose`, en la rama `proposed`, devuelve un campo que su esquema de salida no declara:

- `skill-compiler/lib/definitions.mjs:146` → `updatesProposal: result.updatesProposal`
- `skill-compiler/lib/definitions.mjs:100-114` → el esquema declara `status`, `summary`, `id`, `project`,
  `projectKey`, `path`, `updatesApproved`, `conflicts`, `relatedElsewhere`, `warnings`, `errors`… y **no**
  `updatesProposal`; la raíz lleva `additionalProperties: false`.

El validador que lo rechaza es el del propio harness,
`node_modules/@deepseek-ai/dsh-tools/lib/index.js:468`:

```
"value.updatesProposal" is not a declared property (additionalProperties: false)
```

**La asimetría que lo explica**: `skill_vendor` **sí** declara ese campo (`lib/definitions.mjs:306`). Por eso
vendorizar funcionaba y proponer no: el defecto no es de concepto, es de un esquema que se quedó atrás.

**Por qué el síntoma engaña**: la herramienta escribe en disco *antes* de devolver el valor. La propuesta
**existe** (`~/.dsh/skill-compiler/projects/saas-corporative-a3c393fa/proposed/shell-and-source-editing-traps/`,
`meta.json` con `createdAt 2026-10-13T04:59:35.236Z`) mientras el modelo recibió un error y el usuario
concluyó «no se ha creado nada». Efecto aplicado, respuesta rechazada: hay que cerrar las dos cosas.

### 3.2 Hoy no hay ningún punto humano dentro del harness

Las superficies que existen son externas y se arrancan a mano:

- `bin/skill-compiler.mjs` — `list`, `show`, `check`, `approve`, `reject` (CLI).
- `lib/review.mjs` — servidor local en `127.0.0.1` con token de un solo uso (`bin/skill-compiler.mjs:338-365`).

Ninguna vive en el harness, que es donde trabajas.

### 3.3 Lo que el harness sí ofrece (medido, no supuesto)

Con `dsh --profile web --dump-config` (1265 líneas, sólo lectura):

| Fila montada | Paquete | Qué es |
|---|---|---|
| `commands` | `@deepseek-ai/dsh-commands` | registro de comandos humanos `/nombre` |
| `approval` | `@deepseek-ai/dsh-user-approval` | petición de decisión puntual |
| `ui-approval` | `@deepseek-ai/dsh-client-ui-approval` | la UI que responde esa petición |
| `skill` / `skill-filesystem` | `@deepseek-ai/dsh-skill(-filesystem)` | el catálogo `ctx.skills` (donde ya registramos el proveedor) |
| `ui-commands`, `ui-skill` | cliente | el `/` del compositor y las fichas de skill |

- **`ctx.commands.register({ name, description, input, handler })`** — el handler corre **contra el agente
  sin crear mensaje del modelo** (`{kind:'success'|'error', text}`), el resultado lo pinta la UI fuera del
  historial del modelo, y el run queda en el log de la sesión. **Es el mecanismo elegido** (D1).
- **`ctx.userApproval.request(...)`** — **descartado para aprobar skills**: exige un turno abierto y su
  política es `ask|never`; tu perfil usa el preset `danger-full-access` con `approval: never`
  (`profiles/desktop/cordis.patch.yml`), es decir **toda** petición se rechazaría sin preguntarte y el propio
  prompt del sistema dice que las aprobaciones están deshabilitadas. Una vía que falla en silencio no sirve
  para autorizar.
- **El catálogo del compositor ya es feedback real para lo aprobado**: `ui-skill` lista lo que sirve
  `ctx.skills` (nuestro proveedor incluido) y abre el `SKILL.md` en el sidebar. Lo que falta es la parte
  **pendiente** — eso es este plan.

## 4. Arquitectura elegida

```
modelo ──skill_propose──▶ propuesta en disco ──┐
                                               │  (estado: proposed)
tú ──/skill-propuestas──▶ lista lo pendiente ──┤
tú ──/skill-ver <id>────▶ lee la propuesta ────┤
tú ──/skill-aprobar <id>▶ check + aprobar ─────┴──▶ aprobada ──▶ la sirve ctx.skills ──▶ `/` del compositor
tú ──/skill-rechazar <id>▶ apartar (no borra)
```

Una sola implementación para las tres superficies: la lógica ya vive en `lib/compiler.mjs` (CLI y plugin la
comparten hoy); la validación previa a aprobar —hoy `checkSkill` dentro de `bin/skill-compiler.mjs`— **se
mueve a `lib/`** para que comandos, CLI y página usen exactamente la misma puerta (sin duplicar reglas).

## 5. Fases

Cada fase se cierra con evidencia; ninguna se declara hecha por inferencia.

### F0 · Cerrar el defecto del contrato de salida *(bloqueante)*

- Declarar en el esquema de `skill_propose` todo campo que su `execute` devuelve en **cada** rama, o dejar de
  devolverlo si no aporta. Decisión: declararlo — el dato existe y el marcador del feedback visual lo usa
  (`lib/definitions.mjs:71`, congelado por `tests/presentation.test.mjs:56`).
- **Aceptación**: ejecutar `skill_propose` real contra su esquema declarado con el **validador real** del
  harness → 0 violaciones, en todas las ramas.
- **Evidencia**: salida del validador antes y después (la de antes es la que hoy produce el error).

### F1 · La puerta que cierra la clase, no el caso

- `tests/output-contract.test.mjs` (nuevo): para las **cuatro** herramientas, ejecutar cada rama alcanzable y
  validar el `value` con `validateJsonSchemaValue(...)` — importado de `@deepseek-ai/dsh-tools`, que ya lo
  exporta (medido) — contra su esquema declarado (`valueSchemaSpecToJsonSchema`). Ni un validador propio ni
  una comprobación a ojo: el juez es el del harness.
- `doctor`: la misma comprobación, para que la puerta exista **antes** de instalar.
- **Aceptación**: la prueba se demuestra **roja** contra el código de hoy (F0 sin aplicar) y verde después.
  Esa demostración es el criterio: una puerta que nunca se vio fallar no está probada.
- **Riesgo**: ramas que necesitan disco o red (`vendor` con `fetch`, `propose` con el almacén) → se usan los
  dobles y la caja de arena que ya existen en la suite.

### F2 · La superficie humana dentro del harness

- **F2.0 (descubrimiento, antes de escribir nada)**: leer en el harness el contrato real de
  `ctx.commands.register` — ¿devuelve un disposer?, ¿se ata al *fiber* del plugin (importante para que una
  recarga no choque con «nombre ya registrado»)?, ¿hay tope para el texto que se devuelve? Sin esto, el
  registro se diseña a ciegas.
- **F2.1**: mover `checkSkill` (validación previa) de `bin/` a `lib/`, y que la CLI y la página la importen
  de ahí. Un solo contrato de aprobación.
- **F2.2**: registrar los comandos **de forma opcional** (`ctx.inject(['commands'], …)`), porque en perfiles
  sin comandos —headless, sdk— el servicio no está y el plugin no puede caerse por un adorno de superficie:
  - `/skill-propuestas` — qué hay pendiente y aprobado, con id, descripción y antigüedad.
  - `/skill-ver <id>` — la propuesta entera (su `SKILL.md`).
  - `/skill-aprobar <id>` — exige que la validación pase (igual que la CLI); si pasa, activa y devuelve el
    resultado; si no, devuelve `{kind:'error'}` con la regla que falló.
  - `/skill-rechazar <id>` — aparta sin borrar (mismo `reject` que la CLI).
- **F2.3**: pruebas con un contexto doble que fijan el descriptor (nombre válido según la gramática del
  harness: minúsculas, letras/dígitos/`_`/`-`) y el resultado en los cinco casos: sin propuestas, id
  inexistente, validación en rojo, aprobación correcta, rechazo.
- **Aceptación**: `npm test` verde; `doctor` en verde; el `/` del compositor lista los cuatro comandos.

### F3 · Verificación en el harness vivo

- Recargar la app (procedimiento ya establecido) y **usar los comandos desde el compositor**, no desde una
  terminal: captura del `/` con los comandos y del resultado de `/skill-propuestas`.
- **Aceptación**: evidencia del proceso vivo (captura + el estado en disco que cambie como consecuencia).

### F4 · Activar lo que está pendiente *(requiere tu OK explícito; toca datos)*

- **F4.1 `shell-and-source-editing-traps`** — la propuesta que ya está en disco: validarla con `check`
  (medida: pendiente) y activarla por la vía nueva. Rollback: `reject`/`superseded`, que ya aparta sin
  borrar.
- **F4.2 Las tres skills globales de tenants** (`hostinger-tenant-release`,
  `tenant-onboarding-provision`, `tenant-maintenance-update`): viven en `~/.dsh/skills`, servidas por
  `dsh-skill-filesystem` — **fuera de la jurisdicción del plugin**. El contenido de las adiciones está
  preservado en `saas-corporative`, commit `b669192`
  (`SKILL-PROPOSAL-shell-and-tenants-2026-10.md`, 139 líneas). Aplicarlas es editar esos `SKILL.md`:
  **respaldo con copia fuera del árbol + hash antes de tocar**, edición aplicada al contenido preservado, y
  verificación de que el catálogo sigue sirviéndolas. Rollback: restaurar del respaldo.
- Este es el único punto del plan con **riesgo de datos**, y por eso está separado y no se ejecuta sin una
  respuesta tuya (D4).

## 6. Presupuesto de escritura

| Fichero | Fase | Cambio |
|---|---|---|
| `lib/definitions.mjs` | F0 | esquemas de salida completos (4 herramientas) |
| `tests/output-contract.test.mjs` *(nuevo)* | F1 | ramas × esquema con el validador real |
| `lib/commands.mjs` *(nuevo)* | F2 | los cuatro comandos, sobre `lib/compiler.mjs` |
| `lib/compiler.mjs` | F2.1 | recibe la validación previa (`checkSkill`) |
| `bin/skill-compiler.mjs` | F2.1 | usa la validación compartida; `doctor` cubre F1 y F2 |
| `index.js` | F2.2 | registro opcional de comandos |
| `tests/commands.test.mjs` *(nuevo)* | F2.3 | descriptor y cinco casos por comando |
| `package.json` | F2 | **1.2.0** (capacidad nueva, no parche) |
| `docs/OPERACION.md`, `docs/DESARROLLO.md`, `README.md`, `CHANGELOG.md` | todas | qué es, cómo se usa, diagnóstico y conteo de pruebas |

Sin dependencias nuevas que declarar: los comandos se usan por el **servicio inyectado** (`ctx.commands`), no
por un `import`.

## 7. Decisiones abiertas (las resuelves tú al aprobar)

- **D1 · Superficie**: comandos en el harness (recomendado: verificable entero desde aquí) **o** además un
  panel propio en el cliente (más rico y no verificable sin mirar la interfaz).
- **D2 · Nombres**: `/skill-propuestas`, `/skill-ver`, `/skill-aprobar`, `/skill-rechazar` (en español, como
  tus prompts). ¿Los prefieres en inglés o más cortos?
- **D3 · Politica de aprobación**: tu preset `danger-full-access` trae `approval: never`. Con comandos no
  afecta; lo señalo porque descarta la vía de aprobación nativa del harness. ¿Se queda como está?
- **D4 · F4.2**: ¿aplico las adiciones a las tres skills globales de `~/.dsh/skills` (con respaldo y hash),
  o las dejo como documento de propuesta?
- **D5 · «Autorización hasta la integración real»**: leo que las propuestas pendientes quedan autorizadas a
  activarse por la vía actual (CLI) **mientras** F2 no esté verde, y que a partir de ahí la vía normal es el
  harness. ¿Es correcto?

## 8. Rollback global

- F0–F3: revertir el commit local. No hay datos en juego: el almacén de skills no se toca salvo en F4.
- F4.1: `reject`/`superseded` aparta sin borrar.
- F4.2: respaldo fuera del árbol con hash; restauración del respaldo. Si el respaldo no se puede verificar,
  la fase **no se ejecuta**.

## 9. Autorización

- **Artefacto**: `plans/PLAN-2026-10-12-autorizacion-skills-en-harness.md`
- **Versión**: 1 · **Hash**: en el sidecar `…md.sha256` (verificable con `sha256sum -c`)
- **Estado**: PROPUESTO. Nada se ejecuta hasta que respondas.
- **Cómo apruebas**: «aprobado v1» (con o sin las decisiones D1–D5 resueltas). Si quieres cambios, dime
  cuáles y emito la **v2** con su hash nuevo; la v1 queda intacta byte a byte.
