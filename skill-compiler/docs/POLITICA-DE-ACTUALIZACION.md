# Política de actualización automática

**Estado: los tres niveles están implementados como comportamiento, y la promoción automática está apagada.**
El motor **prepara** correcciones con evidencia (`repair`), las **prueba** (nueve pruebas de regresión), las
**activa sólo si su nivel está explícitamente autorizado** y **deshace** lo que no cuadra (`promote`), dejando
la versión anterior apartada con su huella y la decisión registrada en `journal.jsonl`.

Lo que **no** hay: ningún nivel autorizado por defecto (`NIVELES_POR_DEFECTO` está vacío), ninguna forma de
autorizar el **nivel 3** por la vía automática —la seguridad, los permisos, los secretos, el aislamiento y la
facturación son de una persona—, y ningún motor que decida **por su cuenta** que hay que reparar algo: hoy lo
pide un humano con `repair`, y la autorización de nivel es una decisión por escrito en cada invocación.

Cada criterio lleva escrito **cómo se comprueba**. Un criterio que no se puede verificar no es un criterio:
es una intención.

---

## Los tres niveles de riesgo

La pregunta que decide el nivel no es «¿es un cambio pequeño?» sino **¿qué puede romper y quién lo puede
notar?**. Un cambio de formato que no altera el significado es nivel 1; la misma línea cambiada dentro de un
procedimiento de facturación es nivel 3.

### Nivel 1 — Automatización permitida

Cambios **mecánicos, deterministas y sin significado propio**: normalizaciones de formato, metadatos
derivados de reglas inequívocas, propagación de un campo que el sistema ya conoce.

Permitido **aplicar y activar** sin humano, siempre que se cumplan **las seis condiciones**:

| Condición | Cómo se comprueba |
|---|---|
| No cambia el significado ni el comportamiento | El cambio pertenece a una lista cerrada de transformaciones con nombre (`normalizar-frontmatter`, `rellenar-procedencia`, …). Una transformación fuera de la lista no es de este nivel |
| La validación completa pasa | `validateInput` sobre la versión resultante, sin errores |
| Se conserva la versión anterior | La anterior queda en `superseded/` con su huella (`folderHash`), no se borra |
| Existe reversión verificable | `restore` la devuelve con la **misma huella**; la prueba compara las dos |
| El cambio es idempotente | Aplicarlo dos veces produce exactamente el mismo fichero (huella igual) |
| Queda registrado | `meta.json` guarda nivel, transformación, huella anterior y huella nueva |

Una transformación de este nivel **nunca** toca el cuerpo de la skill: sólo campos derivados.

### Nivel 2 — Actualización automática condicionada

Un parche de alcance limitado **con evidencia objetiva**. El sistema puede prepararlo, probarlo y —sólo si
una política explícita lo habilita— activarlo. Mientras la promoción automática esté apagada, el resultado
es una propuesta normal que espera aprobación humana, **idéntica** a la de hoy.

Condiciones, todas obligatorias:

| Condición | Cómo se comprueba |
|---|---|
| Hash de la versión base | Se guarda el `folderHash` de la versión sobre la que se preparó el parche y se re-comprueba **antes de escribir**. Si cambió, la propuesta se rechaza: nunca se sobrescribe una versión que se movió desde que se preparó |
| Evidencia reproducible | El parche declara `revision`: qué afirmaba la versión anterior, con qué se midió que no era así, y qué cambia. Sin ese campo, la puerta rechaza el parche de algo vivo (ya implementado) |
| Diferencia exacta | Se guarda el diff entre la versión anterior y la propuesta, y el resultado lo publica: sin diff no hay revisión posible |
| Validación estructural | `validateInput` sobre la propuesta, sin errores |
| Sin duplicados | `checkOverlap` contra el resto del inventario, con el mismo umbral que una propuesta nueva |
| Pruebas de regresión | La suite del proyecto pasa; y si la skill declara referencias, `checkProposal` verifica sus huellas |
| Sin cambios fuera del alcance | El conjunto de ficheros escritos y sus huellas tienen que ser exactamente los declarados (`files` del resultado); un fichero de más invalida el parche |
| Registro de la decisión | Nivel, evidencia, pruebas, huellas de entrada y salida y quién/qué lo promovió |
| Reversión automática ante regresión | Si una prueba falla después de promover, se vuelve a la huella anterior y se registra el incidente |

