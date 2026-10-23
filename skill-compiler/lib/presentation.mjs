/**
 * presentation.mjs — el estado que alimenta el feedback visual.
 *
 * Qué se quiere ver en la interfaz: que el análisis de aprendizaje está en marcha, y qué resultó —
 * una skill **nueva**, un **parche** de una existente, o que no hubo nada que aprender.
 *
 * Tres decisiones que gobiernan este módulo:
 *
 *   1. **Se deriva de eventos que ya existen.** La guía de DSH prohíbe añadir tipos de evento propios:
 *      un evento desconocido sin la marca `ignorable` impide reabrir la sesión después. Así que el
 *      estado se pliega de `tool/call`, `tool/result`, `turn/end` y `user/message`, que ya están ahí.
 *   2. **El resultado viaja en un marcador declarado, no se adivina.** Cada herramienta abre su
 *      resultado con `[skill-compiler] <resultado> <id>`. Es un contrato entre dos piezas nuestras —la
 *      herramienta y este plegado—, y hay una prueba que lo congela contra el `render` real.
 *   3. **La vista solo usa primitivos** (cadenas y números, sin nulos ni objetos anidados): el esquema
 *      que valida cada lectura se queda en lo más simple posible, que es donde menos puede fallar.
 *   4. **Una lista de pendientes se quedó obsoleta cuando alguien decide.** Medido con el usuario
 *      delante: aprobó una skill, el bloque de `/skill-propuestas` que tenía delante siguió enseñándola
 *      como pendiente, y él volvió a aprobarla. El resultado de un comando es el registro de lo que pasó
 *      —no se reescribe—, así que lo que se marca aquí es que hubo una decisión POSTERIOR: eso lo puede
 *      decir el log, y es lo que la interfaz necesita para no mentir. Se pliegan `command/run` y
 *      `command/done`, que ya existen: la guía de DSH prohíbe añadir tipos de evento propios.
 */

import { localizedNamesOf } from './localized-commands.mjs';

/** Fases visibles. `idle` no pinta nada. Congeladas: son la fuente de verdad del esquema de la vista. */
export const PHASES = Object.freeze(['idle', 'analyzing', 'done']);

/**
 * Resultados posibles. La cadena vacía significa «todavía no hay resultado», que es distinto de
 * `none`: `none` es un turno que se cerró sin que hubiera nada que aprender, y se sabe al final.
 */
export const OUTCOMES = Object.freeze(['', 'created', 'updated', 'none', 'rejected', 'blocked']);

/** Las herramientas de este plugin, por nombre, y qué hace cada una. */
export const TOOLS = { skill_propose: 'propose', skill_vendor: 'vendor' };

/**
 * Las operaciones humanas que **cambian el almacen**, por **id interno de operacion** -no por nombre-.
 *
 * El nombre de un comando depende del idioma (`skill-approve` / `skill-aprobar`), asi que una tabla de prefijos
 * con nombres volveria a saber espanol en un solo idioma: aqui se declara la operacion y el nombre se resuelve
 * en el mapa localizado. El prefijo cubre las dos formas de invocarla, porque son el mismo acto: el comando
 * (`skill-approve`, `skill-aprobar`) y la fila del menu, que lleva el verbo y el id (`skill-approve-<id>`).
 */
export const DECISION_OPERATIONS = Object.freeze([
  Object.freeze({ id: 'approve', kind: 'aprobar' }),
  // Publicar es una aprobación más: cuenta como decisión propia, y el feedback lo dice así.
  Object.freeze({ id: 'publish', kind: 'aprobar' }),
  Object.freeze({ id: 'scope', kind: 'aprobar' }),
  Object.freeze({ id: 'reject', kind: 'rechazar' }),
]);

