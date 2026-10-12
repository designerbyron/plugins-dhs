#!/usr/bin/env node
/**
 * vendor-real.e2e.mjs — la cadena completa contra la red REAL, en una caja de arena.
 *
 * No es una prueba automática (no la recoge `node --test`, porque necesita red y un tercero). Es el
 * guion que demuestra que el vendorizado funciona de punta a punta con una URL de verdad: resolver el
 * enlace, descargar, analizar, adaptar, proponer, aprobar y servirlo — y que nada de eso toca el store
 * real, porque `DSH_HOME` apunta a un temporal.
 *
 *   node tests/vendor-real.e2e.mjs
 *
 * Exit: 0 la cadena entera funcionó · 1 algo falló.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sandboxHome = mkdtempSync(join(tmpdir(), 'skill-compiler-e2e-'));
process.env.DSH_HOME = sandboxHome;
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(join(PACKAGE_ROOT, rel)).href);
const realStore = join(process.env.USERPROFILE ?? '', '.dsh', 'skill-compiler');

const { approve, defaultRoot, listForProject, parseFrontmatter, projectKey } = await load('lib/compiler.mjs');
const { vendor, upstreamStatus, readProvenance } = await load('lib/vendor.mjs');

/** Fichero markdown real y público: aquí solo se prueba la mecánica, no el contenido. */
const FICHERO = 'https://raw.githubusercontent.com/github/gitignore/main/README.md';
/** Raíz de un repositorio: no tiene SKILL.md, así que debe pedir que elijas carpeta. */
const CARPETA_SIN_SKILL = 'https://github.com/github/gitignore';

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const root = defaultRoot();
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) process.stdout.write(`ok     ${label}${detail ? ' — ' + detail : ''}\n`);
  else { failures++; process.stderr.write(`FALLO  ${label}${detail ? ' — ' + detail : ''}\n`); }
};

process.stdout.write(`caja de arena: ${sandboxHome}\n\n`);
const realBefore = fingerprint(realStore);

// 1. un fichero real
const result = await vendor({ url: FICHERO, localNote: 'prueba de cadena completa, contenido de ejemplo' }, { root, cwd: CWD });
check('el vendorizado se completa', result.status === 'proposed', JSON.stringify(result.errors ?? result.conflicts ?? []));

if (result.status === 'proposed') {
  const dir = join(root, 'projects', projectKey(CWD), 'proposed', result.id);
  const ours = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const { data, body } = parseFrontmatter(ours);
  const snapshot = readFileSync(join(dir, 'upstream', 'README.md'), 'utf8');
  const provenance = JSON.parse(readFileSync(join(dir, 'provenance.json'), 'utf8'));

  check('frontmatter con nombre y descripción', Boolean(data.name && data.description), `${data.name} / ${data.description?.slice(0, 40)}…`);
  check('procedencia en el frontmatter', data.metadata.dsh.upstreamUrl === FICHERO);
  check('banner de versión local', /Versión local de una skill externa/.test(body));
  check('adaptación local visible', /prueba de cadena completa/.test(body));
  check('el original se guarda verbatim', snapshot.length > 0 && provenance.upstream.bytes === Buffer.byteLength(snapshot, 'utf8'));
  check('sin licencia declarada, se avisa', /no declara licencia/.test(provenance.licenseNote ?? ''));
  check('NO se sirve antes de aprobar', listForProject(CWD, { root }).length === 0);

  const moved = approve(data.name, projectKey(CWD), { root });
  check('se aprueba', moved.ok === true, moved.reason ?? '');
  const served = listForProject(CWD, { root });
  check('se sirve SOLO en su proyecto', served.length === 1 && listForProject('C:\\otro', { root }).length === 0, served.map((s) => s.id).join());

  const status = await upstreamStatus(data.name, projectKey(CWD), { root });
  check('el origen no ha cambiado', status.status === 'checked' && status.changed === false, `${status.storedSha256?.slice(0, 12)}…`);
  check('la procedencia es auditable', readProvenance(data.name, projectKey(CWD), { root })?.source?.url === FICHERO);
}

// 2. una carpeta sin SKILL.md: debe pedir que elijas, no traerse el repositorio entero
const dirResult = await vendor({ url: CARPETA_SIN_SKILL }, { root, cwd: CWD });
check('una carpeta con varias skills pide elegir', dirResult.status === 'needs-choice', dirResult.status);
check('y dice qué carpetas hay', (dirResult.dirs ?? []).length > 0, (dirResult.dirs ?? []).slice(0, 5).join(', '));

// 3. huella del store real: la prueba no debe tocarlo. Se mide, no se supone.
function fingerprint(dir) {
  if (!existsSync(dir)) return '(no existe)';
  const out = [];
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(`${full.slice(dir.length + 1)}:${statSync(full).size}`);
    }
  })(dir);
  return out.join('\n');
}
check('el store real quedó idéntico (huella antes/después)', realBefore === fingerprint(realStore), realStore);

rmSync(sandboxHome, { recursive: true, force: true });
process.stdout.write(`\n${failures === 0 ? 'CADENA COMPLETA EN VERDE' : 'CADENA EN ROJO'} — ${failures} fallos\n`);
process.exit(failures === 0 ? 0 : 1);
