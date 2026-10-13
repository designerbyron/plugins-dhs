# Sistema de diseño

El plugin tiene una pieza de interfaz: la **píldora** del dock (el estado del aprendizaje) y la **tarjeta**
del resultado de cada comando. Lo que sigue son las reglas que las sostienen, con el porqué medido. El
detalle del comportamiento está en [`skill-compiler/docs/FEEDBACK-VISUAL.md`](../skill-compiler/docs/FEEDBACK-VISUAL.md).

## Color: hereda el texto, el acento pinta la marca

La regla que salió de medir, no de elegir: **ningún acento llega a 4.5:1 sobre fondo oscuro y claro a la
vez**. Por eso:

- El **texto hereda** el color del anfitrión (`color: inherit`), que es la única forma de garantizar el
  contraste en cualquier tema.
- El **acento** sólo pinta la marca (los gráficos), donde el listón de contraste es 3:1 y todos los acentos
  lo cumplen.
- Los tintes y bordes se derivan del acento con `color-mix(in oklab, …)`, así que funcionan en claro y en
  oscuro sin fijar ni un token.
- Los acentos medidos: `created` `#0d9488`, `updated` `#a16207`, `rejected` `#b45309`, `blocked` `#dc2626`,
  `analyzing` `#7c3aed`. El `#b91c1c` anterior se descartó: 2.93:1 sobre oscuro.
- El **ámbar** no existe en la identidad de marca: no se usa.

## Movimiento

Una sola animación continua —el engranaje mientras analiza— porque la guía sólo la permite para un
indicador de carga. La entrada del resultado es un latido corto de 180 ms. `prefers-reduced-motion` apaga
las dos: el estado nunca depende del movimiento para entenderse.

## Accesibilidad

- **Una sola región viva**, atómica y con la frase entera («Nueva skill creada: mi-skill»), nunca un número
  suelto ni dos regiones que compitan.
- Todo control es un `<button>` de verdad, con `aria-label` y `title` (el tooltip debe servir al teclado y
  al tacto, no sólo al puntero), y con foco dibujado (`:focus-visible`).
- Los iconos son SVG en línea con `aria-hidden`: **nada de emoji**.
- El recorte visual de un identificador largo no esconde el dato: está completo en `title` y por foco.
- Las casillas de selección son `input[type=checkbox]` con etiqueta asociada (`htmlFor`).

## Estilos

- **En el árbol, no en el documento**: cada pieza monta su propia hoja (`h('style', null, CSS)`) para que
  desmontarla la retire. Nunca `document.head`.
- Se respeta `forced-colors: active` (bordes de sistema, fondo `Canvas`).
- Las clases llevan el prefijo `skc-` y no dependen de nombres ofuscados del anfitrión.
- Ojo con la trampa medida: dentro de un *template literal*, un backtick en un comentario CSS cierra el
  template y el fallo aparece como error de sintaxis de JS.

## Idioma

Todos los textos entran por el servicio de idioma del anfitrión, con diccionario propio (`es`/`en`) y
reserva local: si el servicio no está, se pinta la reserva y **nunca una clave cruda**. El diccionario de
reserva vive en `client.js`, junto al componente que lo usa.
