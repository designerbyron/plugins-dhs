# Checkpoint · Skill-Compiler v4.0.0 (i18n ES/EN) — actualizado 2026-10-23

Estado reproducible para retomar sin releer la sesion. Todo lo que sigue esta medido sobre este arbol.

## SHA y rama

- HEAD de codigo: **`4f3a0d3`** (F1.2 grupo 2). Antes: `1a4b170` (grupo 1), `f9b8421` (F1.3), `eb9bbb4` (PROTOCOL).
- Este documento se versiona en el commit siguiente y se empuja con el.
- Rama `main`, remoto `designerbyron/plugins-dsh`, arbol limpio, divergencia **0/0**.
- Version declarada: **3.9.3**. Sin tag `v4.0.0`: no se publica hasta cerrar F1.2, F1.1-menu, F2 y F4.

## Fases

| Fase | Estado | Que hay |
|---|---|---|
| F0 | cerrada | `lib/i18n/{index,es,en}.mjs`, resolucion `DSH_LANG` -> `config.json` -> `en`, `lang` en CLI, `doctor` con idioma y fuente |
| F1.1 | parcial | 16 comandos canonicos + 15 alias con `aliasOf`/`deprecatedIn`, mismo codigo y efecto (probado). **Menu real sin verificar** |
| **F1.3** | **cerrada** | superficie completa congelada + texto visible al modelo en ASCII puro |
| **F1.2** | **grupos 1 y 2 de 5** | proposals/pending/show + approve/publish/scope al catalogo (**131 claves** por idioma). Grupos 3-5 pendientes |
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
npm test                 -> 700/700 (171 suites)
npm run test:hermetic    -> hermetico (huella del almacen identica antes y despues)
node tools/i18n-gate.mjs -> en orden (131 claves por idioma · 15 alias)
node tools/ascii-gate.mjs-> 8.614 caracteres heredados, tope 8.614 (ninguno nuevo)
node --test tests/definitions-schema.test.mjs -> 18/18
```

## Proximo paso exacto (en orden)

1. **F1.2 grupos 3-5**, uno por commit, con `npm test` verde entre grupos (mismo metodo que 1 y 2:
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
