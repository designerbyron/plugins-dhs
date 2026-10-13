/**
 * skill-compiler — adaptador Cordis del compilador de conocimiento.
 *
 * Este fichero es deliberadamente **fino**, porque es el único que no se puede probar antes de
 * instalar (importa `@deepseek-ai/dsh-tools`, que solo existe dentro del harness). Todo lo que decide
 * algo vive en `lib/`, donde sí hay pruebas. Aquí solo se elige el punto de extensión y se registra.
 *
 * Los cuatro puntos de extensión, y por qué cada uno:
 *   1. `ctx.systemPrompt.section(...)` — el protocolo, ESTÁTICO y ordenado. No se usa
 *      `system-prompt/assemble`: la guía de DSH lo prohíbe expresamente para añadir texto, y una
 *      sección estática es además lo que protege el prompt caching.
 *   2. `ctx.tools.register(...)` — la herramienta con la que el modelo **propone**, y otra de solo
 *      lectura para revisar. Aprobar NO es una herramienta: si lo fuera, el modelo podría
 *      auto-aprobarse y la revisión humana sería decorativa. Aprobar vive en `bin/`.
 *   3. `ctx.skills.registerProvider(...)` — sirve **solo** las skills aprobadas del proyecto actual.
 *   4. `ctx.sessionProjections.register(...)` — el estado que alimenta el feedback visual, plegado de
 *      eventos que YA existen y definido en `lib/projection.mjs`. Es **opcional y a prueba de fallos**:
 *      si el registro de proyecciones o la biblioteca de esquemas no están en este perfil, el plugin
 *      pierde el adorno y conserva el trabajo.
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import { createCatalogSignal } from './lib/catalog-signal.mjs';
import { skillCommands, targetCommands } from './lib/commands.mjs';
import { curatedLibraryRoot, defaultRoot } from './lib/compiler.mjs';
import { pendingRowsForAll } from './lib/pending-rows.mjs';
import { PROTOCOL, skillPropose, skillProvider, skillReview, skillUpstreamCheck, skillVendor } from './lib/definitions.mjs';

/** Identidad del Loader. */
export const name = 'skill-compiler';

/** Servicios necesarios; sin ellos el plugin queda inactivo en lugar de lanzar. */
export const inject = ['tools', 'skills', 'systemPrompt'];

/** Orden de la sección estática: después de la guía del harness y antes del sufijo de personalidad. */
const SECTION_ORDER = 9000;

/** La clave de la proyección vive con la unidad, donde está probada; se re-exporta aquí porque es parte
 *  de la identidad pública del plugin (el cliente la pide con `useProjection('skillCompiler')`). */
export { LEARNING_KEY } from './lib/projection.mjs';

/**
 * La unidad de proyección se carga de forma **tolerante**: si este perfil no resolviera `zod` —la
 * biblioteca de esquemas que exige el contrato del registro—, el plugin pierde el feedback visual y
 * conserva las herramientas.
 *
 * Lo que NO se hace, y es la lección de un incidente real, es registrar una unidad sin comprobar antes
 * que cumple el contrato. El registro de proyecciones **no** valida los esquemas que recibe: acepta
 * cualquier cosa con la forma esperada y la llama `parse` más tarde, al leer sesiones. Una unidad con un
 * esquema que no valida no estropea un adorno: deja el historial de sesiones sin cargar. Por eso aquí
 * hay dos guardas —la carga tolerante y la comprobación del contrato— y no una.
 */
let projection = null;
try {
  projection = await import('./lib/projection.mjs');
} catch {
  projection = null;
}

