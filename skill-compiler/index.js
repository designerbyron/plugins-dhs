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
import { pendingRowsFor } from './lib/pending-rows.mjs';
import { PROTOCOL, scopeOf, skillPropose, skillProvider, skillReview, skillUpstreamCheck, skillVendor } from './lib/definitions.mjs';

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

  // ── Las filas de pendientes: una oferta que corresponde a UNA sesión ────────────────────────────
  //
  // El humano vio la lista de pendientes y no encontró cómo elegir una: el compositor no ofrece una
  // lista pulsable para los argumentos de un comando. La superficie de selección del harness es el menú
  // `/`, y desde un plugin se usa así: **una entrada por pendiente, sin argumentos**, porque un comando
  // del host sin argumentos se ejecuta en el acto al elegirlo.
  //
  // Y cada fila es de **un proyecto**. Registrarlas en el global parecía cómodo y era un defecto: el
  // humano abrió una sesión de un proyecto y vio, en el menú, las pendientes de otro —ofrecidas y
  // condenadas a fallar, porque la puerta las rechaza con razón—. Se registran en el ámbito del agente
  // de su sesión, que es lo que el contrato del harness pide para esto: registrar en `agent.ctx`,
  // obtenido en un listener de `agent/created`, y conservar el disposer por agente en un efecto propio.
  /** Lo sustituye el bloque de comandos: sin servicio de comandos no hay filas, y no pasa nada. */
  let refreshPendingRows = () => false;

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
    return skillProvider({ root });
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
      /** agente → cómo recomponer sus filas, y cómo retirarlas si el plugin se descarga. */
      const perAgent = new Map();

      const composeFor = (cwd) => {
        try {
          return targetCommands({ root, catalog, rows: pendingRowsFor({ root, cwd }) });
        } catch {
          return null; // el almacén ilegible no puede tumbar los comandos que ya están
        }
      };

      /**
       * Monta las filas de un agente bajo **su** contexto, que es lo que las hace suyas y sólo suyas.
       * Dentro de un mismo agente el conjunto no se toca si no cambió: re-registrar lo mismo emitiría
       * `commands/change` en vano y haría parpadear el menú.
       */
      const mountFor = (agent) => {
        // `scopeOf` lee el ámbito del `exec` del agente, que es el mismo camino que usan las herramientas:
        // una regla, una implementación. Llamarla con el agente pelado devolvía `undefined` y el montaje
        // se caía en silencio — sin filas para nadie, que es peor que con filas de más.
        const cwd = scopeOf({ agent });
        if (typeof cwd !== 'string' || cwd.trim() === '' || perAgent.has(agent)) return;
        // El plugin guarda **sus propias** retiradas: el harness avisa de que descargar el plugin no
        // libera por su cuenta lo registrado bajo `agent.ctx`, así que la limpieza no puede depender de
        // lo que devuelva el `inject` ni del orden en que el marco recorra los efectos.
        const entry = { applied: '', refresh: null, dispose: null, clear: null };
        // Un solo efecto bajo `agent.ctx`: cuando el agente muere, sus filas se van con él. Y el plugin
        // conserva el disposer porque descargarse él **no** retira por su cuenta lo registrado ahí.
        entry.dispose = agent.ctx.effect(() => {
          let inner = null;
          try {
            inner = agent.ctx.inject(['commands'], (scopedRows) => {
              const rowsRegistry = scopedRows?.commands ?? agent.ctx.commands;
              if (rowsRegistry === undefined || typeof rowsRegistry.register !== 'function') return undefined;
              const rows = [];
              const apply = () => {
                const definitions = composeFor(cwd);
                if (definitions === null) return;
                const signature = definitions.map((definition) => definition.name).join('\n');
                if (signature === entry.applied) return;
                for (const dispose of rows.splice(0)) {
                  try {
                    dispose();
                  } catch {
                    /* ya retirada */
                  }
                }
                for (const definition of definitions) {
                  try {
                    rows.push(rowsRegistry.register(definition));
                  } catch {
                    /* una fila que no se puede registrar no se lleva las demás */
                  }
                }
                entry.applied = signature;
              };
              const clear = () => {
                for (const dispose of rows.splice(0)) {
                  try {
                    dispose();
                  } catch {
                    /* ya retirada */
                  }
                }
                entry.applied = '';
              };
              entry.refresh = apply;
              entry.clear = clear;
              apply();
              return clear;
            });
          } catch {
            /* sin filas propias quedan el comando con argumentos y la tarjeta: nunca se queda sin vía */
          }
          return () => {
            try {
              if (typeof inner === 'function') inner();
            } catch {
              /* ya retirado */
            }
          };
        });
        perAgent.set(agent, entry);
      };

      refreshPendingRows = () => {
        let touched = false;
        for (const entry of perAgent.values()) {
          if (typeof entry.refresh === 'function') {
            entry.refresh();
            touched = true;
          }
        }
        return touched;
      };

      try {
        for (const command of skillCommands({ root, catalog, onListed: refreshPendingRows })) base.push(registry.register(command));
      } catch {
        // Sin comandos no hay atajo humano, pero las herramientas y los skills siguen intactos.
      }

      // El alta del agente es donde el plugin conoce el ámbito sin que un humano lo declare: su `cwd`.
      let offCreated = null;
      try {
        offCreated = ctx.on('agent/created', (agent) => mountFor(agent));
      } catch {
        /* sin el alta no hay filas por sesión; los comandos con argumentos siguen funcionando */
      }

      return () => {
        refreshPendingRows = () => false;
        try {
          if (typeof offCreated === 'function') offCreated();
        } catch {
          /* ya retirado */
        }
        for (const entry of perAgent.values()) {
          // Las filas primero, con las retiradas que guarda el propio plugin: el ámbito del agente no se
          // desmonta solo al descargarse el plugin, y una fila viva apunta a una sesión que ya no está.
          try {
            entry.clear?.();
          } catch {
            /* ya retiradas */
          }
          try {
            entry.dispose?.();
          } catch {
            /* ya retirado */
          }
        }
        perAgent.clear();
        for (const dispose of base) {
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
