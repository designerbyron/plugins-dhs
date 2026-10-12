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
`;

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
      const say = (key) => {
        if (typeof t === 'function') {
          try {
            const value = t(key);
            if (typeof value === 'string' && value.length > 0 && value !== key) return value;
          } catch { /* el anfitrión decide; aquí solo se evita romper */ }
        }
        return FALLBACK[key] ?? key;
      };

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
      },
    };
  },
});
