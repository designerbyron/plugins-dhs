# Auditoría de internacionalización (ES/EN) — 2026-10-22

Motivo: preparar la siguiente versión del plugin `skill-compiler` como **multi-idioma** (inglés y español como
mínimo). Esta auditoría es de sólo lectura: no cambia código ni el almacén. El plan que sale de aquí está en
[`plans/PLAN-2026-10-22-multidioma-es-en.md`](../plans/PLAN-2026-10-22-multidioma-es-en.md).

Todo lo que sigue está medido sobre `HEAD` = `38f70b2` (v3.9.3 + 2 commits de documentación), 614 pruebas.

---

## 1 · Las superficies, y quién lee cada una

La pregunta que decide todo: **quién lee este texto**. No es lo mismo un mensaje para la persona que un
protocolo para el modelo, y no es lo mismo un texto que una máquina interpreta.

| # | Superficie | Dónde vive | Quién la lee | Estado hoy |
|---|---|---|---|---|
| S-1 | Tarjeta del panel (botones, avisos, resultados) | `client.js` | humano (navegador) | **ya bilingüe**: diccionario `es`/`en` registrado en el servicio `locale` del host |
| S-2 | Comandos de sesión (16 nombres, descripciones y textos) | `lib/commands.mjs` | humano (menú `/` y respuesta) | español fijo |
| S-3 | CLI: 26 subórdenes, 40 líneas de ayuda, errores | `bin/skill-compiler.mjs` | humano (terminal) | español fijo |
| S-4 | Mensajes de la puerta y del motor | `lib/compiler.mjs`, `security.mjs`, `repair.mjs`, `audit.mjs`, `promote.mjs`, `scope.mjs`, `auto-update.mjs` | humano | español fijo |
| S-5 | Descripciones de las herramientas y protocolo | `lib/definitions.mjs` (51 descripciones + protocolo) | **el modelo** | español fijo |
| S-6 | Datos: ids, `decision` del diario, `meta.json`, frontmatter, rutas del almacén | todo el plugin | máquina | **no tienen idioma**; no se tocan |

Volumen de literales de cadena por fichero (heurística sobre literales de 3+ caracteres):

| Fichero | Líneas | Literales | Con acento | Español probable |
|---|---:|---:|---:|---:|
| `lib/compiler.mjs` | 2.125 | 450 | 127 | 30 |
| `lib/commands.mjs` | 821 | 207 | 73 | 13 |
| `lib/repair.mjs` | 755 | 146 | 53 | 5 |
| `lib/security.mjs` | 419 | 110 | 20 | 8 |
| `lib/audit.mjs` | 268 | 89 | 5 | 3 |
| `lib/promote.mjs` | 451 | 100 | 25 | 4 |
| `lib/definitions.mjs` | 685 | 229 | 48 | 9 |
| `lib/scope.mjs` | 821 | 269 | 35 | 9 |
| `lib/auto-update.mjs` | 163 | 86 | 10 | 0 |
| `bin/skill-compiler.mjs` | 944 | 314 | 52 | 17 |
| `client.js` | 1.372 | 491 | 78 | 10 |
| `index.js` | 392 | 50 | 15 | 0 |
| **Total** | 9.216 | **2.541** | **541** | 108 |

No todos son textos de interfaz (hay rutas, ids, nombres de regla, claves de `meta`). La cifra sirve para
dimensionar, no para prometer: la migración real se hace **por mensaje que se enseña**, no por literal.

---

## 2 · Hallazgos

### F-1 · El panel deduce el resultado **leyendo prosa** — severidad alta, bloquea la i18n ingenua

`client.js` decide si una orden salió bien interpretando el **texto** que devuelve el servidor:

```js
const SCOPE_ASK = '¿Dónde quieres que viva';
...
const veredicto = (texto, ids) => { ... /^(?:Activa|Publicada|Apartada|Habilitada|Deshabilitada|Retirada|Ya estaba activa):\s*(\S+)/ ... }
```

Traducir el servidor sin tocar esto rompe la tarjeta **en silencio**: la skill se aprueba y el panel informa
«0 hechas · 1 fallo», o pierde el id al preguntar el ámbito. No es hipotético: el mismo patrón ya costó un
defecto real en 3.8.6 (el panel creía la fila del menú en vez del veredicto).

**Consecuencia de diseño:** el contrato cliente↔servidor no puede ser prosa en ningún idioma. Tiene que ser un
**código estable** con parámetros; el texto pasa a ser presentación.

### F-2 · `bulk_ids_hint` está en el idioma equivocado, y falta en el otro — severidad alta, defecto vivo

Medido: el diccionario del panel tiene **77 claves en `es` y 78 en `en`**. La clave que falta en español existe
en el bloque inglés **con el texto en español**:

