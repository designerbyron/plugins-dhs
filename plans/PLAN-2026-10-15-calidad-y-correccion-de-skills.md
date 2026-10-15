# Plan — la calidad de una skill y la corrección: que nazca óptima y que se pueda enmendar

**Estado: PROPUESTO — espera autorización del autor por el SHA-256 de este fichero.** Nada de lo que sigue
está implementado: este documento es el plan, no el resultado.

Fecha: 2026-10-15. Autor de las decisiones: Byron. Redactado tras medir el almacén y la puerta reales.

## Lo que pidió el autor

> Que desde que se propone una skill, esta sea **realmente optimizada**: fáciles de comprender, sin
> sobrecargar el contexto y sin perderlo, porque *el conocimiento tiene un costo y se paga por él*. Que el
> **detalle que dispara la decisión** de proponer esté mejor puesto, para que no se pasen por alto detalles
> pequeños que a veces hacen la diferencia, con el mismo criterio al **actualizar**. Y que el
> **aprendizaje/parche sea automático**, con buenos criterios: el modelo declara cosas, después admite que se
> equivocó, y debe poder **corregirse y corregir la skill sin problemas**.

## Las tres decisiones del autor (2026-10-15)

1. **La corrección automática propone sola y espera aprobación humana.** No activa ni publica nada, y la
   puerta se aplica igual. (Conserva intacta la regla 4: nada se activa solo.)
2. **La auditoría entra también sobre lo ya aprobado, y es de solo lectura**: señala lo que no cumple, no
   toca nada.
3. **El disparador no cuesta contexto fijo**: salta cuando la contradicción ya apareció en la sesión. No se
   añade una revisión obligatoria en cada cierre.

## Lo medido antes de diseñar (2026-10-15, almacén real)

| Dato | Valor medido |
|---|---|
| `PROTOCOL` (entra en el prompt de **cada** sesión) | **1.175 / 1.200** caracteres — al borde del contrato de la suite |
| Descripción de `skill_propose` | 504 caracteres |
| Puerta de validación (`validateInput`, `lib/compiler.mjs:121`) | id, descripción 12–300 en una línea, body ≥200, secretos, rutas. **No mide forma, ni tamaño, ni calidad** |
| Skills en el almacén | 25: 20 aprobadas, 4 pendientes, 1 apagada (2 proyectos) |
| Peso de los cuerpos aprobados | **423 KB** (~105k tokens si se cargan); la mayor, `design-taste-frontend`, **97 KB** en una sola skill |
| Coste fijo por sesión (descripción + `whenToUse` de las 20 aprobadas) | **8.294** caracteres |
| Casos que delatan el hueco | `nuxt-storefront-frontend`: descripción de **48** caracteres, sin `whenToUse`, cuerpo de 50 KB — pasa la puerta de hoy · 7 de 20 aprobadas **sin** `whenToUse` (el campo con el que el harness selecciona) |
| Con los criterios que propone este plan | **9 de 25 conformes**, 7 por aviso, 9 con error. Las **4 pendientes de hoy están conformes**: el trabajo en curso no se rompe |

El diagnóstico, en una frase: la puerta exige **cantidad** (≥200 caracteres) y no **forma**; el disparador
dice «se reutilizará», que no discrimina; y una corrección hoy no se distingue de una propuesta nueva salvo
por el `id`, así que tampoco se puede exigir nada al que corrige.

## El diseño, pieza por pieza

### 1. El disparador y la forma: `PROTOCOL` (`lib/definitions.mjs:29`)

El protocolo se **reescribe entero** (no cabe añadir: está en 1.175 de 1.200). El borrador mide **1.181
caracteres** (contados sobre el bloque de abajo, 15 líneas), cumple los ocho asertos que ya exige
`tests/definitions.test.mjs` y añade las dos cosas que
faltaban: **qué detalle sí entra** y **cómo se corrige con medida**. Texto propuesto, exacto:

```
## Aprendizaje progresivo (skill-compiler)

Propón (`skill_propose`) si lo aprendido se reutilizará y **costó medirlo**: un contrato, una trampa ya pagada,
un orden o un valor exacto. No por una consulta, ni para repetir `AGENTS.md` o `docs/`, ni para contar lo que hiciste.

- **Nuevo** → un procedimiento, no un relato: el detalle que hace la diferencia (valor, orden, bandera, ruta)
  entra; la narración de la sesión, no. Si es largo, lo pesado va a `references/` y el cuerpo lo enlaza.
- **Ya existe y esto lo supera o lo corrige** → `skill_propose` **con el mismo id**: es una actualización, no un duplicado;
  al aprobarla, la anterior queda apartada, nunca borrada. Si desmiente algo que la skill afirma, dilo y
  **con qué lo mediste**: sin esa medida la corrección se rechaza. Consulta antes `skill_review`.
- **De otro repositorio** → `skill_vendor`: nuestra versión, el original verbatim con su procedencia; si trae
  secretos u órdenes al agente **se bloquea**, y lo dices.

Comprueba antes que otra skill no cubra el tema: el solapamiento se rechaza y dice con cuál choca. **Nada se activa solo**:
queda pendiente de aprobación humana; dilo así, con la vía más corta.
```

Y la **descripción de `skill_propose`** (lo que el modelo lee para elegir la herramienta) gana el disparador
fino y la corrección: se pasa de 504 a ~740 caracteres, con el mismo coste declarado.

### 2. La puerta de calidad: `validateInput` (`lib/compiler.mjs`)

Una regla, una implementación: la misma que hoy usan `propose`, `checkProposal`, la CLI y los comandos. Los
números salen de lo medido, no del gusto:

| Regla | Hoy | Propuesta | Motivo medido |
|---|---|---|---|
| `description` mínima | 12 | **60** | la descripción de 48 caracteres pasa hoy y no dispara nada |
| `description` máxima | 300 | 300 | sin cambio |
| `whenToUse` | opcional | **obligatorio, ≥20** | 7 de 20 aprobadas no lo tienen; es el campo de selección |
| `body` mínimo | 200 | 200 | sin cambio |
| `body` presupuesto | — | **aviso ≥8.000 · error ≥24.000** | 8 de 20 superan 8k; 4 superan 37k; el cuerpo se paga entero cada vez que se carga |
| Forma | — | **≥2 encabezados `##`** | es forma, no prosa: medible y sin heurísticas frágiles |
| `evidence` | opcional, sin mirar | **aviso** si va vacía o si una ruta declarada no existe bajo el `cwd` | convierte la evidencia en comprobable, que es lo único que la hace valer |
| Secretos y rutas personales | error | error | sin cambio |

Lo que **no** se hace, y es deliberado: la puerta **no** finge medir «esto es un relato y no un
procedimiento». Esa línea vive en el protocolo (pieza 1), porque una heurística de prosa daría rojos falsos y
un rojo falso enseña a ignorar la puerta.

### 3. El parche y la corrección: `revision`

Parámetro nuevo en `skill_propose` (y en `skill_vendor` al re-vendorizar): **`revision`**, obligatorio cuando
el id ya es nuestro y está vivo —aprobado, apagado o publicado—, con un mínimo de 40 caracteres: *qué
afirmaba la anterior, con qué se midió que no era así*.

- Sin `revision`, la puerta **rechaza** el parche de algo vivo. Es el criterio que evita el vaivén (hoy dice
  A, mañana B) sin exigirle al modelo que acierte a la primera.
- Con `revision`, el resultado lo dice: `outcome` nuevo **`corrected`** en el marcador de la interfaz, campo
  `correction: { of, why }` **declarado en el esquema de salida** (la lección ya pagada de
  `updatesProposal`: con `additionalProperties: false`, un campo devuelto sin declarar rechaza el resultado
  entero y la propuesta —ya escrita en disco— llega al modelo como un error).
- El resumen y la tarjeta dicen «Corrección de X» en vez de «Skill actualizada», y nombran el `superseded/`.

Así es «automático» sin romper la regla 4: cuando una medición desmiente una skill viva, el modelo propone la
corrección **en cuanto lo mide**, sin que nadie se lo pida, y no tiene que pelear con duplicados ni con
conflictos. Lo que sigue siendo humano es la aprobación.

### 4. La auditoría: `audit` (solo lectura)

Comando nuevo en la CLI: aplica **la misma puerta** (`validateInput`) a lo propuesto y a lo aprobado del
proyecto actual —o de todos con `--all`— y lista sólo lo que no cumple, con el número y el motivo. No toca,
no mueve, no aprueba nada.

