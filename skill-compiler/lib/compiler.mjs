/**
 * skill-compiler — lógica pura del compilador de conocimiento.
 *
 * Sin dependencias y sin DSH: aquí vive todo lo que se puede probar con `node --test`. El adaptador
 * Cordis (`index.js`) solo traduce entre estas funciones y los servicios del harness, de modo que el
 * riesgo de romper todas las sesiones del perfil se concentra en ~80 líneas revisables.
 *
 * Objetivo del que sale el diseño: al cerrar una tarea compleja, el conocimiento reutilizable se
 * convierte en una skill **propuesta**, ligada al proyecto donde se aprendió, guardada fuera de todo
 * repositorio y sin solaparse con lo que ya existe.
 *
 * Tres decisiones que gobiernan el código:
 *   1. **El proyecto lo calcula el plugin, no el modelo.** Sale del cwd de la sesión. Si el modelo
 *      pudiera declararlo, una skill podría aterrizar en el ámbito equivocado y cargarse en el lugar
 *      equivocado — justo lo que hay que impedir.
 *   2. **Una propuesta no es una skill.** Se escribe en `proposed/` y nunca se sirve al modelo. Solo
 *      `approved/` se sirve, y aprobar es un acto humano por CLI, no una herramienta del modelo.
 *   3. **La idempotencia es del fichero, no de la memoria.** Reproponer el mismo id reescribe su
 *      carpeta de forma atómica; no hay índice paralelo que pueda desincronizarse.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Raíz de datos por defecto: hermana de `skills/`, para no mezclarse con la biblioteca curada. */
export function defaultRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'skill-compiler');
}

/**
 * La **biblioteca de usuario**: la cuarta raíz que el harness resuelve para skills, con rango 400. Es la
 * capa que ve **todo** proyecto de esta máquina.
 *
 * Se **lee** siempre —compone lo que el agente ve y con lo que se compara una propuesta— y se **escribe**
 * sólo por una aprobación humana con ámbito global. Una **propuesta** sigue sin escribir aquí jamás: lo que
 * escribe es una decisión, y pasa por `publishToLibrary` con su puerta.
 *
 * Aviso que el código asume: la carpeta es **compartida** con otras herramientas (hoy tiene skills que
 * escribe Hermes), así que nada que no sea nuestro se pisa.
 */
export function curatedLibraryRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'skills');
}

/** El mismo directorio, con el nombre del papel que juega al aprobar: destino de publicación. */
export function libraryRoot(opts = {}) {
  return opts.library ?? curatedLibraryRoot();
}

export const SCOPES = Object.freeze(['project', 'global']);

/** El ámbito pedido. Sin decir nada, el gesto conservador: el proyecto. */
export function scopeOf(opts = {}) {
  return opts.scope === 'global' ? 'global' : 'project';
}

/**
 * ¿Esta carpeta de la biblioteca la escribió este plugin? La marca va en el frontmatter
 * (`metadata.dsh.origin`), así que se lee del fichero y no de un registro aparte que podría mentir.
 */
export function isOurs(dir) {
  const loaded = readSkill(join(dir, 'SKILL.md'));
  return loaded !== null && loaded.metadata?.dsh?.origin === 'skill-compiler';
}

const no = (now) => (now instanceof Date ? now.toISOString() : String(now));
const stamp = (now) => no(now).replace(/[:.]/g, '-');
/** El mismo sello, para el respaldo, que usa el formato de carpeta por día del repositorio. */
const dia = (now) => no(now).slice(0, 10);

// ── identidad de proyecto ────────────────────────────────────────────────────────────────────────