export function apply(ctx, config = {}) {
  const root = config.root ?? defaultRoot();
  // La señal de catálogo se crea aquí y la comparten las piezas que mutan el almacén (herramientas y
  // comandos) y la que conserva la invalidación del registro. `config.catalog` existe para que las
  // pruebas puedan observar ese contrato sin montar el harness entero.
  // La señal observa las DOS capas que componen el catálogo del agente: nuestro almacén (que se crea si
  // falta) y la biblioteca curada ajena (que sólo se observa si ya existe). Sin la segunda, mover o
  // editar algo en la capa global dejaría a las sesiones abiertas con el catálogo anterior: la misma
  // clase de defecto que ya se cerró para el almacén propio.
  const catalog = config.catalog ?? createCatalogSignal({ root, also: [curatedLibraryRoot()] });

  // ── Las filas de pendientes: la superficie de selección, no una nota de sintaxis ────────────────
  //
  // El humano vio la lista de pendientes y no encontró cómo elegir una: el compositor no ofrece una
  // lista pulsable para los argumentos de un comando. La superficie de selección del harness es el menú
  // `/`, y desde un plugin se usa así: **una entrada por pendiente, sin argumentos**, porque un comando
  // del host sin argumentos se ejecuta en el acto al elegirlo. Esto vive aquí, fuera de los bloques de
  // inyección, porque lo alimentan dos sitios: el provider (que recibe el `cwd` de la sesión) y la
  // propia señal de catálogo (cualquier mutación cambia qué hay pendiente).
  const knownCwds = new Set();
  /** Lo sustituye el bloque de comandos: sin servicio de comandos no hay filas, y no pasa nada. */
  let refreshPendingRows = () => false;

  const noteScope = (cwd) => {
    if (typeof cwd !== 'string' || cwd.trim() === '' || knownCwds.has(cwd)) return;
    knownCwds.add(cwd);
    refreshPendingRows();
  };

  ctx.systemPrompt.section({
    name: 'skill-compiler:protocol',
    order: SECTION_ORDER,
    interpolate: false,
    text: PROTOCOL,
  });

  ctx.tools.register(defineTool(skillPropose({ root, catalog })));
  ctx.tools.register(defineTool(skillVendor({ root, catalog })));
  ctx.tools.register(defineTool(skillReview({ root })));
  ctx.tools.register(defineTool(skillUpstreamCheck({ root })));

  // ── El catálogo: servir, y saber cuándo cambió ─────────────────────────────────────────────────
  //
  // El registro de skills CACHEA los catálogos y no tiene TTL: sólo se limpia cuando un provider llama
  // a la invalidación que el propio registro le entrega al registrarse. El plugin no la retenía, así que
  // una skill recién aprobada no llegaba al agente hasta reiniciar el harness — el último paso del flujo,
  // roto. Aquí se conserva esa capacidad (vía la señal) y se avisa desde los dos sitios donde el catálogo
  // puede cambiar: lo que muta este proceso (los comandos) y lo que muta fuera (CLI, página, edición a
  // mano), que la señal vigila. La promesa —«usable sin reiniciar»— depende de esto y sólo de esto.
  ctx.skills.registerProvider((control) => {
    catalog.bind(control?.invalidate);
    return skillProvider({ root, observe: noteScope });
  });
  ctx.effect(() => {
    catalog.start();
    // Cualquier cambio del almacén —incluido el que provoca aprobar desde aquí— recompone las filas:
    // una pendiente aprobada no puede seguir ofreciéndose en el menú.
    const off = catalog.onChange(() => refreshPendingRows());
    return () => {
      off?.();
      catalog.stop();
    };
  });

  // ── La superficie humana: aprobar y rechazar sin salir del harness ──────────────────────────────
  //
  // Opcional a propósito: en un perfil sin comandos (headless, sdk) el servicio no está y el plugin no
  // puede caerse por una superficie. Y el registro se retira con el efecto, para que recargar el plugin
  // no choque con «ese comando ya existe».
  ctx.inject(['commands'], (scoped) => {
    const registry = scoped?.commands ?? ctx.commands;
    if (registry === undefined || typeof registry.register !== 'function') return;
    ctx.effect(() => {
      const base = [];
      const rows = [];
      let currentRows = '';

      /** Recompone las filas de pendientes. Si el conjunto no cambió, no toca el registro: re-registrar
       *  lo mismo emitiría `commands/change` en vano y haría parpadear el menú. */
      const registerRows = () => {
        let definitions;
        try {
          definitions = targetCommands({ root, catalog, rows: pendingRowsForAll({ root, cwds: [...knownCwds] }) });
        } catch {
          return false; // el almacén ilegible no puede tumbar los comandos que ya están
        }
        const signature = definitions.map((definition) => definition.name).join('\n');
        if (signature === currentRows) return false;
        for (const dispose of rows.splice(0)) {
          try {
            dispose();
          } catch {
            /* ya retirada */
          }
        }
        for (const definition of definitions) {
          try {
            rows.push(registry.register(definition));
          } catch {
            /* una fila que no se puede registrar no se lleva las demás */
          }
        }
        currentRows = signature;
        return true;
      };

      refreshPendingRows = registerRows;
      try {
        for (const command of skillCommands({ root, catalog, onListed: registerRows })) base.push(registry.register(command));
      } catch {
        // Sin comandos no hay atajo humano, pero las herramientas y los skills siguen intactos.
      }
      registerRows();

      return () => {
        refreshPendingRows = () => false;
        for (const dispose of [...base, ...rows]) {
          try {
            if (typeof dispose === 'function') dispose();
          } catch {
            /* ya retirado */
          }
        }
      };
    });
  });

  // Inyección opcional: el callback recibe un contexto hijo con el servicio disponible (firma
  // verificada en el código que se envía); el respaldo por cierre cubre la otra firma posible.
  //
  // Las guardas que siguen no son ceremonia: sin ellas, un perfil donde el servicio no esté disponible
  // —o donde la unidad no cumpla el contrato— llevaba el fallo al camino de LECTURA de sesiones, no
  // solo al arranque. El adorno visual nunca puede costar el trabajo.
  if (projection !== null) {
    ctx.inject(['sessionProjections'], (scoped) => {
      const registry = scoped?.sessionProjections ?? ctx.sessionProjections;
      if (registry === undefined || typeof registry.register !== 'function') return;
      const definition = projection.learningProjection();
      // Si la unidad no cumple el contrato del registro, no se registra: sin adorno, con el historial
      // intacto. Es la comprobación que faltaba cuando se registró una unidad con esquemas que no
      // validaban, y el coste de no tenerla no fue un adorno ausente: fueron sesiones que no abrían.
      if (projection.projectionContractProblems(definition).length > 0) return;
      try {
        registry.register(definition);
      } catch {
        // El registro no aceptó la unidad (versión incompatible, clave ocupada): el feedback visual no
        // estará, las herramientas sí.
      }
    });
  }
}
