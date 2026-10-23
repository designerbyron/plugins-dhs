# Checkpoint · Skill-Compiler v4.0.0 (i18n ES/EN) — actualizado 2026-10-23

Estado reproducible para retomar sin releer la sesion. Todo lo que sigue esta medido sobre este arbol.

## SHA y rama

- HEAD de codigo al entrar en esta sesion: **`1fbe4c6`** (checkpoint del grupo 4 inspeccionado). Antes: `4a240c9` (F1.2 grupo 3), `4f3a0d3` (grupo 2), `1a4b170` (grupo 1), `f9b8421` (F1.3), `eb9bbb4` (PROTOCOL).
- Este documento se versiona en el mismo commit que el codigo (en esta sesion, sin push).
- Rama `main`, remoto `designerbyron/plugins-dsh`, arbol limpio, divergencia **0/0**.
- Version declarada: **3.9.3**. Sin tag `v4.0.0`: no se publica hasta cerrar F1.2, F1.1-menu, F2 y F4.

## Fases

| Fase | Estado | Que hay |
|---|---|---|
| F0 | cerrada | `lib/i18n/{index,es,en}.mjs`, resolucion `DSH_LANG` -> `config.json` -> `en`, `lang` en CLI, `doctor` con idioma y fuente |
| F1.1 | parcial | 16 comandos canonicos + 15 alias con `aliasOf`/`deprecatedIn`, mismo codigo y efecto (probado). **Menu real sin verificar** |
| **F1.3** | **cerrada** | superficie completa congelada + texto visible al modelo en ASCII puro |
| **F1.2** | **grupos 1-4 cerrados; falta el 5** | 237 claves por idioma. Grupo 4 (ownership/systems/auto) migrado y probado ES/EN |
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

Grupo 5: mensajes humanos de `bin/skill-compiler.mjs` (722 caracteres no ASCII), y despues F1.1-menu, F1.4,
F2, F3 y F4.
