# Feedback visual

Qué se ve en la interfaz mientras el plugin trabaja, por qué se ve así, y **qué parte de esto está
verificada y qué parte no**. Lo último importa tanto como lo primero.

## Qué se ve

Una píldora discreta en la zona del compositor. Aparece solo cuando hay algo que decir, y desaparece
cuando no lo hay — no deja un hueco vacío.

| Momento | Qué se ve | Qué se anuncia |
|---|---|---|
| El modelo llama a `skill_propose` o `skill_vendor` | Un engranaje multicolor girando despacio, con el texto «Analizando el trabajo…» | El análisis está en marcha |
| Y creó una skill **nueva** | Marca de verificación + «Nueva skill» + el nombre | «Nueva skill creada: medida-por-evidencia» |
| Y **actualizó** una existente | Flecha circular + «Skill actualizada» + el nombre | «Skill existente actualizada: medida-por-evidencia» |
| El turno cerró **sin** nada que aprender | Guion + «Sin cambios» | «Sin cambios: no hubo nada que aprender» |
| El intento se **rechazó** (solapamiento, validación) | Aspa + «No se creó» + el nombre | «No se creó ninguna skill» |
| El origen ajeno venía con **contenido peligroso** | Escudo + «Origen bloqueado» | «Bloqueado: el origen traía contenido peligroso» |

Si en una misma sesión ya se crearon o actualizaron varias, la píldora añade `×N` con el acumulado.

## Cómo se entera la interfaz

Sin inventar nada en el registro de sesiones. La guía de DSH **prohíbe** añadir tipos de evento propios:
un evento desconocido sin la marca `ignorable` impide reabrir la sesión más adelante, y esa marca no se
puede poner al escribir. Así que el estado se pliega de eventos que ya existen:

```
tool/call   con name = skill_propose | skill_vendor     → fase «analyzing», un callId en vuelo
tool/result con ese callId                              → fase «done», y el resultado se lee del marcador
turn/end    sin nada en vuelo                           → «sin cambios», que también es una respuesta
user/message de una persona                             → retira el resultado anterior y conserva el acumulado
```

El **marcador** es un contrato entre dos piezas nuestras: cada herramienta abre su resultado con

```
[skill-compiler] created medida-por-evidencia
```

y el plegado lo lee. Es legible para el modelo y estable para el código, y hay una prueba que lo congela
contra el `render` real de las herramientas: si alguien cambia el formato del resultado sin cambiar el
plegado, la suite se pone roja en vez de que el adorno mienta en silencio.

El camino completo:

```
herramienta ──marcador──▶ evento de sesión ──plegado──▶ proyección ──wire.view──▶ interfaz
   (Host)                     (ya existía)                  (Host)                  (navegador)
```

La interfaz **no** lee el registro ni interpreta eventos: pide el valor ya calculado con
`useProjection('skillCompiler')`, según el contrato de proyecciones de DSH.

## Las decisiones de aspecto, y de dónde salen

No son gusto. Cada una viene de una consulta a la guía de UI/UX que acompaña a este puesto:

| Decisión | Regla que la respalda |
|---|---|
| **Una sola** animación en bucle: el engranaje | «Animate 1-2 key elements per view maximum» · «Use continuous animation for loading indicators only, not decorative elements» |
| La rueda gira solo mientras carga; el resultado entra con un latido de 180 ms y se queda quieto | Igual que la anterior: un resultado no es un indicador de carga |
| El estado final se lee del dato, nunca de que la animación acabe | «Cancellable State Transitions»: cancelar o reemplazar el movimiento previo, fijar el estado semántico directamente, y no depender de `animationend` |
| `prefers-reduced-motion` desactiva las dos animaciones | «Reduced Motion»: comprobar la preferencia del sistema |
| **Una** región viva, atómica, con la frase entera | «Contextual Live Badge Updates»: un mensaje con contexto, nunca un número suelto, y no crear regiones vivas que compitan |
| El nombre de la skill se recorta con puntos suspensivos, no se envuelve; el valor completo está en el `title` **y** al enfocar | «Compact Label Overflow»: acotar solo lo impredecible, `nowrap` con etiqueta que encoge, y exponer el texto completo al teclado y al tacto (un tooltip solo al pasar el ratón no vale) |
| Iconos SVG en línea con `aria-hidden`, jamás emoji | «Icon Discipline»: SVG, no emoji; y decorativos cuando el texto de al lado ya lo dice |
| El contenedor toma el color del tema del anfitrión; **solo el arte** lleva sus tonos | «Inherit the host theme for containers and controls; artwork may use its own colors» |
| El texto pasa por el servicio de idioma, con reserva si falla | «Route visible UI text through the Client locale service» |

El contenedor se deriva entero de `currentColor` con `color-mix`, así que funciona en claro y en oscuro
sin fijar ni un token de color del anfitrión. El degradado multicolor vive en el engranaje: es arte, y es
donde el color propio está permitido.

## El color, medido (no estimado)

