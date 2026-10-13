/**
 * skill-compiler — pieza de interfaz (artefacto de navegador).
 *
 * Qué enseña, y por qué así:
 *
 *   · **Mientras el análisis está en marcha** — un engranaje multicolor girando despacio. Es la única
 *     animación continua de la pieza, y la guía de UI solo la permite para un indicador de carga.
 *   · **Al terminar** — qué pasó de verdad: skill **nueva**, **actualizada**, sin cambios, rechazada o
 *     bloqueada, con el nombre de la skill. El resultado se lee del estado, no de que una animación
 *     acabe: si la transición se interrumpe, el estado semántico ya es el correcto.
 *   · **Cada resultado de nuestros comandos, con una X para cerrarlo.** Medido con el usuario delante:
 *     `/skill-propuestas` deja bloques largos en el flujo y sólo se podían colapsar. Se registra una
 *     entrada keyed en `conversation.chat.commandview` —el slot que el nodo `command` del chat declara
 *     por nombre de comando—, así que la tarjeta es nuestra: se lee igual y se cierra. Lo cerrado se
 *     recuerda en la sesión de la página: es una preferencia de vista, no un dato del plugin.
 *
 * Decisiones que vienen de la guía de UI/UX, no del gusto:
 *
 *   1. **Un solo `role="status"` atómico y con contexto.** Se anuncia la frase entera («Nueva skill
 *      creada: mi-skill»), nunca un número suelto, y no se crean dos regiones vivas que compitan.
 *   2. **Una animación, no cinco.** El engranaje gira; nada más se mueve en bucle. La entrada del
 *      resultado es un latido corto de 180 ms.
 *   3. **`prefers-reduced-motion`** desactiva las dos. El estado no depende del movimiento para
 *      entenderse.
 *   4. **La etiqueta encoge, no envuelve.** El nombre de una skill puede ser largo: `nowrap`, `min-width:
 *      0` y recorte con puntos suspensivos, con el valor completo disponible por foco y por `title` —
 *      porque un tooltip que solo aparece al pasar el ratón no sirve ni al teclado ni al tacto.
 *   5. **Contenedor con el tema del anfitrión, arte con color propio.** Todo el color del contenedor se
 *      deriva de `currentColor` con `color-mix`, así que funciona en claro y en oscuro sin fijar ni un
 *      token; el engranaje es el arte, y ahí sí hay varios tonos.
 *   6. **Nada de emoji como icono**: SVG en línea con `aria-hidden`, porque el texto de al lado ya dice
 *      lo que hay que decir.
 *
 * Si el anfitrión no ofrece el servicio de proyección o el de idioma, la pieza **no se rompe**: no pinta
 * nada, o pinta con los textos de reserva. Un adorno nunca debe poder estropear el trabajo.
 */

