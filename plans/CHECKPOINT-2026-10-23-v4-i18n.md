# Checkpoint · Skill-Compiler v4.0.0 (i18n ES/EN) — 2026-10-23

Estado reproducible para retomar sin releer la sesion. Todo lo que sigue esta medido sobre este arbol.

## SHA y rama

- Commit de referencia: **`172e29d`** (+ el commit de este documento).
- Rama `main`, `origin/main` sincronizado, arbol limpio, divergencia **0/0**.
- Version declarada: **3.9.3** (no se sube a 4.0.0 hasta cerrar F1-F3).
- Sin tag `v4.0.0`.

## Fases

| Fase | Estado | Que hay |
|---|---|---|
| F0 | cerrada | `lib/i18n/{index,es,en,codes}.mjs`, resolucion `DSH_LANG` -> `config.json` -> `en`, `lang` en CLI, `doctor` con idioma y fuente |
| F1.1 | parcial | 16 comandos canonicos + 15 alias con `aliasOf`/`deprecatedIn`, mismo contrato y efecto (probado). **Menu real sin verificar** |
| F1.2 | **no hecha** | `commands.mjs` y `bin/` siguen con prosa literal |
| F1.3 | parcial | `tests/fixtures/definitions-contract.json` + `tests/definitions-schema.test.mjs` congelan **4 herramientas** (`skill_propose` 9 parametros, `skill_review` 0, `skill_vendor` 6, `skill_upstream_check` 1): nombre, tipo, obligatoriedad, enum y salida. `PROTOCOL` sigue en espanol |
| F1.4 | parcial | 4 pruebas de esquema, 7 de la puerta i18n, 7 de `i18n.test`, paridad de catalogos |
| F1.5 | cerrada | `docs/ANFITRION.md`: fallback de prosa en 4.0.0-4.1.x, retirada en **4.2.0** |
| F2 | parcial | el panel lee `code` (conocido / desconocido = fallo visible / neutros), `bulk_ids_hint` corregido en los dos idiomas, reserva `en` |
| F3 | parcial | `tools/i18n-gate.mjs` (5 reglas, 6 pruebas negativas) y `tools/ascii-gate.mjs` (linea base, 3 negativas) |
| F4 | no iniciada | — |

## Mediciones reales de este arbol

```
npm test                 -> 674/674
npm run test:hermetic    -> verde
node tools/i18n-gate.mjs -> en orden (34 claves por idioma · 15 alias)
node tools/ascii-gate.mjs-> 8.640 caracteres no ASCII heredados en 21 ficheros (tope 8.640)
audit                    -> 48 · PASS 47 · WARN 1 (static-serving-hardening) · ERROR 0
security                 -> 0 bloqueos · 0 avisos · cadena valida
doctor                   -> language: en (source: default) · todo en su sitio
```

## Proximo paso exacto (en orden)

1. **F1.3 · traduccion con la red puesta.**
   `PROTOCOL` (941 caracteres, `lib/definitions.mjs` linea ~40) y las descripciones de las 4 herramientas
   (lineas 188, 415, 514, 639) al ingles ASCII. Antes y despues: `node --test tests/definitions-schema.test.mjs`.
   Si el esquema cambia, la prueba lo dice: restaurar, no actualizar el manifiesto.
2. **F1.2 · por grupos**, uno por commit, con `npm test` verde entre grupos:
   `proposals/pending/show` -> `approve/publish/scope` -> `reject/disable/enable/retire/retired` ->
   `ownership/systems/auto` -> `bin/` (ayuda, errores, `lang`, `doctor`).
   Cada mensaje: clave en `es` y `en`, `t(key, params)`, `code` cuando sea veredicto.
   Las 32 aserciones de prosa se sustituyen por `code` + estado en disco.
3. **ASCII**: tras cada grupo, `node tools/ascii-gate.mjs --update` **manual**, revisar el diff de la linea base
   y confirmar que baja. Objetivo: 0 en los ficheros controlados.
4. **F1.1 · menu real**: localizar en el harness el punto de registro/presentacion de comandos; si no filtra
   `aliasOf`, filtrar ahi (o en el adaptador de registro). Anotar que parte se verifico y cual no.
5. **F2**: paridad y pruebas por idioma del panel (claves 78/78 ya iguales).
6. **F4**: version 4.0.0, CHANGELOG, README, gates, tag y release.

## Trampas ya pagadas (no repetirlas)

- `git commit -m` con backticks: bash los interpreta. Usar **`-F fichero`**.
- `write_file` sobre un fichero leido con paginacion: releer completo o `rm` + escribir.
- Las lineas en blanco al final de un `.md` rompen `git diff --cached --check`: recortarlas.
- `node -e` en este shell a veces devuelve `stdin is not a tty`: usar fichero `.mjs` y `node fichero`.
- `skillCommands({})` usa el almacen **real**: en pruebas, pasar `{ root: arena.root }`.