```js
// dentro de `en: {` …
bulk_ids_hint: 'Sin filas en esta sesión: el comando con el id funciona igual.',
```

Efectos medidos por lectura del traductor (`FALLBACK[key] ?? key`):

- En un host **español**: la clave no está en `FALLBACK.es` → se pinta literalmente `bulk_ids_hint`.
- En un host **inglés**: se pinta una frase en español.

Ninguna de las dos se ve en las pruebas actuales: no hay prueba de paridad de claves.

### F-3 · La reserva es español — severidad media

`const FALLBACK = DICTIONARIES.es;`. Si el host no pasa `t` (versión vieja, o `locale` no disponible), todo cae
a español **aunque el host esté en inglés**. Para un plugin que se distribuye, la reserva debe ser el idioma
base, y hoy el idioma base de facto es el español: no hay decisión escrita de cuál es.

### F-4 · El servidor no tiene forma de saber el idioma — severidad media, bloquea S-2/S-3/S-4

El servicio `locale` es del **cliente**. `lib/` y `bin/` no leen ningún ajuste: no hay `DSH_LANG`, no hay
`config.json`, y `process.env.LANG` no se consulta. Raíz medida: el almacén sólo tiene `global/`, `locks/`,
`ownership.json` y `projects/`.

Sin un ajuste explícito, los comandos y la CLI tienen que **elegir** idioma a ciegas. Y elegir por `Intl` en
Windows suele dar `en-US` por defecto del sistema aunque la persona trabaje en español: la heurística sola no
basta.

### F-5 · No hay puerta que impida volver a hardcodear — severidad baja, pero es la que sostiene el resultado

541 literales con acento viven fuera de cualquier módulo de traducción. Sin una comprobación que **falle** al
añadir texto nuevo con acento fuera de `lib/i18n/`, la migración se deshace sola en tres versiones. Es la misma
lección de la puerta hermética: lo que no se mide, se pierde.

### F-6 · La migración es barata: 32 de 2.260 aserciones dependen de prosa — dato a favor

Medido por fichero de prueba: **32** aserciones (1,4 %) comprueban texto español (`Activa:`, `tiene avisos`,
`no hay ninguna propuesta`…). El resto mide códigos de retorno, efectos en disco y estructura. Cambiar 32
aserciones a códigos estables es un trabajo acotado, no una reescritura de la suite.

### F-7 · El vocabulario del diario es **dato**, no interfaz — decisión cerrada

`aprobada`, `publicada`, `actualizada-apagada`, `globalizada`, `localizada`, `promovida`, `rechazada-por-regresion`
son valores que `security` verifica y que forman series históricas. **No se traducen nunca.** Traducirlos
rompería la verificación de la cadena y volvería ilegible el histórico. Van en una prueba que fija el conjunto
permitido.

### F-8 · Lo que lee el modelo (`definitions.mjs`) es otra decisión — se aparca

51 descripciones de herramientas y el protocolo van al modelo, no a la persona. Traducirlas no mejora la
experiencia humana y dobla el mantenimiento; en un producto pensado para viajar, lo razonable es que esa
superficie esté **en inglés fijo**. Es un cambio de comportamiento (tokens, forma de razonar del modelo) y no
pertenece a esta versión: se declara como decisión abierta y se mide aparte.

### F-9 · Los identificadores están partidos en dos idiomas — severidad media, la raíz de la asimetría

Medido: la **CLI** tiene 26 subórdenes con nombre inglés (`where`, `check`, `approve`, `scope`, `audit`,
`security`…), los **flags** son ingleses (`--global`, `--local`, `--force`, `--preserve-state`,
`--project-key`) y las **herramientas** del modelo también. Pero los **comandos de sesión** están en español:
`skill-propuestas`, `skill-aprobar`, `skill-globalizar`, `skill-rechazar`, `skill-deshabilitar`…

Hay 596 apariciones de esos 16 nombres en 41 ficheros (de los que ~10 son código y documentación viva; el resto,
planes y registro histórico). Un plugin que se presenta en inglés y se opera con verbos en español obliga a
memorizar dos vocabularios. **Consecuencia:** la normalización de identificadores al inglés no es cosmética, es
la condición para que la opción de idioma hable sólo de presentación y no de contrato.


---

## 3 · Lo que **no** se toca, y por qué

- **Ids, nombres de regla, estados, `meta.json`, frontmatter, rutas del almacén.** Son contrato y datos. Si el
  idioma entra ahí, cada instalación deja de ser comparable con las demás.
- **Los cuerpos de las `SKILL.md`.** El conocimiento lo escribe quien trabaja; el plugin no lo traduce. Un
  cuerpo por idioma es otro producto (y otra decisión).
- **La documentación del repositorio.** Se queda en español en esta versión; si se quiere una README en inglés,
  es un acto aparte con su propia revisión.

---

## 4 · Riesgos, y cómo se contienen

| Riesgo | Probabilidad | Impacto | Contención |
|---|---|---|---|
| El panel deja de reconocer resultados al traducir | alta si no se hace F-1 | alto: aprobaciones que no se reflejan | códigos estables + reserva al regex viejo + prueba de contrato |
| Deriva de traducciones (clave en un idioma y no en otro) | alta (ya pasó, F-2) | medio: clave cruda en pantalla | prueba de paridad **bidireccional** en cada ejecución |
| Texto nuevo hardcodeado tras la migración | alta sin puerta | medio: vuelve el problema | puerta `i18n` que falla al añadir literales con acento fuera de `lib/i18n/` |
| Cambiar el idioma del modelo sin querer | baja | alto: comportamiento distinto | S-5 fuera de alcance; prueba que fija que `definitions.mjs` no cambia |
| Series del diario ilegibles | baja | alto: evidencia histórica | F-7: vocabulario de `decision` fijo, con prueba |
| Un idioma sin traducir al 100 % | media | bajo | se declara el estado por idioma; nunca se pinta una clave cruda |