/** El verbo de decisión de un comando: `aprobar`, `rechazar`, o `''` si ese comando no decide nada. */
export function decisionKindOf(name) {
  const clean = String(name ?? '');
  for (const entry of DECISION_OPERATIONS) {
    const nombres = localizedNamesOf(entry.id);
    if (nombres.some((nombre) => clean === nombre || clean.startsWith(`${nombre}-`))) return entry.kind;
  }
  return '';
}

/** El marcador que abre el resultado de una herramienta. Contrato congelado por prueba. */
export const MARKER_PREFIX = '[skill-compiler]';

/**
 * El marcador tiene que **abrir** el resultado: sin la bandera `m`, `^` solo mira el principio del texto.
 * Así un resultado que cite un marcador ajeno en su cuerpo no se confunde con un resultado de verdad.
 */
const MARKER_RE = new RegExp(`^\\s*\\${MARKER_PREFIX}\\s+(created|updated|none|rejected|blocked)(?:\\s+(\\S+))?`);

/** La línea que abre el resultado de una herramienta. Legible para el modelo y estable para el plegado. */
export function markerLine(outcome, id = '') {
  const clean = String(id ?? '').trim();
  return `${MARKER_PREFIX} ${outcome}${clean ? ` ${clean}` : ''}`;
}

/** Lee el marcador del texto de un resultado. Devuelve `null` si no es nuestro. */
export function parseMarker(text) {
  const match = MARKER_RE.exec(String(text ?? ''));
  if (!match) return null;
  return { outcome: match[1], id: match[2] ?? '' };
}

/** Estado inicial: nada en vuelo, sin resultado, contadores a cero. */
export function initialLearning() {
  return {
    phase: 'idle',
    outcome: '',
    id: '',
    pending: [],     // callIds de las herramientas en vuelo: una lista, para que el esquema sea simple
    created: 0,
    updated: 0,
    // Los resultados que **no** crearon nada también se cuentan: si un turno crea una skill y rechaza otra,
    // decir «No se creó ninguna skill» es sencillamente falso. Un contador por tipo es lo que permite que
    // todos los resultados del turno quepan en la frase.
    rejected: 0,
    blocked: 0,
    // Las skills que este turno ha tocado, **sin repetir**: es lo que permite contar skills y no eventos.
    // Con tres skills distintas, `created: 3` + `id: <la última>` hacía que la píldora dijera «×3» de una
    // sola — que es exactamente lo que el usuario vio y no cuadraba con lo que había pasado.
    ids: [],
    at: 0,
    turn: 0,
    seq: -1,
    // La última decisión humana sobre el almacén. `decisionCommand` sólo está puesto entre el
    // `command/run` y su `command/done`: es el emparejamiento, y `command/done` no trae el nombre.
    decisionCommand: '',
    decisionKind: '',
    decisionSeq: -1,
  };
}

const pendingCount = (pending) => (Array.isArray(pending) ? pending.length : 0);

/** Texto plano de un resultado de herramienta, tal y como lo escribió `output.render`. */
/**
 * El texto de un bloque, en cualquiera de las formas que admite el contrato de mensajes.
 *
 * Medido contra el harness real: un resultado de herramienta llega como `{ type: 'text', text: '...' }`
 * —plano—, y el texto también puede venir anidado en `content`. Se recorre la forma **entera** en vez de
 * elegir una rama con un `else`: la versión anterior colgaba el `else` del `if` interno (faltaba una llave)
 * y un bloque plano no se leía **nunca**, así que el marcador del resultado no aparecía y todo resultado de
 * `skill_propose` contaba como «ninguno». El adorno se quedaba mudo sin que nada fallara a la vista.
 */
function blockText(block) {
  if (typeof block?.text === 'string') return [block.text];
  if (Array.isArray(block?.content)) return block.content.flatMap((inner) => blockText(inner));
  return [];
}

function resultText(event) {
  const blocks = event?.data?.message?.content ?? [];
  return blocks.flatMap((block) => blockText(block)).join('\n');
}

