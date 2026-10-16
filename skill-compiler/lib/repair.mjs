/**
 * El motor de reparación: mira lo que la auditoría encontró y **prepara** la corrección.
 *
 * ── Qué puede hacer solo y qué no ───────────────────────────────────────────────────────────────
 *
 * El catálogo es una lista **cerrada**, y cada entrada declara su nivel de riesgo. Eso no es una etiqueta:
 * es lo que decide quién firma la activación.
 *
 * - **Nivel 1 — mecánico**: normalizar saltos de línea, quitar espacios al final de una línea, dejar un solo
 *   salto final. Son deterministas, idempotentes y **no cambian el significado**: el motor lo *comprueba* en
 *   vez de creérselo, comparando la forma canónica antes y después. Si esa comparación dijera que algo
 *   cambió, la transformación no sería de este nivel y se rechaza.
 * - **Nivel 2 — semántico acotado**: mover el material pesado de un cuerpo que pasa del techo a
 *   `references/`, dejando el vínculo en su sitio. El conocimiento sigue en la skill, se conserva entero,
 *   pero cambia dónde vive: por eso es una **propuesta**, y sólo se activa sola si su clase está
 *   explícitamente autorizada.
 * - **Nivel 3 — criterio**: redactar un disparador que falta, reescribir una descripción, tocar seguridad,
 *   permisos, secretos, aislamiento o facturación. Aquí el motor puede preparar y probar, pero **no
 *   activa nunca**: eso es de una persona.
 * - **No reparable**: lo que exigiría inventar conocimiento —una referencia que falta y nadie escribió, por
 *   ejemplo—. El motor **no inventa**: lo declara y lo deja en el informe para que lo resuelva quien tiene
 *   la evidencia.
 */
import { isUtf8 } from 'node:buffer';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  auditarCarpeta, cuerpoSinTitulo, defaultRoot, folderHash, parseFrontmatter, projectKey, propose,
  treeOfConErrores, vigenteDe,
} from './compiler.mjs';

// ── Nivel 1: las transformaciones mecánicas ──────────────────────────────────────────────────────

/**
 * Las únicas transformaciones que pueden aplicarse solas. Cada una es determinista, idempotente y no toca
 * el significado: quitar un `\r`, un espacio colgando o un salto de más no cambia lo que la skill dice.
 */
export const TRANSFORMACIONES = {
  'normalizar-saltos': {
    nivel: 1,
    describe: 'Saltos de línea canónicos (LF): un `\\r` de más no significa nada y ensucia cada diff',
    aplica: (texto) => texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
  },
  'quitar-espacios-finales': {
    nivel: 1,
    describe: 'Quita espacios y tabuladores al final de cada línea',
    aplica: (texto) => texto.split('\n').map((linea) => linea.replace(/[ \t]+$/, '')).join('\n'),
  },
  'un-salto-final': {
    nivel: 1,
    describe: 'Deja exactamente un salto de línea al final',
    aplica: (texto) => `${texto.replace(/\n+$/, '')}\n`,
  },
};

/**
 * La **forma canónica** de un texto: el resultado de aplicar todas las transformaciones mecánicas.
 *
 * Es la vara con la que se comprueba que una transformación de nivel 1 no cambió el significado: si el
 * canónico de antes y el de después son el mismo texto, lo único que cambió fue la forma.
 */
export function canonico(texto) {
  return Object.values(TRANSFORMACIONES).reduce((t, tr) => tr.aplica(t), String(texto ?? ''));
}

/**
 * Aplica las mecánicas a un texto y **dice qué hizo**.
 *
 * `significativoIgual` no es una promesa: es la comprobación. Si saliera falsa, la transformación no es de
 * nivel 1 y quien la aplicara tendría que pasar por el flujo de revisión.
 */
export function aplicarMecanicas(texto) {
  const antes = String(texto ?? '');
  const aplicadas = [];
  let actual = antes;
  for (const [nombre, tr] of Object.entries(TRANSFORMACIONES)) {
    const siguiente = tr.aplica(actual);
    if (siguiente !== actual) aplicadas.push(nombre);
    actual = siguiente;
  }
  return { texto: actual, aplicadas, significativoIgual: canonico(antes) === canonico(actual), cambio: antes !== actual };
}

// ── Nivel 2: mover el material pesado ────────────────────────────────────────────────────────────