**La promoción automática está desactivada por defecto** hasta que el mecanismo esté implementado, probado y
habilitado por una política explícita. Y esto no es una formalidad: **la confianza del modelo —su propia
afirmación de que el parche funciona— no es evidencia**. La evidencia es una medición reproducible que otra
persona pueda repetir.

### Nivel 3 — Aprobación humana obligatoria

No se activa sola **ninguna** actualización que toque:

- procedimientos o criterios de decisión (el «cómo se hace» de la skill),
- seguridad, permisos o manejo de secretos,
- operaciones destructivas (borrados, sobrescrituras, migraciones, despliegues),
- facturación o cualquier importe,
- aislamiento entre proyectos o entre tenants,
- o que traiga evidencia **insuficiente o contradictoria**.

En estos casos el sistema **sí** puede preparar la propuesta, reunir la evidencia y ejecutar pruebas
aisladas; lo que no puede es mover la versión aprobada. La propuesta espera, y la versión vigente sigue
sirviéndose hasta que un humano decida.

---

## Salvaguardas comunes (a los tres niveles)

1. **Nunca se sobrescribe destructivamente una skill aprobada.** Una versión nueva **aparta** la anterior en
   `superseded/` con su huella; el historial no se pierde.
2. **Versiones inmutables e historial de cambios.** Cada estado (`proposed`, `approved`, `disabled`,
   `superseded`, `published`) se conserva; lo que se mueve deja constancia.
3. **Se rechaza una actualización con hash obsoleto.** Si la base cambió desde que se preparó el parche, el
   parche no se aplica: se vuelve a preparar.
4. **Una skill no puede eludir esta política.** Ni su cuerpo ni sus referencias pueden aportar instrucciones
   que salten la puerta: el contenido ajeno pasa por el escáner de órdenes dirigidas al agente, y un origen
   con secretos u órdenes **se bloquea** por diseño.
5. **Reintentos limitados, sin bucles.** Un ciclo de autocorrección que no progresa se detiene y se reporta;
   el criterio de progreso es una medición (huella, número de errores), no una sensación.
6. **Si no se puede demostrar que el cambio es seguro, gana la versión vigente** y se genera un informe. La
   duda no autoriza.
7. **Separadas las cuatro fases**: generar una propuesta, aprobarla, activarla y revertirla son actos
   distintos, con superficies distintas. El modelo propone; aprobar no es una herramienta del modelo.
8. **Se registran las aceptadas y las rechazadas.** Un rechazo con su motivo es lo que permite ver por qué el
   sistema no actuó, y es la materia prima de la próxima decisión.

---

## Lo que ya existe y lo que falta

| Pieza de la política | Estado |
|---|---|
| Puerta de calidad (formato, estructura, presupuesto, vínculo de referencias, integridad) | **Implementada** (v2.0.0) |
| Versión anterior apartada, nunca borrada | **Implementada** (`superseded/`, con huella) |
| Reversión verificable por huella | **Implementada** (`retire`/`restore`, con la huella comparada) |
| Hash de la versión base y rechazo del obsoleto | **Implementada** (v2.0.0): la propuesta guarda la huella de la versión sobre la que se construyó y la puerta de aprobar la re-comprueba; si cambió, se rechaza y se pide reconciliar |
| Evidencia obligatoria al parchear algo vivo (`revision`) | **Implementada** (v2.0.0), estructurada: `claim`, `evidence`, `measurement` (con número o comando) y `change`; `removed` cuando se elimina algo. La evidencia que es una ruta existente se marca **observada**; lo demás se declara como afirmación no verificada |
| Diff exacto de la propuesta | **Implementado** (v2.0.0): líneas añadidas y eliminadas del cuerpo, y material añadido, modificado y eliminado con sus huellas |
| Preservación del material eliminado | **Implementada**: un fichero de material que desaparece tiene que seguir **entero** en el cuerpo o en otra referencia, o el parche se rechaza |
| **Auditoría de solo lectura** (`audit`) | **Implementada** (v2.0.0): recorre el almacén entero —todos los proyectos, todos sus estados y la biblioteca global—, mide cada skill con la puerta de aprobar y devuelve, por hallazgo, la regla, el valor observado, el umbral, la severidad y la corrección. No escribe nada (la prueba compara la huella del árbol entero antes y después), es reproducible (dos ejecuciones dan el mismo informe byte a byte) y no se cae por una skill ilegible: la declara y sigue |
| Registro de nivel y de decisión en `meta.json` | **Parcial**: se registran `base`, `revision` y `diff`; falta el «nivel» explícito de la política |
| Reversión ante una comprobación que falla | **Implementada**: lo publicado se relee y se compara por huella; si no cuadra, se aparta —nunca se borra— y la anterior vuelve con su huella comprobada |
| Promoción automática, apagada por defecto | **Implementada y apagada**: `NIVELES_POR_DEFECTO` está vacío, el nivel 3 no se autoriza por la vía automática, y el modo `/skill-auto` **no activa correcciones**: delega la confirmación de una skill nueva, nunca el juicio sobre una viva |
| Registro de la decisión | **Implementado**: `journal.jsonl` por proyecto, con nivel, reglas, base, diff, pruebas y decisión. `history` lo lee |
| Reintentos y ciclos sin progreso | **Implementado**: la misma corrección promocionada tres veces seguidas se para y la mira una persona |
| Dos procesos a la vez | **Implementado**: cerrojo por skill con `O_EXCL`; si está tomado, se dice quién y desde cuándo |
| Motor que **prepare** el parche | **Implementado, y lo pide un humano**: `repair <id>`. No hay motor que decida solo que hay que reparar algo |
| Lo que **no** hará nunca el motor | Inventar conocimiento: una referencia que nadie escribió se declara, y la propuesta que la puerta rechazaría no se fabrica |

