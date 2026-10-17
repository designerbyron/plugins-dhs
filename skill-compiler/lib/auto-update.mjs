/**
 * El medidor de la actualización automática.
 *
 * ── Qué problema resuelve ──────────────────────────────────────────────────────────────────────────
 *
 * Hasta aquí la política tenía dos mitades que no se hablaban: una skill **nueva** podía activarse sola si
 * el modo `/skill-auto` estaba encendido (delegar la confirmación, nunca la puerta), y una **corrección** de
 * algo vivo nunca se activaba sola — «queda para una fase posterior, con su política de riesgo». Esta es esa
 * fase: una corrección se activa sola sólo si **cada** medida pasa, y cuando no, se dice **qué midió** y con
 * qué número.
 *
 * ── Por qué medidas y no una lista de permitidos ───────────────────────────────────────────────────
 *
 * Un «se permite si es pequeño» que nadie mide es una opinión. Aquí cada veredicto lleva el número que lo
 * sostiene: el nivel declarado, las líneas del diff, la huella de la base, los avisos de la puerta, la
 * evidencia. Y las dieciséis medidas no se reimplementan: se compone el resultado de `pruebasDeRegresion`
 * —la misma vara que usa `promover`— y se le añade lo que la promoción automática necesita de más.
 *
 * ── Las tres cosas que un medidor no puede hacer ──────────────────────────────────────────────────
 *
 *   1. No decide: devuelve un veredicto con sus medidas. Quien autoriza es `promover`, y el humano sigue
 *      pudiendo aprobar a mano lo que el medidor rechaza.
 *   2. No adivina: si algo no se puede medir (sin `cwd`, sin versión vigente, sin nivel declarado), no pasa.
 *      «No medible» y «pasa» no son lo mismo.
 *   3. No se contradice con la puerta: si la puerta tiene avisos, no hay automático. Un aviso significa que
 *      alguien tiene que juzgar.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escanear } from './security.mjs';
import { NIVEL_QUE_EXIGE_HUMANO, pruebasDeRegresion } from './promote.mjs';
import { defaultRoot, parseFrontmatter, vigenteDe } from './compiler.mjs';

/** El techo del nivel que puede activarse sin humano. Se repite aquí a propósito: es la política, no un dato. */
export const NIVEL_MAXIMO_AUTOMATICO = 2;

/**
 * El disparador de una skill: a quién sirve. Cambiarlo cambia el enrutado del modelo, así que no es una
 * corrección de forma y no lo decide una máquina.
 */
function disparadorDe(meta, texto) {
  const { data } = parseFrontmatter(texto);
  return {
    description: String(meta?.description ?? data.description ?? '').trim(),
    whenToUse: String(meta?.whenToUse ?? data.whenToUse ?? '').trim(),
    tags: [...(meta?.tags ?? data.tags ?? [])].map((t) => String(t)).sort().join(','),
  };
}

/**
 * Mide si una propuesta puede activarse sola.
 *
 * @param id - la skill.
 * @param key - el proyecto.
 * @param root - raíz del almacén.
 * @param curated - la biblioteca de usuario (para saber si lo vigente está publicado).
 * @param cwd - el proyecto del humano: sin él no se puede comprobar que la evidencia exista, y sin esa
 *   comprobación no hay automático.
 * @param limites - `maxLineas` / `maxFicheros`, los mismos que usa la promoción.
 * @returns `{ apto, medidas, fallan, resumen, nivel }` — cada medida con su observado y su umbral.
 */
