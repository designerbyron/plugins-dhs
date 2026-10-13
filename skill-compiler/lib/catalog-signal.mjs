/**
 * catalog-signal.mjs — avisa de que el catálogo de skills del proyecto cambió.
 *
 * ── Por qué existe este módulo ───────────────────────────────────────────────────────────────────
 *
 * El registro de skills del harness (`ctx.skills`) **cachea** los catálogos completos por
 * `(cwd, ámbito, revisión)` y **no tiene TTL**. Su contrato lo dice sin rodeos: sólo se limpia cuando
 * *un provider llama a la invalidación que el propio registro le entregó al registrarse*. Es decir: la
 * frescura del catálogo es responsabilidad del provider, y no del registro.
 *
 * El plugin no lo hacía. Consecuencia medida: una skill recién aprobada no llegaba al agente hasta
 * reiniciar el harness, porque el catálogo cacheado seguía siendo el de antes. Aprobar no servía de
 * nada hasta el siguiente arranque — exactamente el último paso del flujo, roto.
 *
 * ── Tres disparadores, porque el catálogo cambia en tres sitios ─────────────────────────────────
 *
 *   1. **Invalidación explícita**: lo que muta *este* proceso (aprobar o rechazar por comando).
 *   2. **Observación del almacén propio**: lo que muta *fuera* del proceso (la CLI en otra terminal,
 *      la página de revisión servida aparte, una edición a mano sobre `approved/`). El contrato del
 *      seam pide literalmente que el provider lo haga «from its own observation mechanism»; sin esto,
 *      «no hace falta reiniciar» sería cierto sólo para la vía que casualmente ejecutemos nosotros.
 *   3. **Observación de la biblioteca curada** (`also`): el catálogo que ve el agente lo compone el
 *      *mismo* registro, y además de lo que sirve este provider incluye las raíces globales de skills
 *      del harness. Si el humano mueve, edita o retira algo de ahí, sin esta observación la sesión
 *      abierta seguiría viendo el catálogo anterior: la misma clase de defecto que en (2), en la otra
 *      capa. Un aviso al registro fuerza el re-snapshot completo del catálogo del modelo, así que
 *      observar la capa curada es lo que cierra la clase entera.
 *
 * **Distinción que importa**: el almacén propio es nuestro y se crea si falta; las raíces `also` son
 * **ajenas** y sólo se observan *si ya existen*. Crear un directorio del harness por el hecho de
 * vigilarlo sería ensuciar lo que no nos pertenece.
 *
 * Lo que **no** hace: nada de esto fuerza el catálogo del cliente (el menú del compositor), que el
 * harness cachea por sesión por su cuenta y no expone ninguna forma de invalidarlo desde un plugin.
 * Ese límite está medido y documentado, no disimulado.
 */
import { existsSync, mkdirSync, watch as fsWatch } from 'node:fs';

/** Un lote de eventos del sistema de ficheros se convierte en un solo aviso. */
const DEFAULT_DEBOUNCE_MS = 60;

/**
 * Crea la señal.
 *
 * @param root - raíz del almacén propio (`$DSH_HOME/skill-compiler`). Se crea si falta, para poder vigilarla.
 * @param also - raíces **ajenas** que también componen el catálogo (p. ej. la biblioteca curada). Sólo se
 *               vigilan si ya existen: vigilar no puede crear un directorio que no es nuestro.
 * @param watch - `false` para no vigilar (pruebas, plataformas sin vigilancia recursiva).
 * @param debounceMs - ventana de agrupación de eventos.
 * @param watchImpl - inyectable para las pruebas; por defecto `node:fs.watch`.
 * @returns una señal con `bind`, `notify`, `start`, `stop`, `count`, `onChange` y `roots`.
 */