/**
 * Clave de proyecto a partir del cwd de la sesión. Es la regla que evita que una skill se cargue en
 * el lugar equivocado: la misma función decide dónde se guarda y qué se sirve.
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return null;
  const normalized = resolve(cwd).replace(/[\\/]+$/, '');
  const slug = normalized.replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, '').replace(/[^A-Za-z0-9._-]/g, '-');
  if (slug.length === 0) return null;
  // Legible y estable: el último tramo del path primero, y un hash corto del path completo detrás para
  // que dos proyectos con el mismo nombre en sitios distintos no colisionen.
  const tail = normalized.split(/[\\/]/).filter(Boolean).pop() ?? 'root';
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `${tail.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40)}-${digest}`;
}

// ── validación de la entrada ─────────────────────────────────────────────────────────────────────

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MIN_BODY = 200;
const MAX_DESCRIPTION = 300;
const MIN_DESCRIPTION = 12;

/** Formas de credencial y de ruta de usuario que una skill NUNCA debe llevar consigo. */
const SECRET_SHAPES = [
  [/sk-[A-Za-z0-9]{16,}/, 'clave con forma sk-'],
  [/ghp_[A-Za-z0-9]{20,}/, 'token de GitHub'],
  [/eyJ[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada PEM'],
  [/\b(password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*\S{6,}/i, 'asignación de credencial'],
  [/\bBearer\s+\S{12,}/, 'cabecera Bearer'],
];
/** Rutas personales de la máquina del autor: acoplan la skill a un puesto, no a un proyecto. */
const PERSONAL_PATH_SHAPES = [
  [/[A-Za-z]:\\Users\\[^\\\s"']+/i, 'ruta de perfil de Windows'],
  [/\/(?:home|Users)\/[^/\s"']+\//, 'ruta de perfil POSIX'],
];
/** Rutas absolutas en general: se avisa, no se veta (documentar una herramienta del puesto es legítimo). */
const ABSOLUTE_PATH_SHAPES = [/[A-Za-z]:\\[^\s"']+/, /(?:^|\s)\/(?:usr|opt|etc|var|srv|mnt)\/[^\s"']+/];

/**
 * Validate a proposal before it touches disk.
 * @returns `{ ok, errors, warnings }` — errors reject, warnings travel with the proposal.
 */
export function validateInput(input) {
  const errors = [];
  const warnings = [];
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const whenToUse = typeof input?.whenToUse === 'string' ? input.whenToUse.trim() : '';
  const body = typeof input?.body === 'string' ? input.body.trim() : '';

  if (!ID_RE.test(id)) errors.push('id debe ser kebab-case y empezar por letra: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$');
  if (id.length > 64) errors.push('id demasiado largo (máximo 64)');
  if (description.length < MIN_DESCRIPTION) errors.push(`description demasiado corta (mínimo ${MIN_DESCRIPTION} caracteres)`);
  if (description.length > MAX_DESCRIPTION) errors.push(`description demasiado larga (máximo ${MAX_DESCRIPTION}): es lo que el modelo lee al elegir`);
  if (/[\r\n]/.test(description)) errors.push('description debe ser una sola línea');
  if (body.length < MIN_BODY) errors.push(`body demasiado corto (mínimo ${MIN_BODY} caracteres): una skill es un procedimiento, no un titular`);

  const haystack = `${description}\n${whenToUse}\n${body}`;
  for (const [re, label] of SECRET_SHAPES) if (re.test(haystack)) errors.push(`parece contener una credencial (${label}): una skill no lleva secretos nunca`);
  for (const [re, label] of PERSONAL_PATH_SHAPES) if (re.test(haystack)) errors.push(`contiene una ruta personal de la máquina (${label}): usa $DSH_HOME o una ruta relativa`);
  for (const re of ABSOLUTE_PATH_SHAPES) if (re.test(haystack)) { warnings.push('contiene rutas absolutas: si la skill debe viajar, parametrízalas'); break; }

  // No se exige encabezado de nivel 1 en el body: `renderSkill` compone el título a partir de la
  // descripción, así que el documento final siempre lo lleva.
  return { ok: errors.length === 0, errors, warnings };
}

// ── anti-solapamiento ────────────────────────────────────────────────────────────────────────────

/** Palabras que no distinguen un tema de otro. Mismas constantes que el guardián de la biblioteca. */
const STOPWORDS = new Set([
  'use', 'when', 'the', 'and', 'for', 'with', 'its', 'own', 'that', 'this', 'from', 'into', 'over',
  'not', 'are', 'you', 'your', 'must', 'can', 'all', 'any', 'new', 'one', 'two', 'per', 'via', 'out',
  'get', 'set', 'run', 'how', 'why', 'what', 'who', 'been', 'were', 'was', 'has', 'have', 'had',
  'skill', 'skills', 'dsh', 'hermes', 'exact', 'exactly', 'only', 'also', 'then', 'than', 'them',
  'they', 'there', 'here', 'each', 'other', 'same', 'such', 'does', 'doing', 'done', 'before', 'after',
  'under', 'about', 'while', 'never', 'always', 'still', 'just', 'more', 'most', 'some',
]);
/** Tokens que solo dicen «soy de la familia»: no distinguen por sí solos. */
const FAMILY_TOKENS = new Set(['hash', 'hashed', 'authorized', 'authorised', 'sha', 'sha256', 'signed']);
const THRESHOLD = 0.5;

const singular = (w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s) => (s || '').toLowerCase().split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 3 && !STOPWORDS.has(w)).map(singular);

/** Fingerprint de tema: tallos fuertes del nombre + bolsa amplia (nombre, etiquetas, descripción). */
export function fingerprint({ id, description = '', whenToUse = '', tags = [] }) {
  const nameTokens = words((id || '').replace(/[-_]/g, ' '));
  return {
    stems: new Set(nameTokens.filter((t) => !FAMILY_TOKENS.has(t))),
    wide: new Set([...nameTokens, ...tags.flatMap((t) => words(t)), ...words(description), ...words(whenToUse)]),
  };
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 0..1: cuánto se parece un candidato a otro. Mira tallos y bolsa amplia, y se queda con el mayor. */
export function similarity(a, b) {
  const fa = fingerprint(a);
  const fb = fingerprint(b);
  return Math.max(jaccard(fa.stems, fb.stems), jaccard(fa.wide, fb.wide));
}

/**
 * Veto de solapamiento, con **semántica por ámbito**: se veta donde de verdad colisionaría (la
 * biblioteca curada y el mismo proyecto) y solo se informa cuando el mismo tema vive en otro proyecto
 * — porque ahí es legítimo que exista, y saberlo es útil, pero no es motivo para impedir la propuesta.
 *
 * Reproponer el propio id no es una colisión con uno mismo: es actualizar la propuesta.
 */
export function checkOverlap(candidate, existing, { threshold = THRESHOLD, scope = null } = {}) {
  const conflicts = [];
  const relatedElsewhere = [];
  for (const other of existing) {
    const sameScope = other.where === 'biblioteca-curada' || (scope !== null && typeof other.where === 'string' && other.where.endsWith(`:${scope}`));
    if (!sameScope) {
      const score = similarity(candidate, other);
      if (score >= threshold) relatedElsewhere.push({ id: other.id, score: Number(score.toFixed(3)), where: other.where });
      continue;
    }
    if (other.id === candidate.id) {
      // Lo que decide no es DÓNDE está la otra, sino DE QUIÉN ES. Una skill ajena de la biblioteca no se
      // suplanta nunca en silencio: eso es un conflicto y se dice. Y lo que sí es nuestro —la propuesta,
      // la aprobada, la aprobada del mismo proyecto y **lo que este plugin publicó en la biblioteca**— es
      // una ACTUALIZACIÓN del mismo id, y no se veta: se informa con `updatesProposal`/`updatesApproved`.
      // Sin esta distinción, una skill global quedaba congelada: publicada una vez, el modelo ya no podía
      // mejorarla en ningún proyecto.
      if (other.where === 'biblioteca-curada' && other.ours !== true) {
        conflicts.push({ id: other.id, score: 1, where: other.where, reason: 'id-ocupado', ours: false });
      }
      continue;
    }
    const score = similarity(candidate, other);
    if (score >= threshold) conflicts.push({ id: other.id, score: Number(score.toFixed(3)), where: other.where, reason: 'mismo-tema' });
  }
  return {
    ok: conflicts.length === 0,
    conflicts: conflicts.sort((x, y) => y.score - x.score),
    relatedElsewhere: relatedElsewhere.sort((x, y) => y.score - x.score),
  };
}

// ── lectura de lo que ya existe ──────────────────────────────────────────────────────────────────

/** Frontmatter YAML mínimo: `clave: valor`, listas `[a, b]` y un nivel anidado bajo `metadata:`. */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  let nested = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (/^metadata:\s*$/.test(line)) { nested = {}; data.metadata = nested; continue; }
    const deep = /^\s{2,}([A-Za-z][A-Za-z0-9_.-]*):\s*(.*)$/.exec(line);
    if (deep && nested !== null) {
      // `dsh:` abre un segundo nivel; el resto de claves cuelgan de él.
      if (deep[2].trim() === '') { nested[deep[1]] = {}; continue; }
      const bucket = Object.keys(nested).length === 1 ? Object.values(nested)[0] : nested;
      bucket[deep[1]] = deep[2].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    nested = null;
    const [, key, rawValue] = kv;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
    if (key === 'tags' && value.startsWith('[')) data[key] = value.slice(1, -1).split(',').map((t) => t.trim()).filter(Boolean);
    else data[key] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

/** Inventario de skills de un árbol `<raíz>/<id>/SKILL.md`. Nunca lanza por una entrada mala. */
export function scanTree(root, where) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = join(root, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
      out.push({
        id: data.name || entry.name,
        description: data.description || '',
        whenToUse: data.whenToUse || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        // De quién es: la marca que `renderSkill` pone en el frontmatter. Es la distinción que decide si
        // el mismo id es una actualización (nuestra) o una suplantación (de otra herramienta).
        ours: data.metadata?.dsh?.origin === 'skill-compiler',
        where,
        path: file,
      });
    } catch { /* una skill ilegible no debe tumbar el inventario */ }
  }
  return out;
}

/** Todo con lo que una propuesta debe compararse: biblioteca curada + aprendido propuesto y aprobado. */
export function existingSkills({ root = defaultRoot(), curated = curatedLibraryRoot() } = {}) {
  return [
    ...scanTree(curated, 'biblioteca-curada'),
    ...listProjects(root).flatMap((project) => [
      ...scanTree(join(root, 'projects', project, 'proposed'), `propuesto:${project}`),
      ...scanTree(join(root, 'projects', project, 'approved'), `aprobado:${project}`),
      // Lo apagado sigue existiendo: si no entrara aquí, el modelo propondría como nueva una skill que el
      // humano sólo apagó, y acabaríamos con dos versiones del mismo id.
      ...scanTree(join(root, 'projects', project, 'disabled'), `apagada:${project}`),
    ]),
  ];
}

/** Resumen para la CLI y para el informe al usuario: qué hay pendiente y en qué proyecto. */
export function overview({ root = defaultRoot() } = {}) {
  return listProjects(root).map((key) => {
    const proposed = scanTree(join(root, 'projects', key, 'proposed'), 'propuesto');
    const approved = scanTree(join(root, 'projects', key, 'approved'), 'aprobado');
    const rejected = scanTree(join(root, 'projects', key, 'rejected'), 'rechazado');
    return {
      projectKey: key,
      proposed: proposed.map((s) => ({ id: s.id, description: s.description })),
      approved: approved.map((s) => ({ id: s.id, description: s.description })),
      rejected: rejected.map((s) => s.id),
    };
  });
}

export function listProjects(root = defaultRoot()) {
  const dir = join(root, 'projects');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
}

// ── composición del SKILL.md ─────────────────────────────────────────────────────────────────────

const single = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const quote = (s) => `"${single(s).replace(/"/g, '\\"')}"`;

/**
 * Compose the SKILL.md a DSH will accept as-is: `name` y `description` en el frontmatter, más
 * `metadata.dsh` con la procedencia. Sin claves de invocación heredadas: el silenciado se decide
 * donde corresponde, no aquí.
 *
 * `upstream` marca una skill **vendorizada**: nuestra versión adaptada de un original externo. Los
 * campos van planos bajo `metadata.dsh` a propósito (el parser de esta biblioteca modela dos niveles).
 */
export function renderSkill({ id, description, whenToUse, body, project, projectKey: key, evidence = [], createdAt, toolVersion = 1, upstream = null, localNote = '' }) {
  const front = ['---', `name: ${id}`, `description: ${quote(description)}`];
  if (single(whenToUse)) front.push(`whenToUse: ${quote(whenToUse)}`);
  front.push('metadata:');
  front.push('  dsh:');
  front.push('    origin: skill-compiler');
  front.push(`    project: ${quote(project)}`);
  front.push(`    projectKey: ${quote(key)}`);
  front.push(`    learnedAt: ${quote(createdAt)}`);
  front.push(`    toolVersion: ${toolVersion}`);
  if (upstream) {
    front.push(`    upstreamUrl: ${quote(upstream.url)}`);
    if (upstream.ref) front.push(`    upstreamRef: ${quote(upstream.ref)}`);
    front.push(`    upstreamSha256: ${quote(upstream.sha256)}`);
    front.push(`    upstreamFetchedAt: ${quote(upstream.fetchedAt)}`);
  }
  if (evidence.length) front.push(`    evidence: [${evidence.map((e) => quote(e)).join(', ')}]`);
  front.push('---', '', `# ${single(description)}`, '');

  const banner = upstream ? [
    `> **Versión local de una skill externa.** Origen: ${upstream.url}${upstream.ref ? ` (${upstream.ref})` : ''}, consultado el ${upstream.fetchedAt.slice(0, 10)}.`,
    `> SHA-256 del original: \`${upstream.sha256.slice(0, 16)}…\` · esta copia está **adaptada para este proyecto** y no es la fuente autoritativa.`,
    `> El original se guarda verbatim en \`upstream/\` y la procedencia completa en \`provenance.json\`.`,
    ...(single(localNote) ? [`>`, `> **Adaptación local:** ${single(localNote)}`] : []),
    '',
  ].join('\n') : '';

  return `${front.join('\n')}${banner}${body.replace(/^\s*\n/, '')}\n`;
}

// ── escritura: proponer, aprobar, rechazar ───────────────────────────────────────────────────────

function writeAtomic(dir, files) {
  const tmp = `${dir}.tmp-${randomUUID().slice(0, 8)}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = join(tmp, name);
    mkdirSync(dirname(target), { recursive: true }); // el vendorizado guarda `upstream/` dentro
    writeFileSync(target, content);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  renameSync(tmp, dir);
}

/**
 * Write a proposal. Idempotent by construction: the same id rewrites its own directory and nothing
 * else, so proposing twice leaves one proposal and never duplicates the library.
 */
export function propose(input, { root = defaultRoot(), cwd, now = new Date().toISOString(), curated = curatedLibraryRoot(), extraFiles = {}, metaExtra = {} } = {}) {
  const validation = validateInput(input);
  if (!validation.ok) return { status: 'invalid', errors: validation.errors, warnings: validation.warnings };

  const key = projectKey(cwd);
  if (key === null) return { status: 'no-project', errors: ['no se pudo determinar el proyecto: la sesión no tiene un cwd utilizable'], warnings: [] };

  const candidate = {
    id: input.id.trim(),
    description: input.description.trim(),
    whenToUse: (input.whenToUse ?? '').trim(),
    tags: Array.isArray(input.tags) ? input.tags : [],
  };
  const overlap = checkOverlap(candidate, existingSkills({ root, curated }), { scope: key });
  if (!overlap.ok) return { status: 'conflict', conflicts: overlap.conflicts, warnings: validation.warnings };
  const updatesApproved = existsSync(join(root, 'projects', key, 'approved', candidate.id));
  // Si ya existía una propuesta con ese id, esto es un parche de lo propuesto, no una creación.
  // La diferencia importa: es lo que el usuario ve en la interfaz y lo que le dice si su biblioteca
  // creció o si se afinó lo que ya había.
  const updatesProposal = existsSync(join(root, 'projects', key, 'proposed', candidate.id));
  // Una versión **apagada** también se reemplaza al aprobar (`move` la aparta), así que el humano tiene
  // que saberlo: sin esto, proponer sobre algo apagado se anunciaba como «creada» y la aprobación
  // reemplazaba en silencio una skill que alguien había apagado a propósito.
  const updatesDisabled = existsSync(join(root, 'projects', key, 'disabled', candidate.id));
  // Y lo **publicado** para todos los proyectos: aprobar esto reemplaza la versión que ya se sirve en
  // todas las sesiones (la anterior queda apartada en `global/superseded/`). Sin decirlo, el humano
  // creería que está creando algo nuevo cuando en realidad está cambiando lo que ve en todas partes.
  const updatesPublished = isOurs(join(curated, candidate.id));

  const project = input.project ?? cwd;
  const dir = join(root, 'projects', key, 'proposed', candidate.id);
  const skill = renderSkill({
    ...candidate, body: input.body.trim(), project, projectKey: key, evidence: input.evidence ?? [],
    createdAt: now, upstream: input.upstream ?? null, localNote: input.localNote ?? '',
  });
  const meta = {
    id: candidate.id,
    project,
    projectKey: key,
    state: 'proposed',
    createdAt: now,
    description: candidate.description,
    whenToUse: candidate.whenToUse,
    evidence: input.evidence ?? [],
    warnings: validation.warnings,
    ...metaExtra,
  };
  writeAtomic(dir, { 'SKILL.md': skill, 'meta.json': `${JSON.stringify(meta, null, 2)}\n`, ...extraFiles });
  return {
    status: 'proposed',
    id: candidate.id,
    project,
    projectKey: key,
    path: join(dir, 'SKILL.md'),
    warnings: validation.warnings,
    sha256: createHash('sha256').update(skill).digest('hex'),
    updatesApproved,
    updatesProposal,
    updatesDisabled,
    updatesPublished,
    relatedElsewhere: overlap.relatedElsewhere,
  };
}

function move(root, key, id, from, to) {
  const source = join(root, 'projects', key, from, id);
  const target = join(root, 'projects', key, to, id);
  if (!existsSync(source)) return { ok: false, reason: `no existe ${from}/${id} en ${key}` };
  let superseded = null;
  // Aprobar una actualización NO destruye la versión vigente: la aparta con su fecha y deja rastro,
  // porque en esta biblioteca una skill aprobada es una herramienta de trabajo, no un borrador.
  if (existsSync(target)) {
    if (to !== 'approved') return { ok: false, reason: `ya existe ${to}/${id}` };
    superseded = join(root, 'projects', key, 'superseded', `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(dirname(superseded), { recursive: true });
    renameSync(target, superseded);
  }
  // Aprobar reemplaza CUALQUIER versión anterior del mismo id: además de la aprobada que hubiera, una
  // apagada o una propuesta vieja. Dejar dos estados con el mismo id sería servir una y esconder la otra,
  // y la próxima decisión del humano caería sobre la que no está viendo.
  if (to === 'approved') {
    for (const otro of ['disabled', 'proposed']) {
      const candidato = join(root, 'projects', key, otro, id);
      if (candidato === source || !existsSync(candidato)) continue;
      const aparcado = join(root, 'projects', key, 'superseded', `${id}-${otro}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      mkdirSync(dirname(aparcado), { recursive: true });
      renameSync(candidato, aparcado);
      if (superseded === null) superseded = aparcado;
    }
  }
  const metaFile = join(source, 'meta.json');
  if (existsSync(metaFile)) {
    try {
      const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
      meta.state = to;
      meta[`${to}At`] = new Date().toISOString();
      if (superseded !== null) meta.supersededPrevious = superseded;
      writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    } catch { /* el meta es accesorio: no impide mover la skill */ }
  }
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  return { ok: true, path: join(target, 'SKILL.md'), superseded };
}

/**
 * Aprobar es un acto humano, y por eso vive en la CLI y no en una herramienta del modelo: si fuera
 * una herramienta, el propio modelo podría auto-aprobarse su propuesta y la revisión sería decorativa.
 */
export const approve = (id, key, opts = {}) =>
  (scopeOf(opts) === 'global' ? publishToLibrary(id, key, opts) : move(opts.root ?? defaultRoot(), key, id, 'proposed', 'approved'));

/**
 * Aprobar **para todos los proyectos**: la skill se publica en la biblioteca de usuario, que es la raíz que
 * el harness sirve con rango 400, y la propuesta se archiva en el proyecto con la constancia de a dónde fue
 * (`published/`). Una sola copia efectiva: el proyecto no la sirve también, o el mismo conocimiento viajaría
 * dos veces al prompt con dos rangos distintos.
 *
 * Puerta, antes de escribir nada: si la biblioteca ya tiene ese id y **no** es nuestro, no se toca. La
 * carpeta es compartida con otras herramientas y pisar una skill ajena sería destruir trabajo que no es de
 * este plugin.
 */
export function publishToLibrary(id, key, { root = defaultRoot(), library = null, now = new Date() } = {}) {
  const source = join(root, 'projects', key, 'proposed', id);
  if (!existsSync(join(source, 'SKILL.md'))) return { ok: false, reason: `no hay ninguna propuesta con el id ${id} en ${key}` };
  const cartel = join(library ?? curatedLibraryRoot(), id);
  const exists = existsSync(cartel);
  if (exists && !isOurs(cartel)) {
    return { ok: false, reason: `la biblioteca de usuario ya tiene una skill «${id}» que no es de skill-compiler: no se pisa. Retírala tú, o aprueba esta en el proyecto` };
  }
  const hash = folderHash(source);
  let superseded = null;
  if (exists) {
    // Una actualización no destruye la versión vigente: la aparta con su fecha, dentro de nuestro almacén.
    superseded = join(root, 'global', 'superseded', `${id}-${stamp(now)}`);
    try {
      mkdirSync(dirname(superseded), { recursive: true });
      cpSync(cartel, superseded, { recursive: true });
    } catch (error) {
      return { ok: false, reason: `no se pudo apartar la versión anterior: ${error.message}` };
    }
  }
  try {
    mkdirSync(cartel, { recursive: true });
    cpSync(source, cartel, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `no se pudo publicar: ${error.message}` };
  }
  // La huella del destino tiene que ser la del origen: publicar no puede cambiar lo que se publica.
  if (folderHash(cartel) !== hash) {
    return { ok: false, reason: `la copia publicada no coincide con la propuesta (huella distinta): revisa ${cartel}` };
  }
  const moved = moverConConstancia(root, key, id, 'proposed');
  if (!moved.ok) return { ok: false, reason: moved.reason };
  const metaFile = join(root, 'projects', key, 'published', id, 'meta.json');
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    meta.published = { to: cartel, at: no(now), sha256: hash, projectKey: key, superseded };
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  } catch { /* el meta es accesorio: la publicación ya está hecha */ }
  return { ok: true, id, projectKey: key, scope: 'global', path: join(cartel, 'SKILL.md'), library: cartel, sha256: hash, superseded };
}

/**
 * Cambiar el ámbito de una skill ya aprobada, en las dos direcciones. Existe porque una decisión con vuelta
 * no es una decisión a medias: si te equivocaste de ámbito, se corrige sin proponerla otra vez.
 */
export function ambito(id, key, { to, root = defaultRoot(), library = null, now = new Date() } = {}) {
  if (to !== 'global' && to !== 'project') return { ok: false, reason: 'dime a dónde va: «--global» o «--local»' };
  const cartel = join(library ?? curatedLibraryRoot(), id);
  const enProyecto = join(root, 'projects', key, 'approved', id);
  if (to === 'global') {
    if (!existsSync(enProyecto)) return { ok: false, reason: `no hay ninguna skill aprobada con el id ${id} en ${key}` };
    if (existsSync(cartel) && !isOurs(cartel)) return { ok: false, reason: `la biblioteca de usuario ya tiene una skill «${id}» que no es de skill-compiler: no se pisa` };
    const hash = folderHash(enProyecto);
    try {
      mkdirSync(cartel, { recursive: true });
      cpSync(enProyecto, cartel, { recursive: true });
    } catch (error) {
      return { ok: false, reason: `no se pudo mover a la biblioteca: ${error.message}` };
    }
    if (folderHash(cartel) !== hash) return { ok: false, reason: 'la copia no coincide con el original (huella distinta): no se retira nada' };
    const moved = moverConConstancia(root, key, id, 'approved');
    if (!moved.ok) return { ok: false, reason: moved.reason };
    return { ok: true, id, projectKey: key, scope: 'global', path: join(cartel, 'SKILL.md'), library: cartel, sha256: hash };
  }
  if (!existsSync(cartel)) return { ok: false, reason: `no hay ninguna skill publicada con el id ${id}` };
  if (existsSync(enProyecto)) return { ok: false, reason: `${id} ya está aprobada en ${key}: decide qué hacer con ella` };
  const hash = folderHash(cartel);
  try {
    mkdirSync(dirname(enProyecto), { recursive: true });
    cpSync(cartel, enProyecto, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `no se pudo traer al proyecto: ${error.message}` };
  }
  if (folderHash(enProyecto) !== hash) return { ok: false, reason: 'la copia no coincide con el original (huella distinta): no se retira nada' };
  // Ya no está publicada: la constancia de que salió se aparta, para que volver a publicarla no choque con ella.
  const constancia = join(root, 'projects', key, 'published', id);
  if (existsSync(constancia)) {
    const apartada = join(root, 'projects', key, 'superseded', `${id}-constancia-${stamp(now)}`);
    try {
      mkdirSync(dirname(apartada), { recursive: true });
      renameSync(constancia, apartada);
    } catch { /* la constancia es accesorio: no impide el cambio de ámbito */ }
  }
  try {
    const apartada = join(root, 'global', 'superseded', `${id}-localizado-${stamp(now)}`);
    mkdirSync(dirname(apartada), { recursive: true });
    renameSync(cartel, apartada);
  } catch (error) {
    return { ok: false, reason: `quedó en el proyecto pero no se pudo retirar de la biblioteca: ${error.message}` };
  }
  return { ok: true, id, projectKey: key, scope: 'project', path: join(enProyecto, 'SKILL.md'), sha256: hash };
}

/** Archivar la propuesta o la aprobada en `published/`, apartando la constancia anterior si la hubiera. */
function moverConConstancia(root, key, id, from) {
  const yaHay = join(root, 'projects', key, 'published', id);
  if (existsSync(yaHay)) {
    const apartada = join(root, 'projects', key, 'superseded', `${id}-constancia-${stamp(new Date())}`);
    try {
      mkdirSync(dirname(apartada), { recursive: true });
      renameSync(yaHay, apartada);
    } catch (error) {
      return { ok: false, reason: `no se pudo apartar la constancia anterior: ${error.message}` };
    }
  }
  return move(root, key, id, from, 'published');
}

/** Sacar una skill global de la biblioteca a un estado nuestro (apagada, o al respaldo al retirarla). */
function desdeBiblioteca(opts, id, cartel, destino) {
  if (!existsSync(join(cartel, 'SKILL.md'))) return { ok: false, reason: `no hay ninguna skill publicada con el id ${id}` };
  if (!isOurs(cartel)) return { ok: false, reason: `«${id}» está en la biblioteca pero no la escribió skill-compiler: no se toca` };
  if (existsSync(destino)) return { ok: false, reason: `ya hay una copia de ${id} en ${destino}: no se sobrescribe` };
  const hash = folderHash(cartel);
  try {
    mkdirSync(dirname(destino), { recursive: true });
    renameSync(cartel, destino);
  } catch (error) {
    return { ok: false, reason: `no se pudo mover: ${error.message}` };
  }
  return { ok: true, id, scope: 'global', path: join(destino, 'SKILL.md'), hash, root: opts.root ?? defaultRoot() };
}
export const reject = (id, key, opts = {}) => move(opts.root ?? defaultRoot(), key, id, 'proposed', 'rejected');

// ── el ciclo de vida completo: apagar, retirar y volver ──────────────────────────────────────────
//
// Aprobar no era el final del camino: faltaba poder **apagar** algo que ya no quieres (reversible) y
// **retirarlo** del todo (irreversible, así que con respaldo y con vuelta). Sin esto, la única salida
// sobre una skill aprobada era pedir una actualización, que es otra cosa.

/** Raíz de los respaldos: fuera del almacén y con fecha. Lo retirado no se pierde, se archiva. */
export function backupsRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return process.env.SKILL_COMPILER_BACKUPS || join(dshHome, 'backups', 'skills-eliminadas');
}

/** Subcarpeta del día: un respaldo por fecha, para que dos retiradas no se pisen. */
export function retiredRoot(now = new Date()) {
  return join(backupsRoot(), now.toISOString().slice(0, 10));
}

/**
 * Huella del **contenido** de una skill, fichero a fichero. `meta.json` queda fuera a propósito: es el
 * registro de su ciclo de vida y cambia con cada decisión (aprobarla, apagarla), así que incluirlo haría
 * que «volvió lo mismo» nunca se pudiera comprobar. Lo que se compara aquí es la skill, no su papeleo.
 */
export function folderHash(dir) {
  const partes = [];
  const walk = (base, rel) => {
    for (const entry of readdirSync(join(base, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(base, next);
      else if (next !== 'meta.json') partes.push(`${next}:${createHash('sha256').update(readFileSync(join(base, next))).digest('hex')}`);
    }
  };
  walk(dir, '');
  return createHash('sha256').update(partes.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Apagar una skill aprobada: deja de servirse y sale de la lista de activas, pero **se conserva entera** y
 * vuelve con un gesto. No es lo mismo que retirarla, y por eso son dos estados y dos verbos.
 */
export const disable = (id, key, opts = {}) =>
  (scopeOf(opts) === 'global'
    ? desdeBiblioteca(opts, id, join(libraryRoot(opts), id), join(opts.root ?? defaultRoot(), 'global', 'disabled', id))
    : move(opts.root ?? defaultRoot(), key, id, 'approved', 'disabled'));

export const enableGlobal = (id, opts = {}) => {
  const root = opts.root ?? defaultRoot();
  const source = join(root, 'global', 'disabled', id);
  if (!existsSync(join(source, 'SKILL.md'))) return { ok: false, reason: `no hay ninguna skill global apagada con el id ${id}` };
  const cartel = join(libraryRoot(opts), id);
  if (existsSync(cartel)) return { ok: false, reason: `la biblioteca ya tiene «${id}»: decide primero qué hacer con ella` };
  const hash = folderHash(source);
  try {
    mkdirSync(dirname(cartel), { recursive: true });
    renameSync(source, cartel);
  } catch (error) {
    return { ok: false, reason: `no se pudo encender: ${error.message}` };
  }
  return { ok: true, id, scope: 'global', path: join(cartel, 'SKILL.md'), hash };
};

/**
 * Volver a encenderla. Si ya hay una aprobada con ese id, se dice: pisarla en silencio destruiría una
 * skill que alguien aprobó, y decidir eso no le toca al plugin.
 */
export function enable(id, key, opts = {}) {
  if (scopeOf(opts) === 'global') return enableGlobal(id, opts);
  const root = opts.root ?? defaultRoot();
  if (existsSync(join(root, 'projects', key, 'approved', id))) {
    return { ok: false, reason: `ya hay una skill aprobada con ese id en ${key}: decide primero qué hacer con ella` };
  }
  return move(root, key, id, 'disabled', 'approved');
}

/**
 * Retirar: la carpeta sale del almacén a un respaldo fechado, con su huella. Es el único gesto
 * irreversible del plugin, así que **nunca borra**: mueve, y deja la vuelta al lado.
 */
export function retire(id, key, { root = defaultRoot(), now = new Date(), backupRoot = null, scope = 'project', library = null } = {}) {
  if (scopeOf({ scope }) === 'global') {
    const destino = join(backupRoot ?? retiredRoot(now), 'global', id);
    const salida = desdeBiblioteca({ root, library }, id, join(library ?? curatedLibraryRoot(), id), destino);
    if (!salida.ok) return salida;
    return { ok: true, id, projectKey: key, scope: 'global', backup: destino, path: join(destino, 'SKILL.md'), hash: salida.hash, revierte: `restore ${id} --global` };
  }
  const candidatos = [join(root, 'projects', key, 'disabled', id), join(root, 'projects', key, 'approved', id)];
  const source = candidatos.find((dir) => existsSync(dir)) ?? null;
  if (source === null) return { ok: false, reason: `no hay ninguna skill activa ni apagada con el id ${id} en ${key}` };
  const target = join(backupRoot ?? retiredRoot(now), key, id);
  if (existsSync(target)) return { ok: false, reason: `ya hay un respaldo de ${id} con esa fecha: no se sobrescribe` };
  const hash = folderHash(source);
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
  } catch (error) {
    return { ok: false, reason: `no se pudo retirar: ${error.message}` };
  }
  return { ok: true, id, projectKey: key, backup: target, path: join(target, 'SKILL.md'), hash, revierte: `restore ${id}` };
}

/** El respaldo más reciente de un id para un proyecto, o `null`. */
function hallarRespaldo(key, id, { backup = null, backupRoot = null }) {
  if (backup !== null) {
    if (existsSync(join(backup, key, id))) return join(backup, key, id);
    if (existsSync(backup)) return backup;
    return null;
  }
  const base = backupRoot ?? backupsRoot();
  if (!existsSync(base)) return null;
  const dias = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  for (const dia of dias) {
    const candidato = join(base, dia, key, id);
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

/**
 * La vuelta: del respaldo al almacén. Se niega si ese id ya existe —restaurar no puede destruir lo que
 * hay— y devuelve la huella, para poder comprobar que volvió lo mismo.
 */
export function restore(id, key, opts = {}) {
  const root = opts.root ?? defaultRoot();
  if (scopeOf(opts) === 'global') {
    const source = hallarRespaldo('global', id, opts);
    if (source === null) return { ok: false, reason: `no hay respaldo global de ${id}` };
    const cartel = join(libraryRoot(opts), id);
    if (existsSync(cartel)) return { ok: false, reason: `la biblioteca ya tiene «${id}»: decide qué hacer con ella antes de restaurar` };
    const hash = folderHash(source);
    try {
      mkdirSync(dirname(cartel), { recursive: true });
      renameSync(source, cartel);
    } catch (error) {
      return { ok: false, reason: `no se pudo restaurar: ${error.message}` };
    }
    return { ok: true, id, scope: 'global', path: join(cartel, 'SKILL.md'), hash };
  }
  const source = hallarRespaldo(key, id, opts);
  if (source === null) return { ok: false, reason: `no hay respaldo de ${id} para ${key}` };
  if (existsSync(join(root, 'projects', key, 'approved', id)) || existsSync(join(root, 'projects', key, 'disabled', id))) {
    return { ok: false, reason: `${id} ya existe en ${key}: decide qué hacer con ella antes de restaurar` };
  }
  const hash = folderHash(source);
  const target = join(root, 'projects', key, 'approved', id);
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
  } catch (error) {
    return { ok: false, reason: `no se pudo restaurar: ${error.message}` };
  }
  return { ok: true, id, projectKey: key, path: join(target, 'SKILL.md'), hash };
}

/**
 * Lo apagado y lo retirado de un proyecto: es la lista que el humano mira cuando quiere deshacerse de algo,
 * y la que alimenta la decisión en lote.
 */
export function retired(key, { root = defaultRoot(), backupRoot = null } = {}) {
  const apagadas = scanTree(join(root, 'projects', key, 'disabled'), 'apagada').map((skill) => ({ ...skill, state: 'disabled', scope: 'project' }));
  // Y lo global: lo apagado y lo retirado de la biblioteca vive en nuestro almacén, así que se lista aquí,
  // con su ámbito dicho, para que el humano pueda volver a encenderlo o traerlo al proyecto.
  const globales = [
    ...scanTree(join(root, 'global', 'disabled'), 'apagada-global').map((s) => ({ ...s, state: 'disabled', scope: 'global' })),
    ...scanTree(join(root, 'global', 'superseded'), 'apartada-global').map((s) => ({ ...s, state: 'superseded', scope: 'global' })),
  ];
  const base = backupRoot ?? backupsRoot();
  const archivadas = [];
  if (existsSync(base)) {
    const dias = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
    for (const dia of dias) {
      for (const skill of scanTree(join(base, dia, key), 'eliminada')) archivadas.push({ ...skill, state: 'retired', retiredAt: dia, scope: 'project' });
      for (const skill of scanTree(join(base, dia, 'global'), 'eliminada')) archivadas.push({ ...skill, state: 'retired', scope: 'global', retiredAt: dia });
    }
  }
  return [...apagadas, ...globales, ...archivadas];
}

/**
 * La puerta que hay que pasar ANTES de aprobar: válida la propuesta guardada, que es además lo que
 * detecta una edición a mano posterior a la propuesta.
 *
 * Vive aquí, y no en la CLI, porque es una regla y no una superficie: la CLI, la página de revisión y
 * los comandos del harness tienen que aplicar **la misma**. Cuando vivía sólo en `bin/`, cualquier otra
 * vía de aprobación era, por construcción, una vía sin puerta.
 *
 * @param id - id de la propuesta.
 * @param key - clave del proyecto.
 * @param root - raíz del almacén.
 * @returns `{ ok, errors, warnings, file }`; `ok` en falso significa que no se puede aprobar.
 */
export function checkProposal(id, key, { root = defaultRoot() } = {}) {
  const file = join(root, 'projects', key, 'proposed', id, 'SKILL.md');
  if (!existsSync(file)) return { ok: false, errors: [`no existe una propuesta ${id} en ${key}`], warnings: [] };
  const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
  const result = validateInput({
    id: data.name ?? id,
    description: data.description ?? '',
    whenToUse: data.whenToUse ?? '',
    body: body.trim(),
  });
  return { ...result, file };
}

/**
 * Dónde está una skill AHORA: `proposed`, `approved`, `rejected`, o `null` si no existe.
 *
 * Existe por un defecto medido: aprobar dos veces respondía «no existe una propuesta X» y el usuario leía
 * un fallo donde había un acto ya hecho. Saber en qué carpeta está convierte ese error en un mensaje que
 * dice la verdad, sin que el estado deje de ser el mismo.
 */
export function locate(id, key, { root = defaultRoot() } = {}) {
  // `disabled` entra aquí: sin él, apagar algo ya apagado no se reconocía como «ya estaba», y la
  // respuesta era un error de movimiento en vez de decir la verdad (que es lo que el humano espera).
  for (const where of ['proposed', 'approved', 'disabled', 'rejected', 'published']) {
    if (existsSync(join(root, 'projects', key, where, id, 'SKILL.md'))) return where;
  }
  // Y el ámbito global: sin esto, una segunda aprobación «global» intentaría publicar lo ya publicado y
  // respondería un error de movimiento en vez de decir la verdad («ya está en la biblioteca»).
  if (existsSync(join(root, 'global', 'disabled', id, 'SKILL.md'))) return 'global:disabled';
  // Y aquí la distinción que impide el peor desenlace: una skill en la biblioteca **con ese id** pero que
  // no escribió este plugin NO es «ya está publicada». Si lo dijera, el comando no haría nada y el humano
  // leería una mentira; y si siguiera adelante, pisaría trabajo ajeno. Lo cazó la arena.
  const ajena = join(curatedLibraryRoot(), id, 'SKILL.md');
  if (existsSync(ajena)) return isOurs(join(curatedLibraryRoot(), id)) ? 'global' : 'global:ajena';
  return null;
}

/** Propuestas pendientes de un proyecto. Solo lectura: no decide nada. */
export function pending({ root = defaultRoot(), key }) {
  return scanTree(join(root, 'projects', key, 'proposed'), 'propuesto').map((s) => ({ id: s.id, description: s.description, path: s.path }));
}

// ── lo que el proveedor sirve al modelo ──────────────────────────────────────────────────────────

/**
 * Approved skills of ONE project. This is the function that enforces «no se carga en el lugar
 * equivocado»: el proyecto entra por el cwd y lo que no es suyo no se lista.
 */
export function listForProject(cwd, { root = defaultRoot() } = {}) {
  const key = projectKey(cwd);
  if (key === null) return [];
  return scanTree(join(root, 'projects', key, 'approved'), `aprendido:${key}`);
}

export function readSkill(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const { data, body } = parseFrontmatter(text);
  if (!data.name || !data.description) return null;
  return {
    name: data.name,
    description: data.description,
    whenToUse: data.whenToUse,
    content: body.trim(),
    metadata: data.metadata ? { dsh: data.metadata.dsh ?? {} } : undefined,
    path,
    bytes: statSync(path).size,
  };
}