## Compatibilidad: qué cambia en v2.0.0

Estos cambios afectan a quien llame a las herramientas o lea el almacén, y por eso se declaran juntos. Ninguno
es silencioso: cada uno se ve en la puerta, en el resultado o en `meta.json`.

| Cambio | Efecto |
|---|---|
| `whenToUse` pasa a **obligatorio** (≥20 caracteres) | Una llamada que no lo traiga se rechaza con el motivo. El esquema lo declara obligatorio, así que el modelo lo envía |
| Parámetro nuevo `references` (`path` + `content`) | El material pesado viaja con la skill; las rutas tienen que vivir bajo `references/` y no pueden escapar de la carpeta |
| `description`: mínimo de **60** (era 12) | Descripciones de titular dejan de pasar |
| Estructura: **≥2 secciones** `##` | Un cuerpo corto (≤1.500) con una sola sección se admite con aviso |
| `body`: aviso a **8.000**, error a **24.000** | El exceso va a `references/` |
| Parámetro nuevo `revision` | **Obligatorio** cuando el id ya nombra una skill viva; sin él, el parche se rechaza |
| Campos nuevos en el resultado: `references`, `links`, `files` y —en un parche— `base`, `corregida`, `evidenciaObservada`, `diff` | Declarados en el esquema: un campo devuelto sin declarar rechaza el resultado entero |
| El modo `/skill-auto` ya **no** activa correcciones de skills vivas | Cambio deliberado: una corrección espera decisión humana |
| `checkProposal` comprueba además la base y la integridad del material | Una propuesta editada a mano, o construida sobre una versión que se movió, no se aprueba |

---

## El catálogo de reglas: qué mide `audit` y con qué umbral

La auditoría no inventa criterios: aplica **la misma puerta** que decide una aprobación (`auditarCarpeta`, la
que usa `checkProposal`). Esta tabla es el catálogo completo, con el umbral de cada regla y su severidad, para
que un hallazgo se pueda leer sin abrir el código.

