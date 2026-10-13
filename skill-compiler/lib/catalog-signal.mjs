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
 * ── Dos disparadores, porque hay dos formas de que el catálogo cambie ────────────────────────────
 *
 *   1. **Invalidación explícita**: lo que muta *este* proceso (aprobar o rechazar por comando).
 *   2. **Observación del almacén**: lo que muta *fuera* (la CLI en otra terminal, la página de
 *      revisión servida aparte, una edición a mano). El contrato del seam pide literalmente que el
 *      provider lo haga «from its own observation mechanism»; sin esto, «no hace falta reiniciar»
 *      sería cierto sólo para la vía que casualmente ejecutemos nosotros.
 *
 * Lo que **no** hace: nada de esto fuerza el catálogo del cliente (el menú del compositor), que el
 * harness cachea por sesión por su cuenta y no expone ninguna forma de invalidarlo desde un plugin.
 * Ese límite está medido y documentado, no disimulado.
 */
import { watch as fsWatch } from 'node:fs';
import { mkdirSync } from 'node:fs';

/** Un lote de eventos del sistema de ficheros se convierte en un solo aviso. */
const DEFAULT_DEBOUNCE_MS = 60;

/**
 * Crea la señal.
 *
 * @param root - raíz del almacén (`$DSH_HOME/skill-compiler`), el árbol que se vigila.
 * @param watch - `false` para no vigilar (pruebas, plataformas sin vigilancia recursiva).
 * @param debounceMs - ventana de agrupación de eventos.
 * @param watchImpl - inyectable para las pruebas; por defecto `node:fs.watch`.
 * @returns una señal con `bind`, `notify`, `start` y `stop`.
 */
export function createCatalogSignal({
  root,
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
  let watcher = null;
  let timer = null;
  let stopped = false;

  const warn = () => notifications;

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
     * Empieza a vigilar el almacén. Idempotente y tolerante: si el sistema de ficheros no soporta la
     * vigilancia recursiva, la señal sigue funcionando con la invalidación explícita y lo deja dicho.
     */
    start() {
      if (!watch || watcher !== null || stopped) return false;
      try {
        // El directorio del almacén es nuestro; si aún no existe, se crea para poder vigilarlo. Sin
        // esto, la primera aprobación por CLI crearía el árbol y nadie se enteraría del cambio.
        mkdirSync(root, { recursive: true });
        watcher = watchImpl(root, { recursive: true }, () => notifySoon());
        if (typeof watcher.on === 'function') watcher.on('error', () => { /* la vigilancia nunca tumba nada */ });
        if (typeof watcher.unref === 'function') watcher.unref();
        return true;
      } catch {
        watcher = null;
        return false;
      }
    },

    /** Para la vigilancia y los avisos pendientes. Se llama al descargar el plugin. */
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (watcher !== null) {
        try {
          watcher.close();
        } catch {
          /* ya cerrado o nunca abierto */
        }
        watcher = null;
      }
    },
  };
}
