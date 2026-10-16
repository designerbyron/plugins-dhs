/**
 * La promoción: aplicar y activar una corrección, con pruebas delante y reversión detrás.
 *
 * ── La regla que gobierna este fichero ──────────────────────────────────────────────────────────
 *
 * **Nada se activa solo por defecto.** `NIVELES_POR_DEFECTO` está vacío: el motor prepara, prueba y espera.
 * Activar exige que el nivel de esa corrección esté en una lista explícita, y esa lista nunca puede incluir
 * el nivel 3 —ahí está la seguridad, los permisos, los secretos, el aislamiento y la facturación—: eso es de
 * una persona, con la propuesta delante.
 *
 * Las cuatro cosas que no se le piden a la confianza del modelo y sí a la medición:
 *
 * 1. **Pruebas de regresión antes de activar**, independientes de quien propuso el parche: la puerta, la
 *    vigencia de la base, el inventario de conocimiento (nada desaparece sin justificarlo), el alcance y el
 *    tamaño del diff, y los ciclos.
 * 2. **Cerrojo por skill**: dos procesos no promocionan el mismo id a la vez, y si el cerrojo está tomado se
 *    dice quién y desde cuándo en vez de esperar en silencio.
 * 3. **Verificación después de escribir**: la versión publicada se relee y se compara por huella con lo que
 *    se propuso. Aprobar no es un `rename` y confiar.
 * 4. **Reversión comprobable**: si esa verificación falla, se deshace el cambio y la versión anterior vuelve
 *    **con su misma huella**; y si la restauración no cuadrara, se dice tal cual en vez de darlo por bueno.
 *
 * El registro de todo esto vive en el diario del proyecto (`journal.jsonl`), que es lo que permite auditar
 * por qué se activó algo, con qué evidencia y qué se probó.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import {
  approve, checkProposal, defaultRoot, folderHash, materialPreservado, parseFrontmatter, projectKey,
  treeOf, treeOfConErrores, vigenteDe,
} from './compiler.mjs';
import { inventario, inventarioPerdido } from './repair.mjs';

/**
 * Qué niveles se activan solos **si nadie dice otra cosa**. Vacío, y a propósito: la promoción automática es
 * una decisión que se toma por escrito (configuración explícita), no un valor por omisión que nadie revisó.
 */
export const NIVELES_POR_DEFECTO = [];
/** El nivel 3 no se promociona nunca automáticamente, ni aunque alguien lo ponga en la lista. */
export const NIVEL_QUE_EXIGE_HUMANO = 3;

/** Dónde vive el diario de un proyecto. */
export function diarioDe(key, { root = defaultRoot() } = {}) {
  return join(root, 'projects', key, 'journal.jsonl');
}

/**
 * Escribe una entrada del diario. Es la parte que hace auditable la decisión: sin esto, «se promocionó» es
 * una afirmación sin respaldo.
 */
export function anotarEnDiario(key, entrada, { root = defaultRoot(), now = new Date().toISOString() } = {}) {
  const fichero = diarioDe(key, { root });
  try {
    mkdirSync(dirname(fichero), { recursive: true });
    writeFileSync(fichero, `${JSON.stringify({ at: now, ...entrada })}\n`, { flag: 'a' });
    return true;
  } catch {
    // Un diario que no se puede escribir no puede tumbar la operación, pero tampoco se calla: el resultado
    // de la promoción lleva `registrado: false` y quien lo mire lo verá.
    return false;
  }
}

/** Lee el diario entero de un proyecto. */
export function leerDiario(key, { root = defaultRoot() } = {}) {
  const fichero = diarioDe(key, { root });
  if (!existsSync(fichero)) return [];
  return readFileSync(fichero, 'utf8').split('\n').filter(Boolean).map((linea) => {
    try { return JSON.parse(linea); } catch { return { at: null, corrupta: linea.slice(0, 120) }; }
  });
}