La primera versión pintaba la píldora entera con el color del estado. Al medirla con la fórmula de
contraste de WCAG apareció el problema, y no era el que parecía:

```
estado     color      vs oscuro   vs claro   gráfico(3:1)   texto(4.5:1)
analyzing  #7c3aed    3.32:1      5.70:1     ambos          solo claro
created    #0d9488    5.06:1      3.74:1     ambos          solo oscuro
updated    #a16207    3.85:1      4.92:1     ambos          solo claro
rejected   #b45309    3.77:1      5.02:1     ambos          solo claro
blocked    #b91c1c    2.93:1      6.47:1     solo claro     solo claro   ← fallaba
```

Dos conclusiones, y la segunda es la importante:

1. **`#b91c1c` no servía**: 2.93:1 sobre fondo oscuro, por debajo del 3:1 que se exige a un gráfico. Se
   cambió por `#dc2626` (3.92:1 / 4.83:1), que sí cumple en los dos temas.
2. **Ningún acento de esta paleta llega a 4.5:1 sobre fondo oscuro *y* sobre fondo claro a la vez.** No es
   cuestión de elegir mejor: un tono saturado y de luminancia media no puede ser legible sobre blanco y
   sobre casi-negro simultáneamente. Por eso el **texto hereda el color del anfitrión** —que su tema ya
   garantiza legible— y el acento pasa a pintar **solo la marca y el tinte**, que son decoración.

De ahí la regla que quedó escrita en el código: *el color del texto no se elige aquí, se hereda*. Elegir
un acento bonito y usarlo para el texto es exactamente cómo se cuela un texto ilegible en un tema que no
has probado.

Los cuatro tonos del engranaje salen del póster —cian, azul, violeta y magenta—, y el ámbar que llevaba
antes se retiró: no existe en la identidad.

## Resiliencia: un adorno no puede estropear el trabajo

- Si el perfil no resuelve `zod`, **la proyección no se registra** y el plugin conserva las herramientas:
  se pierde el adorno, no el trabajo.
- Si la unidad no cumple el contrato del registro —esquemas que no validan, plegado que devuelve un objeto
  nuevo por evento, vista que devuelve una promesa— **no se registra**, y se pierde lo mismo: el adorno.
  Esto no es celo: el registro de proyecciones **no** valida los esquemas que recibe, y una unidad con
  esquemas que no validan deja el **historial de sesiones** sin cargar. Ocurrió aquí (1.1.2), y por eso la
  comprobación va antes de registrar y hay pruebas contra el registro real.
- Si el servicio de proyección no está, la pieza **no pinta nada** en lugar de fallar.
- Si el servicio de idioma falla o no tiene nuestras claves, se usan los textos de reserva. **Nunca** se
  enseña una clave cruda.
- Los diccionarios se registran dentro de `ctx.effect`, y los estilos viven en el árbol de React: al
  desmontar, se retiran los dos.

## Cerrar un resultado

Los comandos dejan su resultado en el flujo del chat, y `/skill-propuestas` o `/skill-ver` ocupan media
pantalla. Medido con el usuario delante: se podían **colapsar** —la tarjeta del anfitrión tiene chevron—,
pero no **cerrar**, así que los bloques se apilaban y estorbaban.

El sitio por donde se puede hacer está en el contrato del **cliente**, no en el del Host: el nodo `command`
del chat declara un slot **keyed** (`conversation.chat.commandview`) y despacha por el **nombre del comando**:

```text
ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
  name: 'conversation.chat.commandview',
  key: 'skill-propuestas',        // el `entryKey` que pasa el nodo es el nombre del comando
  locale: NS,
}, SkillCommandCard));
```

Registrar ahí es la forma soportada de decidir cómo se pinta **un resultado nuestro**: el slot es del
anfitrión y nosotros ocupamos la entrada de nuestros comandos, sin reclamar el nodo entero —una clave tiene
un solo ocupante, y reclamarla lanzaría al cargar— y sin tocar el DOM de nadie.

Decisiones de la tarjeta, y de dónde salen:

| Decisión | Por qué |
|---|---|
| **X en la esquina derecha**, presente con opacidad baja y a plena al puntero o al foco | Es lo que se busca justo cuando el bloque estorba; escondida hasta el hover no sirve ni al teclado ni al tacto |
| El cierre es por **`commandId`**, no por comando | Dos `/skill-propuestas` son dos bloques: cerrar uno no puede llevarse el otro |
| Se recuerda en `sessionStorage` (tope de 200), no en el Host | Es una preferencia de **vista**: no toca el log de la sesión ni el almacén del plugin, y muere con la pestaña. Cerrar no borra nada |
| Desplegada por defecto si el resultado ocupa varias líneas | Es la información que se pidió; colapsar sigue disponible, y el cierre es aparte: colapsar no era lo que faltaba |
| Si el nodo no llegara (otra versión del anfitrión), se **dice** | Un resultado que desaparece en silencio es peor que un aviso |
| El resultado se pinta como texto (`pre`, sin `dangerouslySetInnerHTML`) | Lo escribe el Host, pero la regla no cambia: nunca HTML |
| El registro va en su propio `try`, después del de la píldora | Si el anfitrión no declara ese slot, la pieza pierde la X y conserva la píldora |
| `@deepseek-ai/dsh-client-ui-chat` declarado en `dsh.client.inject` | Es quien declara el slot; sin eso, el registro podría llegar antes que la declaración |
| **Un panel de decisiones** en la tarjeta de la lista (casilla por pendiente, lote, confirmación) | Aprobar de a una era el gesto que el usuario señaló: con varias pendientes se repetía. Las pendientes salen del **catálogo del host** —no del texto del resultado, que duplicaría el formato— y cada decisión se ejecuta por el remoto que usa el menú, así que la puerta y el registro son los mismos. Marcar no decide: hay confirmación, y con cero marcadas no hay acción |
| Una lista anterior a una decisión se marca y se pliega sola | El texto de un resultado es el registro de lo que pasó y no se reescribe; lo que sí se puede afirmar es que hubo una decisión **posterior**, y eso lo sabe el log (`decisionSeq`). Marcar sin mentir, y plegar para que no ocupe media pantalla |

**Lo que esta pieza no puede hacer**: cerrar los bloques de las **filas de pendientes**
(`skill-aprobar-<id>`). El despacho del slot es por nombre exacto y esos nombres llevan el id, que el
cliente no conoce de antemano. No es una pérdida real —escriben una línea— y se dice en vez de disimularse.

## Lo que la interfaz NO puede hacer, y por qué (para no reintentarlo)

La píldora informa de lo que el plugin **aprendió**, pero no hay en la aplicación una **bandeja de
propuestas pendientes de aprobar**. Se intentó diseñar y se descartó con el contrato delante, no por
gusto. Tres caminos, y los tres están cerrados:

| Camino | Por qué no |
|---|---|
| Que la **proyección** cuente los pendientes | Una proyección es un **plegado puro de eventos de la sesión**: por diseño no puede leer el almacén del disco. Es lo que la hace reproducible —y lo que impediría saber que aprobaste algo por CLI, así que el número mentiría— |
| Que el **cliente pida la lista al Host** por un remoto | Exponer un remoto exige `@Remote`: **decoradores de TypeScript** que procesa un *pipeline* de compilación (`dsh-typert-protocol`). Este plugin escribe su artefacto de navegador a mano, sin build, y meter un pipeline para un adorno cambia la arquitectura del plugin entero |
| Que el cliente **lea el almacén** | El navegador no tiene acceso al disco del Host, y no debe tenerlo |

**Lo que sí se hizo, y es la superficie de aprobación de verdad:** un **servidor local bajo demanda** del
propio CLI —`node bin/skill-compiler.mjs review`— que escucha solo en `127.0.0.1`, exige un **token de un
solo uso** que se imprime en la terminal, y sirve una página con las pendientes, su resultado de validación
y los botones de aprobar y rechazar. Se abre en una pestaña, no dentro de la aplicación, y a cambio es
**más inalcanzable para el modelo que cualquier cosa dentro de la interfaz**: es una URL, no una
herramienta, y desde una sesión no hay camino hasta ella. La implementación está en `lib/review.mjs`, con
sus decisiones de seguridad razonadas dentro, y se prueba **contra un servidor real**, comprobando el disco.

Hoy, además, la superficie de decisión incluye el **terminal** (`list`, `check`, `show`, `approve`,
`reject`, `review`) y lo que el modelo te diga cuando le preguntes: `skill_review` devuelve las pendientes
del proyecto.

Y desde 1.4.0 también se decide **dentro** de la aplicación, sin bandeja: los comandos del compositor y,
encima, **una fila por pendiente en el menú `/`** (`lib/pending-rows.mjs`), que se elige con el ratón o con
las flechas y se ejecuta al elegirla. La **bandeja** con estado propio sigue descartada por los tres
motivos de la tabla; la **decisión**, no.

## Límites, dichos en voz alta

- **El dibujo no está verificado visualmente.** El estado que lo alimenta (217 pruebas, incluido el
  contrato contra el registro real de proyecciones) y la forma del
  artefacto (carga, slot, idioma, movimiento reducido, ausencia de emoji) sí; **cómo se ve** solo se
  comprueba instalando el plugin y mirando la interfaz. No hay control de navegador en este puesto, así
  que sería deshonesto decir «se ve premium»: lo que está verificado es que está construido según las
  reglas, no que el resultado guste.
- **El engranaje gira cuando la herramienta se llama.** La interfaz no puede saber que el modelo está
  *pensando* en aprender antes de llamar: el plugin «se dispara» cuando llama, y eso es lo que se ve.
- **El marcador es un contrato propio.** Si otra pieza reescribiera el resultado de la herramienta, el
  plegado no reconocería el formato y diría «sin cambios» en vez de inventarse un resultado.
