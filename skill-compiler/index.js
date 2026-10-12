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

import { defaultRoot } from './lib/compiler.mjs';
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
