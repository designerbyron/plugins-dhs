# Checkpoint · Skill-Compiler v4.0.0 (i18n ES/EN) — actualizado 2026-10-23

Estado reproducible para retomar sin releer la sesion. Todo lo que sigue esta medido sobre este arbol.

## SHA y rama

- HEAD de codigo al cerrar el grupo 5: **`98ca50f`** (F1.2 grupo 4) mas el commit del grupo 5. Antes: `4a240c9` (F1.2 grupo 3), `4f3a0d3` (grupo 2), `1a4b170` (grupo 1), `f9b8421` (F1.3), `eb9bbb4` (PROTOCOL).
- Este documento se versiona en el mismo commit que el codigo (en esta sesion, sin push).
- Rama `main`, remoto `designerbyron/plugins-dsh`, arbol limpio, divergencia **0/0**.
- Version declarada: **3.9.3**. Sin tag `v4.0.0`: no se publica hasta cerrar F1.1-menu, F2, F3 y F4.

## Fases

| Fase | Estado | Que hay |
|---|---|---|
| F0 | cerrada | `lib/i18n/{index,es,en}.mjs`, resolucion `DSH_LANG` -> `config.json` -> `en`, `lang` en CLI, `doctor` con idioma y fuente |
| **F1.1** | **cerrada** | menu medido en el anfitrion instalado (no puede filtrar alias: descriptor de lista cerrada); `aliasProblems`/`aliasSummary`, linea de `doctor` con las 31 filas, `docs/ANFITRION.md`; 9 casos. **Filas visibles no verificadas** |
| **F1.3** | **cerrada** | superficie completa congelada + texto visible al modelo en ASCII puro |
| **F1.2** | **cerrada (grupos 1-5)** | 566 claves por idioma hoy (527 al cerrar el grupo 5). Grupo 5: toda la prosa de `bin/` + diagnosticos de `scope.mjs` |
| **F1.4** | **cerrada** | cobertura medida por comando (31, dos idiomas) y por CLI (base `en` sin `DSH_LANG`); 9 casos |
| F1.5 | cerrada | `docs/ANFITRION.md`: fallback de prosa en 4.0.0-4.1.x, retirada en **4.2.0** |
| **F2** | **cerrada** | `items` por elemento en el productor y panel que lo prefiere; prosa como reserva (ya en los dos idiomas); 10 casos. Limite medido: el anfitrion recorta el resultado |
| **F3** | **cerrada** | `tools/gates-obligatorios.mjs` obligatorio por `pretest` y por `test:hermetic`; 10 casos negativos sobre copias |
| F4 | no iniciada | version, CHANGELOG, README, gates, tag y release |

## Lo que cerro F1.3, con su evidencia

- **Inventario medido, no supuesto**: 4 herramientas registradas (`ctx.tools.register(defineTool(...))`
  contadas en `index.js`: propose, vendor, review, upstream_check), **16 comandos**, **15 alias**, un
  proveedor (rango 150) y una seccion estatica del prompt (orden 9000, tope 1.200 caracteres, presupuesto
  de trabajo 950). El manifiesto declara las cuatro capas y la prueba lee `index.js` para compararlas.
- `tests/fixtures/definitions-contract.json` (23.099 B): por herramienta `params`, `params_arbol`
  (anidados con sus obligatorios), `output_estructura` **sin texto**, `texto_obligatorio` (35 rutas en
  `skill_propose`, 13 en `skill_vendor`, 2 en `skill_upstream_check`, 1 en `skill_review`) y `contrato`
  (permisos, solo_lectura, aprueba, atajo_de_seguridad, confirmacion, status_permitidos, efectos,
  restricciones, seguridad).
- Lo que **no** se declara de boquilla: las herramientas de solo lectura se ejecutan y se compara la huella
  SHA-256 del almacen antes y despues; las de escritura tienen que moverlo; ningun parametro se llama
  force/skip/bypass/override; un origen con secreto sigue devolviendo `blocked`; y los estados declarados
  tienen que estar dichos en la descripcion de `status`.
- Texto visible al modelo: **10 caracteres no ASCII** (9 U+2014, 1 U+2026) en 8 rutas, todas de
  `skill_propose`. Sustituidos por ASCII sin cambiar el significado; el ejemplo en español que viajaba en la
  descripcion de `references` pasa a ingles. ROJO antes (8 rutas nombradas), verde despues.
- Linea base ASCII: **8.624 -> 8.614**; `definitions.mjs` 273 -> 263.

## Lo que cerro F1.2 grupo 1

- `lib/commands.mjs` 757 -> 708 caracteres no ASCII; catalogo 34 -> **74 claves por idioma**.
- `NO_SCOPE` era `const` evaluada al importar: pasa a funcion `noScope()`, porque el idioma se resuelve en
  cada llamada (12 usos actualizados).
