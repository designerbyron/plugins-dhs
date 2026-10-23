# Plan · registro dinamico por idioma: solo el idioma activo, con cambio EN VIVO

**Estado: prototipo medido en rama local (`proto/i18n-live-commands`, desde el tag `v4.0.1`). NO ejecutado
sobre `main`, sin push, sin release.** Lo autorizable aqui es la migracion de los 16 comandos; el prototipo
existe para que esa decision se tome con numeros y no con una corazonada.

Fecha: 2026-10-23. Paquete: `skill-compiler/`.

---

## 1 · Que se midio en el harness INSTALADO (antes de disenar)

Artefacto: `DeepSeek Harness Desktop 0.2.1-rc.2` (`/package.json` dentro de
`%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`: `@deepseek-ai/dsh-desktop` `0.2.1-rc.2`).
Registro de comandos: `@deepseek-ai/dsh-commands` **0.2.1-rc.2**, extraido del mismo asar con
`scripts/asar-read.py` (skill `windows-git-bash-commands`).

| Pregunta | Evidencia (`fichero:linea` del asar) | Resultado |
|---|---|---|
| `register()` devuelve un disposer de ESA definicion | `@deepseek-ai/dsh-commands/lib/index.js:266-269` (`return this.layers.effect(...)`, `{label:"commands.register()"}`) y `@deepseek-ai/dsh-scope/lib/index.js:211-215` (el `yield () => { undo(); ...; if (notify) this.onChange(); }`) | **Si** |
| Alta y baja emiten `commands/change` | `dsh-scope/lib/index.js:214` (baja) y `:216` (alta); `dsh-commands/lib/index.js:426-436` (`notifyChange` → `ctx.events.dispatch("emit",["commands/change"])`) | **Si, una por mutacion** |
| El adaptador de UI instalado se suscribe | `@deepseek-ai/dsh-client-ui-commands/lib/client.js:1435-1437` (`ctx.remote.$on("commands/change", () => { this.directory.invalidateAll(); })`) | **Si** |
| Al recibirlo vuelve a consultar y repinta el menu `/` | `client.js:858` (`invalidateAll` → `refresh(key)` por sesion), `:903-916` (`refresh` pide `remote.commands.list`), `:1532-1543` (`candidates` construye las filas del menu con `ensureReady`) | **Si, con matiz: invalidacion SUAVE** |
| Hace falta parchear el `app.asar` | no se toco ningun fichero del build | **No** |
| Alguna particularidad del build lo impide | `normalizeDefinition` (`dsh-commands/lib/index.js:149-182`) acepta `definitionId`, `name`, `description`, `input:{hint,attachments}`, `handler`; **no valida banderas** (el `rawInput` llega entero al handler, `:379-385`) | **Ninguna** |

**El matiz que decide el diseno.** La invalidacion es **suave**: `refresh()` no degrada una foto ya lista
(`if (entry.state !== "ready") entry.state = "pending"`, `client.js:903-907`) y `ensureReady` devuelve la foto
`ready` al instante (`:927-937`). Consecuencia medida: entre el aviso y la repoblacion asincrona, un menu `/`
abierto puede pintar el catalogo ANTERIOR una vez. No rompe nada (el siguiente `/` ya pide el nuevo), pero
significa que **la UI no es transaccional** y que el orden de las mutaciones importa: se dan las ALTAS antes que
las BAJAS, de modo que la ventana muestre dos nombres (raro) y nunca cero (perdida).

## 2 · Diseno

- **Mapa por operacion** (`skill-compiler/lib/localized-commands.mjs`): id interno estable (`approve`), id de
  definicion (`skill-compiler.approve`, viaja en el descriptor), nombre slash EN, nombre slash ES, clave de
  descripcion por idioma y la definicion base de la que **hereda el handler**. Un handler por operacion, dos
  nombres: cambiar de idioma no puede cambiar el comportamiento.
- **Arranque**: se registra solo el conjunto del idioma resuelto (`DSH_LANG` → `config.json` → `en`, la
  resolucion que ya existia en `lib/i18n`). Los nombres que el conjunto va a poseer se **omiten** del registro
  base (`skillCommands()` se lee entero para heredar handlers y se filtra al registrar).
- **Cambio en vivo**: se construye y valida el conjunto destino **entero** antes de tocar el registro; se dan
  las altas, despues las bajas con los disposers devueltos por `register()`; se persiste **solo si el cambio fue
  efectivo**; si la persistencia falla se vuelve al conjunto anterior y se dice.
