# Changelog

El formato sigue la idea de [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
es semántico: `mayor` cuando cambia un contrato (herramientas o formato del almacén), `menor` cuando se
añade capacidad, `parche` cuando se corrige un defecto.

## [1.4.1] — 2026-10-13

**Aprobar dos veces no es un fallo, y una lista no puede quedarse mintiendo.** Los dos defectos salieron de
usar el flujo: aprobó una skill con el bloque de `/skill-propuestas` delante, lo vio seguir ahí, volvió a
intentarlo y leyó `failed`.

### Corregido — el segundo intento decía «failed» donde había un acto ya hecho

- Aprobar algo que **ya está aprobado** responde `Ya estaba activa: <id>` y no mueve nada, en vez de
  «no existe una propuesta» (que el cliente pintaba como un fallo). Igual al revés: apartar algo ya
  apartado dice `Ya estaba apartada`.
- Y cuando lo que se intenta no encaja con el estado real, se dice cuál es: aprobar algo en `rejected/`, o
  apartar algo activo, explican qué pasa y por qué esa vía no se aplica.
- La misma corrección en las **dos superficies humanas**: los comandos del harness y el CLI. Una regla, una
  implementación: `locate(id, key, { root })` dice dónde está una skill ahora, y las dos la consultan.

### Añadido — el resultado de decidir trae la lista al día

- Aprobar o apartar termina con `Pendientes de tu aprobación (N)` y la lista (o «ninguna»). Así el humano ve
  el efecto de lo que acaba de hacer sin volver a ejecutar `/skill-propuestas` — que era exactamente lo que
  faltaba cuando el bloque de arriba seguía enseñando lo de antes.

### Añadido — una lista anterior a una decisión se marca, y no engaña

- El texto de un resultado es el registro de lo que pasó: no se reescribe. Lo que sí se puede saber —y es lo
  que la interfaz necesita— es que **hubo una decisión posterior**. La proyección pliega ahora `command/run`
  y `command/done` (emparejados por `commandId`, que es lo único que llevan en común) y expone
  `decisionKind` + `decisionSeq`.
- La tarjeta de `/skill-propuestas` y `/skill-ver` compara ese `seq` con el de su propio bloque: si la
  decisión es posterior, muestra una banda («Aprobaste algo después de esta lista…») y se **pliega sola**
  —sigue ahí, desplegable, pero no ocupa media pantalla describiendo un estado que ya no es—.
- `STATE_VERSION` sube a **2**. Los puntos de control de la versión anterior se descartan, y eso no pierde
  nada visible: el estado se recalcula de los eventos del log, así que la marca aparece también en las
  sesiones ya existentes.

### Medido

- **«Usable sin reiniciar», de punta a punta en el log real**: la aprobación quedó en `seq 8675` y el
  catálogo que recibió el agente en su paso siguiente, `seq 8688`, ya incluía la skill (34 skills antes,
  35 después). Es la promesa de la 1.3.0 medida por primera vez en vivo, no solo contra el registro real.
- 223 pruebas (antes 217), suite hermética en verde y `doctor` verde.
- El caso completo, reproducido contra el CLI real en una arena: la segunda aprobación responde «Ya estaba
  activa» con exit 0 y el estado no se mueve; `reject` sobre algo activo explica que esa vía no se aplica.

## [1.4.0] — 2026-10-13

**Decidir es elegir, no recordar sintaxis.** Medido con el usuario delante: `/skill-propuestas` enseñaba la
lista de pendientes y su respuesta fue *«no veo cómo seleccionar y aprobar la skill»*. El texto pedía teclear
`/skill-aprobar <id>`, y el compositor no ofrece ninguna lista pulsable para los argumentos de un comando del
host: el flujo de autorización existía, pero su superficie era una nota al pie.

### Añadido — el menú `/` como superficie de selección

- **Una fila por pendiente y verbo** (`lib/pending-rows.mjs`): leer entera, activar, apartar sin borrar. El
  nombre lleva el id (`skill-aprobar-<id>`) y la descripción el proyecto, así que la fila se lee sola.
- **Sin argumentos a propósito**: el contrato del harness ejecuta en el acto un comando del host «a secas»
  al elegirlo en el menú (`host bare → detached execute`), así que **elegir la fila es la decisión completa**.
  Y como sigue siendo un comando, también se puede teclear entero: dos formas, una implementación.
- Las filas se anuncian **cuando el harness pide el catálogo de la sesión** (el proveedor recibe el `cwd`) y
  se recomponen cuando cambia el almacén: aprobación desde aquí, CLI en otra terminal, edición a mano. Si el
  conjunto no cambió, no se re-registra nada — el menú no parpadea.
- El ámbito se comprueba **al ejecutar**, no al anunciar: una fila de otro proyecto falla diciendo de cuál
  es, en vez de aprobar en el proyecto equivocado.

### Añadido — leer antes de decidir

- `/skill-ver` (y la fila de leer) enseña el **veredicto de la puerta**: los fallos que impiden aprobar y los
  avisos que exigirán `--force`. Antes eso sólo se descubría al intentar aprobar.

### Añadido — un resultado se puede cerrar

- **La tarjeta del resultado, con una X en la esquina derecha.** Medido con el usuario delante: los bloques
  de `/skill-propuestas` y `/skill-ver` se podían colapsar, no cerrar, y se apilaban. Se registra una
  entrada **keyed** en `conversation.chat.commandview` —el slot que el nodo `command` del chat declara por
  nombre de comando—, que es la forma soportada por el contrato del cliente: sin reclamar el nodo entero
  (una clave tiene un solo ocupante) y sin tocar el DOM de nadie.
- El cierre es por **`commandId`** —dos ejecuciones del mismo comando se cierran por separado— y se
  recuerda en la sesión de la pestaña: es una preferencia de vista, no un dato, y no toca el log ni el
  almacén.
- La tarjeta es accesible: botón de verdad con `aria-label` y `title`, visible al puntero y al foco, con el
  foco dibujado; el resultado se pinta como texto, nunca como HTML.
- `@deepseek-ai/dsh-client-ui-chat` se declara en `dsh.client.inject`: es el paquete que declara el slot.

### Cambiado

- Las tres acciones (`viewProposal`, `approveProposal`, `rejectProposal`) viven en `lib/commands.mjs` y las
  usan las dos superficies: el comando con argumentos y la fila del menú. La puerta sigue siendo la misma, y
  una propuesta con avisos sigue exigiendo decirlo: la fila no aprueba nada con avisos.
- `/skill-propuestas` lista, bajo cada pendiente, los comandos exactos que la deciden.
- `lib/catalog-signal.mjs` gana `onChange`: hay cosas que dependen del almacén y no de la invalidación del
  catálogo (las filas), y el aviso tiene que llegarles igual, aunque no haya invalidación a la que avisar.
- `doctor`: 14 comprobaciones — añade la composición real de las filas del proyecto y ejecuta la puerta nueva.

### Medido

- 217 pruebas (antes 196), con la suite hermética en verde: las 8 del artefacto de interfaz cubren la
  tarjeta —registro keyed, accesibilidad de la X, memoria del cierre, texto y no HTML, y que su fallo no
  puede llevarse el registro de la píldora—, y `doctor` sigue verde con 14 comprobaciones.
- El registro de comandos devuelve el disposer exacto de cada alta y emite `commands/change` al registrar y
  al retirar: comprobado en el código que se envía y cubierto en `tests/activation.test.mjs` con un registro
  en miniatura que honra el disposer (las filas aparecen al pedir el catálogo, se retiran al aprobar, y se
  retiran al descargar el plugin).

## [1.3.0] — 2026-10-13

**Proponer, revisar, aprobar y usar: entero, dentro del harness y sin reiniciar.** Tres defectos
encadenados hacían que el último paso del flujo no existiera.

### Corregido — el campo que no estaba declarado y una respuesta que mentía

`skill_propose` devolvía `updatesProposal` en la rama `proposed`, y su esquema de salida no lo declaraba
(con `additionalProperties: false`). El validador del harness rechazaba **el resultado entero**:

```
"value.updatesProposal" is not a declared property (additionalProperties: false)
```

Y aquí está lo que hacía el daño peor: la herramienta escribe la propuesta en disco **antes** de devolver
el valor, así que el efecto sí ocurría y el modelo recibía un error — el usuario concluyó «no se ha creado
nada» cuando la propuesta estaba entera en el almacén. `skill_vendor` sí declaraba el campo: era un
esquema que se quedó atrás, no un error de concepto.

### Corregido — una skill aprobada no se podía usar hasta reiniciar

Registrábamos el proveedor de skills **ignorando la capacidad de invalidación que el registro entrega al
registrarse**. El registro de skills del harness cachea catálogos y **no tiene TTL**: sólo se limpia
cuando un provider llama a esa invalidación. Consecuencia: aprobar una skill no cambiaba nada hasta el
siguiente arranque, y el agente seguía viendo el catálogo viejo.

- El plugin **conserva esa capacidad** y avisa desde los dos sitios donde el catálogo puede cambiar: lo
  que muta su propio proceso (aprobar, rechazar) y lo que muta **fuera** (la CLI, la página de revisión,
  una edición a mano), que se detecta **vigilando el almacén** — el contrato del seam pide al provider su
  propio mecanismo de observación, y sin él «no hace falta reiniciar» sería cierto sólo para una vía.
- El agente recibe el catálogo de reemplazo en su **siguiente paso** y `/nombre` carga la skill en la
  misma sesión. Límite medido y declarado: el **menú desplegable** del compositor cachea por sesión y su
  invalidación no está en manos de un plugin; escribir el nombre funciona igual.

### Añadido — decidir desde el harness

- Cinco comandos humanos, que corren contra el agente **sin crear mensaje del modelo**:
  `/skill-propuestas`, `/skill-ver <id>`, `/skill-aprobar <id> [--force]`, `/skill-rechazar <id>` y
  `/skill-auto [activar|desactivar]`.
- Aprobar por comando aplica **la misma puerta** que la CLI (`checkProposal`, ahora en `lib/` porque una
  regla tiene que tener una sola implementación, y antes cualquier vía que no fuera la CLI era una vía sin
  puerta).
- **Modo de aprobación automática por sesión**: `/skill-auto activar` hace que las skills y los parches
  que se propongan en esa sesión se activen solos. El estado **se pliega del log de la sesión**
  (`command/run`), no de un flag en memoria: sobrevive a recargar el plugin o reiniciar la app, y deja
  rastro de quién lo activó. **No se delega la puerta**: con el modo activo, una propuesta que no pase la
  validación sigue pendiente, y un conflicto o un origen bloqueado no se aprueban.

### Añadido — puertas y diagnóstico

- `tests/output-contract.test.mjs` (23 pruebas): cada herramienta, **cada rama** de su `execute`, validada
  con `validateJsonSchemaValue` — el validador **del harness** — contra el esquema **compilado** por
  `defineTool`. Se demostró **roja** antes de arreglar: es la puerta que habría cazado el defecto.
- `tests/catalog-freshness.test.mjs` (4): contra el registro de skills **real**, y la primera prueba
  **demuestra el rojo** (sin aviso, el catálogo sigue cacheado).
- `tests/commands.test.mjs` (15) y `tests/auto-approve.test.mjs` (13): descriptor del harness, cinco
  caminos por comando, plegado del modo, y lo que no se delega.
- `doctor`: ejecuta las puertas reales en vez de reimplementarlas, y comprueba que los comandos se
  declaran. Total: **196 pruebas**.
- `@deepseek-ai/dsh-skill` entra como **dependencia de desarrollo**: es el registro real contra el que se
  mide la frescura.


## [1.2.0] — 2026-10-12

**La superficie de aprobación, sin depender del terminal.** Una página de revisión que el CLI sirve
**bajo demanda**: las propuestas pendientes con su resultado de validación y dos botones, aprobar y
rechazar.

### Añadido — revisión local

- `node bin/skill-compiler.mjs review [--port N]` sirve la página en `127.0.0.1` con un **token de un solo
  uso** que solo se imprime en la terminal. Sin él la página responde **403** y no revela ni que existe.
- La página enseña cada pendiente con su descripción, su `whenToUse`, el resultado de `check` (verde, o los
  avisos y errores concretos) y los botones de aprobar y rechazar. Aprobada la lista se actualiza.
- **La misma puerta que el terminal**: si una propuesta no pasa la validación **no hay botón de aprobar**, y
  si tiene avisos aprobar es un acto aparte («Aprobar con avisos»). La página no puede ser más permisiva
  que el comando.
- **El cliente nunca nombra una ruta**: las acciones solo aceptan un `id`, y ese `id` tiene que estar entre
  las pendientes de ese proyecto. Un `../../etc/passwd` responde 404 y no mueve nada.
- **Todo el texto dinámico se escapa**: una descripción la escribió un modelo, así que se pinta como texto.
- Sin dependencias nuevas (el `http` de Node), sin pipeline de compilación, y **nada en el camino crítico
  de las sesiones**.

### Documentado — por qué la bandeja no vive DENTRO de la aplicación

Se intentó diseñar y se descartó con el contrato delante: exponer un remoto exige `@Remote` (decoradores de
TypeScript procesados por el pipeline de `dsh-typert-protocol`), y este plugin escribe su artefacto de
navegador a mano, sin build. La proyección tampoco puede contar los pendientes —es un plegado puro de
eventos y no puede leer el almacén—, y si lo intentara mentiría en cuanto se aprobara algo por CLI, porque
la aprobación no emite ningún evento de sesión. Queda razonado en `docs/FEEDBACK-VISUAL.md`.

### Verificado

- **139 pruebas** (7 nuevas), y las de la página se hacen contra un **servidor real** en un puerto efímero,
  comprobando **el disco** —que la propuesta se movió de `proposed/` a `approved/`— y no solo la respuesta.
- Comprobado también a mano: la orden arranca, sin token responde 403, con token sirve la página y se cierra
  con el proceso.
- Aprobada `dsh-skill-library-authoring` por orden explícita del usuario; queda activa solo en el ámbito de
  `saas-corporative`.


## [1.1.2] — 2026-10-12

**El adorno visual dejaba el historial de sesiones sin cargar.** El harness respondía, al abrir el
historial de cualquier sesión:

```
Failed to load history: failed to project session "session-031083a5-…":
def.wire.viewSchema.parse is not a function
```

Es decir: no se podía abrir ninguna sesión. La causa no era el dibujo, sino **con qué esquemas se había
registrado la unidad de proyección**.

### Corregido — los esquemas del registro tienen que validar

- El plugin registraba su proyección con esquemas de **`@deepseek-ai/schemastery`**. Un esquema de
  schemastery **existe** y se resuelve llamándolo como función —`schema(valor)`—, pero **no tiene
  `parse`**. El contrato del registro de proyecciones es `ZodType`: la unidad declara `stateSchema` y
  `wire.viewSchema` y el harness los llama con `.parse(...)`.
- Lo que hizo el defecto silencioso y tardío: **`register()` no valida los esquemas que recibe.** Aceptó
  la unidad sin una queja, el plugin se activaba, las herramientas funcionaban y el fallo solo aparecía
  al **leer** una sesión —el camino que proyecta estado para el cliente—, donde ya no hay adorno que
  perder: se pierde el historial.
- Los esquemas son ahora **Zod**, y `zod` sustituye a `@deepseek-ai/schemastery` en `dependencies`
  (`^4.4.3`, el rango que declara el propio paquete del harness). Declarar la dependencia correcta no
  bastaba por sí solo; ver el punto siguiente.
- La unidad se muda de `index.js` a **`lib/projection.mjs`**, que sí se puede probar sin el harness: es
  la misma regla que gobierna el resto del plugin —lo que decide algo, en `lib/`—, y aquí decide los
  esquemas y el contrato de lectura.
- Se midió con el **registro real** y un punto de control real de la sesión que falló: antes,
  `restore(...)` lanzaba `def.wire.viewSchema.parse is not a function`; ahora proyecta.

### Añadido — la guarda que el registro no pone

- `projectionContractProblems()`: comprueba el contrato **antes** de registrar y, si la unidad no lo
  cumple, **no se registra**. Se pierde el adorno, nunca la lectura de sesiones. Comprueba que los
  esquemas validan con `parse`, que el estado inicial pasa su esquema, que un punto de control corrupto
  no lanza, que `apply` es síncrono y conserva la referencia para eventos ajenos, y que la vista es
  síncrona y valida incluso con un estado corrupto.
- El **estado** se repara (`.catch` por campo y una red final): viene del disco y `restore()` lo analiza
  sin red de seguridad, así que un dato raro se normaliza en vez de impedir abrir la sesión. La **vista**
  se exige estricta: la calcula el plugin, y un fallo ahí es un defecto que debe verse en las pruebas.

### Añadido — puertas y diagnóstico

- `tests/projection-contract.test.mjs` (8 pruebas), contra el **registro real** de proyecciones, no contra
  un doble: registra la unidad, proyecta una sesión, restaura desde un punto de control, prueba puntos de
  control corruptos y filas de otra versión, y comprueba que el guardián caza una unidad con esquemas que
  no validan. Es la puerta que habría cazado este defecto.
- `doctor` comprueba ahora **la proyección contra el registro real**: monta el registro, registra la unidad
  y proyecta (`snapshot` y lectura en frío). Antes solo compilaba las herramientas, y por eso decía `ok`
  con la proyección rota.
- `docs/DEPENDENCIAS.md` recoge la lección —«declarar no basta: el contrato»— y `docs/OPERACION.md` tiene
  una fila de diagnóstico para el síntoma exacto del historial sin cargar. Total: **132 pruebas**.


## [1.1.1] — 2026-10-12

**El plugin no se activaba al instalarlo.** Se instalaba bien —ficha, título, icono y versión correctos—
y al encenderlo el harness respondía `failed to import`. Detrás de ese error había dos defectos, y el
primero escondía al segundo.

### Corregido — la dependencia que nadie declaró

- El plugin importaba `@deepseek-ai/dsh-tools` **sin declararlo**. Funcionaba en la máquina donde se
  escribió y fallaba en cuanto se instalaba en un perfil: Node resuelve las importaciones desde la ruta
  real del módulo, y los paquetes del harness viven dentro del archivo de la aplicación. Los plugins que
  el harness trae dentro pueden importarlos porque son hermanos suyos ahí dentro; uno externo no.
- Se declaran ahora las **20 dependencias** del cierre completo, con versión exacta. No son tres: el
  propio `dsh-tools` importa en su primera línea paquetes que declara como *peers*, y el perfil de DSH
  trae `autoInstallPeers: false`, así que declarar solo las directas dejaría el plugin roto según qué
  gestor lo instalara. El cierre explícito funciona con cualquier gestor y cualquier política.
- `npm install` pasa a ser un paso **obligatorio y documentado** antes de instalar el bundle por ruta: al
  instalarse por ruta, el perfil enlaza la carpeta del repositorio, así que el plugin carga sus
  dependencias de ahí.
- Se evaluó y se descartó registrar la declaración sin `defineTool`: el registro acepta la declaración
  cruda, pero `defineTool` es quien convierte `parameters` en el esquema que ve el modelo. Habría
  funcionado con las herramientas **sin parámetros**. Queda escrito en `docs/DEPENDENCIAS.md`.

### Corregido — las herramientas que no se podían compilar

- Los esquemas de salida se construían solo al activarse el plugin, así que un esquema inválido se
  descubría instalando. Ahora `tests/harness-contracts.test.mjs` compila las cuatro definiciones con el
  **compilador real** del harness y comprueba los parámetros que el modelo verá, los obligatorios
  incluidos.

### Corregido — la activación que podía caerse sola

- El respaldo de la inyección **opcional** de la proyección podía terminar llamando a `register` sobre
  `undefined` y **lanzar dentro de `apply`**, lo que se lleva por delante la activación completa,
  herramientas incluidas. Ahora hay dos guardas: si el registro no está, se sale en silencio, y si
  rechaza la unidad, se captura. El adorno visual nunca puede costar el trabajo — que es lo que la
  documentación prometía y el código no cumplía.
- Lo encontró `tests/activation.test.mjs` en su primera ejecución.

### Añadido — puertas y diagnóstico

- `tests/harness-contracts.test.mjs` (5 pruebas): las herramientas compilan, el modelo ve los parámetros
  declarados, **toda importación de paquete está declarada como dependencia** —la regla que faltaba—, la
  familia `dsh-*` comparte una sola versión, y el cierre está instalado.
- `tests/activation.test.mjs` (4 pruebas): importa `index.js` y llama a `apply(ctx)` con un contexto
  doble, igual que hace el harness al activar el bundle, y comprueba que no lanza y que registra la
  sección, las cuatro herramientas y el proveedor. Total: **124 pruebas**.
- `node bin/skill-compiler.mjs doctor`: dice qué falta y con qué comando se arregla, y distingue «no está
  instalado» de «no se puede cargar», que son problemas distintos.
- `docs/DEPENDENCIAS.md`: el fallo contado entero, el experimento que lo aisló (enlace frente a copia),
  qué está declarado y por qué, y el procedimiento para subir versiones cuando el harness se actualice.


## [1.1.0] — 2026-10-12

Feedback visual: saber de un vistazo que el plugin está analizando, y si creó una skill **nueva** o
**actualizó** una existente.

### Añadido — interfaz

- `client.js`: artefacto de navegador que registra una píldora en `conversation.composer.dock` y lee el
  estado con `useProjection('skillCompiler')`. El `package.json` declara `dsh.client`
  (`platform: web`, `immediately: true`, `inject: ['@deepseek-ai/dsh-client-ui-conversation']`).
- **Engranaje multicolor** con degradado cónico girando despacio mientras el análisis está en marcha: la
  única animación continua, y solo porque es un indicador de carga.
- Al terminar, el resultado con su nombre: **nueva**, **actualizada**, sin cambios, no se creó, u origen
  bloqueado — y `×N` con el acumulado de la sesión cuando hubo varias.
- Iconos SVG en línea con `aria-hidden` (sin emoji), textos por el servicio de idioma con diccionarios
  `es`/`en` y reserva propia si el idioma no está, contenedor derivado de `currentColor` con `color-mix`
  (funciona en claro y en oscuro sin fijar tokens), y `prefers-reduced-motion` desactivando el movimiento.

### Añadido — estado

- `lib/presentation.mjs`: el contrato del marcador (`[skill-compiler] <resultado> <id>`) y el plegado
  `applyLearning`/`learningView` sobre eventos que **ya existen** (`tool/call`, `tool/result`, `turn/end`,
  `user/message`), sin añadir tipos de evento propios —prohibido por la guía, porque un evento
  desconocido sin marca `ignorable` impide reabrir la sesión—.
- Proyección `skillCompiler` (versión 1) registrada de forma **opcional y a prueba de fallos**: si el
  perfil no resuelve la biblioteca de esquemas, no se registra y el plugin conserva las herramientas.
- `skill_propose` y `skill_vendor` distinguen **crear** de **actualizar** (`updatesProposal`,
  `updatesApproved`), que es justo la diferencia que el usuario quiere ver.
- `tools/ico-to-png.mjs`: extrae sin recodificar la trama PNG de un `.ico` para usarla como icono (el
  harness acepta SVG, PNG, JPEG y WebP, y **no** `.ico`), avisando cuando el `.ico` es del formato
  antiguo de tramas BMP.

### Cambiado

- **Nomenclatura comercial: LifeCode Skill-Compiler** (familia de producto *LifeCode*). El nombre visible
  en la ficha del plugin es `LifeCode Skill-Compiler`; el identificador técnico sigue siendo
  `skill-compiler` —paquete, identidad del Loader, prefijo del marcador y carpeta del almacén—, porque
  renombrar algo que el arranque del perfil valida es un riesgo que no se corre antes de la primera
  instalación. Cuando la instalación esté verificada, el renombrado completo es un commit.
- El resultado de `skill_propose` y `skill_vendor` abre con la línea del marcador. Las dos herramientas de
  solo lectura (`skill_review`, `skill_upstream_check`) **no** lo llevan: no aprenden nada.
- El plegado dejó de atribuir un id a un resultado sin marcador: prefiere no decir de qué skill se trata
  antes que adivinarlo.

### Verificado

- 115 pruebas (32 nuevas), incluida la del contrato del marcador congelada contra el `render` real de las
  herramientas, y la del plegado: referencias estables, contadores, cierre de turno y retirada del
  resultado al prompt siguiente.
- Puerta de hermetismo en verde.
- Forma del artefacto de cliente comprobada: carga por `window.__ModuleLoader__`, `id` igual al paquete,
  slot existente, un solo `role="status"`, movimiento reducido presente, **cero emoji** y sin tocar
  `document.body`.
- `tests/client-artifact.test.mjs` (10 pruebas) convierte esa comprobación en puerta permanente, e incluye
  la regla de contraste que impide volver a pintar el texto con el acento. Se escribió **después** de que
  el propio artefacto incumpliera una de sus reglas: el acento `#b91c1c` del estado bloqueado se quedaba en
  2.93:1 sobre fondo oscuro, por debajo del 3:1 que se exige a un gráfico.

### No verificado, y se dice

- **El dibujo.** No hay control de navegador en este puesto: que la píldora se vea bien solo se comprueba
  instalando el plugin y mirándola. Lo verificado es que está construida según las reglas de diseño, no
  que el resultado guste.


## [1.0.0] — 2026-10-12

Primera versión funcional y probada de `skill-compiler`.

### Añadido — aprendizaje progresivo

- Protocolo estático en el prompt vía `ctx.systemPrompt.section()` (orden 9000, `interpolate: false`):
  entra una vez y no rompe el prompt caching.
- Herramienta `skill_propose`: convierte conocimiento propio en una skill **propuesta**.
- Herramienta `skill_review`: lectura de pendientes y aprobadas del proyecto actual. No aprueba nada.
- Proveedor de skills (`ctx.skills.registerProvider`) con rango 150: sirve **solo** las aprobadas del
  proyecto actual, de modo que una skill no se cargue en el lugar equivocado.
- Ámbito derivado del `cwd` de la sesión; el modelo no lo declara.

### Añadido — vendorizado

- Herramienta `skill_vendor`: crea **nuestra versión** de una skill publicada en un repositorio ajeno,
  guardando el original **verbatim** con su SHA-256 y una `provenance.json` auditable.
- Herramienta `skill_upstream_check`: informa de si el origen cambió, sin tocar nuestra versión.
- Resolución de enlaces: `.md` servido por https, `blob`/`tree` de GitHub, raíz de repositorio y API de
  contenidos. Solo `https`; solo markdown (hasta 10 `references/*.md`); techo de 512 KB y timeout de 15 s.
- `needs-choice` cuando el enlace apunta a una carpeta con varias skills: elige el humano, no la
  herramienta.
- Análisis del contenido ajeno con **bloqueo** (no aviso) ante credenciales, órdenes dirigidas al agente,
  tuberías a shell, escalada de privilegios y caracteres invisibles. Un bloqueo no escribe nada.
- Adaptación: frontmatter del contrato DSH, descripción acotada a lo que el modelo puede leer, título
  normalizado, referencias reescritas a `upstream/references/`, avisos de lo omitido y banner que declara
  que la copia local **no es la fuente autoritativa**.

### Añadido — operación y control

- CLI: `where`, `list`, `show`, `check`, `approve`, `reject`, `active`, `vendor`, `upstream`,
  `provenance`. **Aprobar es un acto humano**: no existe como herramienta del modelo.
- Puerta `check` antes de aprobar, y `--force` solo para avisos: nunca para un fallo.
- Idempotencia de la propuesta (reescritura atómica sin restos), supersesión de la versión anterior al
  aprobar una actualización, y rechazo sin borrado.
- Documentación: `docs/FUNCIONAMIENTO.md`, `docs/CONFIANZA.md`, `docs/OPERACION.md`,
  `docs/DESARROLLO.md`.

### Añadido — licencia

- **MIT** (Copyright (c) 2026 designerbyron): uso, modificación, redistribución y uso comercial libres,
  conservando el aviso de copyright. Texto estándar sin añadidos, para que GitHub y las herramientas de
  cumplimiento la reconozcan.
- La referencia al repositorio original queda como **petición destacada** en el README, declarada como
  tal: MIT no la exige, y ponerla en el `LICENSE` la habría sacado del estándar.

### Verificado

- 83 pruebas automáticas, todas en caja de arena, con `fetch` falso inyectado para el vendorizado.
- Puerta de hermetismo: huella del almacén real idéntica antes y después de la suite.
- Cadena completa contra la red real, 15/15: resolver → descargar → adaptar → proponer → aprobar →
  servir, con el original verbatim comprobado y el origen sin cambios.
- Propuesta real contra la biblioteca curada del puesto (25 skills): sin solapamiento.

### Añadido — identidad visual

- `skill-compiler/icon.png` (192×192, 56 KiB — muy por debajo del límite de 256 KiB que valida el
  manifiesto) declarado como `icon` de primer nivel en `package.json`, con ruta relativa al manifiesto.
- `assets/poster.png` en la raíz, mostrado en las portadas del repositorio y del plugin. Un solo
  fichero, dos referencias: los binarios no se duplican.
- El engranaje de la interfaz pasa a los **tonos de la marca** (cian → azul → violeta → magenta, tomados
  del póster). Se retira el ámbar que llevaba: no existe en la identidad.

### Corregido antes de la primera publicación

Ninguno de estos llegó a publicarse; se listan porque el historial de un defecto vale tanto como el
código que lo arregla.

- `bytes` contaba caracteres, no bytes UTF-8: un `’` multibyte hacía que la cuenta no cuadrara con el
  original guardado.
- Un `\b` mal colocado impedía detectar `exfiltrate the .env` en el análisis de contenido ajeno.
- La reescritura de referencias no reconocía las comillas invertidas, así que en la práctica no
  reescribía ninguna ruta de markdown.
- Las carpetas omitidas del origen (como `scripts/`) no se declaraban.
- Los avisos de una propuesta se calculaban y no llegaban al resumen (un aviso que no se lee no es un
  aviso), y la rama de conflicto devolvía la lista de colisiones vacía.
- Dos pruebas escribían en el almacén real por pasar `root: undefined`. Se cerró de raíz: `sandbox()`
  redirige `DSH_HOME` y `check-hermetic.mjs` lo **mide**.
- El mensaje de la CLI que indica cómo aprobar llevaba la ruta del repositorio incrustada, y se quedó
  obsoleta al mover el proyecto. Ahora el CLI **deriva su propia ruta** en tiempo de ejecución: una
  instrucción de aprobación que no funciona es peor que no darla.

### Pendiente

- **Instalación del bundle** en el perfil (no realizada todavía).
- **Primer `git push`**: el remoto está configurado, el envío no se ha ejecutado.
- Consolidación de las skills silenciadas de la biblioteca curada (fuera de este plugin).
