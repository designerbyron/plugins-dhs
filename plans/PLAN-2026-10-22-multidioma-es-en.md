# Plan · plugin en inglés canónico, con opción de idioma ES/EN (v4.0.0)

**Estado: propuesto (revisión 2). No hay nada implementado.** Se aprueba o se corrige antes de tocar código.
Auditoría que lo sostiene: [`docs/AUDITORIA-2026-10-22-multidioma.md`](../docs/AUDITORIA-2026-10-22-multidioma.md).

Base: `64372c4`, 614 pruebas, `audit` 48 · PASS 47 · WARN 1 (propuesta pendiente) · ERROR 0.

> **Qué cambia respecto a la revisión 1.** La primera traducía los textos y dejaba los identificadores como
> estaban. La dirección correcta es la contraria: **el plugin se normaliza al inglés** —comandos, flags, textos y
> códigos— y el español pasa a ser una **opción de presentación**. La auditoría lo confirma (F-9): la CLI y los
> flags ya son ingleses; los 16 comandos de sesión y los textos son el único resto en español.

---

## 1 · Decisión

**Inglés canónico, español opcional.** Una sola lengua para todo lo que es contrato —nombres de comando, flags,
códigos, valores de estado— y dos para lo que lee una persona, elegida con `/skill-compiler --language es|en`.

| Capa | Idioma | ¿Se traduce? |
|---|---|---|
| Nombres de comando, flags, códigos, ids, rutas, `meta.json`, frontmatter | **inglés** | no: son contrato |
| Textos de comandos, CLI, errores, panel | inglés por defecto; español si se pide | sí |
| Descripciones de herramientas y protocolo (lo que lee el modelo) | **inglés** | no |
| `decision` del diario (`aprobada`, `publicada`…) | **español, congelado** | no: es evidencia |
| Cuerpos de las `SKILL.md` | el que escriba la persona | no |
| Documentación del repositorio | español en esta versión; README en inglés (F4) | aparte |

La excepción del diario no es comodidad: `security` verifica la cadena sobre esos valores y las series históricas
se leen por ellos. Se quedan como están **para siempre**, y su etiqueta en pantalla se resuelve por una tabla
(`aprobada` → `approved` / `aprobada`). Traducirlos rompería la evidencia; reescribir el pasado no es una opción.

---

## 2 · Por qué esto es viable

1. **Ya está medio hecho.** La CLI (26 subórdenes) y los flags son ingleses desde siempre; las herramientas del
   modelo también. Falta el vocabulario de la sesión: 16 comandos y sus textos.
2. **El coste está medido.** 596 apariciones de esos 16 nombres en 41 ficheros, pero sólo ~10 son código y
   documentación viva; el resto son planes y el registro histórico, que **no se tocan** (evidencia).
3. **Los textos ya tienen una puerta.** El panel usa el servicio `locale` con diccionario `es`/`en`; el servidor
   no tiene ninguna. `lib/i18n/` es un módulo nuevo, no una cirugía.
4. **Los datos no se mueven.** Ni ids, ni almacén, ni diario, ni `meta.json`: la migración es de vocabulario y de
   textos, y por eso es reversible por fase.

Lo que **no** es viable sin coste: renombrar comandos **sin** alias. Hay memoria muscular, documentación y skills
escritas que invocan `skill-aprobar`. Por eso los nombres viejos sobreviven como **alias**.

---

## 3 · Contrato de nombres

### 3.1 · Los 16 comandos

| Hoy (español) | Canónico (inglés) |
|---|---|
| `skill-propuestas` | `skill-proposals` |
| `skill-pendientes` | `skill-pending` |
| `skill-ver` | `skill-show` |
| `skill-aprobar` | `skill-approve` |
| `skill-globalizar` | `skill-publish` |
| `skill-ambito` | `skill-scope` |
| `skill-rechazar` | `skill-reject` |
| `skill-deshabilitar` | `skill-disable` |
| `skill-habilitar` | `skill-enable` |
| `skill-eliminar` | `skill-retire` |
| `skill-retiradas` | `skill-retired` |
| `skill-propiedad` | `skill-ownership` |
| `skill-propiedad-dsh-only` | `skill-ownership-dsh-only` |
| `skill-propiedad-machine` | `skill-ownership-machine` |
| `skill-sistemas` | `skill-systems` |
| `skill-auto` | `skill-auto` (ya es inglés) |