| Regla | Qué mide | Umbral | Severidad |
|---|---|---|---|
| `id-format` · `id-max` | Que el id sea kebab-case · su longitud | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` · 64 | error |
| `description-min` · `description-max` · `description-multiline` | La descripción, que es lo que el modelo lee al elegir | 60 · 300 · una línea | error |
| `whenToUse-min` · `whenToUse-multiline` | El disparador con el que el harness decide cuándo aparece | 20 · una línea | error |
| `body-min` | Que haya procedimiento y no un titular | 200 caracteres | error |
| `body-budget` | Lo que se paga **entero en cada carga** | aviso desde 8.000 | aviso |
| `body-max` | El techo: por encima, el material va a `references/` | error desde 24.000 | error |
| `body-no-sections` · `body-sections-min` · `body-sections-soft` | Que el cuerpo se pueda leer por partes | 0 · 2 (a partir de 1.500 caracteres) · 1 con aviso si el cuerpo es corto | error · error · aviso |
| `secret` · `personal-path` | Que no viaje una credencial ni una ruta de la máquina de nadie | patrón de credencial · ruta de perfil | error |
| `absolute-path` | Rutas absolutas que atan la skill a un puesto | — | aviso |
| `reference-path` · `reference-escape` · `reference-not-a-file` · `reference-duplicate` · `reference-empty` | La forma del material que se aporta | bajo `references/`, sin `..`, fichero, una vez, con contenido | error |
| `link-missing` · `link-escape` · `link-is-directory` | Que el vínculo del cuerpo se resuelva de verdad | el fichero tiene que existir | error |
| `link-unverifiable` | Un vínculo dentro de una carpeta que **no se pudo leer** | — | info |
| `reference-budget` | Cuántas referencias lleva | — | aviso |
| `reference-integrity` · `reference-missing-file` | Que el material sea el que se aprobó (huella) y siga ahí | SHA-256 registrado en `meta.json` | error |
| `unreadable` | Un fichero o una carpeta que no se pudo leer | — | error |
| `skill-missing` | Una carpeta de estado sin `SKILL.md` | — | error |
| `unknown-state` · `state-unreadable` · `store-unreadable` | El contenedor: un estado que la auditoría no conoce, o que no se pudo leer | — | aviso · error · error |
| `not-ours` | Una skill de la biblioteca compartida que no es de este plugin | — | info |

Cada hallazgo lleva además **qué hacer** (`fix`), y el informe agrupa por regla: primero lo que más arregla de
una vez. Un aviso no impide nada; un error significa que esa skill no pasaría la puerta si se propusiera hoy.

La auditoría **no repara**: señalar es su trabajo. Corregir es `repair` + `promote` (nivel 1 o 2) o una decisión
humana (nivel 3), y las dos vías pasan por la puerta.

---

## Las nueve pruebas que corren antes de activar (`promote`)

Una promoción automática se gana el derecho a activarse. Estas pruebas las ejecuta **el mismo sistema que va a
activar** —no quien propone el parche— y quedan todas registradas en `journal.jsonl` con su resultado:

| Prueba | Qué comprueba | Quién puede tumbarla |
|---|---|---|
| `puerta` | La propuesta pasa la puerta de calidad | Una skill mal formada |
| `base-vigente` | La versión sobre la que se construyó **sigue siendo la vigente** (por huella) | Que alguien la haya movido |
| `conservacion` | Nada del inventario del conocimiento (comandos, cifras, rutas, encabezados) desaparece sin justificarlo | Una propuesta que borra sin decir por qué |
| `alcance` | Lo que se escribe está **dentro de la skill**: lo que ya tenía —incluido el `upstream/` y el `provenance.json` de una vendorizada— más `references/` | Un fichero colado |
| `tamano` | Ver abajo: lo que cambia está acotado, y se mide distinto lo que se **trocea** de lo que se **añade** | Una corrección desmedida |
| `sin-perdida-de-ficheros` | La propuesta lleva **todos** los ficheros de la skill viva | Una propuesta que pierde material |
| `reversible` | La versión viva está entera y se puede reponer | Una skill ilegible |
| `sin-ciclos` | La misma corrección no se ha promocionado ya tres veces seguidas | Un ciclo sin progreso |
| `material-preservado` | Si se retira material, sigue conservado en el cuerpo o en otra referencia | Una retirada que pierde conocimiento |

**El límite del tamaño, y por qué son dos cuentas.** Un cambio de texto se acota en seco: 200 líneas. Pero
«mover el material pesado a `references/`» no es añadir material de fuera: es el **mismo conocimiento
cambiando de sitio dentro de la skill**, con su vínculo y su huella. Contarlo como si fueran ficheros nuevos
bloqueaba la corrección de las skills más grandes del almacén —las que más lo necesitan—, así que se cuenta
aparte y en proporción a lo que haya que sacar del cuerpo: **un trozo por cada 5.000 caracteres de exceso,
más uno**. Un cuerpo de 3 KB por encima del techo mueve un fichero; uno de 97 KB mueve hasta quince. Lo que
**no** se relaja es que cada trozo viaje entero y con su huella, y que el inventario del conocimiento se
conserve: eso lo comprueban `conservacion`, `sin-perdida-de-ficheros` y `material-preservado`, que no dependen
del tamaño de la corrección.

Lo que **no** está implementado: un motor que decida por su cuenta que hay que reparar algo. Hoy lo pide una
persona (`repair`), y la autorización de nivel es una decisión por escrito en cada invocación (`--nivel`).
