# Checkpoint · Skill-Compiler v4.0.0 (i18n ES/EN) — actualizado 2026-10-23

Estado reproducible para retomar sin releer la sesion. Todo lo que sigue esta medido sobre este arbol.

## SHA y rama

- HEAD de codigo: **`4a240c9`** (F1.2 grupo 3). Antes: `4f3a0d3` (grupo 2), `1a4b170` (grupo 1), `f9b8421` (F1.3), `eb9bbb4` (PROTOCOL).
- Este documento se versiona en el commit siguiente y se empuja con el.
- Rama `main`, remoto `designerbyron/plugins-dsh`, arbol limpio, divergencia **0/0**.
- Version declarada: **3.9.3**. Sin tag `v4.0.0`: no se publica hasta cerrar F1.2, F1.1-menu, F2 y F4.

## Fases

| Fase | Estado | Que hay |
|---|---|---|
| F0 | cerrada | `lib/i18n/{index,es,en}.mjs`, resolucion `DSH_LANG` -> `config.json` -> `en`, `lang` en CLI, `doctor` con idioma y fuente |
| F1.1 | parcial | 16 comandos canonicos + 15 alias con `aliasOf`/`deprecatedIn`, mismo codigo y efecto (probado). **Menu real sin verificar** |
| **F1.3** | **cerrada** | superficie completa congelada + texto visible al modelo en ASCII puro |
| **F1.2** | **grupos 1-3 cerrados; grupo 4 inspeccionado** | 167 claves por idioma. Grupo 4 (ownership/systems/auto): inspeccion medida, sin editar |
| F1.4 | parcial | 18 casos en `definitions-schema` (antes 4), 5 en `i18n-comandos` (nuevo), 7 de la puerta i18n, paridad de catalogos |
| F1.5 | cerrada | `docs/ANFITRION.md`: fallback de prosa en 4.0.0-4.1.x, retirada en **4.2.0** |
| F2 | parcial | el panel lee `code`, `bulk_ids_hint` corregido, reserva `en` |
| F3 | parcial | `tools/i18n-gate.mjs` (5 reglas) y `tools/ascii-gate.mjs` (linea base) |
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
npm test                 -> 707/707 (172 suites)
npm run test:hermetic    -> hermetico (huella del almacen identica antes y despues)
node tools/i18n-gate.mjs -> en orden (167 claves por idioma · 15 alias)
node tools/ascii-gate.mjs-> 8.614 caracteres heredados, tope 8.614 (ninguno nuevo)
node --test tests/definitions-schema.test.mjs -> 18/18
```

## Proximo paso exacto (en orden)

1. **F1.2 grupo 4 y 5** (ver la seccion del grupo 4 al final: inspeccion ya medida, 639 no ASCII en scope.mjs):
   claves en `es`/`en`, `t(key, params)`, `code` cuando sea veredicto, y `DSH_LANG=es` en el fichero de
   pruebas que afirme prosa):
   - grupo 3: `reject` / `disable` / `enable` / `retire` / `retired`
   - grupo 4: `ownership` / `systems` / `auto` (`rejectProposal` ya esta en el grupo 3; la prosa de la
     propiedad vive en `lib/scope.mjs`: se migra alli)
   - grupo 5: `bin/` (ayuda, errores, `lang`, `doctor`) y `textoDeSistemas`
2. **F1.1 · menu real**: localizar en el harness el punto de registro/presentacion de comandos; si no
   filtra `aliasOf`, filtrar ahi. Anotar que parte se verifico y cual no.
3. **F2**: pruebas por idioma del panel (claves 78/78) y reserva `en`.
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

## Grupo 4 (ownership / systems / auto): inspeccion hecha, migracion NO empezada

El contexto se agoto antes de tocar codigo, asi que **no se edito nada** de este grupo: el arbol queda
limpio y los gates en verde (167 claves, ASCII 8.614, 707/707). Lo que sigue es la inspeccion ya medida
para que la proxima sesion no la repita.

### Estado verificado al entrar

- HEAD `d3893de`, rama `main`, `origin/main` en 0/0, arbol limpio, version 3.9.3, sin tag `v4.0.0`.
- `lib/scope.mjs`: 821 lineas, **639 caracteres no ASCII**.

### Que es prosa visible (lo que hay que migrar) y donde

| Bloque | Lineas | No ASCII | Consumidores |
|---|---|---|---|
| `PROPIEDADES` (mapa de las dos politicas) | 63-68 | 6 | `textoDelEstado`, `declararLaPropiedad` (commands.mjs) |
| `textoDeLaPregunta` | 721-732 | 12 | `textoDelEstado` (estado `ausente`) |
| `textoDelEstado` | 738-762 | 18 | `/skill-ownership` (commands.mjs:475) y CLI |
| `textoDeSistemas` | 769-821 | 29 | `/skill-systems` (commands.mjs:493) y CLI `systems` |
| handler de `auto` | desde commands.mjs:647 | 93 | `/skill-auto` |
| `bin/skill-compiler.mjs` | todo | 722 | grupo 5, no este |

### Trampas y riesgos ya identificados

- **`PROPIEDADES` se evalua al importar** (linea 63): una constante con texto traducible congela el idioma
  del arranque. Es la misma trampa que `NO_SCOPE` en el grupo 1: pasa a funcion (`propiedadEnTexto(owner)`)
  y se ajustan sus dos consumidores.
- **`textoDeLaPregunta` esta dentro del camino de LECTURA del estado**: `textoDelEstado` lo compone cuando
  no hay declaracion. Cualquier cambio de firma afecta tambien a lo que lee el CLI.
- **`textoDeSistemas` es compartido por comando y CLI** (`/skill-systems` y `systems` imprimen lo mismo, a
  proposito): la firma `{ datos, estado }` se mantiene y la traduccion entra por dentro, no por parametro.
- `tests/scope-concurrencia.test.mjs:162-164` afirma `textoDeSistemas`/`textoDelEstado` **en español**
  (`/Propiedad: AUSENTE/`): ese fichero tendra que fijar `DSH_LANG=es`, como los de los grupos 1-3.
- `ESTADOS_PROPIEDAD` (`ausente|declarada|invalida|ilegible`) y `SOLO_DSH`/`MAQUINA` **son datos, no prosa**:
  no se traducen nunca (son las claves de almacenamiento y de politica).
- El handler de `auto` usa `AUTO_COMMAND` y `parseAutoCommand` con `activar|desactivar` como **tokens de
  comando**: son interfaz, no prosa libre, y cambiarlos es cambio de contrato; dejarlos y traducir solo las
  respuestas.

### Proximo paso exacto (grupo 4)

1. `lib/scope.mjs`: convertir `PROPIEDADES` en funcion traducida; migrar `textoDeLaPregunta`,
   `textoDelEstado` y `textoDeSistemas` con claves `scope.*` (unas 45 claves nuevas por idioma).
2. `lib/commands.mjs`: migrar el handler de `auto` (dos bloques de respuesta y la descripcion) y la
   descripcion de `/skill-ownership` y de sus dos filas.
3. `tests/i18n-comandos-grupo4.test.mjs`: ES/EN con el mismo `kind`, `code` y estado; la propiedad declarada
   en un idioma se lee en el otro sin cambiar el fichero `ownership.json` ni su huella.
4. Fijar `DSH_LANG=es` en `tests/scope-concurrencia.test.mjs` (y en cualquier otro que afirme esa prosa).
5. Verificacion: `npm test`, `test:hermetic`, los dos gates, `definitions-schema`, y comprobar que la linea
   base ASCII **no crece** (el texto se muda de `scope.mjs` al catalogo: lo esperable es 8.614 igual).
