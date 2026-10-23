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
import { t } from './i18n/index.mjs';

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
  /**
   * Anota una medida: el **valor medido** (`observado`, `umbral`, `detalle`) se guarda tal cual -es el dato, y
   * las pruebas lo afirman- y al lado viaja su **representacion** (`observadoCode`/`observadoParams`, etc.),
   * que es lo unico que se traduce al pintarlo. Una medida sin codigo se pinta con su texto: un dato raro no se
   * convierte en una frase inventada.
   */
  const anota = (regla, pasa, observado, umbral, detalle = '', codigos = {}) => {
    medidas.push({
      regla,
      pasa: pasa === true,
      observado,
      umbral,
      detalle,
      ...codigos.obs === undefined ? {} : { observadoCode: codigos.obs[0], observadoParams: codigos.obs[1] ?? {} },
      ...codigos.th === undefined ? {} : { umbralCode: Array.isArray(codigos.th) ? codigos.th[0] : codigos.th },
      ...codigos.th === undefined || !Array.isArray(codigos.th) ? {} : { umbralParams: codigos.th[1] ?? {} },
      ...codigos.det === undefined ? {} : { detalleCode: codigos.det },
    });
  };
  const opts = { root, ...(curated ? { curated } : {}) };

  // 1 · Tiene que ser una ACTUALIZACIÓN. Una skill nueva es conocimiento nuevo: la confirma un humano.
  const vigente = vigenteDe(id, key, opts);
  anota('es-actualizacion', vigente !== null,
    vigente === null ? 'no hay versión vigente con ese id' : `${vigente.state} · ${vigente.hash.slice(0, 12)}`,
    'una versión vigente (aprobada, apagada o publicada)',
    'una skill nueva no se activa sola: la confirmacion de conocimiento nuevo es humana',
    {
      obs: vigente === null ? ['auto.obs.no-current'] : ['auto.obs.current', { state: vigente.state, hash: vigente.hash.slice(0, 12) }],
      th: 'auto.th.current',
      det: 'auto.det.new-skill',
    });

  // 2 · El nivel declarado por el arreglo. Sin `repair` no hay nivel: lo más delicado.
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(root, 'projects', key, 'proposed', id, 'meta.json'), 'utf8')); } catch { meta = null; }
  const nivel = typeof meta?.repair?.nivel === 'number' ? meta.repair.nivel : NIVEL_QUE_EXIGE_HUMANO;
  anota('nivel', nivel <= NIVEL_MAXIMO_AUTOMATICO,
    meta?.repair?.nivel === undefined ? `sin nivel declarado → ${NIVEL_QUE_EXIGE_HUMANO}` : `nivel ${nivel}`,
    `≤ ${NIVEL_MAXIMO_AUTOMATICO}`,
    'el nivel 3 -seguridad, permisos, secretos, aislamiento, facturacion- exige humano, y un parche sin nivel se trata como 3',
    {
      obs: meta?.repair?.nivel === undefined ? ['auto.obs.no-level', { nivel: NIVEL_QUE_EXIGE_HUMANO }] : ['auto.obs.level', { nivel }],
      th: ['auto.th.level', { max: NIVEL_MAXIMO_AUTOMATICO }],
      det: 'auto.det.level',
    });

  // 3 · La evidencia de la corrección tiene que poder comprobarse. Una afirmación del modelo no vale.
  const evidencia = String(meta?.revision?.evidence ?? '').trim();
  const evidenciaEsRuta = evidencia !== '' && !/\s/.test(evidencia) && (/[\\/]/.test(evidencia) || /\.[A-Za-z0-9]{1,8}$/.test(evidencia));
  const evidenciaExiste = evidenciaEsRuta && typeof cwd === 'string' && cwd.trim() !== '' && existsSync(resolve(cwd, evidencia));
  anota('evidencia-observada', evidenciaExiste,
    evidencia === '' ? 'la corrección no cita evidencia' : `${evidencia}${evidenciaEsRuta ? (evidenciaExiste ? ' (existe)' : ' (no existe)') : ' (es una afirmación, no una ruta)'}`,
    'una ruta que exista en el proyecto',
    'sin evidencia comprobable, lo que cambia no esta demostrado: lo juzga una persona',
    {
      obs: evidencia === ''
        ? ['auto.obs.no-evidence']
        : [evidenciaEsRuta ? (evidenciaExiste ? 'auto.obs.evidence-exists' : 'auto.obs.evidence-missing') : 'auto.obs.evidence-claim', { ruta: evidencia }],
      th: 'auto.th.evidence',
      det: 'auto.det.evidence',
    });

  // 4 · El disparador no cambia. `description`, `whenToUse` y `tags` deciden a quién sirve la skill.
  if (vigente !== null) {
    const antes = disparadorDe(null, readFileSync(join(vigente.dir, 'SKILL.md'), 'utf8'));
    let despues = { description: '', whenToUse: '', tags: '' };
    try { despues = disparadorDe(meta, readFileSync(join(root, 'projects', key, 'proposed', id, 'SKILL.md'), 'utf8')); } catch { /* sin fichero no hay medida */ }
    const cambiado = antes.description !== despues.description || antes.whenToUse !== despues.whenToUse || antes.tags !== despues.tags;
    anota('disparador', !cambiado,
      cambiado ? 'cambia description/whenToUse/tags' : 'description, whenToUse y tags se conservan',
      'sin cambios',
      'un cambio de disparador cambia a quién sirve la skill y no es una corrección de forma',
      {
        obs: [cambiado ? 'auto.obs.trigger-changed' : 'auto.obs.trigger-kept'],
        th: 'auto.th.trigger',
        det: 'auto.det.trigger',
      });
  } else {
    anota('disparador', false, 'no medible sin versión vigente', 'sin cambios', '',
      { obs: ['auto.obs.unmeasurable'], th: 'auto.th.trigger' });
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
    'la promocion automatica no toca nada que la capa de seguridad marque, ni para avisar',
    {
      obs: ['auto.obs.security', { bloqueos: seguridad.bloqueos.length, avisos: seguridad.avisos.length }],
      th: 'auto.th.security',
      det: 'auto.det.security',
    });

  // 5b · El diff tiene que existir. Si `meta.diff` falta, la puerta de tamaño mide cero y **parece** que
  // pasa: esa es la diferencia entre «no hay cambio» y «no se pudo medir», y aquí no se confunden. Medido:
  // una propuesta real traía `diff.lineas` como número y el lector pedía `.length` — cero líneas en todas.
  const hayDiff = meta?.diff != null && typeof meta.diff === 'object';
  anota('diff-medido', hayDiff,
    hayDiff ? 'la propuesta trae su diff contra la base' : 'la propuesta no trae diff: el tamaño no es medible',
    'diff presente y legible',
    'sin diff no se puede acotar el cambio, y una promocion automatica es acotada o no es automatica',
    {
      obs: [hayDiff ? 'auto.obs.diff-present' : 'auto.obs.diff-missing'],
      th: 'auto.th.diff',
      det: 'auto.det.diff',
    });

  // 6 · Las nueve pruebas de la promoción, con sus números. No se reimplementan: es la misma vara.
  let regresion = { ok: false, pruebas: [] };
  try {
    regresion = pruebasDeRegresion(id, key, meta, { root, ...(curated ? { curated } : {}), ...limites });
  } catch (error) {
    anota('regresion', false, `no se pudo medir: ${error.message}`, 'las nueve en verde', '',
      { obs: ['auto.obs.unmeasured', { message: error.message }], th: 'auto.th.regression' });
  }
  for (const p of regresion.pruebas) {
    // La novena vara es la misma que usa `promover`, y su detalle ya trae su representacion: se hereda tal
    // cual para no tener dos redacciones de lo mismo.
    medidas.push({
      regla: p.nombre,
      pasa: p.ok === true,
      observado: p.detalle,
      umbral: 'se cumple',
      detalle: '',
      ...p.detalleCode === undefined ? {} : { observadoCode: p.detalleCode, observadoParams: p.detalleParams ?? {} },
      umbralCode: 'auto.th.met',
    });
  }

  const fallan = medidas.filter((m) => !m.pasa);
  const apto = fallan.length === 0 && regresion.ok === true;
  const resumen = apto
    ? `auto-actualizable: ${medidas.length} medidas en verde (nivel ${nivel}, ${seguridad.bloqueos.length + seguridad.avisos.length} avisos de seguridad)`
    : `requiere humano: ${fallan.map((m) => `${m.regla} (${m.observado})`).slice(0, 4).join(' · ')}`;
  // El resumen es presentacion: lleva su codigo al lado para poder decirlo en el idioma de quien lee, y el texto
  // se conserva porque es lo que afirman las pruebas y lo que viaja en el objeto.
  const resumenCode = apto ? 'cli.auto.summary-ready' : 'cli.auto.summary-human';
  const resumenParams = apto
    ? { medidas: medidas.length, nivel, avisos: seguridad.bloqueos.length + seguridad.avisos.length }
    : { fallos: fallan.map((m) => m.regla).join(', ') };
  return {
    apto,
    medidas,
    fallan: fallan.map((m) => m.regla),
    resumen,
    resumenCode,
    resumenParams,
    nivel,
    avisosSeguridad: seguridad.bloqueos.length + seguridad.avisos.length,
  };
}

