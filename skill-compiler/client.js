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
    const COMMAND_NAMES = [
      'skill-propuestas', 'skill-ver', 'skill-aprobar', 'skill-globalizar', 'skill-ambito', 'skill-auto',
      'skill-rechazar', 'skill-deshabilitar', 'skill-habilitar', 'skill-eliminar', 'skill-retiradas',
    ];
    /** Todos los comandos del plugin empiezan así: es lo que distingue los suyos en el catálogo del host. */
    const COMMAND_PREFIX = 'skill-';
    /**
     * Los comandos cuyo resultado es una LISTA que una decisión posterior deja atrás. Medido con el usuario
     * delante: aprobó una skill y el bloque que tenía debajo siguió enseñándola como pendiente. El texto de
     * un resultado es el registro de lo que pasó y no se reescribe, así que lo que se hace es decir que hay
     * una decisión posterior — eso lo sabe el log, y por eso viaja en la proyección.
     */
    // Los comandos cuyos resultados traen una lista que decidir. Los dos nuevos entran aquí porque su
    // resultado deja pendientes que decidir igual: publicar y cambiar de ámbito son decisiones, y tras una
    // decisión lo que queda se ofrece en el propio bloque, sin volver a pedir la lista.
    const LIST_COMMANDS = ['skill-propuestas', 'skill-ver', 'skill-retiradas', 'skill-globalizar', 'skill-ambito'];
    /**
     * Dónde se recuerda un resultado cerrado.
     *
     * No es `sessionStorage`, y eso costó un defecto reportado: con `sessionStorage` el cierre vivía lo que
     * durara la pestaña, así que al cerrar y reabrir la aplicación los bloques cerrados volvían a aparecer.
     * `localStorage` persiste entre arranques, y aquí es fiable porque el cliente de escritorio se sirve
     * desde un origen **estable** (`dsh-app://app`, medido en el contrato del shell) y no desde un puerto
     * efímero: la clave del almacén no cambia de un arranque al siguiente.
     */
    const CLOSED_KEY = 'skc-closed';
    /** Tope de la lista de cerrados: poda los más viejos, para que no crezca sin fin. */
    const CLOSED_MAX = 500;

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
        bulk_title: 'Decidir aquí mismo',
        bulk_single: 'Esta propuesta',
        bulk_reading: 'Leyendo las pendientes…',
        bulk_none: 'Ninguna pendiente: si acabas de aprobar, ya no queda nada que decidir.',
        bulk_no_rows: 'No hay filas que decidir en el catálogo de esta sesión. La lista está en el resultado de arriba: escribe «/» y elige la fila, o teclea el comando con su id.',
        bulk_unreadable: 'No se pudieron leer las pendientes',
        bulk_unreadable_hint: 'Síguelo desde el terminal o desde el menú «/»: la lista y la aprobación funcionan igual, pasan por la misma puerta',
        bulk_habilitar: 'Volver a encender las marcadas',
        bulk_confirm_habilitar: 'Sí, encender',
        bulk_ask_habilitar: 'Vas a volver a encender',
        bulk_ok_habilitar: 'encendidas',
        bulk_eliminar: 'Retirar las marcadas',
        bulk_confirm_eliminar: 'Sí, retirar',
        bulk_ask_eliminar: 'Vas a retirar (se mueven a un respaldo fechado, no se borran)',
        bulk_ok_eliminar: 'retiradas',
        bulk_select_all: 'Marcar todas',
        bulk_clear: 'Desmarcar',
        bulk_approve: 'Aprobar las marcadas',
        bulk_reject: 'Apartar las marcadas',
        bulk_approve_one: 'Aprobar esta',
        bulk_reject_one: 'Apartar esta',
        bulk_confirm_approve: 'Sí, aprobar',
        bulk_confirm_reject: 'Sí, apartar',
        bulk_cancel: 'Cancelar',
        bulk_running: 'Ejecutando…',
        bulk_ask_approve: 'Vas a aprobar',
        bulk_ask_reject: 'Vas a apartar',
        bulk_ask_footer: 'Cada una pasa por la misma puerta que el comando, y queda registrado.',
        bulk_ok_approve: 'aprobadas',
        bulk_ok_reject: 'apartadas',
        bulk_failed: 'con fallo',
        bulk_remaining: 'Pendientes ahora',
        bulk_again: 'Volver a marcar',
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
        bulk_title: 'Decide right here',
        bulk_single: 'This proposal',
        bulk_reading: 'Reading the pending ones…',
        bulk_none: 'Nothing pending: if you just approved, there is nothing left to decide.',
        bulk_no_rows: 'No rows to decide on in this session catalog. The list is in the result above: type «/» and pick the row, or type the command with its id.',
        bulk_unreadable: 'Could not read the pending ones',
        bulk_unreadable_hint: 'Follow it from the terminal or from the «/» menu: the list and the approval work the same, through the same gate',
        bulk_habilitar: 'Switch the marked ones back on',
        bulk_confirm_habilitar: 'Yes, switch on',
        bulk_ask_habilitar: 'About to switch back on',
        bulk_ok_habilitar: 'switched on',
        bulk_eliminar: 'Retire the marked ones',
        bulk_confirm_eliminar: 'Yes, retire',
        bulk_ask_eliminar: 'About to retire (they move to a dated backup, never deleted)',
        bulk_ok_eliminar: 'retired',
        bulk_select_all: 'Select all',
        bulk_clear: 'Clear',
        bulk_approve: 'Approve the selected',
        bulk_reject: 'Set aside the selected',
        bulk_approve_one: 'Approve this one',
        bulk_reject_one: 'Set this one aside',
        bulk_confirm_approve: 'Yes, approve',
        bulk_confirm_reject: 'Yes, set aside',
        bulk_cancel: 'Cancel',
        bulk_running: 'Running…',
        bulk_ask_approve: 'You are about to approve',
        bulk_ask_reject: 'You are about to set aside',
        bulk_ask_footer: 'Each one goes through the same gate as the command, and it is logged.',
        bulk_ok_approve: 'approved',
        bulk_ok_reject: 'set aside',
        bulk_failed: 'failed',
        bulk_remaining: 'Pending now',
        bulk_again: 'Select again',
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