**Alias:** los 15 nombres viejos se registran como alias funcionales del canónico, con descripción que empieza
por `deprecated:` y sin fila en el menú `/`. Se retiran en **5.0.0**, no antes: una versión mayor para quitar,
como manda la tabla de contrato del README.

**Comando de ajustes:** `skill-compiler`, la puerta única a la configuración del plugin.

```
/skill-compiler                       estado: idioma efectivo y de dónde sale, ámbito, pendientes
/skill-compiler --language es|en      fija el idioma y lo persiste
/skill-compiler --language            informa sin cambiar nada
```

En la CLI: `node bin/skill-compiler.mjs lang [es|en]` (sin argumento, informa). Mismo ajuste, mismo fichero: dos
puertas, una verdad.

### 3.2 · Lo que **no** cambia de nombre

Ids de skill, valores de `decision`, campos de `meta.json`, claves del frontmatter, rutas del almacén, nombres de
regla (`body-budget`, `secreto`, `ruta-absoluta`…) y los 26 subórdenes de la CLI. Cambiar cualquiera de ellos es
romper datos o historia; ninguno hace falta para tener un plugin en inglés.

---

## 4 · Arquitectura

```
lib/i18n/
  index.mjs      resolveLang(), t(key, params), setLang(), langInfo()
  es.mjs         catálogo español (completo)
  en.mjs         catálogo inglés (base y reserva)
  codes.mjs      códigos estables + parámetros admitidos
  decisions.mjs  etiqueta por idioma de los valores del diario (sin tocarlos)
```

- `t(key, params)` con el idioma resuelto **una vez** por proceso. Sin concatenar cadenas para componer mensajes.
- **Precedencia:** `DSH_LANG` → `config.json` del almacén (`{"lang":"es"}`) → locale del sistema → `en`. Etiquetas
  normalizadas (`es-ES`, `es_419`, `ES` → `es`); un idioma desconocido no es error: se usa el defecto y `doctor`
  lo dice.
- **Resultado de comando:** `{kind, text, code, params}`. El panel decide por `code`; `text` es presentación. El
  panel conserva el reconocimiento por prosa **una** versión menor (hosts viejos) y se retira después.
- **Alias:** `ALIASES = {'skill-aprobar': 'skill-approve', …}` registra el nombre viejo apuntando al mismo
  handler. Una prueba comprueba que alias y canónico producen **el mismo `code` y el mismo efecto**.
- `tools/i18n-gate.mjs`: falla si aparece un literal con acento fuera de `lib/i18n/`, si un catálogo tiene claves
  de más o de menos, o si un nombre de comando registrado no es inglés (los alias, exentos y declarados).

### Códigos estables (borrador; se cierra en F1)

| Grupo | Códigos |
|---|---|
| Decisión | `activated`, `already-active`, `updated-disabled`, `published`, `set-aside`, `enabled`, `disabled`, `retired`, `rejected` |
| Pregunta | `scope-ask` (sustituye a `SCOPE_ASK`), `language-ask` |
| Negativas de la puerta | `no-proposal`, `with-warnings`, `unsafe-id`, `no-scope`, `topic-conflict`, `id-conflict` |
| Lote | `batch-partial`, `batch-empty` |

Cada uno con sus parámetros (`id`, `key`, `warnings[]`, `done[]`, `failed[]`). `text` se compone desde el
catálogo; `params` viaja aparte para que el panel no tenga que partir cadenas.

---

## 5 · Fases

### F0 · Cimientos y contrato de nombres (sin cambiar todavía los textos)

- `lib/i18n/{index,es,en,codes,decisions}.mjs`; resolución y normalización de idioma; `config.json`.
- Renombrar los 16 comandos al inglés **con alias** de los viejos; actualizar filas del menú y descripciones.
- `skill-compiler --language` y `lang` en la CLI; `doctor` informa idioma, origen y alias activos.
- Tabla de contrato del README actualizada (canónicos + alias + retirada en 5.0.0).
- Pruebas: alias ≡ canónico (código y efecto), resolución de idioma, idioma desconocido, `config.json`.
- **Criterio:** los 614 tests verdes (con los nombres actualizados donde eran contrato), `audit`/`security`/
  `doctor` idénticos, y el mismo estado en disco usando el nombre viejo o el nuevo.

### F1 · Textos del servidor en inglés, con diccionario

- Migrar al catálogo los textos de los 16 comandos y de la CLI (ayuda, errores, salidas); `en` es la base y `es`
  la traducción completa.
- `code` + `params` en cada resultado.
- **Criterio:** misma decisión y mismo efecto en `es` y `en`; los 32 asserts de prosa pasan a código; ninguna clave
  cruda.

