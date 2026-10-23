/**
 * projection.mjs — la unidad de proyección de sesión que alimenta el feedback visual.
 *
 * Vive aquí, y no en `index.js`, por una razón que costó un incidente: `index.js` es el adaptador de
 * Cordis —el único fichero que no se puede probar sin el harness—, así que todo lo que **decide** algo
 * tiene que estar donde sí hay pruebas. Los esquemas y el contrato de la unidad son una decisión.
 *
 * ── Los esquemas son de Zod, y eso no es un detalle de estilo ────────────────────────────────────
 *
 * El registro de proyecciones de DSH valida con `schema.parse(...)`: el estado que restaura de un punto
 * de control y el valor que sirve al cliente. Su contrato es `ZodType`
 * (`@deepseek-ai/dsh-session-projection` declara `zod` como dependencia propia).
 *
 * Un esquema que **existe pero no valida** —`@deepseek-ai/schemastery` se resuelve llamándolo como
 * función, `schema(valor)`, y no tiene `.parse`— atraviesa `register()` sin una queja —el registro no
 * valida los esquemas que le dan— y revienta mucho después, al **leer sesiones**:
 *
 *     Failed to load history: failed to project session "session-…":
 *     def.wire.viewSchema.parse is not a function
 *
 * Es decir: un adorno visual impedía abrir sesiones. De ahí las dos piezas que hay aquí, y no una:
 * los esquemas correctos, y `projectionContractProblems()`, que comprueba el contrato **antes** de
 * registrar. Quien registra es quien tiene que validar lo que registra.
 *
 * ── El estado se repara; la vista se exige ───────────────────────────────────────────────────────
 *
 * No son la misma cosa y por eso no llevan el mismo trato:
 *
 *   · El **estado** viene del disco: un punto de control escrito por otra versión, truncado o
 *     manipulado. `restore()` lo analiza **sin red de seguridad**, así que un dato raro no puede
 *     lanzar ahí: se repara campo a campo y se sigue. Una proyección que empieza limpia es mejor que
 *     una sesión que no abre.
 *   · La **vista** la calcula este fichero, no el disco, y `learningView` normaliza antes de pintar
 *     (cadenas y números, nunca `undefined`). Un fallo ahí es un defecto de programación que tiene que
 *     verse en las pruebas, no un dato imprevisible: el esquema es estricto a propósito.
 */
import { z } from 'zod';

import { t } from './i18n/index.mjs';
import { DECISION_KINDS, OUTCOMES, PHASES, applyLearning, initialLearning, learningView } from './presentation.mjs';

/** La clave de la proyección. El cliente la lee con `useProjection('skillCompiler')`: no puede cambiar
 *  sin cambiar también `client.js`, y por eso está aquí arriba, a la vista. */
export const LEARNING_KEY = 'skillCompiler';

/** Sube solo cuando cambian los campos del estado o la semántica del plegado, y no al tocar la vista. */
export const STATE_VERSION = 4;

/**
 * El estado que se pliega y se persiste. Cada campo se repara por separado (`.catch`) y el objeto
 * entero tiene una última red: basura total —`null`, un número, un objeto sin nada— se convierte en el
 * estado inicial en vez de lanzar. Las listas derivan de `presentation.mjs`, que es la única fuente.
 */
export const learningStateSchema = z
  .object({
    phase: z.string().catch('idle'),
    outcome: z.string().catch(''),
    id: z.string().catch(''),
    pending: z.array(z.string()).catch([]),
    created: z.number().catch(0),
    updated: z.number().catch(0),
    rejected: z.number().catch(0),
    blocked: z.number().catch(0),
    ids: z.array(z.string()).catch([]),
    at: z.number().catch(0),
    turn: z.number().catch(0),
    seq: z.number().catch(-1),
    // La última decisión humana, para que una lista pintada antes pueda marcarse como anterior a ella.
    decisionCommand: z.string().catch(''),
    decisionKind: z.string().catch(''),
    decisionSeq: z.number().catch(-1),
  })
  .catch(() => initialLearning());

/**
 * La vista que sale hacia el cliente: exactamente lo que produce `learningView`, sin campos de más ni
 * de menos. Estricta: si la vista dejara de encajar aquí, es un defecto nuestro y debe ponerse rojo.
 */
export const learningViewSchema = z.object({
  phase: z.enum(PHASES),
  outcome: z.enum(OUTCOMES),
  id: z.string(),
  analyzers: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  // La vista no lleva listas: los ids del acumulado viajan como una cadena separada por comas.
  ids: z.string(),
  at: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  // `-1` es «ninguna decisión todavía»: es un centinela, no un valor negativo de verdad.
  decisionKind: z.enum(DECISION_KINDS),
  decisionSeq: z.number().int().gte(-1),
});