/**
 * Pliega un evento sobre el estado. **Síncrono, puro y a prueba de excepciones.**
 *
 * Devuelve la MISMA referencia cuando el evento no le concierne: es el contrato del registro de
 * proyecciones, y lo que hace que un evento ajeno no cueste nada aguas abajo.
 *
 * Y no lanza nunca, ni con un estado restaurado de una forma inesperada: esto vive en el camino de
 * lectura de las sesiones, así que una excepción aquí no estropearía un adorno —estropearía abrir una
 * sesión—. Ante cualquier duda, se devuelve el estado tal cual.
 */
export function applyLearning(state, event) {
  try {
    return fold(state, event);
  } catch {
    return state;
  }
}

/** Los verbos de decisión válidos; la vista de la proyección deriva su enum de aquí, como PHASES. */
export const DECISION_KINDS = Object.freeze(['', ...DECISION_OPERATIONS.map((entry) => entry.kind)]);

/** Normaliza un estado que venga de un punto de control: si un campo falta o viene raro, se rellena. */
function normalize(state) {
  const base = initialLearning();
  if (state === null || typeof state !== 'object') return base;
  return {
    phase: typeof state.phase === 'string' ? state.phase : base.phase,
    outcome: typeof state.outcome === 'string' ? state.outcome : base.outcome,
    id: typeof state.id === 'string' ? state.id : base.id,
    pending: Array.isArray(state.pending) ? state.pending.filter((x) => typeof x === 'string') : base.pending,
    created: Number.isFinite(state.created) ? state.created : base.created,
    updated: Number.isFinite(state.updated) ? state.updated : base.updated,
    rejected: Number.isFinite(state.rejected) ? state.rejected : base.rejected,
    blocked: Number.isFinite(state.blocked) ? state.blocked : base.blocked,
    ids: Array.isArray(state.ids) ? state.ids.filter((x) => typeof x === 'string' && x !== '') : base.ids,
    at: Number.isFinite(state.at) ? state.at : base.at,
    turn: Number.isFinite(state.turn) ? state.turn : base.turn,
    seq: Number.isFinite(state.seq) ? state.seq : base.seq,
    decisionCommand: typeof state.decisionCommand === 'string' ? state.decisionCommand : base.decisionCommand,
    decisionKind: DECISION_KINDS.includes(state.decisionKind) ? state.decisionKind : base.decisionKind,
    decisionSeq: Number.isFinite(state.decisionSeq) ? state.decisionSeq : base.decisionSeq,
  };
}

