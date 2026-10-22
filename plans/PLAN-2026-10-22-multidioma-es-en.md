# Plan · plugin multi-idioma ES/EN (v3.10.0)

**Estado: propuesto. No hay nada implementado.** Este documento es la propuesta que se aprueba o se corrige
antes de tocar código. La auditoría que lo sostiene está en
[`docs/AUDITORIA-2026-10-22-multidioma.md`](../docs/AUDITORIA-2026-10-22-multidioma.md).

Base: `38f70b2` (v3.9.3 + documentación), 614 pruebas, `audit` 48 · WARN 1 (propuesta pendiente) · ERROR 0.

---

## 1 · Decisión de diseño

Tres caminos posibles:

| Opción | Qué hace | Cubre | Coste | Riesgo |
|---|---|---|---|---|
| **A · Diccionario en el servidor + códigos estables** | `lib/i18n/` con `es` y `en`; cada resultado lleva `code` + `params`; el panel deja de leer prosa | S-1…S-4 | medio | medio, contenido por F-1 |
| B · Sólo el panel | el diccionario que ya existe en `client.js` | S-1 | bajo | nulo, pero **no es un plugin multi-idioma**: comandos, CLI y errores siguen en español |
| C · Traducir también las skills y la documentación | cuerpos bilingües | todo | muy alto | alto: duplica el almacén y confunde al modelo |

**Se elige A.** B ya está hecho (y tiene el defecto F-2); C no es internacionalización del plugin, es otro
producto. A es la única que deja el plugin presentable en un harness en inglés sin romper lo que ya funciona.

La pieza que hace viable A —y que la auditoría identificó como bloqueante— es que el panel **deje de adivinar
por prosa** (F-1). El servidor pasará a devolver, además del texto, un **código estable con parámetros**; el
panel decidirá por código y usará el texto sólo para mostrar.

---

## 2 · Decisiones que este plan toma (huecos rellenados)

1. **Idiomas:** `es` y `en`, completos. Un tercer idioma es añadir un fichero, no tocar código.
2. **Idioma por defecto:** `en`. Es el idioma base del producto y el que espera un harness que no diga nada; el
   español es completo y de primera clase, pero no es la reserva universal.
3. **Orden de resolución** (el primero que exista gana):
   1. `DSH_LANG` (variable de entorno; sirve para probar y para usos por lotes),
   2. `config.json` del almacén (`$DSH_HOME/skill-compiler/config.json` → `{"lang":"es"}`),
   3. locale del sistema (`LANG`/`LC_ALL`; en Windows, `Intl.DateTimeFormat().resolvedOptions().locale`),
   4. `en`.
4. **Normalización de etiquetas:** `es-ES`, `es_419`, `ES` → `es`; `en-US` → `en`. Un idioma desconocido **no es
   un error**: se usa el defecto y se dice una vez en `doctor`.
5. **Cómo se cambia:** comando de sesión `/skill-idioma [es|en]` (persiste en `config.json`) y
   `node bin/skill-compiler.mjs lang [es|en]` (imprime o fija). Sin argumento, informa el idioma efectivo y de
   dónde salió.
6. **Contrato de resultado:** `{ kind, text, code, params }`. `text` sigue siendo lo que lee una persona;
   `code` es la verdad para el panel. Los códigos **no se traducen nunca** y no cambian de forma sin versión
   mayor.
7. **Compatibilidad:** si un `code` no llega (host viejo, plugin viejo), el panel mantiene el reconocimiento por
   prosa actual durante **una** versión menor, con un aviso en `docs/ANFITRION.md`; se retira en la siguiente.
8. **Datos intactos** (F-7): ids, `decision` del diario, `meta.json`, frontmatter, rutas, nombres de regla y
   códigos. Una prueba fija el vocabulario del diario y falla si aparece un valor nuevo sin declararlo.
9. **Lo que lee el modelo** (F-8) **no se toca** en esta versión: 51 descripciones y el protocolo siguen como
   están. Queda declarado como decisión abierta con su propio acto.
