# CHECKPOINT 2026-10-23 — v5.0.0 publicada

Cierre del candidato `release/v5.0.0` como versión estable. El estado intermedio (integración de las dos ramas y
primer NO PASS por la prosa fuera del catálogo) queda documentado en
`plans/CHECKPOINT-2026-10-23-v5-candidato.md`: no se reescribe, es la evidencia de lo que se midió entonces.

**Veredicto: PASS.** Todos los criterios obligatorios están medidos sobre el commit de cierre; los límites del
anfitrión siguen declarados y ninguno se presenta como resuelto.

## Qué cambió desde el NO PASS

La deuda §5E (prosa humana fuera del catálogo) se cerró por módulos, sin mover el dato:

| Módulo | Qué se hizo |
| --- | --- |
| `lib/audit.mjs` | tabla `PROSA_DE_REGLA`, `messageCode`/`fixCode`, `estadoEnTexto`, `lineasDePuerta`, resumen por catálogo |
| `lib/security.mjs` | `message`/`fix` de las 10 reglas (con las 5 variantes de `security-tree`), motivos anidados `security.motivo.*`, `ficherosQueDifieren` devuelve `[{ruta, cambio}]` |
| `lib/compiler.mjs` | las ~35 reglas de calidad y los 4 mensajes de integridad que imprime `check` |
| `lib/projection.mjs` | los problemas del contrato de la proyección |
| `lib/vendor.mjs` | etiquetas de los patrones con código; avisos `{code, params, text}` |
| `lib/review.mjs` | la página entera (cabeceras, botones, avisos, pie) en el idioma efectivo |
| `lib/promote.mjs` | `reasonCode`/`reasonParams` y `detalleCode` sin mover el `reason` (que se anota como `why`) |
| `lib/i18n/index.mjs` | `textoDeCodigo`: el único sitio donde se decide la reserva (clave ausente → dato crudo) |

No se migran, y se declaran: `lib/definitions.mjs` (superficie del modelo, contrato congelado) y `client.js`
(ya bilingüe por el servicio `locale` del anfitrión).

## Medido sobre el commit de cierre

- `npm test`: **889 pruebas, 889 pasan, 220 suites**.
- `npm run test:hermetic`: 889/889, huella del almacén real **idéntica** antes y después.
- `node tools/i18n-gate.mjs`: **938 claves por idioma**, 16 operaciones × 2 nombres, 1 activo por idioma.
- `node tools/ascii-gate.mjs`: **8.308 caracteres, tope 8.308**, **26/26** ficheros, 0 excluidos.
- Con el binario sobre una **copia** del almacén (nunca el real) y `DSH_LANG=en`: `audit`, `security`, `doctor`,
  `list`, `active`, `retired`, `systems`, `ownership`, `where` → **0 prosa española**.
- `audit --json` en `en` y `es`: **mismo dato** (44 skills en la copia fija, PASS 43 · WARN 1 · ERROR 0, 32
  archivadas, mismas reglas, mismas severidades, mismos estados en disco); sólo cambia la prosa.
- Sobre el **almacén de la máquina**, solo lectura y con la huella del árbol idéntica antes y después: `doctor`
  exit 0, `audit` 50 skills auditadas (PASS 49 · WARN 1 · ERROR 0, 32 archivadas) y `security` 45 revisadas con
  0 bloqueos, 0 avisos y cadena válida. El WARN 1 es el `absolute-path` preexistente.
- Mutación del e2e de actualización: retirar la comprobación de integridad de la base pone en rojo el caso 4 y
  sólo ese; restaurado, 5/5.

## Límites que siguen vigentes (declarados, no resueltos)

1. `normalizeResult` del anfitrión recorta el resultado a `{kind, text}`: la reserva de prosa **no se retira por
   calendario**; se retira cuando una medición demuestre que `code`/`items` llegan al consumidor.
2. La visibilidad del menú `/` no se puede medir sin pantalla: se informa aparte de la invocabilidad y del
   registro, que sí se miden (16 nombres activos por idioma, el del otro idioma no invocable).
3. `absolute-path` sobre una skill del almacén: WARN preexistente, se cierra localizándola o parametrizando la
   ruta; se declara y no se oculta.

## Siguiente operación exacta si hay que tocarlo

`git checkout v5.0.0`, `cd skill-compiler`, `npm install`, `npm test`. Para cambiar un texto visible:
`lib/i18n/{en,es}.mjs` (ASCII, misma clave y mismos placeholders), y si el conteo no ASCII baja, actualizar
`tools/ascii-baseline.json` con `--update` revisando el diff.