function fold(rawState, event) {
  const type = event?.type;

  if (type === 'tool/call') {
    if (TOOLS[event?.data?.name] === undefined) return rawState;
    const state = normalize(rawState);
    const callId = event?.data?.callId ?? '';
    if (callId === '' || state.pending.includes(callId)) return rawState;
    return { ...state, phase: 'analyzing', pending: [...state.pending, callId], at: event.time ?? state.at, seq: event.seq ?? state.seq };
  }

  if (type === 'tool/result') {
    if (typeof event?.data?.message?.source?.callId !== 'string') return rawState;
    const callId = event.data.message.source.callId;
    const state = normalize(rawState);
    if (callId === '' || !state.pending.includes(callId)) return rawState;
    const pending = state.pending.filter((id) => id !== callId);
    const marker = parseMarker(resultText(event));
    // Sin marcador no se atribuye nada: es más honesto no decir de qué skill se trata que adivinarlo.
    const outcome = marker?.outcome ?? 'none';
    const id = marker?.id ?? '';
    return {
      ...state,
      pending,
      phase: pending.length > 0 ? 'analyzing' : 'done',
      outcome,
      id,
      created: state.created + (outcome === 'created' ? 1 : 0),
      updated: state.updated + (outcome === 'updated' ? 1 : 0),
      rejected: state.rejected + (outcome === 'rejected' ? 1 : 0),
      blocked: state.blocked + (outcome === 'blocked' ? 1 : 0),
      // El id entra una sola vez, y sólo cuando de verdad se creó o se actualizó algo: un rechazo o un
      // bloqueo no escribieron nada y no cuentan como skill tocada.
      ids: (outcome === 'created' || outcome === 'updated') && id !== '' && !state.ids.includes(id)
        ? [...state.ids, id]
        : state.ids,
      at: event.time ?? state.at,
      seq: event.seq ?? state.seq,
    };
  }

  // Una decisión humana se anota cuando TERMINA BIEN: `command/run` abre el emparejamiento y
  // `command/done` lo cierra. Un `done` con error significa que no se movió nada, así que no marca.
  if (type === 'command/run') {
    const kind = decisionKindOf(event?.data?.name);
    if (kind === '') return rawState;
    const commandId = typeof event?.data?.commandId === 'string' ? event.data.commandId : '';
    if (commandId === '') return rawState;
    const state = normalize(rawState);
    if (state.decisionCommand === commandId) return rawState;
    return { ...state, decisionCommand: commandId, decisionKind: kind };
  }

  if (type === 'command/done') {
    const commandId = typeof event?.data?.commandId === 'string' ? event.data.commandId : '';
    const state = normalize(rawState);
    if (commandId === '' || commandId !== state.decisionCommand) return rawState;
    // El verbo se conserva para que la interfaz pueda decir qué se hizo; el emparejamiento se suelta.
    if (event?.data?.kind !== 'success') return { ...state, decisionCommand: '' };
    const seq = Number.isFinite(event.seq) ? event.seq : state.decisionSeq;
    return { ...state, decisionCommand: '', decisionSeq: seq };
  }

  // Un turno que se cierra sin que nadie aprendiera nada también es un resultado: es lo que el usuario
  // quiere saber cuando la respuesta fue «no hay skill nueva».
  if (type === 'turn/end') {
    const state = normalize(rawState);
    if (state.pending.length > 0 || state.phase === 'done') return rawState;
    return { ...state, phase: 'done', outcome: state.outcome === '' ? 'none' : state.outcome, seq: event.seq ?? state.seq };
  }

  // Un prompt humano abre trabajo nuevo: el resultado anterior deja de estar vigente. Los contadores
  // de la sesión NO se reinician: son el acumulado, y eso es lo que los hace útiles (el `×N` se titula
  // «En esta sesión»). La lista de ids sigue la misma regla: es el acumulado de la sesión, no del turno.
  // Lo que sí se retira es el resultado anterior (`outcome`/`id`), que es lo que deja de estar vigente.
  if (type === 'user/message' && event?.data?.source?.kind === 'user') {
    const state = normalize(rawState);
    if (state.phase === 'idle' && state.outcome === '' && state.id === '') return rawState;
    return { ...state, phase: 'idle', outcome: '', id: '', at: 0, seq: event.seq ?? state.seq };
  }

  return rawState;
}

/**
 * Vista para el cliente: **solo primitivos**.
 *
 * Se memoiza por referencia de estado (WeakMap): un estado nuevo con la misma vista devuelve la MISMA
 * vista, y el registro no publica un cambio que no existe. No se cachea dentro del estado porque el
 * estado se serializa en los puntos de control.
 */
const viewCache = new WeakMap();

/** Un número que el esquema de la vista acepte, siempre. `undefined` no es un número. */
const count = (value) => (Number.isFinite(value) ? value : 0);