- **No entra en `doctor`** como exigencia sobre el almacén real: si lo hiciera, `doctor` quedaría rojo para
  siempre por las skills grandes que ya están. `doctor` sólo comprueba que la auditoría **corre y es
  determinista**.
- **No se añade superficie al compositor**: la auditoría es del humano y vive en la CLI, sin coste de
  contexto. La herramienta del modelo sigue siendo `skill_review` (solo lectura) y nada más.

### 5. Versión y prueba

- **Cambia el contrato de la herramienta** (parámetros obligatorios nuevos, `revision` condicional, campo
  `correction` en la salida) → por el propio criterio de `CHANGELOG.md` esto es **v2.0.0**, no un menor.
- Cada regla nueva entra con su **prueba roja primero** (regla de oro 8). `tests/helpers.mjs` sube su
  `GOOD_BODY` y su `goodInput` a los mínimos nuevos: ese cambio es, a la vez, la demostración de que la
  puerta mide algo nuevo.
- Las 25 skills del almacén **se auditan y se documenta el resultado** (9 conformes, 7 avisos, 9 errores,
  con la lista): es la evidencia de que la auditoría sirve, y no toca ninguna.

## Fase 0 — la verificación que decide el techo (antes de tocar la puerta)

El diseño manda el peso a `references/`, y eso **hay que demostrarlo, no suponerlo**: hoy el plugin ya
escribe `upstream/` y `provenance.json` **dentro** de la carpeta de una skill y el proveedor declara
`resourceBase: { kind: 'directory' }` (`lib/definitions.mjs:326`), lo que indica que los ficheros de al lado
son alcanzables — pero eso es inferencia, no medida.

- **Se mide**: que una skill aprobada con un fichero adjunto en su carpeta sea legible por el modelo
  (lectura real, con su ruta y su contenido de vuelta).
- **Si se demuestra** → el presupuesto del cuerpo es **error** a los 24.000 caracteres, con la vía
  `references/` dicha en el mensaje.
- **Si no se demuestra** → el presupuesto se queda en **aviso** y la vía que se ofrece es partir el
  conocimiento en dos skills (una que decide y otra que detalla). Queda escrito, no improvisado.

## Efectos declarados (lo que este plan NO esconde)

- **Subir mínimos puede rechazar propuestas futuras legítimas.** Mitigación: lo que es heurística débil
  (evidencia ausente, rutas que no existen, cuerpo entre 8k y 24k) es **aviso**, no error.
- **Siete skills ya aprobadas pasarían a aviso y cuatro a error**, y no se arreglan solas. Quedan listadas por
  `audit`; arreglarlas es otra decisión, y no entra aquí.
- **El protocolo no baja, sube 6 caracteres** (1.175 → 1.181) y se queda con 19 de margen. Si el autor
  quiere margen de verdad, la vía es quitar del protocolo la vía de `skill_vendor` (que ya vive en la
  descripción de su herramienta) y bajar a ~900. **Decisión suya, y este plan la deja abierta a propósito.**
- **Nada de esto se commitea ni se publica** sin autorización expresa. El CLI del plugin no se actualiza en la
  app hasta que el autor recargue el plugin: es el mismo límite ya declarado en v1.8.0.

## Lo que no entra

- No se toca ninguna skill existente (ni se acorta, ni se renombra, ni se re-vendoriza).
- No se añaden herramientas nuevas al modelo ni comandos al compositor.
- No se cambia el anti-solapamiento, ni el ámbito, ni el modo de aprobación automática.

## Cierre

Orden de ejecución: Fase 0 → protocolo y descripción → puerta → `revision`/`corrected` → `audit` → pruebas y
documentación (`OPERACION.md`, `README.md`, `CHANGELOG.md` v2.0.0, `MEMORY.md`, y la regla de oro que nace
de aquí) → `npm test` completo, `npm run test:hermetic`, `doctor`, y el ciclo medido por el CLI real en una
arena. El informe cierra con VEREDICTO / GIT / PRÓXIMO PASO.

Autorización: por el **SHA-256 de este fichero**. Cualquier cambio —incluido el de un número— invalida la
autorización y exige plan nuevo, hash nuevo y autorización nueva.