10. **Documentación**: sigue en español en esta versión. Traducir la README es un acto aparte.
11. **Versión:** `3.10.0` (capacidad nueva, sin ruptura). Sin `major`: nada existente cambia de forma.
12. **Reserva por clave:** si falta una clave en el idioma pedido, se usa la del idioma base y **nunca** se pinta
    la clave cruda; la falta se reporta en la prueba de paridad y en `doctor`.

---

## 3 · Arquitectura

```
lib/i18n/
  index.mjs        resolveLang(), t(), setLang(), langInfo()   ← una sola puerta
  es.mjs           catálogo español (base para comparar)
  en.mjs           catálogo inglés
  codes.mjs        catálogo de códigos estables + parámetros que admite cada uno
```

- `t(key, params)` acepta el idioma resuelto una vez por proceso; los mensajes con datos usan
  `t('gates.id-inseguro', { id })`, no concatenación.
- `codes.mjs` es la **fuente** de los códigos; una prueba comprueba que todo `code` emitido existe en el catálogo
  y que todo código del catálogo tiene texto en los dos idiomas.
- El panel no importa `lib/` (es un artefacto de navegador): sigue con su diccionario, pero pasa a leer
  `resultado.code` cuando existe.

### Códigos que hacen falta (borrador, se cierra en F1)

| Grupo | Códigos |
|---|---|
| Decisión | `activada`, `ya-activa`, `actualizada-apagada`, `publicada`, `apartada`, `habilitada`, `deshabilitada`, `retirada`, `rechazada` |
| Pregunta | `ambito-preguntar` (sustituye a `SCOPE_ASK`), `idioma-preguntar` |
| Negativas de la puerta | `sin-propuesta`, `con-avisos`, `id-inseguro`, `sin-ambito`, `conflicto-tema`, `conflicto-id` |
| Lote | `lote-parcial`, `lote-vacio` |

Cada uno con sus parámetros (`id`, `key`, `avisos[]`, `hechos[]`, `fallos[]`). `text` se compone desde el
catálogo; `params` viaja aparte para que el panel no tenga que partir cadenas.

---

## 4 · Fases (cada una se puede entregar y revertir sola)

### F0 · Cimientos (sin cambiar ni un mensaje visible)

- `lib/i18n/` con `index`, `es`, `en` y `codes`; resolución y normalización de idioma; `config.json`; comando
  `/skill-idioma` y `lang` en la CLI; `doctor` informa idioma efectivo y origen.
- Pruebas: resolución (env > config > sistema > `en`), normalización de etiquetas, idioma desconocido, y que
  **ningún mensaje visible cambia** todavía.
- Salida: `3.10.0-alpha.1` interna, sin publicar. Criterio: suite 614 + nuevas en verde; `audit`/`security`/`doctor`
  idénticos.

### F1 · Comandos y CLI (S-2, S-3)

- Migrar los textos de los **16 comandos** y de la **CLI** (ayuda, errores, salidas) al catálogo.
- Añadir `code` + `params` a cada resultado (el texto se sigue componiendo igual, ahora desde el catálogo).
- `SCOPE_ASK` pasa a `code: 'ambito-preguntar'` (el texto se queda igual en `es` para no cambiar lo que ve hoy).
- Pruebas: los 32 asserts de prosa pasan a código; nuevas pruebas por idioma con el mismo efecto en disco.
- Criterio: mismas decisiones, mismos efectos, dos idiomas; `es` byte a byte comparable salvo los `code`.

### F2 · Panel (S-1) y cierre de F-2

- El panel lee `code`/`params` con reserva al regex actual; `bulk_ids_hint` se mueve a `es` y se traduce en `en`.
- Pruebas: paridad **bidireccional** de claves (falla si un idioma tiene una clave que el otro no), ninguna clave
  cruda en pantalla, y que un resultado con `code` produce el mismo veredicto que su texto en los dos idiomas.
