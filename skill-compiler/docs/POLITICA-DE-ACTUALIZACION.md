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
| **Aprender varias cosas en una sesión** | **Implementado** (v3.0.0): el parecido se mide por tema —descontando el estilo— y un `group` declarado permite que varias propuestas del mismo asunto convivan. Ver «Aprender varias cosas en una sesión: el lote» |
| Un lote no se activa a medias | **Implementado** (v3.0.0): la promoción automática exige el lote completo y verificado; la vía humana queda libre |
| Contar skills y no eventos en la interfaz | **Implementado** (v3.0.0): la vista lleva los ids del turno; la píldora y las filas del menú informan del conjunto |
| Lo que **no** hará nunca el motor | Inventar conocimiento: una referencia que nadie escribió se declara, y la propuesta que la puerta rechazaría no se fabrica |

## Aprender varias cosas en una sesión: el lote

Una sesión puede aprender **varias cosas a la vez** (tres skills de temas distintos, o el mismo cambio en
varias skills). Hasta v2.0.0 eso no funcionaba, y la auditoría lo midió antes de tocar nada:

| Comprobación (medida, no supuesta) | Resultado |
|---|---|
| Tres skills de temas **distintos** propuestas en la misma sesión | La 2ª y la 3ª se **vetaban** por «mismo-tema» contra la 1ª (parecido 0,68) |
| De dónde salía ese parecido | La huella comparaba descripción y disparador **completos**, así que medía el **estilo** de redacción del mismo autor, presente en 8/8 skills de la biblioteca |
| Separación de los pares etiquetados con la huella vieja | Los que **deben** vetarse: 0,800–1,000. Los de temas distintos: 0,708–0,739. **Margen: 0,06** |

### Cómo se mide el parecido desde v3.0.0

La huella **descuenta lo que es estilo de la casa**: un token que aparece en casi todas las skills de la
biblioteca no distingue un tema de otro, así que pesa cero. El peso de un token es `log(1 + N / (1 + df))`
(`N` = skills de la biblioteca, `df` = en cuántas aparece) y los que aparecen en `df/N ≥ 0,8` **no cuentan**
cuando hay al menos 6 skills con las que comparar. Las palabras funcionales del español (`los`, `del`, `con`,
`para`…) tampoco cuentan: se midió que bastaban para que dos asuntos sin nada en común superaran el umbral.

El umbral del veto es **0,40**, y está calibrado con pares etiquetados a mano y un corpus **neutral** (ocho
temas de fondo que no son ninguno de los pares juzgados — si el corpus contiene el mismo tema, decide la
gemela del corpus y no el par, y el fixture mide otra cosa):

| Pares | Puntúan | Veredicto |
|---|---|---|
| Temas **distintos** (5 pares) | **0,000** | No se vetan |
| **Mismo** tema, otra redacción (6 pares) | **0,500 – 1,000** | Se vetan |

Margen: **0,500** (era 0,06). Con la huella vieja y umbral 0,50, dos temas distintos puntuaban 0,70–0,74 y se
vetaban.

**Lo que este criterio no ve, y no se le pide:** sinónimos sin una sola palabra en común (`respaldar` vs
`hacer copia de seguridad`). Un parecido de vocabulario no puede verlo, y fingir que lo ve sería peor que no
verlo. Para eso está la **etiqueta declarada** (`tags`): dos skills que declaran la misma etiqueta normalizada
chocan de forma determinista, sin depender de cómo se redacte. Las etiquetas son identificadores, no prosa:
kebab-case ASCII **sin acentos** (una etiqueta con acento se tolera y **se avisa** con su forma canónica,
porque corregirla en silencio enseña a escribir mal).

### El lote: declarar que varias propuestas van juntas

`skill_propose` acepta `group: { id, motivo, esperadas? }`:

| Regla | Por qué |
|---|---|
| **Dos hermanas del mismo lote no se vetan**: el parecido se **avisa**, con el id de la hermana y el número | El autor ya declaró que van juntas y por qué. Sin lote, el mismo parecido se veta igual que siempre |
| `motivo` obligatorio (≥20 caracteres) | Sin él, `group` sería la forma de saltarse el veto escribiendo cualquier cosa. El esquema lo exige antes de ejecutar, y el motor vuelve a comprobarlo |
| La **promoción automática** exige el lote entero: `esperadas` declarado y todas sus propuestas pasando su propia regresión | Un cambio que toca varias skills y se activa a medias deja la biblioteca contando dos historias. Sin `esperadas` no se puede saber si falta alguna, así que **espera** y lo dice |
| La **vía humana no la bloquea el lote**: `approve <id>` y `promote` sin nivel autorizado siguen igual | Aprobar dos de tres es una decisión, no un accidente. El lote no decide por nadie |
| El lote viaja **con la skill** (`metadata.dsh.groupId`/`groupWhy`) y **sobrevive a la reparación** | Así sigue siendo cierto aunque la skill se copie, y reparar un miembro no parte el lote en dos |
| El diario anota el lote, y `history --grupo <lote>` lo filtra | La decisión queda auditable por lote, no sólo por skill |

### La interfaz: contar skills, no eventos

La píldora de estado contaba **eventos**: con tres skills distintas pintaba «Skill actualizada: la-última
×3», que sugiere una sola skill tocada tres veces. Desde v2.1.0 la vista lleva los **ids** del turno, y:

| Situación | Lo que se enseña |
|---|---|
| Una sola skill | Su id, y `×N` si se tocó N veces (ahí el `×N` dice la verdad) |
| Varias skills distintas | Cuántas son (`3 skills`), con la lista completa en el `title` |
| Un lote | Cada fila del menú dice a qué lote pertenece y **con cuántas más va**, para no dejar al humano sin saber si le falta algo por decidir |

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
| `absolute-path` | Rutas absolutas que atan la skill a un puesto | una ruta de unidad o POSIX **en prosa** | aviso |
| `absolute-path-ejemplo` · `absolute-path-cita` | La misma ruta, pero dentro de un bloque de código (ejemplo) o de código en línea (cita) | — | **info** (se ve en el informe, no pide nada) |
| `absolute-path-ambigua` | Ruta con la barra duplicada tras los dos puntos —como aparece dentro de un JSON—: puede ser real | — | aviso |
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
| `tamano` | Ver abajo: lo que cambia está acotado, y se mide distinto lo que **sale del cuerpo** de lo que se **añade** | Una corrección desmedida |
| `sin-perdida-de-ficheros` | La propuesta lleva **todos** los ficheros de la skill viva | Una propuesta que pierde material |
| `reversible` | La versión viva está entera y se puede reponer | Una skill ilegible |
| `sin-ciclos` | La misma corrección no se ha promocionado ya tres veces seguidas **sin que el cuerpo baje** (el progreso se mide; repetir bajando no es un ciclo) | Un ciclo sin progreso |
| `material-preservado` | Si se retira material, sigue conservado en el cuerpo o en otra referencia | Una retirada que pierde conocimiento |

**El límite del tamaño, y por qué son dos cuentas.** Un cambio de texto se acota en seco: 200 líneas. Pero
«mover el material pesado a `references/`» no es añadir material de fuera: es el **mismo conocimiento
cambiando de sitio dentro de la skill**, con su vínculo y su huella. Contarlo como si fueran ficheros nuevos
bloqueaba la corrección de las skills más grandes del almacén —las que más lo necesitan—, así que se cuenta
aparte. Y se cuenta **en bytes**, con **la misma función** que usa el motor al preparar la corrección
(`topeDeMovimiento`): lo que puede salir del cuerpo es la distancia de su tamaño al objetivo del motor
(80% del umbral) más el tamaño del trozo mayor disponible —un paso entero, porque una sección no se parte—.

Son **una sola vara** a propósito. Con dos fórmulas distintas —el motor moviendo en bytes «hasta bajar del
umbral» y la puerta contando trozos (`1 + exceso/5.000`)— el motor preparaba correcciones que su propia
puerta rechazaba: medido en el almacén real, 16 secciones movidas con tope 3, y 6 con tope 3. Preparar algo
condenado no es preparar: es prometer en falso. Y la garantía no es la fórmula: el motor **no propone** si el
cuerpo resultante se queda por encima del umbral. Lo que **no** se relaja es que cada trozo viaje entero y
con su huella, y que el inventario del conocimiento se conserve: eso lo comprueban `conservacion`,
`sin-perdida-de-ficheros` y `material-preservado`, que no dependen del tamaño de la corrección.

Lo que **no** está implementado: un motor que decida por su cuenta que hay que reparar algo. Hoy lo pide una
persona (`repair`), y la autorización de nivel es una decisión por escrito en cada invocación (`--nivel`).

## Compatibilidad: qué cambia en v3.0.1

| Cambio | Efecto |
|---|---|
| El tope de material que sale del cuerpo se mide **en bytes** con una sola función (`topeDeMovimiento`), compartida por `repair` y `promote` | El motor deja de preparar correcciones que su propia puerta rechazaba. Una corrección que antes pasaba por trocear mucho con poco exceso sigue pasando; una que movía 16 trozos con tope 3 ahora se prepara dentro del tope |
| `sin-ciclos` mide **progreso** (el cuerpo baja en cada ronda) en vez de contar repeticiones | Una corrección que necesita varias rondas deja de confundirse con un bucle. Un bucle real —mismo arreglo, cuerpo clavado— se sigue parando |
| `repair` **no propone** si el cuerpo resultante se queda por encima del umbral | Antes fabricaba una propuesta condenada; ahora lo declara en `sinReparacion` y lo dice el CLI |
| `meta.repair` gana `topeBytes`, `paso`, `bytesMovidos`, `cuerpoTrasBytes` y `alcanzoObjetivo`; el diario gana `cuerpoBytes` | Aditivo: los consumidores anteriores siguen leyendo lo mismo |

## Compatibilidad: qué cambia en v3.0.0

| Cambio | Efecto |
|---|---|
| El veto de solapamiento mide de otra forma (pesos por frecuencia documental, umbral 0,40) | Dos temas distintos dejan de vetarse (**era el defecto**). Los duplicados reales se siguen vetando: se comprueba con los pares etiquetados |
| Parámetro nuevo `group` en `skill_propose` (`id`, `motivo`, `esperadas` opcional) | Opcional. Sin él, todo se comporta como antes salvo que el veto es más preciso |
| Campos nuevos en el resultado de `skill_propose`: `group` (sólo si se declaró) y `siblings` | Declarados en el esquema: un campo devuelto sin declarar rechaza el resultado entero |
| La vista de la proyección lleva `ids` (la lista de skills tocadas en el turno) | Aditivo. Quien leía `created`/`updated` sigue leyéndolos |
| Aviso nuevo de la puerta: `tag-no-cánico` | Una etiqueta con acentos o mayúsculas se admite, se normaliza y **se avisa** con su forma canónica |
| La reparación hereda el lote de la skill viva | Reparar un miembro no parte el lote |
| `metadata.dsh.groupId`/`groupWhy` en el frontmatter | Aditivo: quien no los conozca los ignora |
| Entradas del diario con `group` | Aditivo |