/** La unidad, tal y como la espera `ctx.sessionProjections.register(...)`. */
export function learningProjection() {
  return {
    key: LEARNING_KEY,
    stateVersion: STATE_VERSION,
    stateSchema: learningStateSchema,
    init: () => initialLearning(),
    apply: (state, event) => applyLearning(state, event),
    wire: {
      viewSchema: learningViewSchema,
      view: (state) => learningView(state),
    },
  };
}

/** Estados imposibles que pueden llegar desde un punto de control: ninguno puede tumbar la lectura. */
const CORRUPT_STATES = Object.freeze([null, undefined, 42, 'texto', [], {}, { pending: 'no' }, { created: 'muchos' }]);

/** Lo que un esquema que no valida parece por fuera: ni `parse`, ni forma de saberlo hasta leer.
 *
 *  Devuelve la CLAVE de la frase, no la frase: quien la interpola la compone en el idioma de la sesion. */
const describeSchema = (schema) => {
  if (schema === null || typeof schema !== 'object') return 'other';
  if (typeof schema.parse === 'function') return 'zod';
  if (typeof schema === 'function') return 'function';
  return 'object';
};

/** La frase de un problema de la proyeccion, en el idioma de la sesion. */
const problema = (clave, params = {}) => t(`projection.problem.${clave}`, params);

/** El tipo de un esquema, ya dicho: es lo que se interpola en la frase del problema. */
const tipoDe = (schema) => t(`projection.schema.${describeSchema(schema)}`, { tipo: typeof schema });

/**
 * Comprueba el contrato que el registro de proyecciones **no** comprueba, y devuelve la lista de
 * problemas: vacía significa que la unidad se puede registrar sin arriesgar la lectura de sesiones.
 *
 * Cada comprobación viene de un fallo real o de una regla escrita en el contrato del paquete del
 * harness, y ninguna cuesta más que unos pocos `parse` sobre objetos diminutos:
 *
 *   1. `key` y `stateVersion` válidos — el registro los exige, pero es mejor saberlo aquí.
 *   2. Los esquemas validan de verdad (`parse` es una función). **Es el defecto del incidente.**
 *   3. El estado inicial pasa su propio esquema.
 *   4. Basura de un punto de control no lanza (el estado se repara).
 *   5. `apply` es síncrono y devuelve **la misma referencia** para un evento que no le concierne:
 *      el registro compara con `Object.is` y un objeto nuevo en cada evento de la sesión cuesta
 *      trabajo aguas abajo para nada.
 *   6. `wire.view` es síncrona —una promesa aquí falla el análisis del esquema, según el propio
 *      contrato del paquete— y su resultado valida incluso con un estado corrupto.
 */
export function projectionContractProblems(definition) {
  const problems = [];
  const wire = definition?.wire;

  if (typeof definition?.key !== 'string' || definition.key === '') {
    problems.push(problema('key'));
  }
  if (!Number.isSafeInteger(definition?.stateVersion) || definition.stateVersion < 0) {
    problems.push(problema('state-version', { valor: String(definition?.stateVersion) }));
  }
  if (typeof definition?.stateSchema?.parse !== 'function') {
    problems.push(problema('state-schema', { tipo: tipoDe(definition?.stateSchema) }));
  }
  if (typeof wire?.viewSchema?.parse !== 'function') {
    problems.push(problema('view-schema', { tipo: tipoDe(wire?.viewSchema) }));
  }
  if (typeof definition?.init !== 'function') problems.push(problema('init'));
  if (typeof definition?.apply !== 'function') problems.push(problema('apply'));
  if (typeof wire?.view !== 'function') problems.push(problema('view'));

  // A partir de aquí hay que ejecutar la unidad; con las piezas ausentes, no tiene sentido.
  if (problems.length > 0) return problems;

  let initial;
  try {
    initial = definition.init({}, 0);
    definition.stateSchema.parse(initial);
  } catch (error) {
    problems.push(problema('initial', { detalle: error.message }));
  }

  for (const corrupt of CORRUPT_STATES) {
    try {
      definition.stateSchema.parse(corrupt);
    } catch (error) {
      problems.push(problema('corrupt', { valor: JSON.stringify(corrupt) ?? 'undefined', detalle: error.message }));
      break;
    }
  }

  if (initial !== undefined) {
    try {
      const next = definition.apply(initial, { type: 'evento/ajeno' });
      if (next instanceof Promise) problems.push(problema('apply-async'));
      else if (next !== initial) problems.push(problema('apply-new-state'));
    } catch (error) {
      problems.push(problema('apply-threw', { detalle: error.message }));
    }
  }

  for (const state of [initial, ...CORRUPT_STATES]) {
    try {
      const raw = wire.view(state);
      if (raw instanceof Promise) {
        problems.push(problema('view-async'));
        break;
      }
      wire.viewSchema.parse(raw);
    } catch (error) {
      problems.push(problema('view-invalid', { valor: JSON.stringify(state) ?? 'undefined', detalle: error.message }));
      break;
    }
  }

  return problems;
}
