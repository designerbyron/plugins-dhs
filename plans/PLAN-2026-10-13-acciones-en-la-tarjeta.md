# Plan — acciones en la tarjeta del resultado, y decidir en lote

**Estado: PENDIENTE.** Este documento es el análisis y el diseño de lo que falta, medido contra el
contrato del harness el 2026-10-13. Lo que ya está hecho y publicado se dice al final; nada de aquí se ha
implementado todavía.

## Lo que se pidió

> «Que la lista de pendientes, si hay más de una, me pueda marcar checkbox; tener un step by step para que
> una vez marcadas las opciones pueda aprobar más de una al mismo tiempo. Además revisar qué otras cosas se
> pueden comportar de la misma manera para que sea más intuitivo para el usuario.»

## Por qué tiene sentido

- Aprobar hoy es **de a una**: el menú `/` ofrece una fila por pendiente y verbo (v1.4.0) y el comando con
  argumentos pide teclear el id. Con varias pendientes, el gesto se repite N veces y cada aprobación deja su
  propio bloque en el flujo.
- El propio usuario ya tropezó con el efecto acumulado: aprobó una, la lista que tenía delante siguió
  enseñándola como pendiente y volvió a intentarlo (de ahí v1.4.1).
- La información ya está en la pantalla —la lista de pendientes de `/skill-propuestas`— pero es **texto**:
  no se puede marcar nada en ella.

## Lo que el contrato permite, y lo que no (medido)

| Superficie | ¿Checkboxes y acciones propias? | Evidencia |
|---|---|---|
| El menú `/` | **No.** Sus filas las pinta `dsh-client-ui-input-trigger` (candidatos con `onPick`, sin puntos de extensión por fila) | `input-trigger/README.md`, `lib/client.js` |
| La tarjeta de un **comando** nuestro | **Sí.** `conversation.chat.commandview` es un slot **keyed** por nombre de comando, y ya lo ocupamos con la tarjeta de la X | v1.4.0, verificado en vivo |
| La tarjeta de una **herramienta** (el bloque de `skill_propose`) | **No.** El paquete de chat declara `conversation.chat.node`, `…assistant`, `…turn` y `…commandview`; el nodo `tool` **no** tiene hijo keyed y su clave ya la ocupa el propio paquete | `dsh-client-ui-chat/lib/client.js` |
| Ejecutar un comando del host desde el cliente | **Sí, en el contrato:** `ctx.remote.commands.execute(sessionId, line)` es exactamente lo que usa el cliente de comandos al elegir una fila del menú. **Por verificar** que un tercero pueda llamarlo (Fase 0) | `dsh-client-ui-commands/lib/client.js`: `execute()` → `this.ctx.remote.commands.execute(...)` |

Y lo importante del camino elegido: **ejecutar por ahí no es un atajo**. El comando entra por el mismo sitio
que si se tecleara —el host aplica la misma puerta, registra `command/run`/`command/done` y el nodo aparece
en el flujo de todas las pestañas— y **el modelo sigue sin poder aprobar nada**: el cliente no está en su
alcance, así que aprobar sigue siendo un acto humano, con un clic en vez de una línea.

## Diseño propuesto

### Fase 0 — el experimento que decide (media hora)

Un botón temporal en la tarjeta que ejecute `/skill-propuestas` por `ctx.remote.commands.execute`.

**Criterio de cierre**: aparece un `command/run` nuevo en el log de la sesión. Si no aparece, el RPC no es
alcanzable por un tercero y **las fases 1–3 se caen**: queda la vía del menú, que ya funciona, y este plan se
cierra diciéndolo.

### Fase 1 — seleccionar y decidir en lote, con paso a paso

- Cada pendiente de la tarjeta de `/skill-propuestas`, con **checkbox** (id y descripción; el verbo va en la
  acción, no en la fila).
- Barra de acciones: `Aprobar las marcadas (N)` y `Apartar las marcadas (N)`, deshabilitadas con cero
  marcadas. Más `marcar todas` / `desmarcar`.
- **Paso a paso de verdad**: marcar → **confirmación con el resumen** de lo que se va a hacer (los ids, y los
  avisos de la puerta si los hay) → ejecutar. Un clic accidental no aprueba nada.