- **Comando estable, fuera del conjunto intercambiable**: `/skill-compiler-language --en|--es`, mas la forma sin
  guiones (`es`, la del CLI). El anfitrion no valida banderas, asi que `--en` es argumento, no bandera del host:
  no hubo que adaptar la sintaxis.
- **Equivalente CLI**: `skill-compiler lang --es` (se anadieron `--en`/`--es` al parser; fuera de `lang` se
  rechazan con codigo 2). No se creo un subcomando `language` aparte: `lang` ya era la puerta y dos nombres para
  la misma verdad es deuda.

## 3 · Prueba vertical sobre `approve`, con el registro REAL

Ejecutada con `@deepseek-ai/dsh-commands` **extraido del asar instalado** sobre un `Context` real de
`@deepseek-ai/cordis` del mismo build, y almacen en disco (arena). Lo unico simulado es el `agent` (una sesion
con `append` que no escribe), porque no hay harness vivo en el proceso de prueba. Medidas:

| Paso | Medida |
|---|---|
| Arranque EN | 31 filas; `/skill-approve` si, `/skill-aprobar` **no**; `/skill-compiler-language` si |
| Descriptor | `{name:"skill-approve", definitionId:"skill-compiler.approve", hint:"<id> [--global\|--local] [--force]"}` |
| `/skill-aprobar` en EN | `execute` devuelve **`undefined`** (no invocable), no un error: el nombre no existe |
| Cambio a ES por el comando estable | `kind:"success"`; **2 avisos** `commands/change`; 31 filas; `/skill-approve` no, `/skill-aprobar` si; el comando estable sigue |
| Handler | **el mismo objeto** antes y despues del cambio (y tras volver) |
| Aprobacion por el nombre ES | `kind:"success"`, `text:"Activa: vertical-en [<key>]"`, `approved/` en disco |
| Nombre retirado | `/skill-approve` → `undefined` (no invocable) |
| Estado por aviso | `[["skill-approve","skill-aprobar"],["skill-approve"]]`: **nunca cero nombres**; un aviso intermedio con los dos |
| Cinco vueltas EN/ES/EN | 31 filas antes y despues, **20 avisos** (2 por cambio), **1 disposer vivo** |
| Repetir el idioma vivo | 0 avisos, `kind:"success"`, «ya era en» |
| Idioma invalido (`--fr`) | `kind:"error"`, registro intacto, `config.json` no se crea |
| Persistencia rota (`config.json` es un directorio) | `kind:"error"`, «se deshizo», **registro devuelto al idioma anterior**, sin preferencia escrita |
| `DSH_LANG=es` + `--en` | «DSH_LANG impone es», registro intacto, `config.json` **no** escrito (precedencia intacta) |

**Hallazgo del registro real, que cambia una afirmacion del repo**: `normalizeResult`
(`dsh-commands/lib/index.js:183-204`) devuelve **solo** `{kind, text}` (+ `sourceEventSeq`). Medido: los
resultados que llegan del `execute` tienen `campos=kind,text`; `code` y `params` **se quedan en el servidor**.
Los codigos nuevos (`language-set`, `language-fixed-by-env`, `language-persist-failed`, ...) siguen siendo
contrato para el plugin y sus pruebas, pero **el panel no los ve**: decide por prosa. Es la limitacion ya
conocida (`references/harness-contracts.md`), confirmada aqui en la ruta real del comando.

## 4 · Lo que NO esta verificado (y no se declara resuelto)

- **El menu `/` visible no se ha visto.** Este entorno no tiene la app delante: todo lo anterior es el registro
  y su evento, no el pixel. El procedimiento de comprobacion manual esta en el informe del acto.
- **El refresco es asincrono**: la ventana entre el aviso y la repoblacion no se puede medir sin UI. Se mitigo
  por orden (altas antes que bajas) y se midio que ningun aviso deja cero nombres.
- **La descripcion del comando estable no cambia con el idioma** (se compone en el idioma base): reescribirla
  exigiria retirar y volver a registrar el unico comando que debe existir siempre.
- **Las filas que no son la operacion localizada no cambian de texto** al cambiar de idioma: los otros 15
  comandos siguen registrados con el texto de su arranque. Es la consecuencia de migrar UNA operacion.
- **`doctor` sigue contando la tabla vieja**: «15 of 31 menu rows (16 canonical)» (medido). El total coincide
  por casualidad (15 canonicos + 14 alias + 1 localizado + 1 estable = 31) pero la composicion no. Alinear el
  recuento es parte de la migracion.

