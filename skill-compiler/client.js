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
 *     `/skill-proposals` deja bloques largos en el flujo y sólo se podían colapsar. Se registra una
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
     * despacho del slot es por nombre exacto; las filas de pendientes (`skill-approve-<id>`) escriben una
     * línea y usan la tarjeta del host, que para eso basta.
     */
    const COMMAND_NAMES = [
      // Los dos idiomas: el host registra UN nombre por operacion (el del idioma activo) y el bloque que se
      // esta mirando trae el suyo, asi que las dos formas tienen que tener su entrada.
      'skill-proposals', 'skill-pending', 'skill-show', 'skill-approve', 'skill-publish', 'skill-scope',
      'skill-auto', 'skill-reject', 'skill-disable', 'skill-enable', 'skill-retire', 'skill-retired',
      'skill-ownership', 'skill-systems',
      'skill-propuestas', 'skill-pendientes', 'skill-ver', 'skill-aprobar', 'skill-globalizar', 'skill-ambito',
      'skill-rechazar', 'skill-deshabilitar', 'skill-habilitar', 'skill-eliminar', 'skill-retiradas',
      'skill-propiedad', 'skill-sistemas',
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
    const LIST_COMMANDS = [
      'skill-proposals', 'skill-show', 'skill-retired', 'skill-publish', 'skill-scope',
      'skill-propuestas', 'skill-ver', 'skill-retiradas', 'skill-globalizar', 'skill-ambito',
    ];
    /**
     * El nombre de cada verbo en cada idioma. El panel no teclea: compone una ORDEN (`/skill-aprobar <id>
     * --local`) y el host solo conoce el nombre que el idioma activo tiene registrado. El idioma viaja con el
     * bloque que se esta decidiendo (la lista llega como `skill-propuestas` en espanol y `skill-proposals` en
     * ingles), asi que no hay que preguntarselo a nadie ni duplicar el estado del servidor aqui.
     */
    const VERB_COMMANDS = {
      aprobar: { en: 'skill-approve', es: 'skill-aprobar' },
      globalizar: { en: 'skill-publish', es: 'skill-globalizar' },
      rechazar: { en: 'skill-reject', es: 'skill-rechazar' },
      habilitar: { en: 'skill-enable', es: 'skill-habilitar' },
      eliminar: { en: 'skill-retire', es: 'skill-eliminar' },
    };
    /** Las listas cuyo nombre espanol se reconoce: es lo que dice en que idioma habla el bloque. */
    const LIST_NAMES_ES = ['skill-propuestas', 'skill-ver', 'skill-retiradas', 'skill-globalizar', 'skill-ambito'];
    const idiomaDe = (nodeName) => (LIST_NAMES_ES.includes(String(nodeName ?? '')) ? 'es' : 'en');
    /** El nombre del comando de un verbo, en el idioma del bloque que se decide. */
    const comandoDe = (verb, nodeName) => (VERB_COMMANDS[verb] ?? {})[idiomaDe(nodeName)] ?? `skill-${verb}`;
    /**
     * Con qué empieza la respuesta de `skill-approve` cuando **no** ha aprobado: pregunta el ámbito. Es texto
     * del comando (el de su idioma, hoy ASCII), no de la interfaz, y se comprueba aquí porque contar esa
     * respuesta como aprobada ya costó diez aprobaciones que no ocurrieron. La primera comprobación es el
     * `code` del contrato (`scope-ask`), que no depende del idioma; la prosa queda como reserva.
     */
    const SCOPE_ASK = 'Dime donde quieres que viva';
    /** El host no devolvió resultado: no se ejecutó nada. Se dice con estas palabras, no como éxito. */
    const NO_RESULT = 'el host no devolvió resultado: el comando no se ejecutó';

    // <veredicto>
    /**
     * Lee el veredicto del propio comando. Es la **misma** frase que ve el humano cuando escribe la orden, y
     * por eso es evidencia: `Activa: <id> [<key>]`, `Ya estaba activa: <id>`, `Apartada: <id>`, o el
     * `ok   <id> — …` / `FALLO <id> — …` del lote. Las líneas de la puerta van sangradas (`  FALLO  …`) y se
     * distinguen justamente por eso: no nombran un id.
     *
     * Vivía sólo en la comprobación por filas, y ahí está el defecto que esto cierra: en un anfitrión que no
     * anuncia filas, el efecto no se puede medir, así que una aprobación correcta se contaba como fallida.
     */
    /**
     * Códigos que el panel entiende. Son el contrato: si llega uno reconocido, manda él y no se lee `text`.
     * Un código **desconocido** no puede convertirse en éxito ni en «sigue con la prosa»: es un fallo visible,
     * porque significa que el servidor habla un contrato que esta tarjeta no conoce.
     */
    const CODIGOS_HECHO = new Set([
      'activated', 'already-active', 'updated-disabled', 'published', 'set-aside',
      'enabled', 'disabled', 'retired', 'rejected', 'already-published', 'already-set-aside', 'scope-changed',
    ]);
    const CODIGOS_FALLO = new Set([
      'with-warnings', 'gate-failed', 'unsafe-id', 'no-proposal', 'no-scope', 'id-conflict',
      'topic-conflict', 'invalid-flag', 'internal-error', 'batch-partial', 'batch-empty', 'batch-nothing',
    ]);
    /** Códigos que no son veredicto (una pregunta, un listado): se dejan pasar sin decidir nada. */
    const CODIGOS_NEUTROS = new Set(['scope-ask', 'language-ask', 'pending-list']);
    /**
     * Estados funcionales del contrato por elemento que cuentan como HECHO. Es dato del servidor (el `state` de
     * cada `items[]`), no prosa: si el estado no esta aqui, el elemento no se cuenta como hecho.
     */
    const ESTADOS_HECHOS = new Set(['approved', 'published', 'disabled', 'enabled', 'retired', 'rejected']);

    const veredicto = (texto, ids, code, params, items) => {
      const pedidos = new Set(ids);
      const hechos = new Set();
      const fallos = new Map();
      // 0) Contrato por ELEMENTO (4.0.0). Manda sobre todo lo demas: cada elemento dice su id, su `state` y su
      //    `code`, asi que no hay que interpretar ninguna frase. Un elemento de un id que no se pidio se ignora
      //    (nunca se inventa un veredicto) y uno con estado desconocido es fallo visible, no exito.
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const id = typeof item?.id === 'string' ? item.id : '';
          if (!pedidos.has(id)) continue;
          const c = typeof item.code === 'string' ? item.code : '';
          const estado = String(item.state ?? '');
          if (ESTADOS_HECHOS.has(estado) && (c === '' || CODIGOS_HECHO.has(c))) hechos.add(id);
          else fallos.set(id, c !== '' ? c : (estado !== '' ? estado : 'failed'));
        }
        if (hechos.size > 0 || fallos.size > 0) return { hechos, fallos, code: '', items: true };
      }
      // 1) Contrato nuevo: el código decide. Sólo se acepta como hecho si nombra un id pedido; si no, se cae a
      //    la prosa (compatibilidad), nunca a un éxito inventado.
      if (typeof code === 'string' && code !== '' && !CODIGOS_NEUTROS.has(code)) {
        if (CODIGOS_HECHO.has(code) && typeof params?.id === 'string' && pedidos.has(params.id)) {
          return { hechos: new Set([params.id]), fallos: new Map(), code };
        }
        if (CODIGOS_FALLO.has(code)) {
          const id = typeof params?.id === 'string' && pedidos.has(params.id) ? params.id : ([...pedidos][0] ?? '?');
          return { hechos: new Set(), fallos: new Map([[id, code]]), code };
        }
        if (!CODIGOS_HECHO.has(code)) {
          const id = typeof params?.id === 'string' && pedidos.has(params.id) ? params.id : ([...pedidos][0] ?? '?');
          return { hechos: new Set(), fallos: new Map([[id, `código desconocido: ${code}`]]), code };
        }
      }
      for (const cruda of String(texto ?? '').split('\n')) {
        const linea = cruda.trim();
        if (linea === '') continue;
        // Los verbos de la reserva estan en los dos idiomas: con el texto ingles, la lista espanola no casaba y
        // una aprobacion correcta se contaba como fallo (el `code` no llega en esta compilacion del anfitrion).
        let m = /^ok\s+(\S+)/.exec(linea) || /^(?:Activa|Publicada|Apartada|Habilitada|Deshabilitada|Retirada|Ya estaba activa|Active|Published|Set aside|Enabled|Disabled|Retired|Already active):\s*(\S+)/.exec(linea);
        if (m !== null && pedidos.has(m[1])) { hechos.add(m[1]); continue; }
        m = /^FALLO\s+(\S+)\s+[—-]\s*(.*)$/.exec(linea);
        if (m !== null && pedidos.has(m[1])) fallos.set(m[1], m[2] || 'falló');
      }
      return { hechos, fallos };
    };

    /** ¿El motivo es de transporte (otra firma puede servir) o del comando (repetir no cambia nada)? */
    const esDeTransporte = (motivo) => /wire field|descriptor|boundary validation|is not a function|no expone|cannot get property|undefined is not|TypeError/i.test(String(motivo ?? ''));
    // </veredicto>
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
        skills: 'Skills de este turno',
        part_created_s: 'nueva',
        part_created_p: 'nuevas',
        part_updated_s: 'actualizada',
        part_updated_p: 'actualizadas',
        part_rejected_s: 'rechazada',
        part_rejected_p: 'rechazadas',
        part_blocked_s: 'bloqueada',
        part_blocked_p: 'bloqueadas',
        skills_short: 'skills',
        card_close: 'Cerrar este resultado',
        card_expand: 'Mostrar el resultado',
        card_collapse: 'Ocultar el resultado',
        card_running: 'en curso',
        card_done: 'hecho',
        card_error: 'falló',
        card_title: 'comando',
        card_unreadable: 'No se pudo leer el resultado: esta versión del anfitrión no entrega el comando a la tarjeta',
        card_stale_approved: 'Aprobaste algo después de esta lista: vuelve a ejecutar /skill-proposals para verla al día',
        card_stale_rejected: 'Apartaste algo después de esta lista: vuelve a ejecutar /skill-proposals para verla al día',
        bulk_title: 'Decidir aquí mismo',
        bulk_single: 'Esta propuesta',
        bulk_reading: 'Leyendo las pendientes…',
        bulk_none: 'Ninguna pendiente: si acabas de aprobar, ya no queda nada que decidir.',
        bulk_ids_hint: 'Sin filas en esta sesión: el comando con el id funciona igual.',
        bulk_no_rows: 'No hay filas que decidir en el catálogo de esta sesión. La lista está en el resultado de arriba: escribe «/» y elige la fila, o teclea el comando con su id.',
        bulk_nothing: 'Nada pendiente: no hay ninguna propuesta esperando tu decisión. Las activas siguen en el resultado de arriba.',
        bulk_decided: 'Esta propuesta ya no esta pendiente: se decidio (o se decidio en otra tarjeta). Aqui queda como registro; no hay nada que aprobar.',
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
        bulk_global: 'Publicar para todos los proyectos',
        bulk_global_one: 'Publicar esta para todos',
        bulk_confirm_global: 'Sí, publicar para todos',
        bulk_ask_global: 'Vas a publicar para TODOS tus proyectos',
        bulk_global_note: 'Se publican en la biblioteca de usuario: las sirve el harness en cualquier proyecto. La copia del proyecto queda archivada en published/.',
        bulk_ok_global: 'publicadas',
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
        bulk_remaining_unknown: 'no medible en este anfitrión (no anuncia filas)',
        bulk_warnings_title: 'La puerta pide una decisión: la propuesta tiene avisos. Léelos y decide.',
        bulk_warnings_accept: 'Acepto los avisos y continúo',
        bulk_again: 'Volver a marcar',
        bulk_nothing_ran: 'No se ejecutó ningún comando: pégalos en el compositor, uno por línea, y son la misma puerta.',
        bulk_host_form: 'Forma del host que funcionó',
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
        skills: 'Skills this turn',
        part_created_s: 'new',
        part_created_p: 'new',
        part_updated_s: 'updated',
        part_updated_p: 'updated',
        part_rejected_s: 'rejected',
        part_rejected_p: 'rejected',
        part_blocked_s: 'blocked',
        part_blocked_p: 'blocked',
        skills_short: 'skills',
        card_close: 'Close this result',
        card_expand: 'Show the result',
        card_collapse: 'Hide the result',
        card_running: 'running',
        card_done: 'done',
        card_error: 'failed',
        card_title: 'command',
        card_unreadable: 'Could not read the result: this host version does not hand the command to the card',
        card_stale_approved: 'You approved something after this list: run /skill-proposals again to see it current',
        card_stale_rejected: 'You set something aside after this list: run /skill-proposals again to see it current',
        bulk_title: 'Decide right here',
        bulk_single: 'This proposal',
        bulk_reading: 'Reading the pending ones…',
        bulk_none: 'Nothing pending: if you just approved, there is nothing left to decide.',
        bulk_no_rows: 'No rows to decide on in this session catalog. The list is in the result above: type «/» and pick the row, or type the command with its id.',
        bulk_nothing: 'Nothing pending: no proposal is waiting for your decision. The active ones are in the result above.',
        bulk_decided: 'This proposal is no longer pending: it was decided (or decided in another card). It stays here as a record; there is nothing to approve.',
        bulk_ids_hint: 'No rows in this session: the command with its id works the same.',
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
        bulk_global: 'Publish for all my projects',
        bulk_global_one: 'Publish this one for all',
        bulk_confirm_global: 'Yes, publish for all',
        bulk_ask_global: 'About to publish for ALL your projects',
        bulk_global_note: 'They go to your user library: the harness serves them in any project. The project copy is archived under published/.',
        bulk_ok_global: 'published',
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
        bulk_remaining_unknown: 'not measurable on this host (it announces no rows)',
        bulk_warnings_title: 'The gate asks for a decision: this proposal has warnings. Read them and decide.',
        bulk_warnings_accept: 'I accept the warnings and continue',
        bulk_again: 'Select again',
        bulk_nothing_ran: 'No command was executed: paste them in the composer, one per line — same gate.',
        bulk_host_form: 'Host call shape that worked',
      },
    };

    const FALLBACK = DICTIONARIES.en;

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
/* Las líneas para pegar: se leen como código y se copian enteras — sin heredoc ni adorno. */
.skc-bulk-body { margin: 4px 0 0; padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
  background: color-mix(in oklab, currentColor 5%, transparent); border-radius: 6px; }