- El ingles nuevo es **ASCII puro** (sin `·` ni comillas tipograficas): el total no crece aunque el texto
  español se mude al catalogo. Total 8.614 -> 8.614 (solo cambia de fichero).
- Las aserciones de prosa **no se reescriben**: los seis ficheros que las contienen fijan
  `process.env.DSH_LANG = 'es'`. Dejan de probar «el idioma que toque» y pasan a probar la traduccion
  española. El idioma base se prueba aparte, en `tests/i18n-comandos.test.mjs`.

## Lo que cerro F1.2 grupo 2 (approve / publish / scope)

- `approveProposal` entero (seis negativas y exito), `aprobarLote`, el handler de `/skill-approve` (pregunta
  de lote, pregunta de ambito, nota final), `/skill-publish` y `/skill-scope`, con sus tres descripciones.
- Catalogo **74 -> 131 claves**. `commands.mjs` 708 -> 645; `es.mjs` 81 -> 144: el mismo texto movido, total
  ASCII **8.614 sin crecer**.
- No se movieron los `code` (el panel decide por ellos) ni las lineas del lote (`ok`/`FALLO` + `—`), que la
  tarjeta parsea con `/^FALLO\s+(\S+)\s+—/`: son marcadores tecnicos, no presentacion.
- **Defecto real encontrado**: `/skill-scope` llamaba a `ambito()` sin importarlo y el `guarded` lo convertia
  en «No se pudo completar: ambito is not defined». El comando nunca funciono desde la sesion y ninguna
  prueba lo ejercitaba (`ambito.test.mjs` prueba el motor, no el comando). Arreglado y cubierto.
- Los ficheros que afirman prosa española fijan `DSH_LANG='es'`; los dos casos de `cli-integracion` que miden
  el idioma por defecto borran la variable y la restauran.

## Mediciones reales de este arbol

```
npm test                 -> 725/725 (176 suites)
npm run test:hermetic    -> hermetico (huella del almacen identica antes y despues)
node tools/i18n-gate.mjs -> en orden (527 claves por idioma · 15 alias)
node tools/ascii-gate.mjs-> 8.120 caracteres heredados, tope 8.120 (ninguno nuevo)
node --test tests/definitions-schema.test.mjs -> 18/18
```

## Proximo paso exacto (en orden)

1. **F1.1 · menu real**: localizar en el harness el punto de registro/presentacion de comandos; si no
   filtra `aliasOf`, filtrar ahi. Anotar que parte se verifico y cual no.
2. **F2**: pruebas por idioma del panel (claves 78/78) y reserva `en`.
3. **F3**: la deuda de diagnosticos que queda (ver «Limites» del grupo 5): `auto`/`textoDeMedidas`,
   `motivoDeIdInseguro`, `r.reason` y `estadoLegible` de `audit`.
4. **F4**: version 4.0.0, CHANGELOG (>500 caracteres), README (version + recuento de pruebas desde el
   binario), gates, tag y release, verificando `gh release view --json isDraft,isPrerelease,tagName`.

## Trampas ya pagadas (no repetirlas)

- `git commit -m` con backticks: bash los interpreta. Usar **`-F fichero`**.
- Los ficheros de `lib/` y `tests/` estan en **CRLF**: un ancla multilinea escrita con `\n` no casa. Adaptar
  el ancla (`replace(/\n/g, '\r\n')`) y escribir de vuelta con el mismo fin de linea.
- Las **lineas en blanco al final** de un `.md` rompen `git diff --cached --check`: recortarlas.
- `node -e` con caracteres no ASCII en la linea de comandos se corrompe en este shell: escribir un `.mjs` y
  ejecutarlo con `node fichero`.
- `write_file` sobre un fichero leido con paginacion: releer completo o `rm` + escribir.
- `skillCommands({})` usa el almacen **real**: en pruebas, pasar `{ root: arena.root }`.
- Una constante de modulo con texto traducible congela el idioma del arranque: usar funcion.
- El catalogo ingles tambien cuenta para `ascii-gate`: no meterle tipografia.

## Lo que cerro F1.2 grupo 3 (reject / disable / enable / retire / retired)

- `rejectProposal` entero, los cuatro handlers del ciclo de vida y las cinco descripciones del menu.
  Catalogo: 131 -> 167 claves por idioma.
- No cambiaron los `code` (`set-aside`, `already-set-aside`, `disabled`, `enabled`, `retired`), ni el
  requisito de `--yes` para retirar, ni el respaldo fechado con su huella, ni la anotacion del diario.
- La fila de `/skill-retired` es UNA clave con el estado traducido aparte: dos claves con su propio
  separador duplicaban la tipografia y habrian subido la linea base ASCII en dos caracteres.
- Total ASCII **8.614, sin crecer** (`commands.mjs` 645 -> 617, `es.mjs` 144 -> 172: el mismo texto movido).
- `tests/i18n-comandos-grupo3.test.mjs`: 7 casos por idioma y por efecto. Suite 700 -> 707.
- Siguiente: **grupo 4** (ownership / systems / auto, cuya prosa vive en `lib/scope.mjs`) y **grupo 5**
  (mensajes humanos de `bin/`); despues F1.1-menu, F1.4, F2, F3 y F4.

