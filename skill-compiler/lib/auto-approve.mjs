/**
 * auto-approve.mjs — el modo «aprobar automáticamente en esta sesión».
 *
 * ── Por qué esto no rompe la regla del plugin ────────────────────────────────────────────────────
 *
 * La regla es que **aprobar es un acto humano**, y sigue siéndolo: lo que cambia es *cuándo* se
 * concede. Activar este modo es una decisión de la persona, explícita, por sesión y revocable; el
 * modelo no puede activarlo (vive en un comando del compositor, que es superficie humana) ni saltarse
 * lo que decide: la validación previa sigue aplicándose igual. Lo que el humano delega es la
 * confirmación caso por caso, no la puerta.
 *
 * ── Dónde vive el estado, y por qué ahí ──────────────────────────────────────────────────────────
 *
 * **En el log de la sesión**, no en memoria ni en un fichero aparte. El registro de comandos del
 * harness anexa `command/run` (`{ commandId, name, args }`) antes de invocar el handler, y eso es un
 * evento durable de la sesión. Plegarlo da tres cosas que un flag en memoria no da:
 *
 *   · **sobrevive a recargar el plugin o reiniciar la app** — la sesión sigue siendo la misma sesión;
 *   · **es auditable**: quién activó el modo y cuándo está en el propio registro de la sesión;
 *   · **no inventa estado**: el plugin ya pliega eventos existentes para el feedback visual, y esta es
 *     la misma idea aplicada a una autorización.
 *
 * El coste es una pasada sobre el log al proponer o vendorizar — y sólo entonces, nunca en el camino de
 * lectura de sesiones, que es donde una excepción sí sería grave. Por eso este módulo es total: no lanza
 * nunca y, ante cualquier duda, devuelve «modo desactivado», que es la respuesta segura.
 */

/** El comando que gobierna el modo. Uno solo, con su argumento, para que el log lo cuente entero. */
export const AUTO_COMMAND = 'skill-auto';

/** Palabras que activan y que desactivan. Se aceptan en español y en inglés, sin ambigüedad. */
const ON_WORDS = Object.freeze(['activar', 'activa', 'on', 'si', 'sí']);
const OFF_WORDS = Object.freeze(['desactivar', 'desactiva', 'off', 'no']);

/** Interpreta el argumento del comando. Devuelve `true`, `false`, o `null` si no cambia nada. */
export function parseAutoCommand(rawInput) {
  const word = String(rawInput ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (word === '') return null;
  if (ON_WORDS.includes(word)) return true;
  if (OFF_WORDS.includes(word)) return false;
  return null;
}

/**
 * Pliega el modo desde los eventos de una sesión: **el último `/skill-auto` que cambió algo manda**.
 *
 * El `args` del evento `command/run` es la entrada cruda tal y como la escribió la persona, incluido el
 * espacio que sigue al nombre del comando, así que se mira la primera palabra.
 *
 * @param events - eventos de la sesión (`session.snapshotEvents()`), en orden.
 * @returns `true` si el modo está activo en esa sesión.
 */
export function autoApproveFromEvents(events) {
  try {
    let on = false;
    for (const event of events ?? []) {
      if (event?.type !== 'command/run' || event?.data?.name !== AUTO_COMMAND) continue;
      const decision = parseAutoCommand(event.data.args);
      if (decision !== null) on = decision;
    }
    return on;
  } catch {
    // Camino de lectura de una sesión: ante cualquier duda, no se aprueba nada solo.
    return false;
  }
}

/** ¿El modo está activo para la sesión de esta ejecución? Lee el log; nunca lanza. */
export function autoApproveFor(exec) {
  const events = exec?.agent?.session?.snapshotEvents?.();
  if (typeof events === 'function' || events === undefined || events === null) return false;
  return autoApproveFromEvents(events);
}
