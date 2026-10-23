# CHECKPOINT 2026-10-23 — candidato v5.0.0 integrado, **sin publicar**

Rama local **`release/v5.0.0`**, creada desde `main` (`8393977`, el commit que lleva el tag anotado `v4.0.1`).
`main` y `origin/main` siguen en `8393977`, alineadas y sin tocar; los tags `v4.0.0` (`0de79b1`) y `v4.0.1`
(`fda2e14`) no se movieron; no hubo `push --force`, ni reescritura de historial, ni release. **El arbol de trabajo
vuelve a `main` al cerrar**: la carpeta es el codigo que arranca el harness, y lo que arranca es lo publicado.

**Veredicto de este acto: NO PASS.** Con ese criterio no se sube `package.json`, no se crea el tag `v5.0.0` y no
se publica nada. El motivo esta medido y esta abajo, con su fichero y su numero.

## 1. Lo que quedo integrado

| Frente | Commits | Como entro |
| --- | --- | --- |
| `hardening/post-4.0.1` | `4ba3282`, `24f8f34`, `6aec569`, `5d52fc1`, `5693136` | merge sin conflictos |
| `proto/i18n-live-commands` | `52a95cf`, `7778ab6`, `2ba051f`, `5c19710`, `ba2fec0`, `3e18391` | merge con 10 conflictos, resueltos uno a uno |
| Candidato | `77cfca3` (merge), `67cf358` (e2e), y el commit de documentacion siguiente | — |

Conflictos y criterio (detalle completo en el mensaje de `77cfca3`):

1. `lib/i18n/{en,es}.mjs`, `lib/commands.mjs`, `tests/commands.test.mjs`: la version del prototipo; la fila de
   otro proyecto pasa a **una** clave (`row.wrong-project`) con los mismos datos en una frase.
2. `tests/gates-obligatorios.test.mjs`: se conservan **los dos** tests de endurecimiento (los tres modulos antes
   no vigilados y el fichero sin clasificar) **y** el test que sustituye al del alias. Los del alias no vuelven:
   el modelo esta retirado y `tools/i18n-gate.mjs` ya no mide esa regla.
3. `tools/ascii-gate.mjs`: la puerta endurecida (inventario cerrado, sin holgura, `--allow-raise`), mas los dos
   modulos del prototipo en `FICHEROS`.
4. `tools/ascii-baseline.json`: recalculado con `--update --allow-raise` **despues** de clasificar; tope igual a
   lo medido.
5. `tests/i18n-comandos-grupo6.test.mjs`: el texto esperado se lee del catalogo; la fila se busca por su id, no
   por el prefijo ingles (que cambia con el idioma).
6. `tests/ascii-gate.test.mjs`: el numero de ficheros vigilados sale de `primeraParte(RAIZ)`, no de un `24`.
7. `MEMORY.md`: los dos relatos se conservan como historia del acto.

## 2. Medido en el candidato (no heredado de ningun informe)

- `npm test`: **860 pruebas, 860 pasan, 209 suites**, exit 0.
- `npm run test:hermetic`: 860/860 y huella del almacen real **identica** antes y despues.
- `node tools/i18n-gate.mjs`: en orden, **695 claves por idioma**, 16 operaciones x 2 nombres, 1 activo por
  idioma.
- `node tools/ascii-gate.mjs`: **8.353 caracteres, tope 8.353** (sin holgura), **26/26** ficheros de primera parte,
  0 excluidos.
- `tests/update-real.e2e.test.mjs`: 5/5 descubierta por el runner. Mutacion controlada en copia aislada
  (`else if (vigente.hash !== meta.base.hash)` -> `else if (false)`): **4/5, rojo el caso 4 y solo ese**;
  restaurado, 5/5.
- `doctor` sobre una copia del almacen real (no sobre el almacen de la maquina): exit 0, «everything in place».
- `audit` / `security` en **solo lectura** sobre una copia del almacen: 44 skills auditadas, PASS 43, WARN 1
  (`absolute-path`, el preexistente), ERROR 0, 32 archivadas fuera del recuento; `security` 0 bloqueos,
  0 avisos, cadena valida.

## 3. Lo que impide el PASS (§5E del mandato)

La prosa humana que vive **fuera del catalogo** sigue en espanol fijo. Medido con el binario, `DSH_LANG=en`,
sobre una copia del almacen: `audit` imprime **9 lineas en espanol**

- `skills auditadas: 44 · PASS 43 … ilegibles 0`
- `archivadas: 32 · no se auditan (evidencia congelada: …)`
- los nombres de estado (`aprobada`, `apagada`, `propuesta`, `publicada`)
- los `fixes: Parametriza la ruta absoluta o documentala como del puesto` y `fixes: Nada: si algun dia se usa…`
- el detalle de la regla: `contiene una ruta absoluta en la linea 2 («/mnt/c»): si la skill debe viajar…`

Los catalogos no tienen **ni una** clave `audit.*`, `security.*`, `vendor.*`, `promote.*` ni `review.*` (medido:
0 en `lib/i18n/en.mjs`). La misma deuda esta en `lib/security.mjs`, en los mensajes de integridad de
`lib/compiler.mjs` (los que imprime `check`), `lib/vendor.mjs`, `lib/promote.mjs`, `lib/review.mjs`,
`lib/projection.mjs` y en la capa del modelo (`lib/definitions.mjs`).

Lo que **si** esta cerrado de las deudas de idioma: `scope` (76 claves, `estadoEnTexto`/`motivoEnTexto`, con el
estado desconocido crudo), `repair` (54 claves, `reasonCode`/`reasonParams` + `fraseDeReparacion`) y
`auto-update` (29 claves, `observado`/`umbral` como dato y su presentacion traducida). Los tres con sus pruebas
en `tests/i18n-deuda-prosa.test.mjs`.

## 4. Siguiente operacion exacta

1. Migrar `lib/audit.mjs` al catalogo: cabecera y recuentos, los nombres de estado (`NOMBRE_DE_ESTADO`),
   `fix` de cada regla y el `detalle` con sus parametros. Conservar `rule`, `observed`, `fix` y `estado` como
   DATO (los asertos y los consumidores dependen de ellos); traducir en la presentacion con
   `patron -> clave + params`.
2. Lo mismo para `lib/security.mjs` (detalle y `fix` de cada regla de bloqueo/aviso) y para los mensajes de
   integridad de `lib/compiler.mjs`.
3. `vendor`, `promote`, `review`, `projection` y la capa del modelo (`definitions.mjs`), con la regla de la casa:
   ninguna prueba edita los asertos que ya pasan; la prueba nueva mide el **texto real del binario** en los dos
   idiomas y el dato no se mueve.
4. Repetir el cierre: `npm test`, `test:hermetic`, las dos puertas, `doctor`, `audit`, `security` y el diff. Solo
   con PASS se sube `package.json` a `5.0.0`, se crea el tag sobre el commit que paso los gates y se publica.