## Grupo 4 (ownership / systems / auto): cerrado

Base al entrar: `1fbe4c6`, arbol limpio, version 3.9.3, 167 claves por idioma, ASCII 8.614, suite 707/707.
Todo lo que sigue esta medido despues de la migracion.

### Que se migro

- `lib/scope.mjs`: `PROPIEDADES` era una constante evaluada al importar (congelaba el idioma). Pasa a
  `propiedadEnTexto(owner)`, que resuelve con `t()` en **cada lectura**. Consumidores ajustados sin cambiar
  semantica: `textoDelEstado`, `declararLaPropiedad` (commands.mjs) y el `ownership` del CLI.
- `textoDeLaPregunta`, `textoDelEstado` y `textoDeSistemas` migrados con claves `scope.*`. Firmas intactas
  (`textoDelEstado(estado)`, `textoDeSistemas({ datos, estado })`): `/skill-systems` y `systems` siguen
  imprimiendo el mismo texto porque la traduccion entra por dentro, no por parametro.
- `lib/commands.mjs`: descripciones de `/skill-ownership`, sus dos filas de un clic y `/skill-systems`; el
  resultado de declarar; y el handler de `/skill-auto` (descripcion, informe sin argumento, activado,
  desactivado).
- **No** se tocaron los tokens de contrato: `activar`/`desactivar`, `ESTADOS_PROPIEDAD`, `SOLO_DSH`
  (`dsh-only`), `MAQUINA` (`machine`), los `code` ni los nombres de comando. El texto nuevo es ASCII puro en
  los dos idiomas; los separadores tipograficos (`·`, `—`, `«»`, `↔`) pasaron a guion, comillas rectas y ` / `.

### Mediciones

- Catalogo: 167 -> **237 claves por idioma** (70 nuevas, mismas claves y placeholders).
- ASCII: 8.614 -> **8.513** (`commands.mjs` 617 -> 583, `scope.mjs` 639 -> 572); la linea base se actualizo
  al total nuevo y ningun fichero crecio.
- `tests/i18n-comandos-grupo4.test.mjs`: 9 casos. Suite 707 -> **716/716**; hermetico en verde.
- `DSH_LANG=es` fijado en `scope.test.mjs`, `scope-concurrencia.test.mjs` y `auto-approve.test.mjs`; las
  aserciones con tilde se ajustaron a la prosa ASCII (no se debilito ninguna).

### Defectos conocidos, medidos y NO tocados en este grupo

- Los `motivo`/`reason` de `lib/scope.mjs` (`leerPropiedad`, `declararPropiedad`, `inventario`) siguen en
  espanol y se interpolan dentro del marco ya traducido: en ingles se lee `State: undeclared (nadie ha
  respondido).` Son datos de diagnostico, no prosa de presentacion; migrarlos obliga a cambiar
  `estado.motivo` y las aserciones de `scope.test.mjs`. Va con el grupo 5 / F4.
- El prefijo de los alias (`Alias obsoleto de /X: se retira en 5.0.0.`) sigue en espanol en los dos idiomas;
  `tests/f1-contrato.test.mjs` lo fija como contrato.

### Siguiente

Grupo 5 (cerrado abajo): mensajes humanos de `bin/skill-compiler.mjs`, diagnosticos de `scope.mjs` y ASCII del
catalogo espanol. Despues F1.1-menu, F1.4, F2, F3 y F4.

## Grupo 5 (CLI y diagnosticos mezclados): cerrado

Base al entrar: `98ca50f`, arbol limpio, version 3.9.3, 237 claves por idioma, ASCII 8.513, suite 716/716.

### Que se migro

- `bin/skill-compiler.mjs`: **toda** la prosa humana (267 llamadas a `tr()`), no una parte: ayuda y uso,
  errores de argumento y de opcion, `lang`, `doctor` entero, `where`, `list`, `show`, `check`, `approve`
  (incluido el lote), `scope`, `disable`, `enable`, `delete`, `retired`, `restore`, `reject`, `active`,
  `vendor`, `upstream`, `provenance`, `ownership`, `security`, `auto`, `audit`, `repair`, `promote`,
  `history` y `review`.
- **La ayuda deja de ser un comentario.** Vivia en la cabecera del fichero y se imprimia leyendo el propio
  fichero (`split('*/')[0]`): una sola version, en espanol, y `--help` no podia traducirse. Ahora es la tabla
  `AYUDA` (sintaxis = dato; descripcion = clave `cli.help.*`) y `usage()` la pinta. `tests/coherencia.test.mjs`
  compara esa tabla con los `case` implementados: el contrato (ni un comando de mas ni uno de menos) sigue
  igual, con otra fuente.