export function createCatalogSignal({
  root,
  also = [],
  watch = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  watchImpl = fsWatch,
} = {}) {
  /** La invalidación que entrega el registro; hasta que exista, avisar no hace nada. */
  let invalidate = null;
  /** Cuántos avisos llegaron a la invalidación. Lo usa la puerta de frescura para medir, no para decidir. */
  let notifications = 0;
  /** Suscriptores del mismo aviso: hay cosas del plugin (las filas del menú) que dependen del almacén y
   *  no de la invalidación del catálogo, así que el aviso tiene que llegarles aunque no haya invalidación. */
  const listeners = new Set();
  const watchers = [];
  let timer = null;
  let stopped = false;

  const warn = () => notifications;

  /** Las raíces que de verdad se están observando (diagnóstico y pruebas). */
  const roots = () => watchers.map((entry) => entry.root);

  /** Agrupa una ráfaga de eventos en un único aviso: aprobar toca varios ficheros a la vez. */
  const notifySoon = () => {
    if (stopped) return;
    if (debounceMs <= 0) return notifyNow();
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      notifyNow();
    }, debounceMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const notifyNow = () => {
    if (stopped) return;
    if (invalidate !== null) {
      notifications += 1;
      invalidate();
    }
    for (const listener of listeners) {
      // Un suscriptor que falle no puede llevarse el aviso por delante: el catálogo ya se invalidó.
      try {
        listener();
      } catch { /* el siguiente suscriptor sigue teniendo su aviso */ }
    }
  };

  /**
   * Abre la vigilancia de una raíz. `crear` sólo es cierto para la nuestra: la raíz del almacén se crea
   * si falta (sin ella, la primera aprobación por CLI crearía el árbol y nadie se enteraría del cambio);
   * una raíz ajena que no existe **no se crea**: se declara no vigilada y se sigue con las demás.
   */
  const observe = (raiz, { crear }) => {
    if (!crear && !existsSync(raiz)) return false;
    try {
      if (crear) mkdirSync(raiz, { recursive: true });
      const watcher = watchImpl(raiz, { recursive: true }, () => notifySoon());
      if (typeof watcher.on === 'function') watcher.on('error', () => { /* la vigilancia nunca tumba nada */ });
      if (typeof watcher.unref === 'function') watcher.unref();
      watchers.push({ root: raiz, watcher });
      return true;
    } catch {
      return false; // una raíz que no se puede vigilar no impide vigilar las demás
    }
  };

  return {
    /**
     * Ata la señal a la invalidación del registro. La llama el plugin al registrar su provider: el
     * registro le entrega esa capacidad a la fábrica, y quien registra tiene que conservarla.
     */
    bind(capability) {
      if (typeof capability !== 'function') return false;
      invalidate = capability;
      return true;
    },

    /** Avisa de que el catálogo cambió (mutación propia: aprobar, rechazar, vendorizar). */
    notify: notifyNow,

    /** Cuántos avisos se entregaron de verdad (diagnóstico y pruebas). */
    count: warn,

    /** Las raíces observadas (diagnóstico y pruebas). */
    roots,

    /**
     * Suscribe una reacción al mismo aviso. Devuelve la baja.
     *
     * @param listener - se llama en cada aviso, haya o no invalidación del registro.
     */
    onChange(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Empieza a vigilar. Idempotente y tolerante: si una raíz no se puede vigilar (o no existe, siendo
     * ajena), la señal sigue funcionando con las demás y con la invalidación explícita.
     *
     * @returns `true` si abrió al menos una vigilancia en esta llamada.
     */
    start() {
      if (!watch || watchers.length > 0 || stopped) return false;
      observe(root, { crear: true });
      for (const raiz of also) if (raiz !== root) observe(raiz, { crear: false });
      return watchers.length > 0;
    },

    /** Para la vigilancia y los avisos pendientes. Se llama al descargar el plugin. */
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      for (const { watcher } of watchers.splice(0)) {
        try {
          watcher.close();
        } catch {
          /* ya cerrado o nunca abierto */
        }
      }
    },
  };
}
