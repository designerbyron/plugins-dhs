# Plan v2 — el ámbito de una skill al aprobarla: local o global

**Estado: IMPLEMENTADO en v1.8.0** — 276 pruebas en verde, suite hermética con huella idéntica, `doctor`
verde, y el ciclo completo medido por el CLI real en una arena. Este documento sustituye al v1 únicamente en
lo que cambió al decidir el autor; el v1 se conserva intacto con su SHA-256.

## Las tres decisiones del autor (2026-10-15)

1. **«Global» es la biblioteca de usuario del harness** (`$DSH_HOME/skills`) — la misma carpeta que ya usan
   otras herramientas, y la que el harness sirve en cualquier sesión con rango 400.
2. **Si no se dice el ámbito, se pregunta** — y **en aprobación automática, siempre local**. Lo dijo así:
   *«caso que no esté auto siempre preguntar local(Proyecto) Global($DSH_HOME)»*. Un gesto delegado delega la
   confirmación, no el alcance.
3. **Se puede cambiar de ámbito después**, con `/skill-ambito`, en las dos direcciones.

## Lo que la implementación añadió al diseño del v1

Tres cosas que el v1 no previó, y que salieron de medir:

1. **La puerta de identidad, con la marca de origen como criterio.** La biblioteca no es territorio virgen:
   hoy tiene 21 skills que escribe otra herramienta. El plugin escribe ahí **sólo** si el destino no existe o
   si lleva `metadata.dsh.origin: skill-compiler`; una skill ajena con el mismo id **no se pisa**, y el
   mensaje lo dice sin culpar a nadie.
2. **El solapamiento tenía un hueco real, y lo destapó la suite**: el veto trataba la biblioteca curada como
   territorio de nadie, así que el **mismo id** de una skill que habíamos publicado era un `conflict`. O sea:
   publicada una vez, el modelo **ya no podía mejorarla en ningún proyecto**. Lo que decide no es *dónde*
   está la otra, sino **de quién es**: lo nuestro es una actualización (y ahora se anuncia con
   `updatesPublished`); lo ajeno sigue siendo conflicto, y la vía que se le ofrece al modelo es otro id, no
   «mejorar» una skill que no es nuestra.
3. **El campo nuevo, declarado también en `skill_vendor`.** La suite de contratos cazó que el esquema de la
   otra herramienta devolvía `updatesPublished` sin declararlo: con `additionalProperties: false`, eso
   rechaza el resultado entero. Es el mismo defecto que ya pasó una vez con `updatesProposal`, y por eso hay
   una prueba que lo fija.

## Lo que quedó como está, a propósito

- **El provider no cambia**: sigue sirviendo sólo el proyecto. Lo global lo sirve el harness, con su rango.
  Una sola fuente y una sola copia efectiva: publicar **mueve**, no duplica.
- **`curatedLibraryRoot()` sigue leyéndose siempre** y sigue sin ser destino de ninguna propuesta. Lo que
  escribe ahí es una **aprobación humana con ámbito global**, y pasa por la puerta.
- **El CLI conserva el defecto local** (`approve <id>`), porque ahí el gesto ya es explícito y hay scripts
  detrás; lo que añade es la línea que enseña cómo publicarla, y el gesto inverso con `scope`.

## Medido, no supuesto

| Qué | Cómo |
|---|---|
| El ciclo entero del ámbito | CLI real sobre una **arena** (`DSH_HOME` aparte): proponer → publicar → apagar → encender → traer a local → volver a global → retirar → restaurar, huella idéntica |
| La puerta de identidad | una skill ajena con el mismo id: no se publica, no se apaga, no se retira, y su huella no cambia |
| Una sola copia efectiva | `listForProject` no incluye lo publicado |
| El defecto seguro | `approveProposal` sin ámbito deja en el proyecto y **nunca** escribe en la biblioteca |
| La actualización de una global | mismo id de una publicada nuestra → `proposed` con `updatesPublished`; de una ajena → `conflict` con `ours: false` |
| Suite | 276 pruebas, hermética con huella idéntica, `doctor` verde |

## Lo que falta, y es del autor

**La verificación en vivo**: publicar una skill real desde una sesión del Desktop, ver que aparece en otra
sesión (el catálogo del harness puede cachear la biblioteca; por eso está declarado como límite a medir y no
como promesa), y comprobar el ciclo desde la interfaz. Todo lo demás está cerrado.