- Los nombres de comando, flags, `code`, rutas, claves de proyecto, ids y contadores **no** se traducen: son
  datos. El codigo de salida es el mismo en los dos idiomas y esta probado comando a comando.
- `bin` 722 -> **524** caracteres no ASCII. Lo que queda son **comentarios de mantenimiento** (el espanol del
  proyecto), no prosa de usuario: no se reescribieron para no convertir un commit de i18n en 60 lineas de
  comentario retocado.

### El defecto que este grupo cierra (diagnosticos mezclados)

- `lib/scope.mjs` interpolaba `estado.motivo` (dato en espanol) dentro de un marco ya traducido: en ingles se
  leia `State: undeclared (nadie ha respondido).`
- Ahora hay dos tablas de **representacion**, no de datos: `ESTADOS_EN_TEXTO` y `MOTIVOS_EN_TEXTO` (patron +
  clave + como sacar los parametros). `estadoEnTexto()` y `motivoEnTexto()` se aplican en los cinco puntos de
  presentacion (`scope.state.undeclared`, `scope.state.line`, `scope.systems.row-detail`,
  `scope.systems.ownership-state`, `scope.systems.incomplete-row`) y en `doctor`.
- **El dato no cambia**: `estado.estado` y `estado.motivo` siguen siendo los de siempre, con la misma forma y
  las mismas pruebas de `scope.test.mjs`, y un motivo sin clave se pinta tal cual. Los patrones llevan las
  tildes escapadas (`\u00xx`) para casar con el dato sin meter no ASCII en el fichero.
- El detalle del motivo (codigo de error, ruta, cuenta) viaja como parametro y **no** se toca:
  `fuera del ambito autorizado (C:/otro/sitio)` -> `outside the authorised scope (C:/otro/sitio)`.
- `doctor` pasa de `propiedad del puesto: AUSENTE (nadie ha respondido)` a
  `machine ownership: ABSENT (nobody has answered)`.

### ASCII del catalogo espanol (grupos 1-3)

- `lib/i18n/es.mjs` 172 -> **0**: las 88 claves con tilde de los grupos 1-3 pasaron a espanol ASCII por
  bloques (idioma, `code.*`, listar/ver, aprobar/publicar/ambito, ciclo de vida), conservando el significado:
  `«»` -> `"`, `·` -> `-`, `—` -> `-`, `→` -> `->`, tildes fuera y las interrogativas reescritas en imperativo
  (`¿Dónde quieres que viva...?` -> `Dime donde quieres que viva...`) para no perder el signo de apertura.
- `lib/i18n/en.mjs` 23 -> **0**: las nueve claves inglesas que aun llevaban `«»`/`—` (todas de `lang.*` y
  `code.*`) pasaron a comillas rectas y guion.
- Las pruebas que afirman esa prosa **se ajustaron, no se borraron** (`commands`, `activation`,
  `aprendizaje-en-lote`, `cli-integracion`, `scope-concurrencia`, `client-artifact`, `i18n-comandos`,
  `update-real.e2e`), y el control cruzado de `i18n-comandos` usa el texto ASCII real: con la cadena vieja
  habria pasado por no encontrarla.

### Defecto real encontrado: el marcador del panel

- `client.js` reconocia la pregunta del ambito por su prosa (`SCOPE_ASK = '¿Dónde quieres que viva'`). Con el
  texto nuevo el marcador no casaba, y con el ingles no habria casado nunca. Ahora manda el `code` del
  contrato (`scope-ask`) y la prosa queda como reserva; `client-artifact` lo prueba por los dos lados.

### Mediciones

- Catalogo: 237 -> **527 claves por idioma** (290 nuevas: `cli.*`, `scope.estado.*`, `scope.motivo.*`).
- ASCII: 8.513 -> **8.120** (`es.mjs` 172->0, `en.mjs` 23->0, `bin` 722->524; `scope.mjs` 572->572 y
  `client.js` 906->906, ninguno crece). Linea base reescrita al total nuevo.
- Suite: 716 -> **725/725**, con `tests/i18n-cli-grupo5.test.mjs` (9 casos: ayuda, opcion desconocida,
  `where`/`list`/`retired`/`active`/`provenance`, `lang`, `doctor` en los dos idiomas, las tablas de
  representacion y una declaracion de propiedad rota de verdad en disco).
- Hermetico en verde; `definitions-schema` 18/18; `i18n-gate` 527 claves; `ascii-gate` 8.120.

### Limites que este grupo NO cierra (medidos)

- **`auto` y las medidas de actualizacion**: el CLI sigue imprimiendo `textoDeMedidas()` de
  `lib/auto-update.mjs` en espanol (`regla`, `observado`, `umbral`, `detalle`, `resumen`). Son diagnosticos
  como los `motivo` de `scope.mjs`, pero de otro modulo: migrarlos pide su propia tabla y toca tambien
  `promote` y el `cmd.list.auto-*` del listado.