- Ejecución: un comando por marcada, en orden, con el resultado de cada una a la vista
  (`N aprobadas · M con fallo`, y el motivo de cada fallo: la puerta sigue siendo la puerta).
- Las que no pasan la puerta **no se preseleccionan solas**: decidir es del humano.

### Fase 2 — las mismas acciones donde ya estás mirando

- En la tarjeta de `/skill-ver`: `Aprobar esta` / `Apartar esta`, con la misma confirmación y la misma puerta.
  Hoy, después de leerla entera, hay que volver a escribir el id.
- En la tarjeta de la lista: además del lote, una acción por fila (leer / aprobar / apartar) para decidir sin
  marcar nada.

### Fase 3 — el estado, en vivo

- Tras el lote, la tarjeta muestra `Aprobadas: N · Pendientes: M` restando **lo que ella misma ejecutó**
  (aritmética sobre la lista que muestra, no una reimplementación de la del host).
- La marca de «lista anterior a una decisión» (v1.4.1) ya cubre el caso de que la decisión llegue por otra
  vía: el CLI, otra pestaña, o una aprobación automática.

### Fase 4 — candidatos con el mismo patrón (evaluados, no decididos)

| Idea | Veredicto |
|---|---|
| Interruptor del modo automático en la tarjeta (hoy `/skill-auto activar`) | **Sí**: es estado de sesión, el comando ya existe y es reversible. Con el texto de lo que NO cambia (la puerta) al lado |
| «Aprobar todo lo pendiente» | **Sí, con confirmación explícita** y el recuento delante |
| Aprobar desde el bloque de `skill_propose` | **No** (medido arriba): la tarjeta de una herramienta no tiene slot keyed. Por eso el resultado de la herramienta tiene que seguir diciendo cómo se aprueba |
| Checkboxes en el menú `/` | **No** por contrato |
| Contador de pendientes en la píldora del dock | **Sí, y es barato**: la píldora ya está en la interfaz. Requiere decidir de dónde sale el número (la proyección es un plegado de eventos y no lee el disco), así que es una decisión aparte, no un detalle de esta |

## Reglas que NO se tocan

- **La puerta** (`checkProposal`), el anti-solapamiento, el bloqueo de orígenes y el registro: cada comando
  del lote pasa por lo mismo que el tecleado.
- **Aprobar es un acto humano.** El cliente no está en el alcance del modelo: los checkboxes se marcan con el
  ratón o el teclado, no con una herramienta.
- **Una regla, una implementación**: la tarjeta no reimplementa la lista ni la validación; ejecuta comandos y
  muestra lo que devuelven.
- **Nada se auto-aprueba por marcar**: la confirmación es un paso aparte y dice qué se va a hacer.

## Cómo se probará

- **Forma del artefacto** (`tests/client-artifact.test.mjs`): el checkbox es un `input` con `aria-label`
  propio, la barra está deshabilitada con cero marcadas, existe la confirmación, y la ejecución va por el
  RPC —no por texto inventado—.
- **En vivo**: la Fase 0 primero, y después el lote sobre las pendientes reales de un proyecto, con el log
  como fuente (un `command/run` por marcada).

## Riesgos

- **Si el RPC no es alcanzable por un tercero**, F1–F3 caen. Alternativa evaluada y descartada: que el cliente
  componga la línea y la deje escrita en el compositor — el cliente no puede escribir en el borrador.
- **Ruido en el flujo**: cada comando del lote deja su nodo. Mitigación de diseño: el resumen del lote vive en
  la tarjeta que lo lanzó, y la lista vieja se marca y se pliega (ya implementado en v1.4.1).
- **Selección que envejece**: entre marcar y confirmar puede cambiar el almacén. Mitigación: la confirmación
  muestra los ids y cada comando vuelve a pasar la puerta; lo que ya no esté pendiente responde «Ya estaba
  activa» (v1.4.1) en vez de fallar.

## Estado del trabajo

- **Hecho y publicado**: v1.4.0 (una fila por pendiente en el menú `/`; tarjeta del resultado con X para
  cerrarla) y v1.4.1 (aprobar dos veces es idempotente y lo dice; el resultado de decidir trae la lista al
  día; una lista anterior a una decisión se marca y se pliega sola).
- **Pendiente**: todo lo de arriba, empezando por la **Fase 0**.
