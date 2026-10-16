# Plan — el tiempo de los avisos y el aviso mixto

**Fecha:** 2026-10-16 · **Ámbito:** `skill-compiler` (superficie visible) · **Estado:** propuesto (fases con gate)
**Base:** el acto anterior sin versionar (v3.0.0 en `package.json`, sin commit)

---

## 0. Lo que se pide, y lo que la auditoría midió

Pedido: *«¿cuánto tiempo deben permanecer las notificaciones en pantalla? Un aviso no debería mantenerse
indefinidamente. ¿Y qué pasa cuando una sesión necesita mostrar aviso de nueva skill y actualización de otra u
otras?»*

Auditoría hecha antes de este plan, con la proyección real y el diccionario real. Lo medido:

| # | Comprobación | Resultado real |
|---|---|---|
| 1 | ¿Hay algún temporizador o expiración en la píldora? | **Ninguno.** El único `setTimeout` de la pieza (400 ms) es un reintento de lectura de filas, no un temporizador de aviso: **la píldora permanece indefinidamente** |
| 2 | Crea una skill **y actualiza** otra en el mismo turno | Se pinta «Skill existente actualizada: *la-segunda*»: **la creación no aparece en ninguna parte** |
| 3 | Crea, actualiza, crea (tres resultados) | «Nueva skill creada: *la-última* **×3**»: el contador **mezcla 2 nuevas + 1 actualizada** |
| 4 | Crea una y **rechaza** otra | «**No se creó ninguna skill**» — con `created=1` en el dato: **miente** |
| 5 | ¿Qué puede medir la píldora del turno? | Un **`outcome` único** (el último resultado pisa al anterior) y dos contadores (`created`, `updated`). No hay recuento de rechazadas ni de bloqueadas |
| 6 | Frase más larga que la píldora puede pintar | **73 caracteres** (`verbo_full` + un id de 44), ≈13 palabras |
| 7 | Tiempo de lectura de esa frase | **3,9 s** a 200 ppm · 3,2 s a 250 ppm (calculado con la tasa declarada, no a ojo) |
| 8 | ¿La información del aviso vive en otro sitio? | **Sí**: el resultado de la herramienta queda en el flujo del chat (la píldora es un resumen, no el registro) |

**Causa raíz, en una frase:** la píldora describe el turno con **un solo verbo** y no lo retira nunca, así que
o miente sobre lo que pasó (casos 2–4) o no deja de ocupar (caso 1).

## 1. El aviso mixto: contar por tipo, no por último resultado

El estado pasa a llevar **un recuento por tipo** —`created`, `updated`, `rejected`, `blocked`— y la frase se
compone de los tipos que ocurrieron, en ese orden:

| Lo que pasó en el turno | Lo que se pinta |
|---|---|
| Sólo una creación | «Nueva skill creada: `<id>`» *(igual que hoy)* |
| Sólo una actualización | «Skill existente actualizada: `<id>`» *(igual que hoy)* |
| Una creación **y** una actualización | «1 nueva · 1 actualizada *(2 skills)*» con los ids en el `title` |
| Crea, actualiza, crea | «2 nuevas · 1 actualizada» |
| Crea una y rechaza otra | «1 nueva · 1 rechazada» — **nunca** «no se creó ninguna» |
| Nada que aprender | «Sin cambios: no hubo nada que aprender» *(igual que hoy)* |

Reglas de composición:
1. **Ningún resultado se pierde**: cada tipo que ocurrió aparece, aunque sea con la cuenta de 1.
2. **Con un solo tipo y una sola skill, la frase no cambia** — lo que ya funciona no se toca.
3. El **id** se enseña sólo cuando hay una sola skill; con varias, la cuenta y los ids en el `title`.
4. El `×N` de hoy desaparece como tal: era la forma de contar un acumulado mezclando tipos, que es
   exactamente la mentira del caso 3. Donde hacía falta el acumulado, ahora hay dos cuentas honestas.