/**
 * Un cerrojo por skill, con `O_EXCL`: si existe, hay otra operación en curso.
 *
 * No se rompe un cerrojo ajeno por viejo que sea: se informa de quién lo dejó y desde cuándo, y se para. Un
 * cerrojo roto a la fuerza es exactamente cómo se pierden dos versiones de trabajo.
 */
export function conCerrojo(root, key, id, fn) {
  const carpeta = join(root, 'locks');
  const fichero = join(carpeta, `${key}--${id.replace(/[^\w.-]/g, '_')}.lock`);
  let fd = null;
  try {
    mkdirSync(carpeta, { recursive: true });
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

/**
 * Las pruebas que tienen que pasar **antes** de activar nada. No las propone el modelo: las ejecuta el mismo
 * sistema que va a activar, y cada una dice qué comprobó y con qué valores.
 *
 * @returns `{ ok, pruebas }` — `pruebas` es `[{ nombre, ok, detalle }]`.
 */
export function pruebasDeRegresion(id, key, meta, { root = defaultRoot(), curated = null, maxLineas = 200, maxFicheros = 5, alcance = null, ciclosMaximos = 3 } = {}) {
  const pruebas = [];
  const anota = (nombre, ok, detalle) => pruebas.push({ nombre, ok, detalle });
  const opts = { root, ...(curated ? { curated } : {}) };

  // 1. La puerta: exactamente la misma que decide una aprobación.
  const puerta = checkProposal(id, key, opts);
  anota('puerta', puerta.ok, puerta.ok ? 'la propuesta pasa la puerta de calidad' : `no pasa: ${puerta.errors.slice(0, 3).join(' | ')}`);

  // 2. La base: ¿sigue siendo la versión sobre la que se preparó?
  const vigente = vigenteDe(id, key, opts);
  const base = meta?.base ?? null;
  const baseOk = base !== null && vigente !== null && vigente.hash === base.hash;
  anota('base-vigente', baseOk, base === null
    ? 'la propuesta no declara sobre qué versión se preparó'
    : vigente === null
      ? `la versión vigente (${base.state}, ${base.hash.slice(0, 12)}) ya no está`
      : `base ${base.hash.slice(0, 12)} vs vigente ${vigente.hash.slice(0, 12)}`);

  // 3. El conocimiento: nada desaparece del inventario sin que se declare.
  let conservacion = { ok: false, detalle: 'no se pudo leer la versión vigente' };
  let contenidoBase = '';
  if (vigente !== null) {
    const { body } = parseFrontmatter(readFileSync(join(vigente.dir, 'SKILL.md'), 'utf8'));
    contenidoBase = body;
    const { body: cuerpoPropuesto } = parseFrontmatter(readFileSync(puerta.file, 'utf8'));
    const referenciasPropuestas = (puerta.meta?.references ?? []).map((r) => {
      try { return readFileSync(join(dirname(puerta.file), r.path), 'utf8'); } catch { return ''; }
    }).join('\n');
    const perdido = inventarioPerdido(inventario(contenidoBase), inventario(`${cuerpoPropuesto}\n${referenciasPropuestas}`));
    const justificado = (puerta.meta?.revision?.removed ?? '').trim();
    const claves = Object.keys(perdido);
    const graves = claves.filter((c) => c !== 'numeros' && c !== 'pasos');
    conservacion = {
      ok: claves.length === 0 || (graves.length === 0 && justificado.length > 0),
      detalle: claves.length === 0
        ? 'el inventario del conocimiento se conserva entero'
        : `desaparece ${claves.map((c) => `${c}: ${perdido[c].slice(0, 3).join(', ')}`).join(' · ')} — justificación: ${justificado ? 'presente' : 'AUSENTE'}`,
      perdido,
    };
  }
  anota('conservacion', conservacion.ok, conservacion.detalle);

  // 4. El alcance: lo que la propuesta escribe tiene que ser de la skill y nada más. Las rutas se comparan
  //    **relativas a la carpeta de la propuesta**: comparar absolutas contra una lista relativa marcaría
  //    como «fuera de alcance» el propio SKILL.md, y una prueba que siempre falla no prueba nada.
  const raizPropuesta = dirname(puerta.file);
  // Lo permitido no es una lista fija: es **lo que la skill ya tenía**, más `references/`. Una skill
  // vendorizada lleva su `upstream/` y su `provenance.json` dentro, y marcarlos como «fuera de alcance»
  // bloqueaba toda corrección de una vendorizada —que es justo lo que la auditoría reporta.
  const deLaViva = vigente !== null ? treeOfConErrores(vigente.dir).files.map((f) => f.split(sep).join('/')) : [];
  const permitido = alcance ?? [...deLaViva, 'SKILL.md', 'meta.json'];
  // Los ficheros que la propuesta **tiene de verdad**, no los que su meta declara: un fichero colado en la
  // carpeta no aparece en `meta.references`, y mirando sólo el meta se escaparía del control de alcance.
  const escritos = treeOfConErrores(raizPropuesta).files.map((f) => f.split(sep).join('/'));
  const fuera = escritos.filter((r) => !permitido.includes(r) && !r.startsWith('references/'));
  anota('alcance', fuera.length === 0, fuera.length === 0
    ? `todo lo escrito vive en la skill (${escritos.length} fichero(s): ${escritos.slice(0, 4).join(', ')}${escritos.length > 4 ? '…' : ''})`
    : `fuera del alcance autorizado: ${fuera.join(', ')}`);

  // 5. El tamaño del diff: una promoción automática es acotada o no es automática. Y se cuentan dos cosas
  //    distintas, porque no son el mismo riesgo: **trocear** el propio cuerpo (el conocimiento cambia de
  //    sitio dentro de la skill, con su vínculo, y su número va en proporción a lo que haya que sacar) y
  //    **añadir** material de fuera (que sí se acota en seco: cinco piezas nuevas por corrección).
  const lineas = (meta?.diff?.lineas?.anadidas?.length ?? 0) + (meta?.diff?.lineas?.eliminadas?.length ?? 0);
  const movidas = meta?.repair?.movidas?.length ?? 0;
  const exceso = Math.max(0, (meta?.repair?.bytesAntes ?? 0) - (meta?.repair?.umbral ?? 24000));
  const maxMovidas = Math.max(1, 1 + Math.floor(exceso / 5000)); // un trozo por cada 5.000 caracteres de exceso, más uno
  const nuevas = Math.max(0, (meta?.diff?.references?.anadidas?.length ?? 0) - movidas) + (meta?.diff?.references?.modificadas?.length ?? 0);
  anota('tamano', lineas <= maxLineas && nuevas <= maxFicheros && movidas <= maxMovidas,
    `diff de ${lineas} línea(s) (máximo ${maxLineas}) · ${nuevas} pieza(s) de material nuevo (máximo ${maxFicheros}) · ${movidas} trozo(s) que salen del cuerpo (máximo ${maxMovidas})`);

  // 6. La reversibilidad: la versión anterior tiene que poder volver con su huella.
  const reversibles = vigente !== null ? folderHash(vigente.dir) === vigente.hash : false;
  anota('reversible', reversibles, reversibles
    ? `la versión vigente (${vigente.hash.slice(0, 12)}) está entera y se puede reponer`
    : 'la versión vigente no se puede leer entera: sin ella no hay vuelta atrás');

  // 7. Los ciclos: la misma corrección repetida sin progreso no se promociona sola otra vez.
  const reglas = [...(meta?.repair?.reglas ?? [])].sort().join('+');
  const previas = leerDiario(key, { root }).filter((e) => e.id === id && e.decision === 'promovida');
  const seguidas = previas.slice(-ciclosMaximos).filter((e) => [...(e.reglas ?? [])].sort().join('+') === reglas).length;
  anota('sin-ciclos', seguidas < ciclosMaximos, seguidas < ciclosMaximos
    ? `${seguidas} promoción(es) previas de ${reglas || '(sin reglas)'}`
    : `la misma corrección (${reglas}) se ha promocionado ${seguidas} veces seguidas: puede ser un ciclo sin progreso, y eso lo mira una persona`);

  // 8. El material: la propuesta no puede perder ni un fichero de la skill viva. Es la comprobación más
  //    importante de todas, porque una pérdida aquí es conocimiento que se va sin que nadie lo note.
  if (vigente !== null) {
    const deLaViva = treeOfConErrores(vigente.dir).files.filter((f) => f !== 'meta.json');
    const deLaPropuesta = [relative(raizPropuesta, puerta.file).split(sep).join('/'), ...(puerta.meta?.references ?? []).map((r) => String(r.path).split(sep).join('/'))]
      .filter((f) => f !== 'meta.json');
    const perdidos = deLaViva.filter((f) => !deLaPropuesta.includes(f));
    // Un fichero puede desaparecer de `meta.references` y seguir en la carpeta: eso cuenta como conservado.
    const enCarpeta = treeOfConErrores(raizPropuesta).files.filter((f) => f !== 'meta.json');
    const deVerdad = perdidos.filter((f) => !enCarpeta.includes(f));
    anota('sin-perdida-de-ficheros', deVerdad.length === 0, deVerdad.length === 0
      ? `la propuesta conserva los ${deLaViva.length} fichero(s) de la versión viva`
      : `la propuesta NO lleva: ${deVerdad.join(', ')} — una promoción no puede perder material de la skill`);
  }

  // 9. Material eliminado: si se quita algo, tiene que seguir conservado.
  const eliminadas = (meta?.diff?.references?.eliminadas ?? []).map((r) => (typeof r === 'string' ? r : r.path));
  if (eliminadas.length > 0 && vigente !== null) {
    const preservado = materialPreservado(vigente.dir, eliminadas, {
      body: parseFrontmatter(readFileSync(puerta.file, 'utf8')).body,
      references: (puerta.meta?.references ?? []).map((r) => r.path),
    });
    anota('material-preservado', preservado.ok, preservado.ok
      ? `el material retirado (${eliminadas.join(', ')}) sigue en la skill`
      : `se retira ${eliminadas.join(', ')} y no aparece en ninguna parte: eso pierde conocimiento`);
  }

  return { ok: pruebas.every((p) => p.ok), pruebas };
}

/**
 * Promociona una propuesta: la activa si su nivel está autorizado y todo pasa; si no, la deja esperando.
 *
 * @param niveles - qué niveles pueden activarse solos. Por defecto **ninguno**.
 * @returns `{ status, nivel, regresion, ... }` con `status` en `promoted` · `pending` · `regression` ·
 *   `missing` · `no-propuesta` · `reverted` · `critical` · `locked`.
 */
export function promover(id, key, {
  root = defaultRoot(), curated = null, cwd = null, niveles = NIVELES_POR_DEFECTO,
  maxLineas = 200, maxFicheros = 5, alcance = null, por = 'motor', now = new Date().toISOString(),
  verificador = null,
} = {}) {
  const opts = { root, ...(curated ? { curated } : {}) };
  const dirPropuesta = join(root, 'projects', key, 'proposed', id);
  const fichero = join(dirPropuesta, 'SKILL.md');
  if (!existsSync(fichero)) {
    return { status: 'no-propuesta', id, reason: `no hay ninguna propuesta ${id} en ${key}: la promoción activa lo que ya está propuesto` };
  }
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(dirPropuesta, 'meta.json'), 'utf8')); } catch { meta = null; }
  // Sin `repair` declarado no hay nivel: se trata como lo más delicado. Un parche sin nivel no puede colarse
  // por la puerta de atrás de la automatización.
  const nivel = typeof meta?.repair?.nivel === 'number' ? meta.repair.nivel : NIVEL_QUE_EXIGE_HUMANO;
  const reglas = meta?.repair?.reglas ?? [];

  const cerrado = conCerrojo(root, key, id, () => {
    // Las pruebas se corren SIEMPRE, aunque no se autorice: son la información de la decisión, y el humano
    // que apruebe a mano merece verlas igual.
    const regresion = pruebasDeRegresion(id, key, meta, { root, curated, maxLineas, maxFicheros, alcance });
    const autorizado = nivel <= 2 && niveles.includes(nivel);

    // ── El lote: la vía automática no activa una parte de un cambio que toca varias skills ─────────
    // La vía humana (promoción no autorizada) NO pasa por aquí: aprobar dos de tres es una decisión, no un
    // accidente. Lo que no puede pasar es que la automatización deje la biblioteca contando dos historias.
    const grupo = meta?.group ?? null;
    if (autorizado && grupo) {
      const bloqueoLote = comprobarLote(grupo, propuestasDelLote(grupo.id, key, { root }), { key, root, curated, maxLineas, maxFicheros, alcance });
      if (bloqueoLote) {
        anotarEnDiario(key, { id, key, group: grupo.id, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas, decision: 'espera-lote', por, hashResultante: null, hashAnterior: null, why: bloqueoLote }, { root, now });
        return { status: 'pending', id, nivel, grupo: grupo.id, regresion, reason: bloqueoLote };
      }
    }

    if (!autorizado) {
      const decision = nivel > 2 ? 'espera-humano' : 'promocion-desactivada';
      const reason = nivel > 2
        ? `el nivel ${nivel} de esta corrección exige aprobación humana: la propuesta queda pendiente y con sus pruebas hechas`
        : `el nivel ${nivel} no está en la lista de niveles autorizados (${niveles.length ? niveles.join(', ') : 'ninguno'}): la promoción automática está apagada`;
      anotarEnDiario(key, { id, key, group: grupo?.id ?? null, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas, decision, por, hashResultante: null, hashAnterior: null, why: reason }, { root, now });
      return { status: 'pending', id, nivel, regresion, reason };
    }
    if (!regresion.ok) {
      const reason = `no se activa: ${regresion.pruebas.filter((p) => !p.ok).map((p) => p.nombre).join(', ')}`;
      anotarEnDiario(key, { id, key, group: grupo?.id ?? null, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas, decision: 'rechazada-por-regresion', por, hashResultante: null, hashAnterior: null, why: reason }, { root, now });
      return { status: 'regression', id, nivel, regresion, reason };
    }

    // ── A partir de aquí se escribe. Todo lo que siga está dentro de esta guarda. ──────────────────
    const vigente = vigenteDe(id, key, opts);
    const hashAnterior = vigente?.hash ?? null;
    const huellaPropuesta = folderHash(dirPropuesta);
    let resultado = null;
    try {
      resultado = approve(id, key, opts); // aparta la anterior en `superseded/` y deja la nueva activa
    } catch (error) {
      return { status: 'critical', id, nivel, regresion, reason: `la activación lanzó: ${error.message}`, hashAnterior };
    }
    if (!resultado?.ok) {
      return { status: 'critical', id, nivel, regresion, reason: `no se pudo activar: ${resultado?.reason ?? 'sin motivo'}`, hashAnterior };
    }

    // ── Verificación DESPUÉS de escribir: se relee y se compara por huella ────────────────────────
    const activada = join(root, 'projects', key, 'approved', id);
    const huellaActivada = folderHash(activada);
    const puertaTras = checkProposal(id, key, opts); // ya no hay propuesta: su fallo aquí no es un problema
    const problemas = [];
    if (huellaActivada !== huellaPropuesta) problemas.push(`lo publicado (${huellaActivada.slice(0, 12)}) no coincide con lo propuesto (${huellaPropuesta.slice(0, 12)})`);
    const metaActivada = (() => { try { return JSON.parse(readFileSync(join(activada, 'meta.json'), 'utf8')); } catch { return null; } })();
    if (metaActivada !== null && metaActivada.state !== 'approved') problemas.push(`el meta dice «${metaActivada.state}» en vez de approved`);
    if (!existsSync(join(activada, 'SKILL.md'))) problemas.push('no hay SKILL.md en la versión activada');
    if (metaActivada?.base?.hash && metaActivada.base.hash !== meta?.base?.hash) problemas.push('la versión publicada dice haberse construido sobre otra base');
    // Un integrador puede añadir sus propias comprobaciones (las de su proyecto, por ejemplo). Y sólo
    // pueden **añadir** problemas: ninguna comprobación externa puede autorizar lo que el motor no autorizó.
    if (typeof verificador === 'function') {
      try {
        for (const problema of verificador({ root, key, id, dir: activada, huellaActivada, huellaPropuesta, meta: metaActivada }) ?? []) problemas.push(String(problema));
      } catch (error) {
        problemas.push(`la comprobación externa lanzó: ${error.message}`);
      }
    }

    if (problemas.length === 0) {
      anotarEnDiario(key, { id, key, group: grupo?.id ?? null, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas, decision: 'promovida', por, hashResultante: huellaActivada, hashAnterior, superseded: resultado.superseded ?? null }, { root, now });
      return { status: 'promoted', id, nivel, regresion, hashAnterior, hashResultante: huellaActivada, superseded: resultado.superseded ?? null };
    }

    // ── Reversión: volver a la versión anterior, con su huella ────────────────────────────────────
    const reverso = deshacer({ root, key, id, huellaActivada, hashAnterior, superseded: resultado.superseded ?? null });
    anotarEnDiario(key, {
      id, key, group: grupo?.id ?? null, nivel, reglas, base: meta?.base ?? null, diff: meta?.diff ?? null, pruebas: regresion.pruebas,
      decision: reverso.ok ? 'revertida' : 'reversion-fallida', por, hashResultante: reverso.hash ?? null, hashAnterior,
      why: problemas.join(' | '), reverso,
    }, { root, now });
    return reverso.ok
      ? {
        status: 'reverted', id, nivel, regresion, problems: problemas,
        hashAnterior, hashRestaurado: reverso.hash, hashApartado: reverso.huellaApartada, apartada: reverso.apartada,
        reason: `se activó y no cuadró (${problemas.join(' | ')}): se ha deshecho y la versión anterior está de vuelta, con su huella`,
      }
      : { status: 'critical', id, nivel, regresion, problems: problemas, reverso, hashAnterior, reason: 'no se pudo publicar bien NI deshacer: hace falta una persona. Nada más se ha tocado' };
  });

  if (cerrado?.ok === false && cerrado.reason?.startsWith('ya hay una operación')) return { status: 'locked', id, ...cerrado };
  return cerrado;
}