export function learningView(rawState) {
  // La caché va por la referencia que ENTRA, no por la normalizada: es la que el registro repite
  // mientras el estado no cambie, y comparar vistas con `Object.is` es lo que evita publicar cambios
  // que no existen. Normalizar crea un objeto nuevo, así que se hace solo cuando hay que proyectar.
  const cacheable = rawState !== null && typeof rawState === 'object';
  if (cacheable) {
    const cached = viewCache.get(rawState);
    if (cached !== undefined) return cached;
  }
  const state = normalize(rawState);
  const view = {
    phase: PHASES.includes(state.phase) ? state.phase : 'idle',
    outcome: OUTCOMES.includes(state.outcome) ? state.outcome : '',
    id: state.id,
    // Cadena, no lista: la vista de esta unidad sólo lleva primitivos (`pending` es del ESTADO, no de la
    // vista), y el esquema que valida cada lectura se queda en lo más simple posible. Un id kebab-case no
    // puede contener una coma, así que la coma es un separador seguro.
    ids: state.ids.join(','),
    analyzers: count(state.pending.length),
    created: count(state.created),
    updated: count(state.updated),
    rejected: count(state.rejected),
    blocked: count(state.blocked),
    at: count(state.at),
    turn: count(state.turn),
    // `-1` es "ninguna decisión": la interfaz compara esto con el `seq` del bloque que está pintando.
    decisionKind: DECISION_KINDS.includes(state.decisionKind) ? state.decisionKind : '',
    decisionSeq: Number.isFinite(state.decisionSeq) ? state.decisionSeq : -1,
  };
  if (cacheable) viewCache.set(rawState, view);
  return view;
}

/**
 * Lo que la píldora necesita para **no mentir** cuando el turno aprendió varias cosas.
 *
 * Con una sola skill tocada se enseña su id y, si se tocó varias veces, `×N` — que ahí dice la verdad. Con
 * varias skills distintas se enseña cuántas son, y la lista completa va en el `title`: enseñar el id de la
 * última junto a un `×3` es lo que hacía parecer que una skill se hubiera actualizado tres veces.
 */
export function resumenDeActividad(view) {
  const ids = typeof view?.ids === 'string'
    ? view.ids.split(',').map((x) => x.trim()).filter((x) => x !== '')
    : [];
  const total = count(view?.created) + count(view?.updated);
  return {
    skills: ids.length,
    total,
    ids,
    // El `id` es el del ÚLTIMO resultado (como siempre: es el que usa la frase simple, y en una frase
    // compuesta no se pinta, va la lista entera en el `title`). `ids` es el acumulado, que es otra cosa.
    id: typeof view?.id === 'string' ? view.id : '',
    repetido: ids.length <= 1 && total > 1,
    // Lo que de verdad pasó en el turno, por tipo. `total` sigue siendo «skills creadas o actualizadas»: un
    // rechazo no crea nada, así que no entra ahí — pero sí se cuenta, porque callarlo es mentir.
    nuevas: count(view?.created),
    actualizadas: count(view?.updated),
    rechazadas: count(view?.rejected),
    bloqueadas: count(view?.blocked),
  };
}

/**
 * Las partes de la frase: `['1 nueva', '2 actualizadas']`, en orden y sin perder ninguna.
 *
 * Con un solo resultado esto devuelve **una** parte, y el cliente pinta la frase simple de siempre
 * («Nueva skill creada: mi-skill») — que es lo que ya funcionaba y no se toca. Con varias, cada tipo que
 * ocurrió aparece: es lo que arregla las tres mentiras medidas (perder una creación, mezclar tipos en un
 * `×N`, y decir «no se creó ninguna» cuando sí se creó).
 *
 * @param palabras - `{ created: [singular, plural], … }`, del diccionario del idioma.
 */
export function partesDeActividad(view, palabras = {}) {
  const r = resumenDeActividad(view);
  return [['created', r.nuevas], ['updated', r.actualizadas], ['rejected', r.rechazadas], ['blocked', r.bloqueadas]]
    .filter(([, cuantas]) => cuantas > 0)
    .map(([tipo, cuantas]) => {
      const [singular, plural] = palabras[tipo] ?? [tipo, tipo];
      return `${cuantas} ${cuantas === 1 ? singular : plural}`;
    });
}

/** ¿Hay algo que enseñar? Si no, la interfaz no pinta nada — ni un hueco vacío. */
export function hasSomethingToShow(view) {
  if (!view) return false;
  if (view.phase === 'analyzing') return true;
  if (view.outcome === '') return false;
  return true;
}