- **`motivoDeIdInseguro`** (`lib/security.mjs`) viaja como parametro `{motivo}` dentro de `cmd.ids.unsafe`:
  mismo caso, otro modulo.
- **`r.reason`** de `repair` y de `declararPropiedad` se imprime tal cual: es dato de retorno de otro modulo.
- **`estadoLegible`** de `lib/audit.mjs` sale en la fila de detalle de `audit` en espanol.
- **El prefijo de los alias** (`Alias obsoleto de /X: se retira en 5.0.0.`) sigue en espanol en los dos
  idiomas; `tests/f1-contrato.test.mjs` lo fija como contrato.
- Los comentarios de `bin/skill-compiler.mjs` siguen en espanol con tildes: no son prosa de usuario.

### Trampas nuevas (pagadas aqui)

- Para tocar ~120 mensajes se uso un script `.py` con anclas exactas y **conteo por ancla**: si una ancla no
  casa exactamente una vez, el script no escribe nada y dice cual fallo. Nada de sustituciones globales.
- El primer argumento del CLI **no** pasa por el parser de opciones (`command = argv[0]`): `--lo-que-sea`
  como primer argumento cae en `usage(2)`, no en «opcion desconocida». Se prueba con `list --lo-que-sea`.
## Desviacion registrada: los dos commits del encargo anterior SI se empujaron

- El encargo anterior pedia **commit local sin push**. Se empujaron `efc49ca` y `b33139b` a `origin/main`
  con la autorizacion general vigente. Queda escrito aqui y no se toca nada mas: `main` no se reescribe, no
  se revierte ningun commit y las etiquetas siguen donde estaban. Divergencia con el remoto: **0/0**.
- Dicho sin adorno: aquel acto se ejecuto con push habilitado en vez de retenido. La consecuencia es que la
  historia publicada lleva dos commits que el encargo queria locales.

## `doctor` en cuatro arenas: reproduccion con exit real

Medido con el binario (`node bin/skill-compiler.mjs doctor`), `DSH_HOME` en la arena, `cwd` en su raiz y
`stdio: ['ignore','pipe','pipe']` (un CLI con stdin no-tty sale != 0 sin haber medido nada):

| Arena | Linea de la capa de seguridad | exit |
|---|---|---|
| sin `projects/` | `ok  capa de seguridad: nada que revisar todavia (no existe <arena>/projects: el almacen aun no tiene proyectos)` | **0** |
| `projects/` vacio | `ok  capa de seguridad: 0 skills revisadas - 0 bloqueo(s) - 0 aviso(s)` | **0** |
| `projects` es un FICHERO | `FALLA  capa de seguridad: no se pudo leer <arena>/projects (ENOTDIR)` | **1** |
| `proposed/<clave>` es un FICHERO | `FALLA  capa de seguridad: no se pudo revisar (proposed/<clave>: ENOTDIR)` | **1** |

## La correccion, en la raiz

- `leerProyectosDelAlmacen()` devuelve `{estado, proyectos, ruta, codigo, motivo}` y **solo `ENOENT` es
  `inexistente`** («todavia no hay»); cualquier otro error —`EACCES`, `ENOTDIR`— es `ilegible` y sigue
  siendo fallo, con su codigo del sistema y su remedio. La misma regla vale para las carpetas de estado, asi
  que `proposed` convertido en fichero **no** se lee como «no hay nada».
- La frase de cada caso vive en el catalogo (`cli.doctor.security-empty` / `cli.doctor.security-unreadable`),
  y `doctor` sigue midiendo el proyecto del `cwd`.

## Regresion

- `tests/doctor-almacen.test.mjs` (4 casos, rojo antes del arreglo): sin carpeta de almacen, sin `projects/`,
  `projects/` vacio y `projects` como fichero. Mide el **binario** —salida y exit— y no una funcion del motor,
  y exige que el caso ilegible nombre el codigo real y el remedio.

## Deudas cerradas en `efc49ca` (6)

1. `textoDeMedidas` de `lib/auto-update.mjs` -> catalogo `cli.auto.*` (el marco; los valores siguen siendo datos).
2. Prefijo de los alias -> `cmd.alias.deprecated`, con la version de retirada como dato.
3. `motivoDeIdInseguro` -> `diagnosticoDeId` + `id.reason.*`; el valor del dato no cambia.
4. `reason` de `repair` -> `reasonCode`/`reasonParams` + `cli.repair.reason.*`.
5. `estadoLegible` de `audit` -> `cli.audit.state.*` (el campo sigue igual).
6. Comentarios de `bin/` a ASCII puro (no son prosa de usuario) y `f1-contrato` midiendo metadatos.

## Deudas que SIGUEN (medidas, no tocadas)

- Las **medidas** de la auto-actualizacion: `regla`, `observado` y `umbral` siguen siendo cadenas del motor
  en espanol dentro de un marco ya traducido (`lib/auto-update.mjs` lineas 70-71, 145, 152 y 159-167).
  Traducirlas es cambiar el DATO, no el texto: pide su tabla de representacion, como se hizo con `scope.mjs`.