export function medirAutoActualizacion(id, key, {
  root = defaultRoot(), curated = null, cwd = null, limites = {},
} = {}) {
  const medidas = [];
  const anota = (regla, pasa, observado, umbral, detalle = '') => {
    medidas.push({ regla, pasa: pasa === true, observado, umbral, detalle });
  };
  const opts = { root, ...(curated ? { curated } : {}) };

  // 1 · Tiene que ser una ACTUALIZACIÓN. Una skill nueva es conocimiento nuevo: la confirma un humano.
  const vigente = vigenteDe(id, key, opts);
  anota('es-actualizacion', vigente !== null,
    vigente === null ? 'no hay versión vigente con ese id' : `${vigente.state} · ${vigente.hash.slice(0, 12)}`,
    'una versión vigente (aprobada, apagada o publicada)',
    'una skill nueva no se activa sola: la confirmación de conocimiento nuevo es humana');

  // 2 · El nivel declarado por el arreglo. Sin `repair` no hay nivel: lo más delicado.
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(root, 'projects', key, 'proposed', id, 'meta.json'), 'utf8')); } catch { meta = null; }
  const nivel = typeof meta?.repair?.nivel === 'number' ? meta.repair.nivel : NIVEL_QUE_EXIGE_HUMANO;
  anota('nivel', nivel <= NIVEL_MAXIMO_AUTOMATICO,
    meta?.repair?.nivel === undefined ? `sin nivel declarado → ${NIVEL_QUE_EXIGE_HUMANO}` : `nivel ${nivel}`,
    `≤ ${NIVEL_MAXIMO_AUTOMATICO}`,
    'el nivel 3 —seguridad, permisos, secretos, aislamiento, facturación— exige humano, y un parche sin nivel se trata como 3');

  // 3 · La evidencia de la corrección tiene que poder comprobarse. Una afirmación del modelo no vale.
  const evidencia = String(meta?.revision?.evidence ?? '').trim();
  const evidenciaEsRuta = evidencia !== '' && !/\s/.test(evidencia) && (/[\\/]/.test(evidencia) || /\.[A-Za-z0-9]{1,8}$/.test(evidencia));
  const evidenciaExiste = evidenciaEsRuta && typeof cwd === 'string' && cwd.trim() !== '' && existsSync(resolve(cwd, evidencia));
  anota('evidencia-observada', evidenciaExiste,
    evidencia === '' ? 'la corrección no cita evidencia' : `${evidencia}${evidenciaEsRuta ? (evidenciaExiste ? ' (existe)' : ' (no existe)') : ' (es una afirmación, no una ruta)'}`,
    'una ruta que exista en el proyecto',
    'sin evidencia comprobable, lo que cambia no está demostrado: lo juzga una persona');

  // 4 · El disparador no cambia. `description`, `whenToUse` y `tags` deciden a quién sirve la skill.
  if (vigente !== null) {
    const antes = disparadorDe(null, readFileSync(join(vigente.dir, 'SKILL.md'), 'utf8'));
    let despues = { description: '', whenToUse: '', tags: '' };
    try { despues = disparadorDe(meta, readFileSync(join(root, 'projects', key, 'proposed', id, 'SKILL.md'), 'utf8')); } catch { /* sin fichero no hay medida */ }
    const cambiado = antes.description !== despues.description || antes.whenToUse !== despues.whenToUse || antes.tags !== despues.tags;
    anota('disparador', !cambiado,
      cambiado ? 'cambia description/whenToUse/tags' : 'description, whenToUse y tags se conservan',
      'sin cambios',
      'un cambio de disparador cambia a quién sirve la skill y no es una corrección de forma');
  } else {
    anota('disparador', false, 'no medible sin versión vigente', 'sin cambios', '');
  }

  // 5 · La capa de seguridad: cero bloqueos **y cero avisos**. Un aviso es una decisión, y aquí no hay humano.
  const seguridad = escanear({
    id,
    body: (() => { try { return readFileSync(join(root, 'projects', key, 'proposed', id, 'SKILL.md'), 'utf8'); } catch { return ''; } })(),
    ficheros: Object.fromEntries((meta?.references ?? []).map((r) => {
      try { return [String(r.path), readFileSync(join(root, 'projects', key, 'proposed', id, r.path), 'utf8')]; } catch { return [String(r.path), '']; }
    })),
  });
  const hallazgos = seguridad.bloqueos.length + seguridad.avisos.length;
  anota('seguridad', hallazgos === 0,
    `${seguridad.bloqueos.length} bloqueo(s) · ${seguridad.avisos.length} aviso(s)`,
    '0 y 0',
    'la promoción automática no toca nada que la capa de seguridad marque, ni para avisar');

  // 5b · El diff tiene que existir. Si `meta.diff` falta, la puerta de tamaño mide cero y **parece** que
  // pasa: esa es la diferencia entre «no hay cambio» y «no se pudo medir», y aquí no se confunden. Medido:
  // una propuesta real traía `diff.lineas` como número y el lector pedía `.length` — cero líneas en todas.
  const hayDiff = meta?.diff != null && typeof meta.diff === 'object';
  anota('diff-medido', hayDiff,
    hayDiff ? 'la propuesta trae su diff contra la base' : 'la propuesta no trae diff: el tamaño no es medible',
    'diff presente y legible',
    'sin diff no se puede acotar el cambio, y una promoción automática es acotada o no es automática');

  // 6 · Las nueve pruebas de la promoción, con sus números. No se reimplementan: es la misma vara.
  let regresion = { ok: false, pruebas: [] };
  try {
    regresion = pruebasDeRegresion(id, key, meta, { root, ...(curated ? { curated } : {}), ...limites });
  } catch (error) {
    anota('regresion', false, `no se pudo medir: ${error.message}`, 'las nueve en verde', '');
  }
  for (const p of regresion.pruebas) {
    medidas.push({ regla: p.nombre, pasa: p.ok === true, observado: p.detalle, umbral: 'se cumple', detalle: '' });
  }

  const fallan = medidas.filter((m) => !m.pasa);
  const apto = fallan.length === 0 && regresion.ok === true;
  const resumen = apto
    ? `auto-actualizable: ${medidas.length} medidas en verde (nivel ${nivel}, ${seguridad.bloqueos.length + seguridad.avisos.length} avisos de seguridad)`
    : `requiere humano: ${fallan.map((m) => `${m.regla} (${m.observado})`).slice(0, 4).join(' · ')}`;
  return { apto, medidas, fallan: fallan.map((m) => m.regla), resumen, nivel };
}

/** El texto de las medidas, para la CLI y para el listado: una sola redacción, tres superficies. */
export function textoDeMedidas(veredicto) {
  if (!veredicto) return '';
  const lineas = [veredicto.apto ? 'APTO para actualizarse solo' : 'NO apto: lo decide una persona', veredicto.resumen, ''];
  for (const m of veredicto.medidas) {
    lineas.push(`  ${m.pasa ? 'pasa ' : 'FALLA'} ${m.regla}: ${m.observado}${m.pasa ? '' : ` (se exige ${m.umbral})`}`);
  }
  return lineas.join('\n');
}
