/**
 * El cerrojo por skill: **uno solo** en el puesto.
 *
 * Vive aquí, y no en la promoción, porque hay más de una operación que puede escribir sobre la misma
 * skill: proponer, promocionar y publicar. Dos mecanismos distintos de exclusión serían dos verdades
 * sobre lo mismo —y la segunda siempre se olvida en el camino nuevo—, así que los dos caminos toman el
 * mismo fichero.
 *
 * `O_EXCL` es la primitiva: si el fichero existe, hay otra operación en curso. No se rompe un cerrojo
 * ajeno por viejo que sea: se informa de quién lo dejó y desde cuándo, y se para. Un cerrojo roto a la
 * fuerza es exactamente cómo se pierden dos versiones de trabajo.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** La ruta del cerrojo de una skill, para poder declararla en el informe de un fallo. */
export function rutaDelCerrojo(root, key, id) {
  return join(root, 'locks', `${key}--${String(id).replace(/[^\w.-]/g, '_')}.lock`);
}

/**
 * Toma el cerrojo de una skill, ejecuta `fn` y lo suelta pase lo que pase.
 *
 * @returns el valor de `fn`, o `{ ok: false, reason, lock }` si ya había una operación en curso.
 */
export function conCerrojo(root, key, id, fn) {
  const fichero = rutaDelCerrojo(root, key, id);
  let fd = null;
  try {
    mkdirSync(join(root, 'locks'), { recursive: true });
    fd = openSync(fichero, 'wx');
  } catch (error) {
    let dueno = '(sin datos)';
    try { dueno = readFileSync(fichero, 'utf8').trim(); } catch { /* el cerrojo existe pero no se puede leer */ }
    return {
      ok: false,
      reason: `ya hay una operación en curso sobre ${id}: cerrojo ${fichero} (${dueno}). Si es de un proceso que murió, bórralo tú — el motor no rompe cerrojos.`,
      lock: fichero,
    };
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), id, key }), 'utf8');
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* ya cerrado */ }
    try { rmSync(fichero, { force: true }); } catch { /* si no se puede borrar, queda declarado en el informe */ }
  }
}