### F2 · Panel

- Leer `code`/`params` con reserva al regex; arreglar F-2 (`bulk_ids_hint` en el bloque equivocado) y F-3
  (reserva `es` → base `en`).
- **Criterio:** paridad bidireccional de claves; en host inglés no aparece una palabra en español, y al revés.

### F3 · Motor y puertas

- Migrar `compiler`, `security`, `repair`, `audit`, `promote`, `scope`, `auto-update`.
- `tools/i18n-gate.mjs` en verde, **y demostrado en rojo** con un literal nuevo de prueba.
- **Criterio:** gate verde y suite completa verde.

### F4 · Documentación y release

- `docs/OPERACION.md` (idioma, precedencia, cómo añadir un idioma), `docs/ANFITRION.md` (reserva por prosa una
  versión), `CHANGELOG` **4.0.0**, README en **inglés** con `README.es.md` enlazado.
- Release `v4.0.0` con nota de compatibilidad: canónicos + alias, retirada de alias en 5.0.0, y qué no cambió
  (ids, diario, almacén).
- **Criterio:** suite + hermética verdes antes de etiquetar; `describe` limpio.

**Esfuerzo:** F0 día y medio (el renombrado con alias es lo que más toca), F1 día, F2 medio día, F3 un día, F4
medio día. ~4,5 días en cinco entregas verificables.

---

## 6 · Pruebas

| Prueba | Qué mide |
|---|---|
| `tests/i18n.test.mjs` | precedencia, normalización, `config.json`, `lang` de la CLI, idioma desconocido |
| `tests/i18n-paridad.test.mjs` | claves iguales en `es` y `en`; ninguna cruda; valores no vacíos |
| `tests/i18n-codigos.test.mjs` | todo `code` emitido existe; todo código tiene texto en los dos idiomas |
| `tests/i18n-efecto.test.mjs` | la misma orden en `es` y `en` deja **el mismo estado en disco** y el mismo `code` |
| `tests/i18n-datos.test.mjs` | ids, `decision`, `meta` y frontmatter intactos; vocabulario del diario congelado |
| `tests/alias.test.mjs` | cada alias existe, resuelve al canónico, mismo `code` y mismo efecto, y está declarado obsoleto |
| `tools/i18n-gate.mjs` | ningún literal con acento nuevo fuera de `lib/i18n/`; nombres de comando en inglés |

Y las de siempre: suite completa, hermética, `audit`, `security`, `doctor`, `coherencia`.

---

## 7 · Riesgos y reversión

| Riesgo | Contención |
|---|---|
| Romper la memoria muscular de quien escribe `skill-aprobar` | alias funcionales durante toda la 4.x; se retiran en 5.0.0 |
| Panel leyendo prosa traducida (F-1) | `code` primero, regex como reserva una versión, prueba de contrato |
| Deriva de traducciones (F-2) | paridad bidireccional en cada ejecución |
| Volver a hardcodear (F-5) | `tools/i18n-gate.mjs` |
| Tocar datos por «normalizar» | `tests/i18n-datos.test.mjs` falla si cambia un id, una `decision` o una ruta |
| Alias eternos | fecha de retirada en el contrato y aviso en la descripción del alias |

Reversión: `DSH_LANG=es` devuelve la presentación en español; cada fase es un commit; quitar `config.json` vuelve
a la resolución por entorno y sistema; ninguna fase escribe en `projects/`, `global/` ni el diario.

---

## 8 · Lo que este plan no hace

- No traduce las `SKILL.md` ni los cuerpos que escribe el usuario.
- No traduce la documentación (salvo el README, que pasa a inglés con copia en español).
- No toca las descripciones ni el protocolo del modelo: ya están en inglés y se quedan.
- No renombra ids, estados del diario, rutas ni campos de `meta.json`.
- No añade un tercer idioma; deja el camino abierto (un fichero por idioma).

---

## 9 · Para aprobar

Los tres puntos que cambian el resultado:

1. **Nombres canónicos en inglés con alias** —y retirada de alias en 5.0.0—, en vez de mantener los españoles
   como canónicos.
2. **`/skill-compiler --language es|en`** como puerta única de ajustes, persistido en `config.json`; por defecto
   **`en`**.
3. **El diario se queda en español**, con etiqueta traducida en pantalla: es evidencia, no interfaz.

Aprobado esto, se empieza por **F0** y se para al final de cada fase con su medición.