/**
 * El texto de las medidas, para la CLI y para el listado: una sola redaccion, tres superficies.
 *
 * El **marco** y la **frase de la medida** son presentacion y viven en el catalogo: si la medida trae su codigo
 * (`observadoCode` / `umbralCode`) se dice en el idioma de quien lee; si no lo trae, se pinta el valor medido tal
 * cual. `regla` es un **codigo interno** -la clave con la que el motor y el diario nombran la vara- y se imprime
 * como tal: traducirlo romperia la correspondencia con `fallan` y con el historial.
 */
export function textoDeMedidas(veredicto) {
  if (!veredicto) return '';
  const resumen = veredicto.apto
    ? t('cli.auto.summary-ready', { medidas: veredicto.medidas.length, nivel: veredicto.nivel, avisos: veredicto.avisosSeguridad })
    : t('cli.auto.summary-human', { fallos: veredicto.fallan.join(', ') });
  const lineas = [t(veredicto.apto ? 'cli.auto.verdict-ready' : 'cli.auto.verdict-human'), resumen, ''];
  const frase = (codigo, params, crudo) => (typeof codigo === 'string' ? t(codigo, params ?? {}) : crudo);
  for (const m of veredicto.medidas) {
    lineas.push(t(m.pasa ? 'cli.auto.measure-pass' : 'cli.auto.measure-fail', {
      regla: m.regla,
      observado: frase(m.observadoCode, m.observadoParams, m.observado),
      umbral: frase(m.umbralCode, m.umbralParams, m.umbral),
    }));
  }
  return lineas.join('\n');
}