- El **motivo de bloqueo de `repair`**: `sinReparacion[].motivo` es prosa literal del motor
  (`lib/repair.mjs` lineas 390, 394 y 413) y se imprime tal cual en los dos idiomas.
## F1.1 · alias y menu: cerrado con lo que se pudo medir

### Lo que el harness instalado hace (medido, no deducido)

| Capa | Artefacto | Que hace |
|---|---|---|
| Registro | `@deepseek-ai/dsh-commands/lib/index.js` (`normalizeDefinition`) | valida nombre, descripcion no vacia, handler funcion e `input.hint`; guarda la `definition` con `recordInput`/`definitionId` y publica un `descriptor` de **lista cerrada**: `{definitionId?, name, description, input?}` |
| Despacho | mismo paquete, `execute(agent, line, ...)` | parte la linea por el primer espacio, busca el nombre en la capa fusionada, anota `command/run` (con `args`, salvo `recordInput: false`), llama al handler y sella `command/done`; un handler que lanza o se cancela cierra como `error` |
| Menu `/` | `@deepseek-ai/dsh-client-ui-commands/lib/client.js` (`candidates`) | `ctx.remote.commands.list(sessionId)` -> una fila por descriptor con `name` + `description` + `input.hint`; oculta solo las filas con `hint` cuando el cursor no esta al principio de la linea; consulta vacia -> secciones Add/Commands, consulta escrita -> `rankByName` |

- **No interpreta `aliasOf` ni `deprecatedIn`**: ninguno de esos dos nombres aparece en el `app.asar` (barrido de
  los ~18.300 ficheros: 0 coincidencias), y el descriptor no los lleva porque se pierden en
  `normalizeDefinition`.
- Por tanto **no hay punto de integracion donde filtrar sin perder la invocabilidad**: el menu compone lo que
  esta registrado y `execute` resuelve por nombre, asi que no registrar un alias lo deja sin despacho. No se
  invento ninguna API para simular un filtro que el anfitrion no tiene.

### Lo que se implemento

- `ALIAS_ESPERADOS` y `RETIRADA_DE_ALIAS` pasan del ambito de `skillCommands` al del modulo y se exportan: el
  dato se puede medir desde `doctor` y desde las pruebas.
- `aliasProblems(definiciones, esperados)` mide: destino inexistente, alias ausente, `aliasOf` que apunta a otro
  sitio, `deprecatedIn` que no es version, handler que no es funcion, descripcion vacia, alias fuera de la tabla,
  nombre duplicado y alias de si mismo. Cierra el defecto silencioso del `continue`.
- `aliasSummary(definiciones)` cuenta canonicos, alias y filas del menu.
- `doctor` gana una linea de alias: `los alias estan declarados y son coherentes: 15 de 31 filas del menu (16
  canonicos); el harness no filtra por metadatos...`. Cuenta, no presume.
- `docs/ANFITRION.md`: seccion nueva con la composicion del menu y su consecuencia, y su fila en la tabla de
  capacidades medidas.

### Pruebas nuevas

`tests/alias-menu.test.mjs` (9 casos): los 15 alias existen con metadatos coherentes; cada alias **invocado de
verdad** devuelve el mismo `kind` y el mismo `code` que su canonico (dos arenas distintas); las definiciones
reales no tienen ningun problema y el menu anuncia 31 filas; los rechazos de `aliasProblems`; `doctor` con el
recuento, en los dos idiomas. Suite **730 -> 739**.

### Lo que NO se pudo observar desde aqui

- **Las filas visibles del menu**: en este entorno no hay navegador ni sesion interactiva, asi que no se vio el
  menu pintado. Lo comprobado es el registro (descriptores reales), el despacho (`execute` sobre la linea), los
  metadatos y la invocabilidad por handler; lo no comprobado es el pixel. No se afirma.
## F1.4 · cobertura ES/EN: cerrada por comando y por CLI

Los grupos 1-5 migraron el texto. F1.4 cierra la **cobertura**: que no quede un camino sin medir en los dos
idiomas. Todo lo que sigue se ejecuta, comando a comando y binario a binario.

### Lo que se midio

- **Idioma base sin `DSH_LANG`**: `resolveLang({fresh:true})` -> `{lang: 'en', source: 'default'}`, y el binario
  contesta `No learned skills yet (...)`. Con `DSH_LANG=es` el mismo `list` contesta `Sin skills aprendidas
  todavia (...)` y el ingles no aparece. Los dos con exit 0.
- **Los 31 comandos** (16 canonicos + 15 alias): mismo `kind`, mismo `code` y mismos `params` en los dos idiomas,
  cada idioma en su arena. El texto cambia en **20 o mas** de los 31 (los que devuelven solo datos, como la
  linea de ids, no cambian de texto y eso tambien es correcto).