/** Los encabezados de nivel 2 con su contenido, en orden. */
export function seccionesDe(cuerpo) {
  const lineas = String(cuerpo ?? '').split('\n');
  const trozos = [];
  let actual = null;
  for (const linea of lineas) {
    if (/^##[^#]/.test(linea)) {
      if (actual) trozos.push(actual);
      actual = { titulo: linea.replace(/^##\s*/, '').trim(), lineas: [linea] };
      continue;
    }
    if (actual) actual.lineas.push(linea);
  }
  if (actual) trozos.push(actual);
  return trozos.map((t) => ({ ...t, texto: t.lineas.join('\n'), bytes: Buffer.byteLength(t.lineas.join('\n')) }));
}

const slug = (texto) => String(texto ?? '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'material';

/**
 * El tope de material que una corrección automática puede sacar del cuerpo, **medido en bytes**.
 *
 * Se mide en bytes y no en trozos porque el trabajo que se delega al automático es el exceso, no su
 * troceado: con dos fórmulas distintas —una contando secciones al promocionar y otra contando bytes al
 * preparar— el motor preparaba parches que su propia puerta rechazaba, que es justo la «propuesta
 * condenada» que este repositorio prohíbe. Una sola fuente: la usan `moverMaterialPesado` al preparar y
 * `pruebasDeRegresion` al promocionar.
 *
 * `paso` es el tamaño del trozo más grande que hay que sacar: el corte es por secciones enteras y una
 * sección no se parte, así que el exceso solo no llega para cruzar el umbral —hace falta un trozo más—.
 * Sin ese margen, el motor pararía justo antes de cruzar y la puerta rechazaría el cuerpo por alto.
 *
 * @param bytesAntes - bytes del cuerpo de la versión viva sobre la que se corrige.
 * @param umbral - techo del cuerpo (`body-max` 24.000 · `body-budget` 8.000).
 * @param objetivo - a dónde quiere llegar el motor; por defecto, el umbral mismo.
 * @param paso - bytes del trozo mayor disponible, para poder cruzar con secciones enteras.
 */
export function topeDeMovimiento(bytesAntes, { umbral = 24000, objetivo = null, paso = 0 } = {}) {
  const antes = Number(bytesAntes ?? 0);
  // Por debajo del umbral no hay nada legítimo que sacar del cuerpo: el tope es cero, y una corrección que
  // mueva material ahí se rechaza en vez de colarse.
  if (antes <= Number(umbral ?? 24000)) return 0;
  // La distancia se mide al **objetivo** del motor (por defecto, el 80% del umbral), no al umbral: quedarse
  // justo por debajo del techo es lo que dejaba al cuerpo a un paso de cruzarlo, y con pasos discretos ese
  // paso no cabía en el tope.
  const destino = objetivo ?? Math.round(umbral * 0.8);
  return Math.max(0, antes - destino) + Math.max(0, Number(paso) || 0);
}

/**
 * Mueve la sección más pesada a `references/` y deja el vínculo en su lugar.
 *
 * Se elige **la más larga** y no «la que parezca de consulta»: eso sería un juicio, y un juicio no puede
 * aplicarse solo. Lo que sí es determinista es el criterio de tamaño, y el corte se hace de modo que el
 * cuerpo baje del objetivo —hasta donde llegue `topeBytes`, que es lo que la puerta admite—. El material
 * no se reescribe: viaja entero, con su encabezado.
 *
 * @returns `{ body, references, movidas, bodyBytes, bytesMovidos, alcanzoObjetivo }`, o `null` si no hace
 *   falta o no se puede mover nada (una sola sección, o la primera candidata ya pasa del tope).
 */
export function moverMaterialPesado({ id, body, budget = 24000, objetivo = 20000, topeBytes = Infinity }) {
  const original = String(body ?? '');
  if (Buffer.byteLength(original) <= budget) return null;
  const secciones = seccionesDe(original).sort((a, b) => b.bytes - a.bytes);
  if (secciones.length < 2) return null; // sin una segunda sección no hay nada que mover sin dejar el cuerpo vacío
  const movidas = [];
  let restante = original;
  let bytesMovidos = 0;
  const references = [];
  for (const seccion of secciones) {
    if (Buffer.byteLength(restante) <= objetivo) break;
    // El cuerpo no puede quedarse sin procedimiento: como mínimo tiene que quedar una sección.
    if (seccionesDe(restante).length < 2) break;
    // El tope acota la corrección **entera**: pasarlo la haría impromovible, y preparar algo que la puerta
    // va a rechazar no es preparar, es prometer en falso.
    if (bytesMovidos + seccion.bytes > topeBytes) break;
    const ruta = `references/${slug(seccion.titulo)}.md`;
    if (references.some((r) => r.path === ruta)) continue;
    const contenido = `${seccion.texto.replace(/\s+$/, '')}\n`;
    references.push({ path: ruta, content: contenido });
    restante = restante.replace(seccion.texto, `## ${seccion.titulo}\n\nEl detalle está en \`${ruta}\`: léelo antes de aplicar esta parte.\n`).replace(/\n{3,}/g, '\n\n');
    movidas.push({ titulo: seccion.titulo, ruta, bytes: seccion.bytes });
    bytesMovidos += seccion.bytes;
  }
  if (movidas.length === 0) return null;
  const bodyBytes = Buffer.byteLength(restante);
  return { body: restante, references, movidas, bodyBytes, bytesMovidos, alcanzoObjetivo: bodyBytes <= objetivo };
}

// ── El catálogo: qué repara cada hallazgo, y quién lo firma ──────────────────────────────────────

/**
 * El catálogo de reparaciones, por regla de la auditoría. `nivel` es el nivel de riesgo **de la reparación**
 * (no de la regla), y `automatica` dice si el motor puede aplicarla dentro de una propuesta sin intervención.
 *
 * No están todas las reglas a propósito: lo que exigiría inventar conocimiento no tiene entrada aquí, y eso
 * es una decisión, no un olvido.
 */
export const REPARACIONES = {
  'un-normalizado': {
    nivel: 1,
    automatica: true,
    describe: 'Normaliza saltos, espacios finales y el salto final',
    como: 'El cuerpo y el material se llevan a su forma canónica: nada de lo que la skill dice cambia',
  },
  'body-max': {
    nivel: 2,
    automatica: true,
    describe: 'Mueve al material pesado la sección más larga, entera y con su encabezado, y deja el vínculo',
    como: 'El conocimiento no se recorta: cambia de sitio, y el cuerpo lo sigue enlazando',
  },
  'body-budget': {
    nivel: 2,
    automatica: true,
    describe: 'Lo mismo que `body-max`, con el umbral de aviso: deja el cuerpo por debajo de lo que se paga entero en cada carga',
    como: 'Se aplica sólo si el cuerpo supera el presupuesto y hay más de una sección',
  },
  'reference-integrity': {
    nivel: 2,
    automatica: false,
    describe: 'Volver a proponer la skill con el material que hay ahora, o reponer el aprobado',
    como: 'Exige decidir cuál de las dos versiones es la buena: eso es de una persona',
  },
  'link-missing': {
    nivel: 0,
    automatica: false,
    reparable: false,
    describe: 'NO se repara sola',
    como: 'El fichero que el cuerpo enlaza no está y nadie lo ha escrito: inventarlo sería fabricar conocimiento. Hay que aportarlo (o corregir la ruta) con la evidencia delante',
  },
  'reference-missing-file': {
    nivel: 0,
    automatica: false,
    reparable: false,
    describe: 'NO se repara sola',
    como: 'El material que la skill decía llevar ya no está: reponerlo exige el original',
  },
  'body-min': { nivel: 3, automatica: false, describe: 'Escribir el procedimiento que falta', como: 'Un cuerpo de menos de 200 caracteres no es un procedimiento: redactarlo es criterio, no formato' },
  'description-multiline': { nivel: 3, automatica: false, describe: 'Unir la descripción en una sola línea', como: 'Al unir dos frases se decide cuál sobra: eso cambia lo que el modelo lee' },
  'whenToUse-multiline': { nivel: 3, automatica: false, describe: 'Unir el disparador en una sola línea', como: 'Decidir qué frase se queda es criterio' },
  'link-escape': { nivel: 3, automatica: false, describe: 'Corregir la ruta que sale de la carpeta', como: 'Hay que saber dónde está de verdad el material' },
  'link-is-directory': { nivel: 3, automatica: false, describe: 'Enlazar el fichero concreto', como: 'Elegir el fichero dentro de la carpeta es criterio' },
  'id-format': { nivel: 0, automatica: false, reparable: false, describe: 'NO se repara sola', como: 'Renombrar una skill viva es crear otra: el id es su identidad, y mirar dónde se usa es de una persona' },
  'id-max': { nivel: 0, automatica: false, reparable: false, describe: 'NO se repara sola', como: 'Acortar el id cambia su identidad' },
  'whenToUse-min': {
    nivel: 3,
    automatica: false,
    describe: 'Escribir el disparador que falta',
    como: 'El disparador decide CUÁNDO aparece la skill ante el modelo: redactarlo cambia el comportamiento',
  },
  'description-min': { nivel: 3, automatica: false, describe: 'Reescribir la descripción', como: 'Es lo que el modelo lee para elegir: cambia el comportamiento' },
  'description-max': { nivel: 3, automatica: false, describe: 'Recortar la descripción', como: 'Recortar qué se dice cambia qué se elige' },
  'secret': { nivel: 3, automatica: false, describe: 'Quitar la credencial', como: 'Seguridad: sólo una persona decide qué se hace con un secreto' },
  'personal-path': { nivel: 3, automatica: false, describe: 'Sustituir la ruta personal', como: 'Cambia cómo se ejecuta la skill' },
  'body-sections-min': { nivel: 3, automatica: false, describe: 'Dividir el cuerpo en dos secciones', como: 'Decidir dónde se divide es criterio, no formato' },
  'body-no-sections': { nivel: 3, automatica: false, describe: 'Añadir secciones al cuerpo', como: 'Decidir la estructura de un procedimiento es criterio' },
  unreadable: { nivel: 3, automatica: false, describe: 'Arreglar el acceso al fichero', como: 'Los permisos se arreglan a mano y se comprueban después' },
  'absolute-path': { nivel: 3, automatica: false, describe: 'Parametrizar la ruta absoluta', como: 'Cambia cómo se ejecuta la skill' },
};

/** ¿Qué hallazgos de esta skill tienen reparación, y de qué nivel? */
export function planDeReparacion(hallazgos) {
  const reparables = [];
  const sinReparacion = [];
  for (const hallazgo of hallazgos) {
    if (hallazgo.severity === 'info') continue; // lo informativo no se repara
    const entrada = REPARACIONES[hallazgo.rule];
    if (!entrada) {
      sinReparacion.push({ ...hallazgo, motivo: 'esta regla no tiene reparación en el catálogo del motor: decídelo tú, con la propuesta delante' });
      continue;
    }
    if (entrada.reparable === false) {
      sinReparacion.push({ ...hallazgo, motivo: `no se repara sola — ${entrada.como}` });
      continue;
    }
    reparables.push({ regla: hallazgo.rule, nivel: entrada.nivel, automatica: entrada.automatica, describe: entrada.describe, como: entrada.como, hallazgo });
  }
  // Un **aviso** no puede convertir en humana una corrección que sólo arregla un error: si pudiera, el motor
  // dejaría de poder activar por sí mismo lo que sí sabe arreglar —un aviso de nivel 3 al lado de un error de
  // nivel 2 subía la propuesta entera a nivel 3, y la corrección del error se quedaba esperando a una
  // persona—. Se planifica lo que bloquea (los errores) más los avisos que no suben el nivel; los demás se
  // declaran, para que los decida quien puede decidirlos.
  const hayErrores = reparables.some((p) => p.hallazgo.severity === 'error');
  const nivelDeErrores = reparables
    .filter((p) => p.hallazgo.severity === 'error')
    .reduce((max, p) => Math.max(max, p.nivel), 0);
  const plan = [];
  for (const candidata of reparables) {
    if (hayErrores && candidata.hallazgo.severity !== 'error' && candidata.nivel > nivelDeErrores) {
      sinReparacion.push({
        ...candidata.hallazgo,
        motivo: `es un aviso y su arreglo es de nivel ${candidata.nivel}: no se mete en una corrección automática de un error de nivel ${nivelDeErrores} — decídelo tú, con la propuesta delante`,
      });
      continue;
    }
    plan.push(candidata);
  }
  // El nivel de la propuesta es el más alto de sus reparaciones: lo que manda es lo más delicado.
  const nivel = plan.reduce((max, p) => Math.max(max, p.nivel), 0);
  return { plan, sinReparacion, nivel };
}

// ── Preparar la propuesta ────────────────────────────────────────────────────────────────────────

/** Un slug estable para nombrar la corrección en el diario y en el meta. */
const claveDeHallazgo = (plan) => plan.map((p) => p.regla).sort().join('+') || 'normalizado';

/**
 * Prepara la reparación de una skill viva: mira, aplica lo que puede, y **propone**.
 *
 * No activa nada: eso es `promote` (o una persona, con `approve`). Aquí se reúne la evidencia y se deja el
 * trabajo hecho para que alguien lo revise —o para que el motor lo promocione si su nivel está autorizado.
 *
 * @returns `{ status, id, nivel, reparaciones, sinReparacion, propuesta, base, diff }`
 */
export function reparar(id, key, { root = defaultRoot(), curated = null, cwd = null, now = null } = {}) {
  const opts = { root, cwd };
  if (curated) opts.curated = curated;
  const vigente = vigenteDe(id, key, opts);
  if (vigente === null) {
    return { status: 'missing', id, reason: `no hay ninguna skill viva con el id ${id} en ${key}: nada que reparar` };
  }
  const { data, body } = parseFrontmatter(readFileSync(join(vigente.dir, 'SKILL.md'), 'utf8'));
  const cuerpoBase = cuerpoSinTitulo(body);
  // El título de nivel 1 lo **compone** `renderSkill` a partir de la descripción: si el de la skill viva dice
  // otra cosa, la corrección lo normaliza. Se declara —es un cambio que se ve en el diff— en vez de
  // desaparecer en silencio, que fue el defecto que dejó una corrección impromovible.
  const tituloVivo = (String(body).match(/^\s*#\s+(.+)$/m) ?? [])[1]?.trim() ?? null;
  const tituloCanonico = String(data?.description ?? '').trim();
  const tituloSeNormaliza = tituloVivo !== null && tituloVivo !== '' && tituloVivo !== tituloCanonico;
  // Si la skill vive en un lote, su reparación **sigue en el lote**: reparar un miembro no puede partir el
  // lote en dos, o la promoción automática dejaría de poder comprobar que está entero (y el humano vería dos
  // propuestas del mismo asunto sin saber que van juntas).
  const metaVigente = (() => {
    try { return JSON.parse(readFileSync(join(vigente.dir, 'meta.json'), 'utf8')); } catch { return null; }
  })();
  const grupoHeredado = metaVigente?.group ?? null;

  // La evidencia que justifica la corrección: la auditoría de ESA skill, con sus números.
  const auditoria = auditarCarpeta(vigente.dir, { cwd, id });
  const { plan, sinReparacion, nivel } = planDeReparacion(auditoria.findings);

  // Lo mecánico se aplica siempre que haga falta, aunque no haya hallazgos: la forma canónica es gratis.
  const mecanica = aplicarMecanicas(cuerpoBase);
  const quiereNormalizar = mecanica.cambio;
  if (quiereNormalizar && !plan.some((p) => p.regla === 'un-normalizado')) {
    plan.unshift({
      regla: 'un-normalizado', nivel: 1, automatica: true,
      describe: REPARACIONES['un-normalizado'].describe, como: REPARACIONES['un-normalizado'].como,
      hallazgo: { severity: 'warn', rule: 'un-normalizado', observed: mecanica.aplicadas.join(', '), threshold: null, message: `la forma del texto no es la canónica: ${mecanica.aplicadas.join(', ')}`, fix: 'Normalizar' },
    });
  }
  const hallazgosDeForma = auditoria.findings.filter((f) => f.rule === 'un-normalizado' || f.severity === 'error' || f.severity === 'warn');
  const nivelFinal = plan.reduce((max, p) => Math.max(max, p.nivel), 0);

  // ── La guarda que evita una propuesta condenada ─────────────────────────────────────────────────
  //
  // Si la skill incumple algo que el motor **no** arregla y que la puerta vuelve a exigir (una descripción
  // corta, un disparador que falta), proponer sería fabricar una propuesta que la puerta rechazará: ni
  // siquiera se crea. Se dice qué bloquea y qué haría falta, y no se deja nada a medias.
  const bloquean = auditoria.findings.filter((f) => f.severity === 'error' && (REPARACIONES[f.rule]?.reparable === false || REPARACIONES[f.rule] === undefined || REPARACIONES[f.rule].nivel === 3));
  if (bloquean.length > 0) {
    return {
      status: 'blocked', id, nivel: nivelFinal, base: { state: vigente.state, hash: vigente.hash },
      reparaciones: plan.filter((p) => p.nivel <= 2), sinReparacion,
      bloqueos: bloquean.map((f) => ({ rule: f.rule, observed: f.observed, fix: f.fix, motivo: REPARACIONES[f.rule]?.como ?? 'esta regla no tiene reparación automática' })),
      reason: `la skill incumple ${bloquean.map((f) => f.rule).join(', ')}: es criterio humano (nivel 3), y sin eso la puerta no admitiría ninguna corrección. Repara eso primero, o propón tú la corrección con su revisión.`,
    };
  }
  if (!quiereNormalizar && plan.length === 0) {
    return {
      status: 'nothing-to-do', id, nivel: 0, base: { state: vigente.state, hash: vigente.hash },
      reparaciones: [], sinReparacion, hallazgos: hallazgosDeForma.length,
      reason: 'la skill no incumple nada que el motor sepa reparar',
    };
  }

  let cuerpo = mecanica.texto;
  let umbral = Buffer.byteLength(cuerpoBase) > 24000 ? 24000 : 8000;
  // El material se recoge **del disco**, no de `meta.json`: un fichero añadido a mano a la carpeta de la
  // skill (o puesto por otra vía) no aparece en el meta, y tomarlo del meta lo perdería en la propuesta.
  // Lo que la skill tiene es lo que hay en su carpeta, esté registrado o no.
  const arbolVigente = treeOfConErrores(vigente.dir);
  const material = [];   // lo que vive bajo `references/`: viaja por el parámetro de referencias, con huella
  const sinTocar = [];   // todo lo demás (upstream/, provenance.json, binario): viaja tal cual
  for (const ruta of arbolVigente.files) {
    if (ruta === 'SKILL.md' || ruta === 'meta.json') continue;
    try {
      const bruto = readFileSync(join(vigente.dir, ruta));
      // Sólo lo que vive bajo `references/` puede viajar como referencia: el material de una skill
      // vendorizada (`upstream/…`, `provenance.json`) tiene su sitio y ahí se queda, byte a byte.
      if (isUtf8(bruto) && ruta.startsWith('references/')) material.push({ path: ruta, content: bruto.toString('utf8') });
      else sinTocar.push({ path: ruta, content: bruto });
    } catch (error) {
      return {
        status: 'blocked', id, nivel: nivelFinal, base: { state: vigente.state, hash: vigente.hash },
        reparaciones: plan, sinReparacion,
        bloqueos: [{ rule: 'unreadable', observed: ruta, fix: 'Revisa los permisos', motivo: `no se pudo leer «${ruta}» (${error.code ?? error.message}): sin poder leerlo todo, la propuesta podría perder material` }],
        reason: `la carpeta de la skill tiene material que no se puede leer: ${ruta}`,
      };
    }
  }
  const movidas = [];
  let ronda = null;
  if (plan.some((p) => p.regla === 'body-max' || p.regla === 'body-budget')) {
    const entrada = plan.find((p) => p.regla === 'body-max' || p.regla === 'body-budget');
    umbral = entrada.regla === 'body-max' ? 24000 : 8000;
    const objetivo = Math.round(umbral * 0.8);
    // El tope se calcula sobre el cuerpo de la versión **viva** (el mismo que medirá la puerta al
    // promocionar) y se le pasa al movimiento: así el parche que se prepara es, por construcción, uno que
    // la puerta admite. Antes se movía «hasta bajar del umbral» y la puerta contaba trozos: el motor
    // preparaba propuestas condenadas.
    const bytesAntes = Buffer.byteLength(cuerpoBase);
    const paso = Math.max(0, ...seccionesDe(cuerpo).map((s) => s.bytes));
    const topeBytes = topeDeMovimiento(bytesAntes, { umbral, paso });
    const movimiento = moverMaterialPesado({ id, body: cuerpo, budget: umbral, objetivo, topeBytes });
    // La garantía no es la fórmula: es que el cuerpo resultante quede por debajo del umbral. Si no queda,
    // la puerta rechazaría la propuesta —por alto— y aquí no se fabrica lo que la puerta va a rechazar.
    if (movimiento !== null && movimiento.bodyBytes <= umbral) {
      cuerpo = movimiento.body;
      material.push(...movimiento.references);
      movidas.push(...movimiento.movidas);
      ronda = {
        umbral, objetivo, bytesAntes, topeBytes, paso,
        bytesMovidos: movimiento.bytesMovidos,
        cuerpoTrasBytes: movimiento.bodyBytes,
        alcanzoObjetivo: movimiento.alcanzoObjetivo,
      };
    } else {
      sinReparacion.push({
        severity: 'warn', rule: entrada.regla, observed: Buffer.byteLength(cuerpo), threshold: umbral,
        message: 'el cuerpo pasa del umbral y no cabe en una corrección automática: el corte dejaría el cuerpo sin procedimiento, o la sección que habría que sacar ya supera el tope',
        fix: 'Divide el cuerpo a mano en secciones y vuelve a intentarlo, o mueve tú el material de consulta',
        motivo: 'el motor no parte secciones ni deja el cuerpo sin procedimiento: decidir ese corte es criterio',
      });
      plan.splice(plan.indexOf(entrada), 1);
    }
  }

  // El material de texto también se lleva a su forma canónica, sin tocar su contenido significativo. El
  // binario no se toca: viaja byte a byte.
  const referencesFinales = material.map((r) => {
    const normalizado = aplicarMecanicas(r.content);
    return { path: r.path, content: normalizado.texto };
  });

  const revision = {
    claim: hallazgosDeForma.length > 0
      ? `La skill incumplía ${hallazgosDeForma.map((f) => f.rule).join(', ')} según la auditoría de solo lectura.`
      : 'La skill no estaba en su forma canónica: el texto arrastraba marcas que no significan nada.',
    evidence: `node bin/skill-compiler.mjs audit --estado approved (medido: ${hallazgosDeForma.length} hallazgo(s) sobre ${vigente.dir})`,
    measurement: `Auditoría de solo lectura sobre la versión vigente (huella ${vigente.hash.slice(0, 16)}): cuerpo de ${Buffer.byteLength(cuerpoBase)} bytes${movidas.length ? `, ${movidas.length} sección(es) movida(s) a references/` : ''}.`,
    change: plan.map((p) => `${p.regla}: ${p.describe}`).join(' · ') || 'Forma canónica.',
  };
  const notasRetiradas = [];
  if (movidas.length > 0) {
    notasRetiradas.push(`Las secciones ${movidas.map((m) => `«${m.titulo}»`).join(', ')} NO se eliminan: viajan enteras a ${movidas.map((m) => `«${m.ruta}»`).join(', ')} y el cuerpo las sigue enlazando.`);
  }
  if (tituloSeNormaliza) {
    notasRetiradas.push(`El título de nivel 1 se normaliza al de la casa —lo compone la descripción—: «${tituloVivo}» pasa a «${tituloCanonico}». No es conocimiento del cuerpo: el inventario mide sin título.`);
  }
  if (notasRetiradas.length > 0) revision.removed = notasRetiradas.join(' ');

  const base = { state: vigente.state, hash: vigente.hash };
  const propuesta = propose({
    id,
    description: data.description ?? '',
    whenToUse: data.whenToUse ?? '',
    body: cuerpo,
    revision,
  }, {
    root, ...(curated ? { curated } : {}), references: referencesFinales, cwd: cwd ?? process.cwd(), key,
    ...(grupoHeredado ? { group: grupoHeredado } : {}),
    extraFiles: Object.fromEntries(sinTocar.map((f) => [f.path, f.content])),
    metaExtra: {
      repair: {
        nivel: nivelFinal,
        umbral,
        bytesAntes: Buffer.byteLength(cuerpoBase),
        reglas: plan.map((p) => p.regla),
        automatica: plan.every((p) => p.automatica),
        movidas: movidas.map((m) => ({ titulo: m.titulo, ruta: m.ruta, bytes: m.bytes })),
        // La ronda: con qué tope se preparó y cuánto salió del cuerpo. La puerta lo RE-CALCULA con la
        // misma función y comprueba que no se pasó; sin esto, preparar y verificar medían con varas distintas.
        ...(ronda
          ? {
            topeBytes: ronda.topeBytes,
            paso: ronda.paso,
            bytesMovidos: ronda.bytesMovidos,
            cuerpoTrasBytes: ronda.cuerpoTrasBytes,
            alcanzoObjetivo: ronda.alcanzoObjetivo,
          }
          : {}),
        sinReparacion: sinReparacion.map((s) => ({ rule: s.rule, motivo: s.motivo ?? 'sin catálogo' })),
        hallazgos: hallazgosDeForma.map((f) => ({ rule: f.rule, severity: f.severity, observed: f.observed, threshold: f.threshold })),
        baseHash: base.hash,
        preparadoPor: 'motor',
      },
    },
  });

  // ── La guarda del material: la propuesta no puede perder ni un fichero ──────────────────────────
  //
  // Es lo último que se comprueba y lo más importante: si la propuesta no tiene exactamente los mismos
  // ficheros que la skill viva, se retira y no queda nada. Perder un fichero de una skill aprobada en
  // silencio sería el peor fallo posible de este motor.
  if (propuesta.status === 'proposed') {
    const dirPropuesta = join(root, 'projects', projectKey(cwd ?? process.cwd()), 'proposed', id);
    const escritos = treeOfConErrores(dirPropuesta).files.filter((f) => f !== 'meta.json');
    const esperados = arbolVigente.files.filter((f) => f !== 'meta.json').concat(movidas.map((m) => m.ruta)).sort();
    if (escritos.length !== esperados.length || escritos.some((f, i) => f !== esperados[i])) {
      const faltan = esperados.filter((f) => !escritos.includes(f));
      const sobran = escritos.filter((f) => !esperados.includes(f));
      try { rmSync(dirPropuesta, { recursive: true, force: true }); } catch { /* queda declarado abajo */ }
      return {
        status: 'failed', id, nivel: nivelFinal, base,
        reparaciones: plan, sinReparacion, movidas,
        bloqueos: [{ rule: 'material-perdido', observed: `faltan ${faltan.join(', ') || '—'} · sobran ${sobran.join(', ') || '—'}`, fix: 'Repórtalo: el motor no debe proponer una skill que pierde material', motivo: 'la propuesta no conserva el material de la skill' }],
        reason: `la propuesta perdía material (faltan: ${faltan.join(', ') || 'nada'}; sobran: ${sobran.join(', ') || 'nada'}): se ha retirado entera y no se ha tocado la skill`,
      };
    }
  }

  if (propuesta.status !== 'proposed') {
    return {
      status: propuesta.status, id, nivel: nivelFinal, base,
      reparaciones: plan, sinReparacion, movidas,
      errors: propuesta.errors ?? [], warnings: propuesta.warnings ?? [], conflicts: propuesta.conflicts ?? [],
      reason: `no se pudo proponer la corrección (${propuesta.status}): ${[...(propuesta.errors ?? []), ...(propuesta.conflicts ?? []).map((c) => `choca con ${c.id}`)].slice(0, 3).join(' | ') || 'sin motivo declarado'}`,
    };
  }

  return {
    status: propuesta.status, id, nivel: nivelFinal, reparaciones: plan, sinReparacion, movidas,
    base, propuesta, diff: propuesta.diff ?? null, revision,
    // Un diff de líneas puede salir `+0/-0` cuando lo que cambia es la FORMA (un `\r`, un espacio al
    // final): sin esta señal, la propuesta parecería no haber cambiado nada.
    forma: {
      bytesAntes: Buffer.byteLength(cuerpoBase),
      bytesDespues: Buffer.byteLength(cuerpo),
      transformaciones: mecanica.aplicadas,
      significativoIgual: mecanica.significativoIgual,
      seccionesMovidas: movidas.length,
    },
  };
}

/** El inventario del conocimiento de una skill: lo que no puede desaparecer sin que alguien lo diga. */
export function inventario(cuerpo) {
  const texto = String(cuerpo ?? '');
  const entreBackticks = [...texto.matchAll(/`([^`\n]{2,})`/g)].map((m) => m[1].trim());
  const numeros = [...texto.matchAll(/\b\d[\d.,]*\b/g)].map((m) => m[0]);
  const rutas = [...texto.matchAll(/[\w./-]+\/[\w./-]+/g)].map((m) => m[0]);
  const encabezados = [...texto.matchAll(/^##[^#\n].*$/gm)].map((m) => m[0].trim());
  const claves = [...texto.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.{0,60})/gm)].map((m) => m[1].trim().toLowerCase());
  const unicos = (lista) => [...new Set(lista)].sort();
  return { entreBackticks: unicos(entreBackticks), numeros: unicos(numeros), rutas: unicos(rutas), encabezados: unicos(encabezados), pasos: unicos(claves) };
}

/** Qué se perdió entre dos inventarios. */
export function inventarioPerdido(antes, despues) {
  const perdido = {};
  for (const clave of Object.keys(antes)) {
    const quedan = new Set(despues[clave] ?? []);
    const faltan = antes[clave].filter((x) => !quedan.has(x));
    if (faltan.length > 0) perdido[clave] = faltan;
  }
  return perdido;
}

/** Lo que hay hoy en el almacén para un id, sin inventarse nada. */
export function estadoDe(id, key, { root = defaultRoot(), curated = null } = {}) {
  const opts = { root };
  if (curated) opts.curated = curated;
  const vigente = vigenteDe(id, key, opts);
  if (vigente === null) return null;
  const arbol = treeOfConErrores(vigente.dir);
  return {
    id, key, state: vigente.state, hash: vigente.hash, dir: vigente.dir,
    hashVerificado: existsSync(join(vigente.dir, 'SKILL.md')) ? folderHash(vigente.dir) === vigente.hash : false,
    ficheros: arbol.files, errores: arbol.errores,
  };
}