window.__ModuleLoader__.load({
  id: '@local/skill-compiler',

  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** El nombre tiene que coincidir con el del paquete: es la identidad del artefacto. */
    const PACKAGE = '@local/skill-compiler';
    const NS = 'skill-compiler';
    /** El mismo valor que `LEARNING_KEY` en `index.js`: la clave con la que se pide la proyección. */
    const PROJECTION_KEY = 'skillCompiler';
    /** El slot que la guía de plugins recomienda: tiene espacio asignado y no invade controles. */
    const SLOT = 'conversation.composer.dock';
    /**
     * El slot keyed que el nodo `command` del chat declara por nombre de comando. El host despacha por
     * `entryKey` contra la `key` del registro y cae a su propia tarjeta si ninguna coincide: registrar
     * aquí es la forma soportada de decidir cómo se pinta un resultado, y la única que permite cerrarlo.
     */
    const COMMAND_VIEW_SLOT = 'conversation.chat.commandview';
    /**
     * Los comandos nuestros que dejan un bloque en el flujo. Se registra una entrada por nombre porque el
     * despacho del slot es por nombre exacto; las filas de pendientes (`skill-aprobar-<id>`) escriben una
     * línea y usan la tarjeta del host, que para eso basta.
     */
    const COMMAND_NAMES = ['skill-propuestas', 'skill-ver', 'skill-aprobar', 'skill-auto', 'skill-rechazar'];
    /**
     * Los comandos cuyo resultado es una LISTA que una decisión posterior deja atrás. Medido con el usuario
     * delante: aprobó una skill y el bloque que tenía debajo siguió enseñándola como pendiente. El texto de
     * un resultado es el registro de lo que pasó y no se reescribe, así que lo que se hace es decir que hay
     * una decisión posterior — eso lo sabe el log, y por eso viaja en la proyección.
     */
    const LIST_COMMANDS = ['skill-propuestas', 'skill-ver'];
    /** Dónde se recuerda un resultado cerrado: la sesión de la página, que muere con ella. */
    const CLOSED_KEY = 'skc-closed';
    /** Tope de la lista de cerrados, para que no crezca sin fin en una sesión larga. */
    const CLOSED_MAX = 200;

    /** Textos. Se registran en el servicio de idioma del anfitrión; abajo hay reserva por si falla. */
    const DICTIONARIES = {
      es: {
        analyzing: 'Analizando el trabajo…',
        created: 'Nueva skill',
        updated: 'Skill actualizada',
        none: 'Sin cambios',
        rejected: 'No se creó',
        blocked: 'Origen bloqueado',
        created_full: 'Nueva skill creada',
        updated_full: 'Skill existente actualizada',
        none_full: 'Sin cambios: no hubo nada que aprender',
        rejected_full: 'No se creó ninguna skill',
        blocked_full: 'Bloqueado: el origen traía contenido peligroso',
        total: 'En esta sesión',
        card_close: 'Cerrar este resultado',
        card_expand: 'Mostrar el resultado',
        card_collapse: 'Ocultar el resultado',
        card_running: 'en curso',
        card_done: 'hecho',
        card_error: 'falló',
        card_title: 'comando',
        card_unreadable: 'No se pudo leer el resultado: esta versión del anfitrión no entrega el comando a la tarjeta',
        card_stale_approved: 'Aprobaste algo después de esta lista: vuelve a ejecutar /skill-propuestas para verla al día',
        card_stale_rejected: 'Apartaste algo después de esta lista: vuelve a ejecutar /skill-propuestas para verla al día',
      },
      en: {
        analyzing: 'Analysing the work…',
        created: 'New skill',
        updated: 'Skill updated',
        none: 'No changes',
        rejected: 'Nothing created',
        blocked: 'Origin blocked',
        created_full: 'New skill created',
        updated_full: 'Existing skill updated',
        none_full: 'No changes: there was nothing to learn',
        rejected_full: 'No skill was created',
        blocked_full: 'Blocked: the origin carried dangerous content',
        total: 'This session',
        card_close: 'Close this result',
        card_expand: 'Show the result',
        card_collapse: 'Hide the result',
        card_running: 'running',
        card_done: 'done',
        card_error: 'failed',
        card_title: 'command',
        card_unreadable: 'Could not read the result: this host version does not hand the command to the card',
        card_stale_approved: 'You approved something after this list: run /skill-propuestas again to see it current',
        card_stale_rejected: 'You set something aside after this list: run /skill-propuestas again to see it current',
      },
    };

    const FALLBACK = DICTIONARIES.es;

    /* ── iconos: SVG en línea, trazo, decorativos (el texto de al lado ya lo dice) ───────────────── */

    const icon = (paths, extra) => h('svg', {
      viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true, focusable: false, style: { display: 'block', flex: '0 0 auto' },
      ...extra,
    }, paths.map((d, i) => h('path', { key: i, d })));

    const ICONS = {
      created: () => icon(['M20 6 9 17l-5-5']),
      updated: () => icon(['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6']),
      none: () => icon(['M5 12h14']),
      rejected: () => icon(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M15 9l-6 6', 'M9 9l6 6']),
      blocked: () => icon(['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z', 'M12 8v4', 'M12 15.5h.01']),
    };

    /**
     * El engranaje. Multicolor a propósito —es el arte de la pieza, y ahí la guía permite color propio—
     * con los tonos de la marca: cian, azul, violeta y magenta, tomados del póster. Se descartó el ámbar
     * que llevaba antes porque no existe en la identidad.
     */
    function Gear() {
      const teeth = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const x = 12 + Math.cos(angle) * 8.4;
        const y = 12 + Math.sin(angle) * 8.4;
        teeth.push(h('rect', {
          key: i, x: x - 1.35, y: y - 1.35, width: 2.7, height: 2.7, rx: 0.7,
          fill: 'currentColor', opacity: 0.85,
          transform: `rotate(${(i * 45)} ${x} ${y})`,
        }));
      }
      return h('span', { className: 'skc-gear', 'aria-hidden': true },
        h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, style: { display: 'block' } },
          h('defs', null,
            h('linearGradient', { id: 'skc-hues', x1: '0', y1: '0', x2: '1', y2: '1' },
              h('stop', { offset: '0%', stopColor: '#22d3ee' }),
              h('stop', { offset: '38%', stopColor: '#3b82f6' }),
              h('stop', { offset: '72%', stopColor: '#7c3aed' }),
              h('stop', { offset: '100%', stopColor: '#d946ef' })),
          ),
          // corona dentada + aro interior, con el degradado multicolor
          h('g', { fill: 'none', stroke: 'url(#skc-hues)', strokeWidth: 1.7 },
            h('circle', { cx: 12, cy: 12, r: 7.2 }),
          ),
          h('g', null, teeth),
          h('circle', { cx: 12, cy: 12, r: 2.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, opacity: 0.9 }),
        ),
      );
    }

    /* ── estilos: van dentro del árbol, así que desmontar los retira ─────────────────────────────── */

    const STYLES = `
.skc-pill {
  display: inline-flex; align-items: center; gap: 8px;
  min-width: 0; max-width: 100%;
  padding: 5px 11px 5px 9px;
  border-radius: 999px;
  font: 500 12.5px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.01em;
  /* El TEXTO hereda el color del anfitrión, y no es un detalle: es la única forma de garantizar el
     contraste en cualquier tema. Medido con la fórmula WCAG, NINGÚN acento de los que se usan aquí
     llega a 4.5:1 sobre fondo oscuro Y sobre fondo claro a la vez (ver docs/FEEDBACK-VISUAL.md). El
     acento pinta la marca y el tinte, que son decoración. */
  color: inherit;
  background: color-mix(in oklab, var(--skc-accent, currentColor) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--skc-accent, currentColor) 26%, transparent);
  box-shadow: 0 1px 2px color-mix(in oklab, var(--skc-accent, currentColor) 14%, transparent);
  transition: background 180ms ease, border-color 180ms ease;
}
/* La marca sí lleva el acento: es un gráfico, y para un gráfico el listón es 3:1, que todos cumplen
   en los dos temas. */
.skc-mark { display: inline-flex; color: var(--skc-accent, currentColor); }
.skc-label { white-space: nowrap; }
.skc-id {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px; opacity: 0.85;
}
.skc-count {
  font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 11.5px;
  padding-left: 2px; white-space: nowrap;
}
.skc-gear { display: inline-flex; animation: skc-spin 2.4s linear infinite; transform-origin: 50% 50%; }
.skc-enter { animation: skc-pop 180ms cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes skc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes skc-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .skc-gear, .skc-enter { animation: none; }
}
@media (forced-colors: active) {
  .skc-pill { border-color: CanvasText; background: Canvas; color: CanvasText; }
}

/* ── la tarjeta de un resultado de comando ──────────────────────────────────────────────────────
   Mismo criterio de color que la píldora: el texto hereda del anfitrión y todo se deriva de
   currentColor, así que funciona en los dos temas sin fijar ni un token. La X vive en la esquina
   derecha y no desaparece: en el borde del bloque se ve al pasar el puntero o al enfocarla, que es
   justo cuando se busca. */
.skc-card {
  display: flex; flex-direction: column; gap: 6px;
  margin: 2px 0; padding: 7px 9px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, currentColor 16%, transparent);
  background: color-mix(in oklab, currentColor 4%, transparent);
  color: inherit;
  font: 500 12.5px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.skc-card-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.skc-card-name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
}
.skc-card-summary { opacity: 0.65; font-size: 11.5px; white-space: nowrap; }
.skc-card-close { margin-left: auto; }
.skc-card-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 6px; background: transparent; color: inherit;
  opacity: 0.55; cursor: pointer;
  transition: opacity 160ms ease, background 160ms ease;
}
.skc-card-icon:hover, .skc-card-icon:focus-visible {
  opacity: 1; background: color-mix(in oklab, currentColor 12%, transparent);
}
.skc-card-icon:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
.skc-card-body {
  margin: 0; padding: 8px 10px; max-height: 340px; overflow: auto;
  border-radius: 8px;
  background: color-mix(in oklab, currentColor 5%, transparent);
  font: 400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-word;
}
/* La banda de una lista anterior a la última decisión. No es un error: es un aviso de que ese bloque ya
   no describe el almacén, y va fuera del cuerpo desplegable para que se lea aunque esté colapsada. */
.skc-card-stale {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px;
  border-radius: 7px;
  background: color-mix(in oklab, currentColor 10%, transparent);
  font-size: 11.5px; line-height: 1.35;
}
.skc-card-stale svg { flex: 0 0 auto; opacity: 0.8; }
@media (forced-colors: active) {
  .skc-card { border-color: CanvasText; background: Canvas; }
}
`;

    /* ── la tarjeta de resultados: lo que el anfitrión no tiene, una X para cerrarla ─────────────── */

    /**
     * Traduce una clave nuestra, con reserva. El idioma puede no estar registrado —o el anfitrión puede no
     * pasarnos `t`—, así que nunca se enseña una clave cruda.
     */
    function translator(t) {
      return (key) => {
        if (typeof t === 'function') {
          try {
            const value = t(key);
            if (typeof value === 'string' && value.length > 0 && value !== key) return value;
          } catch { /* el anfitrión decide; aquí sólo se evita romper */ }
        }
        return FALLBACK[key] ?? key;
      };
    }

    /** Los resultados cerrados, tal como los recuerda esta pestaña. Nunca lanza. */
    function readClosed() {
      try {
        const raw = window.sessionStorage.getItem(CLOSED_KEY);
        const list = raw === null ? [] : JSON.parse(raw);
        return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : [];
      } catch {
        return [];
      }
    }

    function writeClosed(ids) {
      try {
        window.sessionStorage.setItem(CLOSED_KEY, JSON.stringify(ids.slice(-CLOSED_MAX)));
      } catch { /* sin almacenamiento: se cierra igual, sólo que no se recuerda */ }
    }

    /** Cerrar es por `commandId`: identifica esa ejecución y sólo esa, así que cerrar una no cierra las demás. */
    function closeCommand(commandId) {
      if (commandId === null) return;
      const ids = readClosed();
      if (!ids.includes(commandId)) writeClosed([...ids, commandId]);
    }

    function CloseMark() {
      return icon(['M18 6 6 18', 'M6 6l12 12']);
    }

    function NoticeMark() {
      return icon(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 8v5', 'M12 16.5h.01']);
    }

    /**
     * La última decisión humana, tal como la sirve la proyección: `{ kind, seq }`, o `null` si el
     * anfitrión no ofrece ese servicio. No se adivina nada: sin dato, la tarjeta pinta como siempre.
     */
    function useDecision(useProjection) {
      const view = typeof useProjection === 'function' ? useProjection(PROJECTION_KEY) : null;
      if (!view || typeof view !== 'object') return null;
      return {
        kind: typeof view.decisionKind === 'string' ? view.decisionKind : '',
        seq: Number.isFinite(view.decisionSeq) ? view.decisionSeq : -1,
      };
    }

    function ChevronMark({ open }) {
      return icon(open ? ['M6 15l6-6 6 6'] : ['M9 6l6 6-6 6']);
    }

    /**
     * La tarjeta de un resultado de nuestros comandos.
     *
     * El contrato lo manda el slot: llegan el nodo del comando —`commandId`, `name`, `outcome`— y la `t`
     * de nuestro espacio de nombres, y el anfitrión envuelve la vista en su frontera de error, así que un
     * fallo aquí no puede tumbar el chat. Si el nodo no llegara (otra versión del anfitrión), se dice: un
     * resultado que desaparece en silencio es peor que un aviso.
     *
     * Desplegada por defecto cuando el resultado ocupa varias líneas —es la información que se pidió—, y
     * colapsable; el cierre es aparte, porque colapsar no era lo que faltaba: faltaba poder quitarla.
     */
    function SkillCommandCard(props) {
      const { node, t } = props;
      const say = translator(t);
      const commandId = typeof node?.commandId === 'string' ? node.commandId : null;
      const text = typeof node?.outcome?.text === 'string' ? node.outcome.text : '';
      const decision = useDecision(props.useProjection);
      const [closed, setClosed] = React.useState(() => commandId !== null && readClosed().includes(commandId));
      const [open, setOpen] = React.useState(() => text.includes('\n'));
      const [touched, setTouched] = React.useState(false);

      // Una lista es anterior a una decisión si el `seq` de esa decisión es mayor que el de su propio
      // evento. Sin `seq` en el nodo no se compara: mejor no marcar que marcar por casualidad.
      const isList = LIST_COMMANDS.includes(String(node?.name ?? ''));
      const seq = Number.isFinite(node?.seq) ? node.seq : null;
      const stale = isList && decision !== null && decision.seq > -1 && seq !== null && decision.seq > seq;
      // Una lista obsoleta se pliega sola —ya no es la información que se pidió— y se despliega si el
      // humano la pide. Marcar y colapsar es lo honesto: el bloque sigue ahí, pero no engaña a primera vista.
      const expanded = touched ? open : open && !stale;

      // Las hojas de estilo se llevan en el árbol, como la de la píldora: desmontar la tarjeta las retira,
      // y cada una puede montarse sin la otra.
      if (node === undefined || node === null) {
        return h(React.Fragment, null,
          h('style', null, STYLES),
          h('div', { className: 'skc-card', 'data-state': 'unknown' }, say('card_unreadable')));
      }
      if (closed) return null;

      const state = node.outcome === null ? 'running' : (node.outcome.kind === 'error' ? 'error' : 'done');
      const name = typeof node.name === 'string' && node.name.length > 0 ? node.name : say('card_title');
      const toggle = say(expanded ? 'card_collapse' : 'card_expand');

      return h(React.Fragment, null,
        h('style', null, STYLES),
        h('div', { className: 'skc-card', 'data-state': state },
          h('div', { className: 'skc-card-head' },
            text === ''
              ? null
              : h('button', {
                type: 'button', className: 'skc-card-icon', 'aria-expanded': expanded,
                'aria-label': toggle, title: toggle,
                onClick: () => {
                  setTouched(true);
                  setOpen(!expanded);
                },
              }, h(ChevronMark, { open: expanded })),
            h('span', { className: 'skc-card-name', title: name }, name),
            h('span', { className: 'skc-card-summary' }, say(`card_${state}`)),
            h('button', {
              type: 'button', className: 'skc-card-icon skc-card-close',
              'aria-label': say('card_close'), title: say('card_close'),
              onClick: () => {
                closeCommand(commandId);
                setClosed(true);
              },
            }, h(CloseMark)),
          ),
          stale
            ? h('div', { className: 'skc-card-stale', role: 'note' },
              h(NoticeMark),
              h('span', null, say(decision.kind === 'rechazar' ? 'card_stale_rejected' : 'card_stale_approved')))
            : null,
          expanded && text !== '' ? h('pre', { className: 'skc-card-body' }, text) : null,
        ));
    }

    /* ── el componente ───────────────────────────────────────────────────────────────────────────── */

    function SkillCompilerBadge(props) {
      const { useProjection, t } = props;

      // Un adorno no puede romper el trabajo: sin servicio de proyección no se pinta nada.
      if (typeof useProjection !== 'function') return null;
      const view = useProjection(PROJECTION_KEY);
      if (!view || typeof view !== 'object') return null;

      const phase = view.phase;
      const outcome = view.outcome;
      const analyzing = phase === 'analyzing';
      if (!analyzing && !outcome) return null;

      // El idioma puede no estar registrado: se usa el texto del anfitrión si lo da, y si no, el de
      // reserva. Nunca se enseña una clave cruda.
      const say = translator(t);

      const shown = analyzing ? 'analyzing' : outcome;
      const Icon = ICONS[shown] ?? ICONS.none;
      const id = typeof view.id === 'string' ? view.id : '';
      const total = (Number(view.created) || 0) + (Number(view.updated) || 0);

      // Una sola frase con contexto: es lo que se anuncia, y es lo que se ve.
      const sentence = analyzing
        ? say('analyzing')
        : `${say(`${shown}_full`)}${id ? `: ${id}` : ''}`;

      // Acentos medidos: cada uno supera 3:1 como gráfico sobre fondo oscuro Y sobre fondo claro. El
      // `blocked` anterior (#b91c1c) se quedaba en 2.93:1 sobre oscuro; #dc2626 da 3.92/4.83.
      const accent = {
        created: '#0d9488',
        updated: '#a16207',
        none: 'inherit',
        rejected: '#b45309',
        blocked: '#dc2626',
        analyzing: '#7c3aed',
      }[shown] ?? 'inherit';

      return h(React.Fragment, null,
        h('style', null, STYLES),
        h('span', {
          className: `skc-pill${analyzing ? '' : ' skc-enter'}`,
          // Un único estado vivo, atómico, con la frase entera. Nada de números sueltos.
          role: 'status',
          'aria-atomic': 'true',
          'aria-live': 'polite',
          // El valor completo, disponible por foco y por puntero: el recorte visual no esconde el dato.
          title: sentence,
          tabIndex: 0,
          style: { '--skc-accent': accent },
        },
          h('span', { className: 'skc-mark' }, analyzing ? h(Gear) : h(Icon)),
          h('span', { className: 'skc-label' }, analyzing ? say('analyzing') : say(shown)),
          id ? h('span', { className: 'skc-id' }, id) : null,
          !analyzing && total > 1
            ? h('span', { className: 'skc-count', title: `${say('total')}: ${total}` }, `×${total}`)
            : null,
        ),
      );
    }

    return {
      // El servicio de idioma se declara aquí porque la pieza registra sus diccionarios en el arranque.
      inject: ['slots', 'locale'],

      apply(ctx) {
        // El registro del idioma es un recurso: se registra en un efecto para que se retire al descargar.
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES));

        ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          id: PACKAGE,
          order: 50,
          // Con esto el anfitrión pasa a la pieza una `t` ya atada a nuestro espacio de nombres.
          locale: NS,
        }, SkillCompilerBadge));

        // La tarjeta de los resultados de nuestros comandos: una entrada keyed por nombre. Si esta versión
        // del anfitrión no declarara ese slot, la pieza pierde la X y conserva la píldora —un adorno nunca
        // puede estropear el trabajo, y menos el flujo del chat.
        try {
          for (const command of COMMAND_NAMES) {
            ctx.slots.inject(COMMAND_VIEW_SLOT, () => ctx.slots.register({
              name: COMMAND_VIEW_SLOT,
              key: command,
              locale: NS,
            }, SkillCommandCard));
          }
        } catch { /* sin tarjeta propia: el resultado se lee en la del anfitrión, que no sabe cerrarse */ }
      },
    };
  },
});