- **Avisos**: cuerpo por encima del umbral -> `with-warnings` con `params.id` igual en los dos, y el texto
  traducido de verdad (`warnings` / `avisos`).
- **Lote parcial**: mismo `kind: error` y los marcadores `ok    <id>` / `FALLO <id>` intactos en los dos
  idiomas —son protocolo que el panel parsea, no prosa— y el bueno del lote sale de `proposed` en los dos casos.
- **Neutros**: `scope-ask` en singular y en lote sin ambito, `pending-list` en la linea de ids. `/skill-proposals`
  **no** emite `code` a proposito (es una lista, no un veredicto): queda fijado en la prueba para que no cambie
  sin decidirlo.
- **Id inseguro**: `unsafe-id` con el mismo `params.id` y un `params.motivo` no vacio en los dos idiomas.
- **Sin claves crudas ni placeholders**: los 31 comandos, con y sin argumento, en los dos idiomas: cero
  resultados con forma de clave de catalogo y cero `{param}` sin sustituir.
- **Catalogos completos**: `clavesFaltantes('en')` y `clavesFaltantes('es')` vacios.

### Pruebas nuevas

`tests/i18n-cobertura.test.mjs` (9 casos). Suite **739 -> 748**.

### Lo que sigue abierto en idioma (declarado, no arreglado)

- `regla`/`observado`/`umbral` de la auto-actualizacion y el motivo de bloqueo de `repair`: siguen siendo datos
  del motor en espanol (ver la seccion de deudas). No es cobertura de comandos: es representacion de un dato, y
  pide su propia tabla.
## F2 · contrato estructurado por elemento: cerrado, con su limite medido

### Lo que cambio, en los dos lados a la vez

- **Productor** (`lib/commands.mjs`, `aprobarLote`): cada elemento del lote lleva ahora su veredicto como DATO.
  `items: [{id, kind, code, state, params, text}]`, con `state` traducido del `code` por la tabla
  `ESTADO_DE_CODIGO` (`activated` -> `approved`, `already-active` -> `approved`, `updated-disabled` -> `disabled`,
  `published` -> `published`, `set-aside` -> `rejected`, ...). Un codigo fuera de la tabla da `unknown`, no un
  estado inventado; un elemento fallido da `state: 'failed'` con su `code` (`no-proposal`, `gate-failed`, ...).
  No se quito ni se renombro nada: `kind`, `text` y las lineas `ok    <id>` / `FALLO <id>` siguen igual, y **el
  lote no emite un `code` global a proposito** (un `batch-partial` global haria que el panel marcara un solo id).
- **Consumidor** (`client.js`, bloque `<veredicto>`): `veredicto(texto, ids, code, params, items)` usa `items`
  cuando esta —antes que el `code` suelto y que la prosa—, ignora los elementos de ids que no se pidieron y
  trata un `state` desconocido como fallo visible. Sin `items`, la reserva sigue: `code` reconocido, y si no,
  los marcadores del texto.
- **La reserva de prosa aprende ingles.** Las frases del veredicto singular estaban solo en espanol (`Activa:`,
  `Ya estaba activa:`, `Apartada:`), asi que con el texto ingles —que ya es el idioma base— una aprobacion
  correcta no se reconocia. Ahora la lista incluye `Active:`, `Published:`, `Set aside:`, `Already active:`, y
  el `FALLO` acepta la raya del servidor **y** el guion ASCII. Sigue siendo reserva, no contrato.

### El limite, medido en el anfitrion instalado

`@deepseek-ai/dsh-commands` (`normalizeResult`) **reconstruye** el resultado con lista cerrada antes de salir:
`success` -> `{kind, text?, sourceEventSeq?}` y `error` -> `{kind, text}`; `execute()` devuelve
`{commandId, result}` con ese objeto. Consecuencia: `code`, `params` e `items` **no llegan al panel** por
`runCommand` en esta compilacion. Por eso el camino de `items` esta escrito y probado, pero hoy no se ejecuta en
produccion: lo que decide es la reserva. Queda declarado en `docs/ANFITRION.md`, con la condicion que hay que
mirar antes de retirar la prosa en 4.2.0 (si el anfitrion sigue recortando, el panel no puede medir por id y
tiene que decir «no medible», no contar cero).

No se metio el contrato en el texto visible (un bloque JSON al pie se lo comeria el humano en cada lote): el
texto queda para presentar y el dato para el objeto, que es lo que el encargo pedia.

### Pruebas nuevas

`tests/resultados-por-elemento.test.mjs` (10 casos): lote mixto con `items` reales del productor (exito, fallo,
`state`, `params`, `text` y lineas de siempre), lote entero bueno y entero fallido, lote sin ids; y el consumidor
con `items` (mixto, estado desconocido, id no pedido, tres hechos), sin `items` (marcadores del lote en los dos
idiomas, aprobacion suelta en ingles y en espanol, lineas de la puerta que no cuentan). Suite **748 -> 758**
(`client-artifact` actualiza su aserto de la firma, como manda la regla, y no borra ninguno).
## F3 · puertas obligatorias: cerrado