- Criterio: en un host inglés no aparece una sola palabra en español; en un host español no aparece una clave.

### F3 · Motor y puertas (S-4) + la puerta anti-regresión

- Migrar `compiler`, `security`, `repair`, `audit`, `promote`, `scope`, `auto-update`.
- `tools/i18n-gate.mjs`: falla si aparece un literal con acento fuera de `lib/i18n/` (lista blanca que **sólo
  puede menguar**), y si un catálogo tiene claves de más o de menos.
- Criterio: la puerta está en verde y demuestra que falla con un literal nuevo de prueba.

### F4 · Cierre y release

- `docs/OPERACION.md` (idioma, resolución, cómo añadir un idioma), `docs/ANFITRION.md` (reserva por prosa durante
  una versión), `CHANGELOG` 3.10.0, README con la tabla de idiomas.
- Release `v3.10.0` con nota de compatibilidad. Sin etiqueta hasta que la suite completa y la hermética estén
  verdes.

**Esfuerzo estimado** (por lo medido en F1 de la auditoría: 32 asserts, 2.541 literales, de los que la mayoría no
son interfaz): F0 medio día, F1 día y medio, F2 medio día, F3 un día, F4 medio día. Total ~4 días de trabajo
efectivo, en cinco entregas verificables.

---

## 5 · Pruebas que sostienen el resultado

| Prueba | Qué mide | Cuándo falla |
|---|---|---|
| `tests/i18n.test.mjs` | resolución, normalización, reserva, `config.json`, `lang` de la CLI | si cambia la precedencia o una etiqueta no normaliza |
| `tests/i18n-paridad.test.mjs` | claves **iguales** en `es` y `en`, sin valores vacíos ni claves crudas | al añadir una clave en un solo idioma (F-2) |
| `tests/i18n-codigos.test.mjs` | todo `code` emitido existe; todo `code` del catálogo tiene texto en los dos idiomas | al inventar un código o dejar uno sin traducir |
| `tests/i18n-efecto.test.mjs` | la misma orden en `es` y en `en` produce **el mismo estado en disco** y el mismo `code` | si el idioma cambia comportamiento |
| `tests/i18n-datos.test.mjs` | ids, `decision`, `meta` y frontmatter no contienen texto traducible y el vocabulario del diario es el declarado | si alguien traduce un dato (F-7) |
| `tools/i18n-gate.mjs` | ningún literal con acento nuevo fuera de `lib/i18n/` | al hardcodear texto (F-5) |

Y las de siempre: suite completa, hermética, `audit`, `security`, `doctor`, `coherencia`.

---

## 6 · Riesgos y reversión

Los riesgos están en la auditoría (§4). La reversión es por fases y por idioma:

- `DSH_LANG=es` devuelve el comportamiento de hoy sin tocar el código (F0 ya lo permite).
- Cada fase es un commit independiente; revertir F2 devuelve el panel al regex sin tocar el servidor.
- `config.json` es aditivo: si se borra, el plugin vuelve a resolver por entorno y sistema.
- Ninguna fase escribe en `projects/`, `global/` ni en el diario.

---

## 7 · Lo que este plan **no** hace

- No traduce las `SKILL.md` ni los cuerpos que escribe el usuario.
- No traduce la documentación del repositorio.
- No toca las descripciones ni el protocolo que lee el modelo (decisión abierta, con su propio acto).
- No renombra ids, estados ni códigos existentes.
- No añade un tercer idioma: deja el camino abierto (un fichero por idioma).

---

## 8 · Para aprobar

Si se aprueba tal cual, se empieza por **F0** y se para al final de cada fase con su medición. Si se quiere
cambiar algo, los tres puntos que de verdad cambian el resultado son: el **idioma por defecto** (`en`),
la **retirada de la reserva por prosa** del panel (una versión menor después), y si **S-5** (lo que lee el
modelo) entra o no en esta versión. Los demás son detalles de implementación ya decididos.