/* ── el panel de decisiones ─────────────────────────────────────────────────────────────────────
   La lista, marcable: cada pendiente con su casilla y una barra de acciones. Es la superficie que
   pidio el usuario despues de ver que aprobar era de a una. Mismo criterio de color que el resto. */
.skc-bulk {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 9px;
  border-radius: 8px;
  border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
  background: color-mix(in oklab, currentColor 3%, transparent);
}
.skc-bulk-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px; opacity: 0.7; }
.skc-bulk-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.skc-bulk-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 4px; border-radius: 6px; }
.skc-bulk-row:hover { background: color-mix(in oklab, currentColor 7%, transparent); }
.skc-bulk-row input { flex: 0 0 auto; width: 14px; height: 14px; margin: 0; accent-color: currentColor; cursor: pointer; }
.skc-bulk-row label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px;
}
.skc-bulk-done { flex: 0 0 auto; margin-left: auto; font-size: 11px; opacity: 0.7; white-space: nowrap; }
.skc-bulk-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.skc-bulk-button {
  padding: 4px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid color-mix(in oklab, currentColor 22%, transparent);
  background: color-mix(in oklab, currentColor 8%, transparent);
  color: inherit; font: 500 11.5px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.skc-bulk-button:hover:enabled { background: color-mix(in oklab, currentColor 15%, transparent); }
.skc-bulk-button:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
.skc-bulk-button:disabled { opacity: 0.45; cursor: default; }
.skc-bulk-quiet { border-color: transparent; background: transparent; opacity: 0.7; }
.skc-bulk-spacer { flex: 1 1 auto; }
.skc-bulk-note { font-size: 11.5px; line-height: 1.4; }
.skc-bulk-note[data-tone="error"] { color: color-mix(in oklab, currentColor 70%, #dc2626); }
@media (forced-colors: active) {
  .skc-bulk, .skc-bulk-button { border-color: CanvasText; }
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

    /** Los resultados cerrados, tal como los recuerda esta instalación. Nunca lanza. */
    function readClosed() {
      try {
        const raw = window.localStorage.getItem(CLOSED_KEY);
        const list = raw === null ? [] : JSON.parse(raw);
        return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : [];
      } catch {
        return [];
      }
    }

    function writeClosed(ids) {
      try {
        window.localStorage.setItem(CLOSED_KEY, JSON.stringify(ids.slice(-CLOSED_MAX)));
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

    /* ── decidir aquí mismo: la lista, marcable ──────────────────────────────────────────────────── */

    /**
     * El prefijo de una fila del menú es `skill-<verbo>-`: es la gramática que lee el panel, y vale igual
     * para las pendientes (`skill-aprobar-<id>`) que para lo apagado (`skill-eliminar-<id>`).
     */
    const rowPrefix = (verb) => `skill-${verb}-`;

    /** Los ids de un verbo, tal y como los anuncia el catálogo del host. Una sola fuente: sus filas. */
    function rowIds(commands, verb) {
      const list = Array.isArray(commands) ? commands : (Array.isArray(commands?.commands) ? commands.commands : []);
      const prefix = rowPrefix(verb);
      const ids = [];
      for (const command of list) {
        const name = typeof command?.name === 'string' ? command.name : '';
        if (!name.startsWith(prefix)) continue;
        const id = name.slice(prefix.length);
        if (id !== '' && !ids.includes(id)) ids.push(id);
      }
      return ids;
    }

    /** Los verbos de cada lista, y sus textos: es lo único que cambia entre decidir propuestas y apagadas. */
    const VERB_TEXTS = {
      aprobar: { go: 'bulk_approve', confirm: 'bulk_confirm_approve', ask: 'bulk_ask_approve', ok: 'bulk_ok_approve' },
      rechazar: { go: 'bulk_reject', confirm: 'bulk_confirm_reject', ask: 'bulk_ask_reject', ok: 'bulk_ok_reject' },
      habilitar: { go: 'bulk_habilitar', confirm: 'bulk_confirm_habilitar', ask: 'bulk_ask_habilitar', ok: 'bulk_ok_habilitar' },
      eliminar: { go: 'bulk_eliminar', confirm: 'bulk_confirm_eliminar', ask: 'bulk_ask_eliminar', ok: 'bulk_ok_eliminar' },
    };

    /**
     * En `/skill-retiradas` también se decide en lote: reencender o retirar del todo lo que está apagado.
     * Retirar exige `--yes` —lo añade el panel, y por eso el paso de confirmación no es decorativo—: es el
     * único gesto irreversible, y siempre deja respaldo fechado.
     */
    function actionsFor(nodeName) {
      return String(nodeName ?? '') === 'skill-retiradas' ? ['habilitar', 'eliminar'] : ['aprobar', 'rechazar'];
    }
    const listVerbFor = (nodeName) => (String(nodeName ?? '') === 'skill-retiradas' ? 'eliminar' : 'aprobar');

    /**
     * El panel de decisiones de una lista de pendientes —y de una propuesta leída con `/skill-ver`—.
     *
     * Lo que pidió el usuario, y cómo se resuelve sin inventarse nada:
     *
     *   · Las pendientes **no se adivinan del texto** del resultado: se leen del catálogo del host, donde
     *     cada una ya tiene su fila (`skill-aprobar-<id>`). Es la única fuente estructurada, y es la misma
     *     que alimenta el menú `/`.
     *   · Ejecutar es **ejecutar el comando**, por el mismo remoto que usa el menú: el host aplica la misma
     *     puerta, lo registra igual y el flujo pinta el nodo. Aquí no se aprueba nada por un atajo.
     *   · **Paso a paso**: marcar, leer el resumen de lo que se va a hacer, y confirmar. Un clic no decide.
     *   · Si el remoto no está disponible, se dice con el motivo: no hay un plan B silencioso, y aprobar
     *     sigue siendo un acto humano.
     */
    function BulkActions(props) {
      const { say, node, sessionId, runCommand, listCommands } = props;
      const bulk = node?.name === 'skill-propuestas';
      const reading = typeof node?.args === 'string' ? node.args.trim() : '';

      const [ids, setIds] = React.useState(null);
      const [failure, setFailure] = React.useState('');
      const [picked, setPicked] = React.useState([]);
      const [stage, setStage] = React.useState('pick');
      // La primera acción de la lista decide el verbo inicial; el resto se ofrecen como botones. Antes sólo
      // existía «aprobar» y el verbo de rechazar estaba declarado pero sin botón: quedaba inalcanzable.
      const acciones = actionsFor(node?.name);
      const [verb, setVerb] = React.useState(() => acciones[0]);
      const [report, setReport] = React.useState(null);
      const [busy, setBusy] = React.useState(false);

      React.useEffect(() => {
        if (!bulk) {
          setIds(reading === '' ? [] : [reading]);
          return undefined;
        }
        let alive = true;
        const leer = () => listCommands(sessionId).then((commands) => rowIds(commands, listVerbFor(node?.name)));
        (async () => {
          try {
            let found = await leer();
            // El comando que originó este bloque acaba de armar sus filas (`onListed`), así que el host
            // puede tardar un instante en anunciarlas. Sin este reintento, el panel decía «no hay nada»
            // justo cuando acababa de llegar algo.
            if (found.length === 0) {
              await new Promise((resolve) => setTimeout(resolve, 400));
              if (!alive) return;
              found = await leer();
            }
            if (alive) setIds(found);
          } catch (error) {
            if (alive) {
              setIds([]);
              setFailure(String(error?.message ?? error));
            }
          }
        })();
        return () => { alive = false; };
      }, [bulk, reading, sessionId]);

      const rows = ids ?? [];
      const toggle = (id) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
      // El verbo decide el comando, y sólo retirar pide confirmación explícita al host.
      const target = `skill-${verb}`;
      const texts = VERB_TEXTS[verb] ?? VERB_TEXTS.aprobar;
      const linea = (id) => `${target} ${id}${verb === 'eliminar' ? ' --yes' : ''}`;

      const run = async () => {
        setBusy(true);
        setStage('running');
        const done = [];
        const failed = [];
        for (const id of picked) {
          try {
            const result = await runCommand(sessionId, linea(id));
            if (result !== null && result !== undefined && result.kind === 'error') failed.push({ id, reason: String(result.text ?? '') });
            else done.push(id);
          } catch (error) {
            failed.push({ id, reason: String(error?.message ?? error) });
          }
        }
        setReport({ done, failed });
        // Lo que salió bien deja de ofrecerse: el estado de la lista se mueve con lo que se ejecutó.
        setIds(rows.filter((id) => !done.includes(id)));
        setPicked(failed.map((entry) => entry.id));
        setBusy(false);
        setStage('done');
      };

      const buttons = [];
      const addButton = (key, text, onClick, { disabled = false, quiet = false } = {}) => {
        buttons.push(h('button', {
          key, type: 'button', disabled,
          className: `skc-bulk-button${quiet ? ' skc-bulk-quiet' : ''}`,
          onClick,
        }, text));
      };

      if (stage === 'pick') {
        if (picked.length > 0) {
          // Un botón por acción: marcar no decide, elegir la acción tampoco — el paso de confirmación sigue
          // detrás, y es el que dice qué se va a hacer y con qué consecuencia.
          for (const opcion of acciones) {
            addButton(`go-${opcion}`, `${say(VERB_TEXTS[opcion].go)} (${picked.length})`, () => { setVerb(opcion); setStage('confirm'); });
          }
          addButton('clear', say('bulk_clear'), () => setPicked([]), { quiet: true });
        } else if (rows.length > 1) {
          addButton('all', say('bulk_select_all'), () => setPicked(rows.slice()));
        }
      } else if (stage === 'confirm') {
        addButton('yes', say(texts.confirm), run);
        addButton('no', say('bulk_cancel'), () => setStage('pick'), { quiet: true });
      } else if (stage === 'done' && report !== null) {
        addButton('again', say('bulk_again'), () => { setReport(null); setStage('pick'); }, { quiet: true });
      }

      return h('div', { className: 'skc-bulk' },
        h('div', { className: 'skc-bulk-head' }, h('span', null, say(bulk ? 'bulk_title' : 'bulk_single'))),
        failure === ''
          ? null
          : h('div', { className: 'skc-bulk-note', 'data-tone': 'error' }, `${say('bulk_unreadable')}: ${failure}. ${say('bulk_unreadable_hint')}`),
        // «Leyendo…» sólo mientras de verdad se está leyendo: si la lectura falló, el único aviso es el
        // motivo, más abajo. Y «ninguna pendiente» sólo cuando se pudo leer y la lista vino vacía — decir
        // «no hay nada» sin haber podido preguntar es una mentira por omisión, y además deja al humano sin
        // salida: el error añade por dónde seguir.
        ids === null && failure === '' ? h('div', { className: 'skc-bulk-note' }, say('bulk_reading')) : null,
        ids !== null && failure === '' && rows.length === 0 && report === null
          ? h('div', { className: 'skc-bulk-note' }, say('bulk_no_rows'))
          : null,
        rows.length === 0
          ? null
          : h('ul', { className: 'skc-bulk-list' },
            rows.map((id) => {
              const state = report === null ? '' : (report.done.includes(id) ? say('card_done') : (report.failed.some((entry) => entry.id === id) ? say('card_error') : ''));
              return h('li', { key: id, className: 'skc-bulk-row' },
                h('input', {
                  id: `skc-pick-${id}`,
                  type: 'checkbox',
                  checked: picked.includes(id),
                  disabled: stage === 'running' || stage === 'confirm',
                  'aria-label': `${say(bulk ? 'bulk_title' : 'bulk_single')}: ${id}`,
                  onChange: () => toggle(id),
                }),
                h('label', { htmlFor: `skc-pick-${id}`, title: id }, id),
                state === '' ? null : h('span', { className: 'skc-bulk-done' }, state));
            })),
        stage === 'confirm'
          ? h('div', null,
            h('div', { className: 'skc-bulk-note' }, `${say(texts.ask)} ${picked.length}: ${picked.join(', ')}`),
            h('div', { className: 'skc-bulk-note' }, say('bulk_ask_footer')))
          : null,
        stage === 'running' ? h('div', { className: 'skc-bulk-note' }, say('bulk_running')) : null,
        stage === 'done' && report !== null
          ? h('div', null,
            h('div', { className: 'skc-bulk-note' },
              `${report.done.length} ${say(texts.ok)} · ${report.failed.length} ${say('bulk_failed')}`),
            h('div', { className: 'skc-bulk-note' }, `${say('bulk_remaining')}: ${ids === null ? '' : ids.length}`),
            report.failed.length === 0
              ? null
              : h('ul', { className: 'skc-bulk-list' },
                report.failed.map((entry) => h('li', { key: entry.id, className: 'skc-bulk-note', 'data-tone': 'error' },
                  `${entry.id}: ${entry.reason.split('\n')[0]}`))))
          : null,
        buttons.length === 0 ? null : h('div', { className: 'skc-bulk-bar' }, buttons));
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
      const { node, t, sessionId, runCommand, listCommands, ensureCard } = props;
      const say = translator(t);
      const commandId = typeof node?.commandId === 'string' ? node.commandId : null;
      const text = typeof node?.outcome?.text === 'string' ? node.outcome.text : '';
      const decision = useDecision(props.useProjection);
      const [closed, setClosed] = React.useState(() => commandId !== null && readClosed().includes(commandId));

      // Aprender qué comandos son del plugin, para que **también las filas del menú** tengan tarjeta
      // propia —y con ella su X—. El nombre de una fila no se puede saber de antemano; el catálogo del
      // host sí lo dice, y aquí ya hay `sessionId` para preguntarlo.
      React.useEffect(() => {
        if (typeof sessionId !== 'string' || typeof ensureCard !== 'function' || typeof listCommands !== 'function') return undefined;
        let vivo = true;
        (async () => {
          try {
            const commands = await listCommands(sessionId);
            for (const entry of commands) {
              const name = typeof entry === 'string' ? entry : entry?.name;
              if (vivo && typeof name === 'string') ensureCard(name);
            }
          } catch { /* el panel ya dice por qué no pudo leer: aquí no hay nada que añadir */ }
        })();
        return () => { vivo = false; };
      }, [sessionId]);
      const [open, setOpen] = React.useState(() => text.includes('\n'));
      const [touched, setTouched] = React.useState(false);

      // Una lista es anterior a una decisión si el `seq` de esa decisión es mayor que el de su propio
      // evento. Sin `seq` en el nodo no se compara: mejor no marcar que marcar por casualidad.
      const isList = LIST_COMMANDS.includes(String(node?.name ?? ''));
      const seq = Number.isFinite(node?.seq) ? node.seq : null;
      const stale = isList && decision !== null && decision.seq > -1 && seq !== null && decision.seq > seq;
      // Una lista obsoleta se pliega sola —ya no es la información que se pidió— y se despliega si el
      // humano la pide. Marcar y colapsar es lo honesto: el bloque sigue ahí, pero no engaña a primera vista.
      // El `stale` **marca** que la lista quedó atrás de una decisión, y eso se avisa aparte; lo que no
      // puede hacer es **esconder** el resultado. El texto de un bloque es el registro de lo que pasó, y
      // una lista de pendientes que el humano pidió ver no desaparece porque después se decidiera algo.
      const expanded = touched ? open : open;

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
          // Las acciones van fuera del cuerpo desplegable: una lista colapsada sigue ofreciendo decidir, y
          // el panel lee el catálogo del host, así que vale también cuando el texto del bloque quedó atrás.
          isList ? h(BulkActions, { say, node, sessionId, runCommand, listCommands }) : null,
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
      //
      // `remote.commands` se declara con su PATH, no como `remote`: el contexto de cliente resuelve los
      // servicios por la ruta que el anfitrión declara, y su propio paquete de comandos usa exactamente
      // `'remote.commands'`. Sin esta línea, `ctx.remote.commands` existía como proxy pero lanzaba
      // «cannot get property "remote.commands" without inject» al primer uso: el panel anunciaba que no
      // había nada pendiente cuando lo que pasaba es que no había podido preguntar.
      inject: ['slots', 'locale', 'remote.commands'],

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

        // Ejecutar un comando del host desde la tarjeta: es **el mismo remoto** que usa el menú `/` al
        // elegir una fila, así que el comando entra por donde entraría tecleado —el host aplica la misma
        // puerta, lo registra con `command/run`/`command/done` y el nodo aparece en el flujo de todas las
        // pestañas—. Y el modelo no alcanza esta superficie: aprobar sigue siendo un acto humano, con un
        // clic en vez de una línea.
        //
        // Se busca de forma tolerante: si este anfitrión no expone el remoto, el panel lo dirá con el
        // motivo en vez de desaparecer en silencio, y la píldora sigue funcionando.
        const remote = ctx.get?.('remote') ?? ctx.remote ?? null;
        const runCommand = async (sessionId, line) => {
          if (typeof remote?.commands?.execute !== 'function') throw new Error('este anfitrión no expone commands.execute a un plugin de cliente');
          const result = await remote.commands.execute(sessionId, line, []);
          if (result === null || result === undefined || result.ok !== true) throw new Error(String(result?.error?.message ?? 'command.execute failed'));
          return result.value?.result ?? null;
        };
        const listCommands = async (sessionId) => {
          if (typeof remote?.commands?.list !== 'function') throw new Error('este anfitrión no expone commands.list a un plugin de cliente');
          const result = await remote.commands.list(sessionId);
          if (result === null || result === undefined || result.ok !== true) throw new Error(String(result?.error?.message ?? 'commands.list failed'));
          return result.value ?? [];
        };

        // La tarjeta de los resultados de nuestros comandos: una entrada keyed por nombre. Si esta versión
        // del anfitrión no declarara ese slot, la pieza pierde la X y conserva la píldora —un adorno nunca
        // puede estropear el trabajo, y menos el flujo del chat.
        //
        // Los nombres base se fijan aquí; las **filas del menú**, no: llevan el id en el nombre
        // (`skill-aprobar-<id>`), así que no se pueden enumerar de antemano y el slot no existía para
        // ellas. Consecuencia medida: al elegir una fila, su resultado lo pintaba la tarjeta del
        // anfitrión **sin X** y el bloque quedaba fijo en la conversación. El cliente los aprende del
        // catálogo del host en cuanto tiene un `sessionId` (al montar cualquier tarjeta nuestra) y
        // registra su slot entonces.
        const cardSlots = new Map();
        const ensureCard = (name) => {
          if (typeof name !== 'string' || name === '' || !name.startsWith(COMMAND_PREFIX) || cardSlots.has(name)) return;
          try {
            const dispose = ctx.slots.inject(COMMAND_VIEW_SLOT, () => ctx.slots.register({
              name: COMMAND_VIEW_SLOT,
              key: name,
              locale: NS,
            }, (props) => h(SkillCommandCard, { ...props, runCommand, listCommands, ensureCard })));
            cardSlots.set(name, dispose);
          } catch { /* sin tarjeta propia: el resultado se lee en la del anfitrión, que no sabe cerrarse */ }
        };
        for (const command of COMMAND_NAMES) ensureCard(command);
        // Las retiradas se guardan: descargar el plugin no puede dejar slots vivos apuntando a una pieza
        // que ya no está.
        ctx.effect(() => () => {
          for (const dispose of cardSlots.values()) {
            try {
              if (typeof dispose === 'function') dispose();
            } catch { /* ya retirado */ }
          }
          cardSlots.clear();
        });
      },
    };
  },
});