## 5 · Criterio de decision

- **Funciona de punta a punta en el registro real** (disposer + `commands/change` + el adaptador suscrito +
  reinvocacion correcta): si. **La actualizacion del menu en vivo queda INFERIDA, no observada.**
- Por tanto: **no se declara resuelto el menu**. Lo que se declara resuelto es el mecanismo de registro (medido)
  y la maquina de estados del cambio (medido, 18 casos).
- Si el operador confirma en pantalla que el menu cambia sin reiniciar, la migracion de los 16 se autoriza con
  este mismo mecanismo. Si el menu **no** cambia, la limitacion es del adaptador de UI (`invalidateAll` suave),
  no del registro, y las salidas soportadas son: (a) reiniciar el cliente, (b) una accion del plugin en
  `client.js` que fuerce `resetSession`/repoblacion, (c) aceptar el cambio tras el siguiente `/`. Parchear el
  `app.asar` queda descartado.

## 6 · Plan de migracion de los 16 (NO ejecutado)

1. **Mapa completo**: anadir a `LOCALIZED_OPERATIONS` las 15 operaciones restantes con su `source` canonico y
   sus dos nombres (`ALIAS_ESPERADOS` ya declara la correspondencia). El `omitNames` crece solo; el registro
   base queda en los comandos que no son operacion (hoy: ninguno).
2. **Alias**: los 15 nombres espanoles dejan de ser alias con `aliasOf`/`deprecatedIn` y pasan a ser el nombre
   localizado de su operacion. Efecto: el menu pasa de 31 a 30 filas + 1 comando estable = **31**, y ya no hay
   dos filas para la misma operacion.
3. **Textos del resultado**: migrar `DECISION_COMMANDS` (`lib/presentation.mjs:42-47`) para que reconozca
   tambien el prefijo espanol; hoy `decisionKindOf('skill-aprobar')` devuelve `''` (medido), asi que el pliegue
   no cuenta esa decision cuando el nombre es el espanol.
4. **Filas por propuesta** (`lib/pending-rows.mjs`): su nombre se genera (`skill-approve-<id>`); decidir si el
   prefijo sigue al idioma o se queda estable (recomendado: estable, es un id de fila).
5. **`doctor` y el recuento**: leer el conjunto localizado en vez de `skillCommands()` a secas, para que la
   frase «N de M filas» describa el menu que existe.
6. **GUI textual de las otras filas**: re-registrar el conjunto completo al cambiar de idioma (las 16), no solo
   la operacion migrada, para que las descripciones cambien todas a la vez. Coste medido: 2 avisos por fila.
7. **Pruebas**: por cada operacion, el caso de invocabilidad del nombre retirado (`undefined`) y el de mismo
   `kind`/estado en disco; y un caso que mida el recuento de filas antes y despues.
8. **Puerta i18n**: hoy `tools/i18n-gate.mjs:105-145` solo mira `lib/commands.mjs`; al mover los nombres al
   mapa, la puerta tiene que mirar el mapa (nombres ingleses canonicos, ninguno duplicado, alias coherentes).
9. **Retirada**: el tag de la version que retire los alias deja de tener sentido; `RETIRADA_DE_ALIAS` se
   conserva como historia en el `CHANGELOG`, no como fecha viva.
10. **Cierre**: version MAYOR (cambia la superficie visible: nombres y descripciones), `CHANGELOG` y `README`
    desde el binario, y la comprobacion visual del menu como criterio de aceptacion.

## 7 · Puertas y recuentos del prototipo

| Puerta | Resultado |
|---|---|
| `node tools/i18n-gate.mjs` | verde · 576 claves por idioma · 15 alias |
| `node tools/ascii-gate.mjs` | verde · 7579 caracteres heredados, tope 7579 · **22 ficheros** (antes 21: se anadio `lib/localized-commands.mjs` con **0** de deuda) |
| `npm test` | **796/796** (antes 777: +18 del fichero nuevo, +1 del CLI) |
| `npm run test:hermetic` | verde (huella del almacen real identica antes y despues) |
| `node --test tests/definitions-schema.test.mjs` | 18/18 |

La linea base ASCII **no sube**: el total baja de 7580 a 7579 (un caracter menos en `lib/pending-rows.mjs`, que
ya estaba por debajo de su tope) y el fichero nuevo entra con 0.