/**
 * Deshace una activación que no cuadró: la versión publicada se aparta (nunca se borra) y la anterior vuelve
 * a su sitio. La huella restaurada se **comprueba**: si no coincide, se dice.
 */
function deshacer({ root, key, id, huellaActivada, hashAnterior, superseded }) {
  const activada = join(root, 'projects', key, 'approved', id);
  const apartada = join(root, 'projects', key, 'superseded', `${id}-deshecho-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  try {
    mkdirSync(dirname(apartada), { recursive: true });
    renameSync(activada, apartada);
  } catch (error) {
    return { ok: false, reason: `no se pudo apartar la versión que no cuadró: ${error.message}` };
  }
  if (superseded === null || !existsSync(superseded)) {
    return { ok: false, reason: `no hay versión anterior que reponer (se esperaba en ${superseded ?? 'ninguna'})`, apartada };
  }
  try {
    mkdirSync(dirname(activada), { recursive: true });
    renameSync(superseded, activada);
  } catch (error) {
    return { ok: false, reason: `no se pudo reponer la versión anterior: ${error.message}`, apartada };
  }
  const hash = folderHash(activada);
  if (hashAnterior !== null && hash !== hashAnterior) {
    return { ok: false, reason: `la versión repuesta (${hash.slice(0, 12)}) no coincide con la anterior (${hashAnterior.slice(0, 12)})`, hash, apartada };
  }
  return { ok: true, hash, apartada, huellaApartada: huellaActivada };
}

/**
 * Las propuestas que forman un lote en un proyecto, leídas de su `meta.json` (que es el estado que el motor
 * consume). Se ordenan por id para que el resultado no dependa del orden del sistema de ficheros.
 */
export function propuestasDelLote(groupId, key, { root = defaultRoot() } = {}) {
  const dir = join(root, 'projects', key, 'proposed');
  let entradas = [];
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // Sólo «no existe la carpeta» significa «no hay propuestas». Cualquier otro error se **propaga**: un
    // fallo de programación no puede disfrazarse de lote vacío y dejar que la promoción siga adelante
    // creyendo que el lote está completo. Es la misma lección que `treeOf` → `treeOfConErrores`.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, entrada.name, 'meta.json'), 'utf8'));
      if (meta?.group?.id === groupId) out.push({ id: entrada.name, meta });
    } catch { /* una propuesta ilegible no entra en el lote: su problema saldrá por su propia puerta */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * ¿Está el lote entero, y entero **verificable**, como para activar una de sus partes sola?
 *
 * Un cambio que toca varias skills y se activa a medias deja la biblioteca contando dos historias distintas
 * — y es justo lo que el lote existe para evitar. Devuelve el motivo del bloqueo, o `null` si el lote está
 * completo y cada una de sus propuestas pasa su propia regresión.
 */
export function comprobarLote(grupo, propuestas, { key = null, root = defaultRoot(), curated = null, maxLineas = 200, maxFicheros = 5, alcance = null } = {}) {
  if (!grupo) return null;
  if (typeof grupo.esperadas !== 'number') {
    return `el lote «${grupo.id}» no declara cuántas propuestas lo forman («esperadas»): sin eso no se puede saber si falta alguna, y un lote no se activa a medias`;
  }
  if (propuestas.length !== grupo.esperadas) {
    return `el lote «${grupo.id}» declara ${grupo.esperadas} propuestas y solo hay ${propuestas.length} propuesta(s): un lote no se activa a medias (la vía humana puede activar lo que quiera, esta no)`;
  }
  for (const hermana of propuestas) {
    const regresion = pruebasDeRegresion(hermana.id, key ?? hermana.meta?.projectKey ?? null, hermana.meta, { root, curated, maxLineas, maxFicheros, alcance });
    if (!regresion.ok) {
      return `la hermana «${hermana.id}» del lote «${grupo.id}» no pasa su regresión (${regresion.pruebas.filter((p) => !p.ok).map((p) => p.nombre).join(', ')}): se arregla eso antes de activar ninguna`;
    }
  }
  return null;
}

/** El estado de las correcciones de un proyecto, tal y como quedó en el diario. */
export function historial(key, { root = defaultRoot(), id = null, grupo = null } = {}) {
  return leerDiario(key, { root })
    .filter((e) => (id === null ? true : e.id === id))
    .filter((e) => (grupo === null ? true : e.group === grupo))
    .map((e) => ({
      at: e.at, id: e.id, group: e.group ?? null, nivel: e.nivel, reglas: e.reglas ?? [], decision: e.decision,
      pruebas: (e.pruebas ?? []).map((p) => `${p.nombre}:${p.ok ? 'ok' : 'FALLA'}`),
      base: e.base?.hash ?? null, resultado: e.hashResultante ?? null, anterior: e.hashAnterior ?? null, why: e.why ?? null,
    }));
}

/** ¿Hay un ciclo? La misma corrección promocionada una y otra vez sin que el hallazgo se vaya. */
export function ciclos({ key, root = defaultRoot(), id = null, veces = 3 } = {}) {
  const promociones = leerDiario(key, { root }).filter((e) => e.decision === 'promovida' && (id === null || e.id === id));
  const porId = new Map();
  for (const e of promociones) {
    const clave = `${e.id}|${[...(e.reglas ?? [])].sort().join('+')}`;
    porId.set(clave, [...(porId.get(clave) ?? []), e.at]);
  }
  return [...porId.entries()]
    .filter(([, fechas]) => fechas.length >= veces)
    .map(([clave, fechas]) => ({ id: clave.split('|')[0], reglas: clave.split('|')[1], promociones: fechas.length, ultima: fechas.at(-1) }));
}

export { projectKey, treeOf };
