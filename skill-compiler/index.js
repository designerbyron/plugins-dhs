/**
 * skill-compiler — adaptador Cordis del compilador de conocimiento.
 *
 * Este fichero es deliberadamente **fino**, porque es el único que no se puede probar antes de
 * instalar (importa `@deepseek-ai/dsh-tools`, que solo existe dentro del harness). Todo lo que decide
 * algo vive en `lib/`, donde sí hay pruebas. Aquí solo se elige el punto de extensión y se registra.
 *
 * Los tres puntos de extensión, y por qué cada uno:
 *   1. `ctx.systemPrompt.section(...)` — el protocolo, ESTÁTICO y ordenado. No se usa
 *      `system-prompt/assemble`: la guía de DSH lo prohíbe expresamente para añadir texto, y una
 *      sección estática es además lo que protege el prompt caching.
 *   2. `ctx.tools.register(...)` — la herramienta con la que el modelo **propone**, y otra de solo
 *      lectura para revisar. Aprobar NO es una herramienta: si lo fuera, el modelo podría
 *      auto-aprobarse y la revisión humana sería decorativa. Aprobar vive en `bin/`.
 *   3. `ctx.skills.registerProvider(...)` — sirve **solo** las skills aprobadas del proyecto actual.
 *   4. `ctx.sessionProjections.register(...)` — el estado que alimenta el feedback visual, plegado de
 *      eventos que YA existen. Es **opcional y a prueba de fallos**: si el registro de proyecciones o su
 *      biblioteca de esquemas no están en este perfil, el plugin pierde el adorno y conserva el trabajo.
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import { defaultRoot } from './lib/compiler.mjs';
import { PROTOCOL, skillPropose, skillProvider, skillReview, skillUpstreamCheck, skillVendor } from './lib/definitions.mjs';
import { applyLearning, initialLearning, learningView } from './lib/presentation.mjs';

/** Identidad del Loader. */
export const name = 'skill-compiler';

/** Servicios necesarios; sin ellos el plugin queda inactivo en lugar de lanzar. */
export const inject = ['tools', 'skills', 'systemPrompt'];

/** Orden de la sección estática: después de la guía del harness y antes del sufijo de personalidad. */
const SECTION_ORDER = 9000;

/** La clave de la proyección. El cliente la lee con `useProjection('skillCompiler')`: no puede cambiar
 *  sin cambiar también `client.js`, y por eso está aquí arriba, a la vista. */
export const LEARNING_KEY = 'skillCompiler';

/**
 * Se importa la biblioteca de esquemas de forma **tolerante**: si este perfil no la resuelve, se pierde
 * el feedback visual y nada más. Una proyección que no se puede validar no se registra, en vez de
 * reventar la activación del plugin entero —que se llevaría por delante las herramientas—.
 */
let schemastery = null;
try {
  schemastery = (await import('@deepseek-ai/schemastery')).default;
} catch {
  schemastery = null;
}

/** El estado y la vista, con el esquema más simple posible: cadenas, números y una lista de cadenas. */
function learningDefinition(z) {
  return {
    key: LEARNING_KEY,
    stateVersion: 1,
    stateSchema: z.object({
      phase: z.string(),
      outcome: z.string(),
      id: z.string(),
      pending: z.array(z.string()),
      created: z.number(),
      updated: z.number(),
      at: z.number(),
      turn: z.number(),
      seq: z.number(),
    }),
    init: () => initialLearning(),
    apply: (state, event) => applyLearning(state, event),
    wire: {
      viewSchema: z.object({
        phase: z.string(),
        outcome: z.string(),
        id: z.string(),
        analyzers: z.number(),
        created: z.number(),
        updated: z.number(),
        at: z.number(),
        turn: z.number(),
      }),
      view: (state) => learningView(state),
    },
  };
}

export function apply(ctx, config = {}) {
  const root = config.root ?? defaultRoot();

  ctx.systemPrompt.section({
    name: 'skill-compiler:protocol',
    order: SECTION_ORDER,
    interpolate: false,
    text: PROTOCOL,
  });

  ctx.tools.register(defineTool(skillPropose({ root })));
  ctx.tools.register(defineTool(skillVendor({ root })));
  ctx.tools.register(defineTool(skillReview({ root })));
  ctx.tools.register(defineTool(skillUpstreamCheck({ root })));

  ctx.skills.registerProvider(() => skillProvider({ root }));

  // Inyección opcional: el callback recibe un contexto hijo con el servicio disponible (firma
  // verificada en el código que se envía); el respaldo por cierre cubre la otra firma posible.
  //
  // Y las dos guardas que siguen no son ceremonia: sin ellas, un perfil donde el servicio no esté
  // disponible —o donde el registro rechace el esquema— lanzaba DENTRO de `apply` y se llevaba por
  // delante la activación entera, incluidas las herramientas. El adorno visual nunca puede costar el
  // trabajo; si no se puede registrar la proyección, se pierde el adorno y nada más.
  if (schemastery !== null) {
    ctx.inject(['sessionProjections'], (scoped) => {
      const registry = scoped?.sessionProjections ?? ctx.sessionProjections;
      if (registry === undefined || typeof registry.register !== 'function') return;
      try {
        registry.register(learningDefinition(schemastery));
      } catch {
        // El registro de proyecciones no aceptó la unidad (versión, esquema o clave ocupada): el
        // feedback visual no estará, las herramientas sí.
      }
    });
  }
}