### Que cambio

- `tools/gates-obligatorios.mjs`: ejecuta `tools/i18n-gate.mjs` y `tools/ascii-gate.mjs` en serie con
  `--root` y devuelve distinto de cero si alguna falla, diciendo **cual**. Antes las dos puertas eran comandos
  que habia que recordar; una puerta que depende de la memoria no es una puerta.
- `package.json`: `pretest` -> `node tools/gates-obligatorios.mjs`, asi que **`npm test` no llega a correr una
  prueba con una puerta en rojo**; mas `gate`, `gate:i18n` y `gate:ascii` para correrlas sueltas.
- `tests/check-hermetic.mjs` (la ruta de release, la que cita `docs/DESARROLLO.md`): corre las puertas **antes**
  de la suite y aborta con `exit` distinto de cero si alguna esta en rojo. No despues: antes.
- `docs/DESARROLLO.md` y `docs/OPERACION.md`: la ruta de validacion descrita es la real, con los recuentos
  medidos.

### Pruebas negativas (sembradas en una COPIA del paquete, nunca en el arbol)

`tests/gates-obligatorios.test.mjs` (10 casos):

| Defecto sembrado | Puerta | Lo que se exige |
|---|---|---|
| `code.activated` renombrado en `es.mjs` | i18n | `FALLO paridad · es:code.activated`, exit 1 |
| codigo inventado en `CODES` sin texto | i18n | `FALLO codigo-sin-texto` en los dos idiomas |
| placeholder `{nuevo}` -> `{nombre}` en `es` | i18n | `FALLO placeholders · es:cmd.alias.deprecated` |
| un no-ASCII anadido a `lib/scope.mjs` | ascii | `FALLO ascii-nuevo · lib/scope.mjs`, exit 1 |
| `skill-ver` -> destino inexistente | i18n | `FALLO alias-destino · lib/commands.mjs:skill-ver` |
| `id` de `skill_propose` deja de ser obligatorio | schema | `tests/definitions-schema.test.mjs` en rojo |
| la expectativa congelada con un parametro de mas | schema | en rojo (no se regenera sola) |
| una puerta en rojo | runner | exit 1 y `GATES: la puerta ascii esta en rojo` |

Y dos asertos de cableado: `pretest` es el runner, y en `check-hermetic.mjs` la llamada a las puertas aparece
**antes** de la de la suite.

### Mediciones

- Suite **758 -> 768**; `npm test` ahora ejecuta las puertas antes (pretest) y sigue en verde.
- `node tools/gates-obligatorios.mjs` -> `GATES: i18n y ascii en verde` (566 claves por idioma · 7580 no ASCII).
- `npm run test:hermetic` -> puertas, suite y huella del almacen identica.

## Estado al cerrar este acto (2026-10-23)

Medido sobre el arbol, en este orden, antes de cerrar:

```
npm test                                    -> 768/768 (190 suites), con pretest de puertas
npm run test:hermetic                       -> puertas + suite + huella identica (HERMETICO)
node tools/gates-obligatorios.mjs           -> GATES: i18n y ascii en verde
node tools/i18n-gate.mjs                    -> 566 claves por idioma · 566 · 15 alias
node tools/ascii-gate.mjs                   -> 7580 heredados, tope 7580, ninguno nuevo
node --test tests/definitions-schema.test.mjs -> 18/18
doctor (4 arenas)                           -> 0, 0, 1, 1
```

- Fases cerradas en este acto: **F1.1, F1.4, F2 y F3**.
- Version declarada: **3.9.3**. Sin tag `v4.0.0`, sin entrada de release en el CHANGELOG y sin release: eso es
  F4 y lo cierra el operador despues de verificar.
- **Sin poder verificar**: las filas visibles del menu `/` (no hay navegador ni sesion interactiva aqui) y el
  transporte real de `items`/`code` al panel (medido que el anfitrion los recorta; no se puede observar una
  compilacion que no existe).
- Deudas de idioma que siguen: `regla`/`observado`/`umbral` de la auto-actualizacion y los `motivo` de bloqueo
  de `repair`. Aviso preexistente de `audit`/`security`: el de `static-serving-hardening` no es de este acto.

## Proximo paso exacto (sustituye a la lista de arriba)

1. **F4 · release**: `package.json` a 4.0.0, entrada del `CHANGELOG` (>500 caracteres), `README` con la version
   y el recuento real de la suite leidos del binario, barrido de afirmaciones de `docs/`, tag `v4.0.0` y
   `gh release create` verificando `isDraft`/`isPrerelease`.
2. Antes de retirar la prosa del panel en 4.2.0: comprobar si el anfitrion ya transporta `items`/`code`
   (`normalizeResult`). Si sigue recortando, el panel tiene que decir «no medible», no contar cero.