## 2. El tiempo: cuándo se retira un aviso

**El cliente decide el tiempo, no la proyección.** Una proyección es un plegado **puro y reproducible** de
eventos de la sesión: meterle un reloj la haría no reproducible y mentiría al releer el punto de control. El
tiempo es una preferencia de vista, como el cierre de la tarjeta (que ya vive en `sessionStorage`).

| Tipo de aviso | Cuánto permanece | Por qué |
|---|---|---|
| **Informativo** (nueva, actualizada, sin cambios) | **8 s**, con una salida suave | 2 × el peor tiempo de lectura medido (3,9 s): da tiempo a verlo, dirigir la mirada y leerlo, y no se queda |
| **Requiere atención** (rechazada, bloqueada) | **30 s** | No es información de paso: puede exigir una decisión (mejorar la propuesta, mirar el origen). Tampoco es indefinido |
| Con el **foco** en la píldora o el **puntero** encima | **No se retira** hasta que salgan | WCAG 2.2.1 (pausar, detener, ocultar): un aviso no puede desaparecer bajo los dedos de quien lo está leyendo |
| Con `prefers-reduced-motion` | El mismo tiempo, **sin transición** | La preferencia es sobre el movimiento, no sobre el tiempo |
| Llega un resultado **nuevo** | El anterior se retira en el acto | Lo que se anuncia es del turno; el acumulado lo lleva el contador |

Y el aviso **no es la única vía** de la información: el resultado de la herramienta queda en el flujo del
chat, y el `title` de la píldora lleva el detalle. Un aviso que se retira sin dejar rastro sería el defecto;
retirarse dejando el registro donde está, no.

## 3. Fases, con su gate

| Fase | Qué se hace | Gate de salida |
|---|---|---|
| **1** | El recuento por tipo en el plegado, la vista y la frase | Los cuatro casos medidos (A–D) dicen lo que pasó; el caso de un solo tipo **no cambia** de frase; ninguna prueba existente se edita para pasar |
| **2** | La retirada por tiempo en el cliente | Informativo se retira a los 8 s; atención a los 30 s; el foco y el puntero lo pausan; un resultado nuevo retira el anterior; el temporizador se limpia al desmontar |
| **3** | La documentación: `FEEDBACK-VISUAL.md` (tabla del tiempo y del aviso mixto), `CHANGELOG.md`, `POLITICA` si aplica | Coherencia docs↔código↔versión en verde |
| **4** | Verificación y sincronización | Suite completa, `test:hermetic` idéntico, `doctor` verde, prueba de fuego con los casos medidos, y **commit + push** verificando remoto = local |

## 4. Reglas de ejecución

1. **Lo que ya funciona no se toca**: con un solo resultado, la frase y el comportamiento son los de hoy, y se
   demuestra con asertos que ya pasaban (cero borrados en esos ficheros).
2. **El defecto se demuestra rojo antes del arreglo** (los cuatro casos ya están medidos; se congelan como
   pruebas).
3. **La proyección sigue siendo pura**: sin relojes, sin `Date.now()`, reproducible byte a byte.
4. **Nada se retira sin dejar el registro** en su sitio (el flujo del chat y el `title`).
5. **El almacén real no se toca** (solo lectura en las sondas; huella antes = después).
6. **El plan firmado no se reescribe**: cualquier desviación se registra en el informe.

## 5. Lo que este plan NO hace

- No añade una **bandeja** ni una X a la píldora: la píldora es un resumen del turno, y su salida es el tiempo
  (y el turno siguiente). La decisión de aprobar vive donde ya vive.
- No cambia el **contrato de los eventos** de sesión: se sigue plegando de los que ya existen, sin tipos
  propios (la guía de DSH lo prohíbe, y está medido).
- No toca los avisos de la **tarjeta** del comando (`commandview`): eso ya tiene su X y su memoria de vista.