.skc-bulk-note[data-tone="error"] { color: color-mix(in oklab, currentColor 68%, #dc2626); }
/* Un tono por significado, y todos derivados de currentColor: el texto nunca baja del contraste que el
   anfitrión ya aprobó, y en cualquier tema el matiz es el mismo. */
.skc-bulk-note[data-tone="ok"] { color: color-mix(in oklab, currentColor 68%, #16a34a); }
.skc-bulk-note[data-tone="warn"] { color: color-mix(in oklab, currentColor 68%, #d97706); }
.skc-bulk-note[data-tone="muted"] { opacity: 0.72; }
.skc-bulk-done[data-tone="ok"] { color: color-mix(in oklab, currentColor 68%, #16a34a); opacity: 1; }
.skc-bulk-done[data-tone="error"] { color: color-mix(in oklab, currentColor 68%, #dc2626); opacity: 1; }
.skc-bulk-row[data-hecha="si"] label { opacity: 0.55; }
.skc-bulk-row[data-hecha="si"] { background: color-mix(in oklab, currentColor 4%, transparent); }

/* Microanimación: la línea aparece subiendo dos píxeles. Es información que llega, no fuegos artificiales —
   y con movimiento reducido no hay animación, sólo el estado final. */
@keyframes skc-llega { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
.skc-bulk-note, .skc-bulk-done { animation: skc-llega 170ms ease-out both; }
.skc-bulk-body { animation: skc-llega 200ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .skc-bulk-note, .skc-bulk-done, .skc-bulk-body { animation: none; }
}
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
     * para las pendientes (`skill-approve-<id>`) que para lo apagado (`skill-retire-<id>`).
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
      // El ámbito es una decisión, no un detalle: «aprobar» deja la skill en este proyecto y «publicar»
      // la sirve el harness en todos. Ofrecer sólo una de las dos obligaba a teclear la otra a mano.
      globalizar: { go: 'bulk_global', confirm: 'bulk_confirm_global', ask: 'bulk_ask_global', ok: 'bulk_ok_global', note: 'bulk_global_note' },
      rechazar: { go: 'bulk_reject', confirm: 'bulk_confirm_reject', ask: 'bulk_ask_reject', ok: 'bulk_ok_reject' },
      habilitar: { go: 'bulk_habilitar', confirm: 'bulk_confirm_habilitar', ask: 'bulk_ask_habilitar', ok: 'bulk_ok_habilitar' },
      eliminar: { go: 'bulk_eliminar', confirm: 'bulk_confirm_eliminar', ask: 'bulk_ask_eliminar', ok: 'bulk_ok_eliminar' },
    };

    /**
     * En `/skill-retired` también se decide en lote: reencender o retirar del todo lo que está apagado.
     * Retirar exige `--yes` —lo añade el panel, y por eso el paso de confirmación no es decorativo—: es el
     * único gesto irreversible, y siempre deja respaldo fechado.
     */
    function actionsFor(nodeName) {
      // Orden = orden de los botones; el primero es además el verbo por defecto. Aprobar (este proyecto),
      // publicar (todos) y apartar: las tres decisiones que existen, sin sintaxis que recordar. Lo apagado
      // no publica —ya estuvo activo— así que allí sólo se reenciende o se retira.
      return ['skill-retired', 'skill-retiradas'].includes(String(nodeName ?? '')) ? ['habilitar', 'eliminar'] : ['aprobar', 'globalizar', 'rechazar'];
    }
    // El VERBO de la fila es siempre el ingles: las filas del menu se llaman `skill-approve-<id>` en los dos
    // idiomas (son marcador de maquina, como los `ok`/`FALLO` del lote).
    const listVerbFor = (nodeName) => (['skill-retired', 'skill-retiradas'].includes(String(nodeName ?? '')) ? 'retire' : 'approve');

    /**
     * El panel de decisiones de una lista de pendientes —y de una propuesta leída con `/skill-show`—.
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
    /* [store:pendientes:inicio]
     *
     * La lista de pendientes, UNA vez por sesion y compartida por todas las tarjetas.
     *
     * El problema que resuelve, medido en una decision real: el panel preguntaba "que esta pendiente?" cuatro
     * veces antes de decidir y una despues, y el anfitrion **ejecuta un comando para contestar** -no hay canal de
     * lectura-, asi que cada pregunta dejaba una notificacion en el flujo. Y como cada tarjeta guardaba su propia
     * foto, la que habia leido antes de publicar seguia ofreciendo aprobar lo ya publicado.
     *
     * La forma que aguanta:
     *   · una sola lectura en vuelo (las llamadas concurrentes comparten la misma promesa),
     *   · una foto con caducidad corta (dentro de la ventana, preguntar otra vez no ejecuta nada),
     *   · `force` para el momento en que el efecto tiene que comprobarse de verdad,
     *   · y suscriptores: decidir invalida y **todas** las tarjetas leen la misma foto nueva.
     *
     * Esto vive en el cliente porque el panel es del plugin; el motor no participa en la presentacion.
     */
    const ESPERA_FOTO_MS = 1500;

    function createPendingStore() {
      let foto = { ids: null, avisos: new Map(), medible: false, failure: '', at: 0, seq: 0 };
      let enVuelo = null;
      let lector = null;
      const oyentes = new Set();
      const avisar = () => { for (const oyente of [...oyentes]) oyente(foto); };
      return {
        /** La foto actual. `ids === null` significa "todavia no se ha podido leer". */
        foto: () => foto,
        /** Quien sabe leer: lo pone la tarjeta en cada render (runCommand/listCommands son del host). */
        usarLector: (fn) => { if (typeof fn === 'function') lector = fn; },
        suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
        /** La foto deja de servir: la proxima lectura pregunta al almacen aunque este dentro de la ventana. */
        invalidar() { foto = { ...foto, at: 0 }; },
        /**
         * La foto, leyendola si hace falta. Devuelve SIEMPRE la foto (con `failure` si no se pudo leer), para
         * que quien llama no tenga que distinguir "no hay nada" de "no pude mirar": son cosas distintas y el
         * panel las dice distintas.
         */
        async leer({ force = false } = {}) {
          const ahora = Date.now();
          if (!force && foto.at > 0 && ahora - foto.at < ESPERA_FOTO_MS) return foto;
          if (enVuelo !== null) return enVuelo;
          enVuelo = (async () => {
            try {
              if (lector === null) throw new Error('sin lector');
              const leida = await lector();
              foto = {
                ids: Array.isArray(leida?.ids) ? leida.ids : [],
                avisos: leida?.avisos instanceof Map ? leida.avisos : new Map(),
                medible: leida?.medible === true,
                failure: '',
                at: Date.now(),
                seq: foto.seq + 1,
              };
            } catch (error) {
              // Un fallo de lectura no se convierte en "no hay nada": la foto conserva lo que sabia y dice el
              // motivo. `at` a 0 para que la proxima llamada lo reintente de verdad.
              foto = { ...foto, failure: String(error?.message ?? error), at: 0, seq: foto.seq + 1 };
            } finally {
              enVuelo = null;
              avisar();
            }
            return foto;
          })();
          return enVuelo;
        },
      };
    }

    /** Un store por sesion: dos tarjetas de la misma sesion comparten la foto; dos sesiones no. */
    const storesPendientes = new Map();
    function pendingStoreFor(sessionId) {
      const clave = String(sessionId ?? '');
      if (!storesPendientes.has(clave)) storesPendientes.set(clave, createPendingStore());
      return storesPendientes.get(clave);
    }
    /* [store:pendientes:fin] */

    function BulkActions(props) {
      const { say, node, sessionId, runCommand, listCommands } = props;
      // Diagnóstico del contrato: el host no documenta sus props y el asar está minificado. Esta línea dice
      // lo que entrega de verdad —nombres y tipos— para dejar de adivinar. Se pinta sólo cuando algo falla.
      const diagnóstico = React.useMemo(() => {
        const tipos = Object.fromEntries(Object.keys(props).sort().map((k) => [k, typeof props[k]]));
        return `host · ${Object.entries(tipos).map(([k, v]) => `${k}=${v}`).join(' · ')}`;
      }, [props]);
      // El bloque es una lista de pendientes en cualquiera de los dos idiomas; con el nombre fijo, en
      // espanol el panel trataba la lista como una propuesta suelta y no ofrecia las casillas.
      const bulk = ['skill-proposals', 'skill-propuestas'].includes(String(node?.name ?? ''));
      const reading = typeof node?.args === 'string' ? node.args.trim() : '';

      // La foto la comparte TODA la sesion: leer aqui no ejecuta nada si otra tarjeta acaba de leer, y decidir
      // en una tarjeta actualiza las demas (antes cada una guardaba su foto y la vieja seguia ofreciendo lo ya
      // publicado).
      const store = pendingStoreFor(sessionId);
      const [foto, setFoto] = React.useState(store.foto());
      const [filas, setFilas] = React.useState(null);
      const [falloFilas, setFalloFilas] = React.useState('');
      const [picked, setPicked] = React.useState([]);
      const [stage, setStage] = React.useState('pick');
      // La primera acción de la lista decide el verbo inicial; el resto se ofrecen como botones. Antes sólo
      // existía «aprobar» y el verbo de rechazar estaba declarado pero sin botón: quedaba inalcanzable.
      const acciones = actionsFor(node?.name);
      const [verb, setVerb] = React.useState(() => acciones[0]);
      const [report, setReport] = React.useState(null);
      const [busy, setBusy] = React.useState(false);

      /**
       * Lo que el store usa para leer: el comando del plugin primero (existe siempre), las filas del menu
       * como respaldo. Se registra en cada render porque `runCommand`/`listCommands` son del host.
       */
      const leerPendientes = async () => {
        try {
          const r = await runCommand(sessionId, '/skill-pending');
          const texto = String(r?.text ?? '');
          const linea = /^ids:\s*(.*)$/m.exec(texto);
          if (linea !== null) {
            const ids = linea[1].trim() === '' ? [] : linea[1].split(',').map((x) => x.trim()).filter(Boolean);
            const avisos = new Map();
            for (const m of texto.matchAll(/^aviso:\s*(\S+)\s*·\s*(.*)$/gm)) {
              if (!avisos.has(m[1])) avisos.set(m[1], []);
              avisos.get(m[1]).push(m[2]);
            }
            return { ids, medible: true, avisos };
          }
        } catch {
          /* sin el comando se sigue por las filas */
        }
        const encontradas = rowIds(await listCommands(sessionId), listVerbFor(node?.name));
        return { ids: encontradas, medible: encontradas.length > 0, avisos: new Map() };
      };
      store.usarLector(leerPendientes);

      React.useEffect(() => {
        const baja = store.suscribir(setFoto);
        setFoto(store.foto());
        // Una lectura por sesion y compartida: si otra tarjeta ya leyo hace un instante, esto no ejecuta nada.
        store.leer().catch(() => {});
        return baja;
      }, [store]);

      // Las filas del menu son el respaldo cuando la foto no se pudo leer, y son gratis (no ejecutan comando).
      // El comando que origino el bloque acaba de armar sus filas, asi que se reintenta una vez.
      React.useEffect(() => {
        if (!bulk) return undefined;
        let alive = true;
        const leerFilas = () => listCommands(sessionId).then((commands) => rowIds(commands, listVerbFor(node?.name)));
        (async () => {
          try {
            let found = await leerFilas();
            if (found.length === 0) {
              await new Promise((resolve) => setTimeout(resolve, 400));
              if (!alive) return;
              found = await leerFilas();
            }
            if (alive) setFilas(found);
          } catch (error) {
            if (alive) {
              setFilas([]);
              setFalloFilas(String(error?.message ?? error));
            }
          }
        })();
        return () => { alive = false; };
      }, [bulk, sessionId, node?.name]);

      // Una propuesta suelta se ofrece solo si de verdad sigue pendiente: si la foto dice que ya se decidio, el
      // bloque queda como registro y no ofrece botones. Es el defecto que se vio en pantalla: publicar arriba y
      // seguir ofreciendo publicar abajo.
      const yaDecidida = !bulk && foto.ids !== null && foto.medible && reading !== '' && !foto.ids.includes(reading);
      const ids = bulk
        ? (foto.ids !== null && foto.medible ? foto.ids : filas)
        : (yaDecidida ? [] : (reading === '' ? [] : [reading]));
      const failure = foto.failure || falloFilas;
      const rows = ids ?? [];
      const toggle = (id) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
      // El verbo decide el comando, y solo retirar pide confirmacion explicita al host. El nombre es el del
      // idioma del bloque: el otro no esta registrado y el host lo rechazaria como comando desconocido.
      const target = comandoDe(verb, node?.name);
      const texts = VERB_TEXTS[verb] ?? VERB_TEXTS.aprobar;
      // El ámbito va **explícito**: sin `--local` el comando pregunta dónde vive la skill (que es lo correcto
      // para un humano que lo teclea), y esa pregunta no aprueba nada. Medido: once «aprobaciones» de este
      // panel se contaron como hechas y diez siguieron pendientes. Aquí el botón ya dice el ámbito.
      const linea = (id) => `${target} ${id}${verb === 'aprobar' ? ' --local' : ''}${verb === 'eliminar' ? ' --yes' : ''}`;

      /**
       * Las formas conocidas de pedirle una ejecución al host, en orden.
       *
       * El contrato de `runCommand` no está documentado y el binario está minificado: se probó con
       * `(sessionId, "skill-aprobar X")` y el host no devolvió nada — ni ejecutó—, así que la forma importa.
       * Cada forma es la MISMA orden con distinta firma; la barra delante es la del compositor, que sí
       * funciona. Se probarán en orden hasta que el EFECTO diga que una sirvió, y la que sirva se usa para
       * el resto (una sola vez por lote).
       */
      const FORMAS = [
        { nombre: 'texto con barra', args: (texto, nom, resto) => [sessionId, texto] },
        { nombre: 'nombre + args', args: (texto, nom, resto) => [sessionId, nom, resto] },
        { nombre: 'objeto {name,args}', args: (texto, nom, resto) => [sessionId, { name: nom, args: resto }] },
        { nombre: 'texto solo', args: (texto, nom, resto) => [texto] },
      ];
      const FORMA_DE = Object.fromEntries(FORMAS.map((f) => [f.nombre, f]));
      const [formaUsada, setFormaUsada] = React.useState(null);
      const [avisos, setAvisos] = React.useState(null);

      /**
       * Las pendientes **según el host**, ahora mismo, y si el host ofrece filas.
       *
       * La lectura la hace el store compartido: dentro de su ventana devuelve la foto sin ejecutar nada, y dos
       * tarjetas que pregunten a la vez comparten la misma ejecucion. `force` es para cuando el efecto de una
       * decision tiene que comprobarse de verdad.
       *
       * `medible === false` es un estado de primera clase: sin filas no hay efecto que observar, y decir
       * «sigue pendiente» cuando no se ha podido mirar es la mentira que hacía fallar aprobaciones correctas.
       */
      const pendientesAhora = (opciones = {}) => store.leer(opciones);

      /** Espera a que una condición se cumpla (el efecto tarda lo que tarde el host). */
      const esperarA = async (condicion, intentos = 6, espera = 250) => {
        for (let i = 0; i < intentos; i += 1) {
          if (await condicion()) return true;
          await new Promise((listo) => setTimeout(listo, espera));
        }
        return false;
      };

      /**
       * Ejecuta una orden y **comprueba que ocurrió**. Devuelve `{ ok, forma, motivo }`:
       *   · el resultado del host no se cree (puede ser `undefined`, o un éxito sin efecto);
       *   · si el id deja de estar pendiente, la orden ocurrió, aunque el host no devolviera nada;
       *   · si ninguna forma cambia nada, no se aprueba nada: es un fallo con motivo.
       */
      /**
       * Ejecuta UNA orden y comprueba que ocurrió, probando las formas conocidas.
       *
       * @param texto - la orden como la escribiría el humano (`/skill-approve …`).
       * @param nombre - el comando.
       * @param resto - sus argumentos.
       * @param efecto - `() => Promise<boolean>`: ¿ocurrió? Se le pregunta al almacén, no a la llamada.
       */
      const ejecutarOrden = async (texto, nombre, resto, idsPedidos, conocida, forzar = false) => {
        // `--force` no se adivina: lo pone esta función sólo cuando el humano lo ha dicho en la pantalla de
        // avisos. La orden que se ejecuta es entonces la misma que escribiría él, con su flag.
        const restoFinal = forzar ? `${resto} --force`.trim() : resto;
        const textoFinal = `/${nombre}${restoFinal ? ` ${restoFinal}` : ''}`;
        const orden = conocida === null ? FORMAS : [conocida];
        const motivos = [];
        for (const forma of orden) {
          let resultado;
          try {
            resultado = await runCommand(...forma.args(textoFinal, nombre, restoFinal));
          } catch (error) {
            motivos.push(`${forma.nombre}: ${String(error?.message ?? error)}`);
            continue;
          }
          const salida = String(resultado?.text ?? '');

          // 1) El comando contestó con veredicto por id. Es la evidencia: exactamente la frase que vería el
          //    humano al escribirlo. No hace falta preguntar por filas —y en este anfitrión, además, no hay—.
          const v = veredicto(salida, idsPedidos, resultado?.code, resultado?.params, resultado?.items);
          if (v.hechos.size > 0 || v.fallos.size > 0) {
            return {
              ok: v.fallos.size === 0 && idsPedidos.every((id) => v.hechos.has(id)),
              forma,
              motivo: [...v.fallos].map(([id, m]) => `${id}: ${m}`).join(' · '),
              hechos: v.hechos,
              fallos: v.fallos,
            };
          }

          // 2) Pidió el ámbito: la orden llegó, sólo faltaba `--local`. Otra firma no lo arregla. Manda el
          //    código del contrato; la prosa es la reserva para un anfitrión que todavía no lo manda.
          if (resultado?.code === 'scope-ask' || salida.startsWith(SCOPE_ASK)) {
            motivos.push(`${forma.nombre}: el comando preguntó el ámbito`);
            break;
          }

          // 3) Error sin veredicto: si es del comando (no de la forma de llamar), repetir con otra firma sólo
          //    produce el mismo error tres veces y ensucia el motivo.
          if (resultado?.kind === 'error') {
            motivos.push(`${forma.nombre}: ${salida.split('\n')[0]}`);
            // «tiene avisos» no es un fallo de la llamada: la puerta pide una decisión humana explícita. Se
            // devuelve el texto entero para que la tarjeta la pida, en vez de dejar al humano sin salida.
            if (/tiene avisos/i.test(salida)) {
              return { ok: false, forma, motivo: salida, avisos: salida, hechos: new Set(), fallos: new Map() };
            }
            if (!esDeTransporte(salida)) break;
            continue;
          }

          // 4) Sin veredicto ni error: se pregunta al host por sus filas **si las ofrece**. Sin filas no hay
          //    efecto observable, y decir «no ocurrió» sin haber podido mirar es lo que fallaba.
          let observado = null;
          try {
            observado = await esperarA(async () => {
              const ahora = await pendientesAhora({ force: true });
              return ahora.medible && idsPedidos.every((id) => !ahora.ids.includes(id));
            });
          } catch {
            observado = false;
          }
          if (observado === true) {
            return { ok: true, forma, motivo: '', hechos: new Set(idsPedidos), fallos: new Map() };
          }
          motivos.push(`${forma.nombre}: ${NO_RESULT}`);
        }
        return { ok: false, forma: null, motivo: motivos.join(' · '), hechos: new Set(), fallos: new Map() };
      };

      const ejecutar = (id, conocida, forzar = false) => ejecutarOrden(
        `/${linea(id)}`, target, linea(id).slice(target.length).trim(), [id], conocida, forzar,
      );

      /** La orden del LOTE: un comando, N ids. Es la forma plural que el servidor entiende. */
      const ejecutarLote = (ids, conocida, forzar = false) => {
        const comando = verb === 'globalizar' ? comandoDe('aprobar', node?.name) : target;
        const ambito = verb === 'aprobar' ? ' --local' : verb === 'globalizar' ? ' --global' : '';
        const argumentos = `${ids.join(',')}${ambito}`;
        return ejecutarOrden(`/${comando} ${argumentos}`, comando, argumentos, ids, conocida, forzar);
      };

      const run = async ({ forzar = false } = {}) => {
        setBusy(true);
        setStage('running');
        setAvisos(null);
        const done = [];
        const failed = [];
        // La forma que funcione se descubre con la primera orden y se reutiliza: una vez por lote.
        let forma = null;
        // UNA lectura antes de decidir, y sirve para las dos cosas: los avisos que el humano tiene que leer y si
        // el id sigue pendiente. Antes eran dos preguntas seguidas al host -dos ejecuciones, dos notificaciones-
        // para el mismo dato, y el panel contaba como "fallo" lo que ya se habia decidido en otra tarjeta.
        let antes = null;
        try { antes = await pendientesAhora(); } catch { antes = null; }
        if (!forzar && antes !== null) {
          const conAvisos = [...picked].filter((id) => (antes.avisos?.get(id)?.length ?? 0) > 0);
          if (conAvisos.length > 0) {
            const texto = conAvisos
              .map((id) => [`${id}:`, ...antes.avisos.get(id).map((a) => `  aviso  ${a}`)].join('\n'))
              .join('\n\n');
            setAvisos({ texto, ids: conAvisos });
            setBusy(false);
            setStage('avisos');
            return;
          }
        }
        let pendientes = [...picked];
        // Lo que la tarjeta muestra puede ser viejo (otra sesion, otra decision). Lo que ya no esta pendiente se
        // dice como tal -no como un fallo del comando, que era un callejon sin salida-.
        if (antes !== null) {
          const vivos = pendientes.filter((id) => antes.ids.includes(id));
          for (const id of pendientes) {
            if (!vivos.includes(id)) failed.push({ id, reason: 'ya no está pendiente en el almacén: la tarjeta estaba desactualizada' });
          }
          pendientes = vivos;
          if (pendientes.length === 0) {
            setReport({ done, failed, restantes: antes.ids, lineas: [], forma: null });
            setPicked([]);
            setBusy(false);
            setStage('done');
            return;
          }
        }
        // 1) El LOTE como UNA orden: una llamada al host, N aprobaciones dentro, un solo efecto que medir.
        if ((verb === 'aprobar' || verb === 'globalizar') && picked.length > 1) {
          const salida = await ejecutarLote(picked, forma, forzar);
          if (salida.avisos) { setAvisos({ texto: salida.avisos, ids: [...picked] }); setBusy(false); setStage('avisos'); return; }
          if (salida.ok) {
            pendientes = [];
            done.push(...picked);
            forma = salida.forma;
            setFormaUsada(salida.forma?.nombre ?? null);
          } else {
            // El lote contestó por id: se cuenta lo que dijo y sólo se reintenta lo que quedó sin veredicto.
            // Antes, un `FALLO` en uno tiraba el resultado de todos y se volvía a intentar lo ya hecho.
            pendientes = [];
            for (const id of picked) {
              if (salida.hechos.has(id)) done.push(id);
              else if (salida.fallos.has(id)) failed.push({ id, reason: salida.fallos.get(id) });
              else pendientes.push(id);
            }
            if (salida.forma) { forma = salida.forma; setFormaUsada(salida.forma.nombre); }
          }
        }
        // 2) Lo que quede, id a id (y también todo si el verbo no admite lote: apartar, retirar, encender).
        for (const id of pendientes) {
          const salida = await ejecutar(id, forma, forzar);
          if (salida.avisos) { setAvisos({ texto: salida.avisos, ids: [id] }); setBusy(false); setStage('avisos'); return; }
          if (salida.ok || salida.hechos.has(id)) {
            done.push(id);
            if (forma === null && salida.forma) { forma = salida.forma; setFormaUsada(salida.forma.nombre); }
          } else failed.push({ id, reason: salida.fallos.get(id) ?? salida.motivo });
        }
        // El informe se comprueba contra el EFECTO: se vuelve a leer la lista del host, forzando la lectura
        // (la foto de hace un instante es de ANTES de decidir). Si dice que se aprobaron diez y el host sigue
        // devolviendo diez, lo que se pinta es lo que el host dice.
        store.invalidar();
        let restantes = null;
        try {
          const despues = await pendientesAhora({ force: true });
          // Sólo se afirma una cifra si el host ofreció filas que mirar. Si no, se declara que no se pudo:
          // pintar el número de la tarjeta como si fuera el del almacén es exactamente la mentira anterior.
          restantes = despues.medible ? despues.ids.filter((id) => !done.includes(id)) : null;
        } catch { restantes = null; }
        setReport({ done, failed, restantes, lineas: picked.map((id) => `/${linea(id)}`), forma: forma?.nombre ?? null });
        // La foto nueva la ven TODAS las tarjetas de la sesion: es lo que apaga el "sigue disponible para
        // aprobar" de la tarjeta que leyo antes de decidir.
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
        addButton('yes', say(texts.confirm), () => run());
        addButton('no', say('bulk_cancel'), () => setStage('pick'), { quiet: true });
      } else if (stage === 'avisos' && avisos !== null) {
        // El humano acepta **habiendo leído** los avisos: eso es exactamente lo que significa `--force`.
        addButton('force', say('bulk_warnings_accept'), () => run({ forzar: true }));
        addButton('no', say('bulk_cancel'), () => { setAvisos(null); setStage('pick'); }, { quiet: true });
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
        // «Nada pendiente» y «no hay filas» son cosas distintas y se decían igual. Si la lectura salió bien y
        // la lista vino vacía, lo que hay que decir es que no hay nada que decidir —no mandar a buscar filas
        // que no existen—. «No hay filas» se reserva para el caso de verdad: había pendientes y el catálogo de
        // la sesión no las anunció (ahí sí: el comando con el id funciona igual).
        // Una propuesta suelta que ya se decidio no se ofrece otra vez: el bloque queda como registro, y el
        // aviso dice por que no hay botones. (Es el defecto que se vio en pantalla: publicada arriba y ofrecida
        // abajo.)
        yaDecidida && report === null
          ? h('div', { className: 'skc-bulk-note', 'data-tone': 'ok' }, say('bulk_decided'))
          : null,
        ids !== null && failure === '' && ids.length === 0 && report === null && !yaDecidida
          ? h('div', { className: 'skc-bulk-note', 'data-tone': 'ok' }, say('bulk_nothing'))
          : null,
        ids !== null && failure === '' && ids.length > 0 && rows.length === 0 && report === null
          ? h('div', { className: 'skc-bulk-note', 'data-tone': 'warn' },
            `${say('bulk_no_rows')} ${say('bulk_ids_hint')}`)
          : null,
        rows.length === 0
          ? null
          : h('ul', { className: 'skc-bulk-list' },
            rows.map((id) => {
              const state = report === null ? '' : (report.done.includes(id) ? say('card_done') : (report.failed.some((entry) => entry.id === id) ? say('card_error') : ''));
              const hecha = report !== null && report.done.includes(id);
              const fallada = report !== null && report.failed.some((entry) => entry.id === id);
              return h('li', {
                key: id,
                className: 'skc-bulk-row',
                ...(hecha ? { 'data-hecha': 'si' } : {}),
              },
                h('input', {
                  id: `skc-pick-${id}`,
                  type: 'checkbox',
                  checked: picked.includes(id),
                  disabled: stage === 'running' || stage === 'confirm',
                  'aria-label': `${say(bulk ? 'bulk_title' : 'bulk_single')}: ${id}`,
                  onChange: () => toggle(id),
                }),
                h('label', { htmlFor: `skc-pick-${id}`, title: id }, id),
                state === '' ? null : h('span', {
                  className: 'skc-bulk-done',
                  ...(hecha ? { 'data-tone': 'ok' } : {}),
                  ...(fallada ? { 'data-tone': 'error' } : {}),
                }, state));
            })),
        stage === 'confirm'
          ? h('div', null,
            h('div', { className: 'skc-bulk-note' }, `${say(texts.ask)} ${picked.length}: ${picked.join(', ')}`),
            h('div', { className: 'skc-bulk-note' }, say('bulk_ask_footer')),
            // El alcance se dice **en la confirmación** de las que lo tienen: es la última pantalla antes de
            // publicar, y «para todos» no es lo mismo que «en este proyecto».
            texts.note ? h('div', { className: 'skc-bulk-note' }, say(texts.note)) : null)
          : null,
        stage === 'avisos' && avisos !== null
          ? h('div', null,
            h('div', { className: 'skc-bulk-note', 'data-tone': 'warn' }, say('bulk_warnings_title')),
            h('pre', { className: 'skc-bulk-body' }, avisos.texto))
          : null,
        stage === 'running' ? h('div', { className: 'skc-bulk-note' }, say('bulk_running')) : null,
        stage === 'done' && report !== null
          ? h('div', null,
            h('div', {
              className: 'skc-bulk-note',
              'data-tone': report.failed.length === 0 ? 'ok' : (report.done.length === 0 ? 'error' : 'warn'),
            }, `${report.done.length} ${say(texts.ok)} · ${report.failed.length} ${say('bulk_failed')}`),
            h('div', { className: 'skc-bulk-note', 'data-tone': 'muted' },
              report.restantes === null
                ? `${say('bulk_remaining')}: ${say('bulk_remaining_unknown')}`
                : `${say('bulk_remaining')}: ${report.restantes.length}`),
            // Si no se ejecutó nada, el panel da la salida: las líneas exactas que el humano puede pegar.
            report.done.length > 0 && report.forma
              ? h('div', { className: 'skc-bulk-note', 'data-tone': 'ok' }, `${say('bulk_host_form')}: ${report.forma}`)
              : null,
            report.done.length === 0 && report.failed.length > 0
              ? h('div', { className: 'skc-bulk-note', 'data-tone': 'error' }, diagnóstico)
              : null,
            // Si ninguna forma sirvió, las firmas reales de las funciones: con eso la corrección es medida.
            report.done.length === 0 && report.failed.length > 0
              ? h('pre', { className: 'skc-bulk-body' }, `runCommand: ${String(runCommand).slice(0, 240)}\nlistCommands: ${String(listCommands).slice(0, 240)}`)
              : null,
            report.done.length === 0 && report.failed.length > 0 && Array.isArray(report.lineas) && report.lineas.length > 0
              ? h('div', null,
                h('div', { className: 'skc-bulk-note', 'data-tone': 'warn' }, say('bulk_nothing_ran')),
                h('pre', { className: 'skc-bulk-body' }, report.lineas.join('\n')))
              : null,
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

    // Cuánto permanece un aviso en pantalla. Los dos números salen de una medida, no del gusto: la frase
    // más larga que la píldora puede pintar son 73 caracteres, que a 200 palabras por minuto se leen en
    // 3,9 s, así que el informativo se queda el doble de eso: tiempo de verlo, mirarlo y leerlo.
    // El que **pide atención** (un rechazo, un origen bloqueado) puede exigir una decisión y se queda más.
    // Y ninguno es indefinido: el registro vive en el flujo del chat, así que retirarse no borra nada.
    const MS_INFORMATIVO = 8000;
    const MS_ATENCION = 30000;

    /**
     * La píldora, con su temporizador. Va en su propio componente porque los hooks no pueden vivir detrás
     * de los returns tempranos del componente de fuera (sin proyección, sin vista o sin nada que decir).
     *
     * No se retira mientras el foco o el puntero están encima: un aviso no puede desaparecer bajo los dedos
     * de quien lo está leyendo (WCAG 2.2.1, pausar/detener/ocultar).
     */
    function Pildora({ say, view, sentence, accent, Icon, analyzing, partes, ids, id, repetido, total }) {
      const [enPausa, setEnPausa] = React.useState(false);
      const [retirado, setRetirado] = React.useState(false);
      // La clave identifica el resultado: cuando cambia, el aviso anterior deja de estar vigente y el
      // temporizador vuelve a empezar. Sin esto, un aviso retirado no volvería a aparecer nunca.
      const clave = [view.seq, view.outcome, view.ids, view.created, view.updated, view.rejected, view.blocked].join('|');
      React.useEffect(() => { setRetirado(false); setEnPausa(false); }, [clave]);
      const pideAtencion = (Number(view.rejected) || 0) > 0 || (Number(view.blocked) || 0) > 0;
      React.useEffect(() => {
        // Mientras analiza no se retira (todavía no hay nada que contar) ni cuando el humano lo tiene delante.
        if (analyzing || retirado || enPausa) return undefined;
        const temporizador = setTimeout(() => setRetirado(true), pideAtencion ? MS_ATENCION : MS_INFORMATIVO);
        return () => clearTimeout(temporizador);
      }, [clave, analyzing, retirado, enPausa, pideAtencion]);
      if (retirado) return null;

      // La frase simple (con el id) sólo vale cuando el turno hizo UNA cosa con UNA skill: con tres
      // creaciones, partes es una sola cuenta («3 nuevas») y la frase simple perdería el 3.
      const simple = partes.length === 1 && total === 1;
      return h('span', {
        className: `skc-pill${analyzing ? '' : ' skc-enter'}`,
        // Un único estado vivo, atómico, con la frase entera. Nada de números sueltos.
        role: 'status',
        'aria-atomic': 'true',
        'aria-live': 'polite',
        // El valor completo, disponible por foco y por puntero: el recorte visual no esconde el dato, y
        // sigue disponible cuando el aviso se retire.
        title: sentence,
        tabIndex: 0,
        style: { '--skc-accent': accent },
        // Con el foco o el puntero encima, el aviso se queda: leerlo es lo que se estaba haciendo.
        onFocus: () => setEnPausa(true),
        onBlur: () => setEnPausa(false),
        onPointerEnter: () => setEnPausa(true),
        onPointerLeave: () => setEnPausa(false),
      },
        h('span', { className: 'skc-mark' }, analyzing ? h(Gear) : h(Icon)),
        // Con varias cosas en el turno, la etiqueta son las cuentas («1 nueva · 1 actualizada») y los ids
        // completos van al `title`: un id suelto entre dos cuentas diría que todo pasó con esa skill.
        h('span', { className: 'skc-label' }, analyzing ? say('analyzing') : simple ? say(shown) : partes.join(' · ')),
        !analyzing && simple && id ? h('span', { className: 'skc-id' }, id) : null,
        // Y el acumulado de la misma skill, que sí es una repetición de verdad.
        !analyzing && simple && repetido
          ? h('span', { className: 'skc-count', title: `${say('total')}: ${total}` }, `×${total}`)
          : null,
      );
    }

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
      // Las skills que este turno tocó, sin repetir. La cuenta se hace sobre `ids` y no sobre los
      // contadores: `created: 3` con tres skills DISTINTAS + el id de la última es lo que pintaba
      // «Skill actualizada: la-última ×3» — una sola skill que parecía tocada tres veces. Con un solo id,
      // `×N` dice la verdad y se enseña; con varios, se enseña cuántas son y la lista entera va en el
      // `title`. La regla está probada en `lib/presentation.mjs` (`resumenDeActividad`).
      const ids = typeof view.ids === 'string' ? view.ids.split(',').map((x) => x.trim()).filter((x) => x !== '') : [];
      const total = (Number(view.created) || 0) + (Number(view.updated) || 0);
      const id = typeof view.id === 'string' ? view.id : '';
      const repetido = ids.length <= 1 && total > 1;
      // Lo que pasó en el turno, por tipo: la misma regla que `partesDeActividad` en `lib/presentation.mjs`
      // (el cliente es un artefacto de navegador sin imports, así que la repite; una prueba de coherencia
      // vigila que las dos digan lo mismo). Antes había UN outcome: el último resultado pisaba al anterior,
      // y un turno que creaba una skill y rechazaba otra decía «no se creó ninguna».
      const tipos = [['created', Number(view.created) || 0, 'part_created_s', 'part_created_p'],
        ['updated', Number(view.updated) || 0, 'part_updated_s', 'part_updated_p'],
        ['rejected', Number(view.rejected) || 0, 'part_rejected_s', 'part_rejected_p'],
        ['blocked', Number(view.blocked) || 0, 'part_blocked_s', 'part_blocked_p']];
      const partes = tipos.filter(([, cuantas]) => cuantas > 0)
        .map(([, cuantas, singular, plural]) => `${cuantas} ${say(cuantas === 1 ? singular : plural)}`);

      // Una sola frase con contexto: es lo que se anuncia, y es lo que se ve.
      const sentence = analyzing
        ? say('analyzing')
        : partes.length === 1 && total === 1
          ? `${say(`${shown}_full`)}${id ? `: ${id}` : ''}`
          : `${partes.join(' · ')}${ids.length > 0 ? ` — ${ids.join(', ')}` : ''}`;

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
        h(Pildora, { say, view, sentence, accent, Icon, analyzing, partes, ids, id, repetido, total, shown }),
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
