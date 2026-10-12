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
 */

/** Fases visibles. `idle` no pinta nada. */
export const PHASES = ['idle', 'analyzing', 'done'];

/**
 * Resultados posibles. La cadena vacía significa «todavía no hay resultado», que es distinto de
 * `none`: `none` es un turno que se cerró sin que hubiera nada que aprender, y se sabe al final.
 */
export const OUTCOMES = ['', 'created', 'updated', 'none', 'rejected', 'blocked'];

/** Las herramientas de este plugin, por nombre, y qué hace cada una. */
export const TOOLS = { skill_propose: 'propose', skill_vendor: 'vendor' };

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
    at: 0,
    turn: 0,
    seq: -1,
  };
}

const pendingCount = (pending) => (Array.isArray(pending) ? pending.length : 0);

/** Texto plano de un resultado de herramienta, tal y como lo escribió `output.render`. */
function resultText(event) {
  const blocks = event?.data?.message?.content ?? [];
  const parts = [];
  for (const block of blocks) {
    if (Array.isArray(block?.content)) for (const inner of block.content) if (typeof inner?.text === 'string') parts.push(inner.text);
    else if (typeof block?.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Pliega un evento sobre el estado. **Síncrono y puro.**
 *
 * Devuelve la MISMA referencia cuando el evento no le concierne: es el contrato del registro de
 * proyecciones, y lo que hace que un evento ajeno no cueste nada aguas abajo.
 */
export function applyLearning(state, event) {
  const type = event?.type;

  if (type === 'tool/call' && TOOLS[event?.data?.name] !== undefined) {
    const callId = event?.data?.callId ?? '';
    if (callId === '' || state.pending.includes(callId)) return state;
    return { ...state, phase: 'analyzing', pending: [...state.pending, callId], at: event.time ?? state.at, seq: event.seq ?? state.seq };
  }

  if (type === 'tool/result') {
    const callId = event?.data?.message?.source?.callId ?? '';
    if (callId === '' || !state.pending.includes(callId)) return state;
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
      at: event.time ?? state.at,
      seq: event.seq ?? state.seq,
    };
  }

  // Un turno que se cierra sin que nadie aprendiera nada también es un resultado: es lo que el usuario
  // quiere saber cuando la respuesta fue «no hay skill nueva».
  if (type === 'turn/end') {
    if (pendingCount(state.pending) > 0 || state.phase === 'done') return state;
    return { ...state, phase: 'done', outcome: state.outcome === '' ? 'none' : state.outcome, seq: event.seq ?? state.seq };
  }

  // Un prompt humano abre trabajo nuevo: el resultado anterior deja de estar vigente. Los contadores
  // de la sesión NO se reinician: son el acumulado, y eso es lo que los hace útiles.
  if (type === 'user/message' && event?.data?.source?.kind === 'user') {
    if (state.phase === 'idle' && state.outcome === '' && state.id === '') return state;
    return { ...state, phase: 'idle', outcome: '', id: '', at: 0, seq: event.seq ?? state.seq };
  }

  return state;
}

/**
 * Vista para el cliente: **solo primitivos**.
 *
 * Se memoiza por referencia de estado (WeakMap): un estado nuevo con la misma vista devuelve la MISMA
 * vista, y el registro no publica un cambio que no existe. No se cachea dentro del estado porque el
 * estado se serializa en los puntos de control.
 */
const viewCache = new WeakMap();

export function learningView(state) {
  const cached = viewCache.get(state);
  if (cached !== undefined) return cached;
  const view = {
    phase: PHASES.includes(state.phase) ? state.phase : 'idle',
    outcome: OUTCOMES.includes(state.outcome) ? state.outcome : '',
    id: typeof state.id === 'string' ? state.id : '',
    analyzers: pendingCount(state.pending),
    created: state.created ?? 0,
    updated: state.updated ?? 0,
    at: state.at ?? 0,
    turn: state.turn ?? 0,
  };
  viewCache.set(state, view);
  return view;
}

/** ¿Hay algo que enseñar? Si no, la interfaz no pinta nada — ni un hueco vacío. */
export function hasSomethingToShow(view) {
  if (!view) return false;
  if (view.phase === 'analyzing') return true;
  if (view.outcome === '') return false;
  return true;
}
