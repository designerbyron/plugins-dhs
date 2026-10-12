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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Raíz de datos por defecto: hermana de `skills/`, para no mezclarse con la biblioteca curada. */
export function defaultRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'skill-compiler');
}

/** La biblioteca curada, que solo se LEE: una propuesta jamás escribe aquí. */
export function curatedLibraryRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(dshHome, 'skills');
}

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
      // La biblioteca curada manda: una skill aprendida nunca la suplanta en silencio. Dentro del
      // propio ámbito, en cambio, el mismo id es una ACTUALIZACIÓN (de la propuesta o de la aprobada),
      // y por eso no se veta: se informa con `updatesApproved`.
      if (other.where === 'biblioteca-curada') conflicts.push({ id: other.id, score: 1, where: other.where, reason: 'id-ocupado' });
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
export const approve = (id, key, opts = {}) => move(opts.root ?? defaultRoot(), key, id, 'proposed', 'approved');
export const reject = (id, key, opts = {}) => move(opts.root ?? defaultRoot(), key, id, 'proposed', 'rejected');

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
