/**
 * E2E · vendorizar una skill externa de punta a punta: descarga, analisis, adaptacion, propuesta, aprobacion,
 * servicio y comprobacion del origen.
 *
 * Era `vendor-real.e2e.mjs`, un guion con `check()` y `process.exit` que la suite no recogia (extension
 * `.e2e.mjs`) y que necesitaba red. Ahora es una prueba real y corre en cada `npm test`:
 *
 *   · el `fetch` va INYECTADO y sirve respuestas con la MISMA forma que GitHub (listado de la API + raw),
 *     asi que se ejercita el camino completo de produccion —`parseSource` -> `fetchSource` ->
 *     `scanUpstream` -> `adaptUpstream` -> `propose` -> `approve` -> `listForProject` -> `upstreamStatus`—
 *     sin red y sin simular el resultado: lo que se afirma es lo que quedo en disco;
 *   · se afirma la procedencia, el snapshot verbatim, el banner, lo que se dejo fuera del origen y que el
 *     origen no cambio;
 *   · una carpeta con varias skills pide elegir, en vez de traerse el repositorio entero.
 *
 * Regresion que detecta (comprobada con mutacion controlada): que la procedencia se escriba sin la URL del
 * origen. El vendorizado sigue "funcionando" —propone y se aprueba— pero deja de ser auditable, y antes
 * nadie lo miraba porque el guion no tenia una sola asercion.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, defaultRoot, listForProject, parseFrontmatter, projectKey } from '../lib/compiler.mjs';
import { readProvenance, upstreamStatus, vendor } from '../lib/vendor.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const ID = 'measured-decisions';

const DIR_GH = 'https://github.com/acme/skills/tree/main/measured';
const API_DIR = 'https://api.github.com/repos/acme/skills/contents/measured?ref=main';
const RAW = 'https://raw.githubusercontent.com/acme/skills/main/measured/SKILL.md';
const REF_LIST = 'https://api.github.com/repos/acme/skills/contents/measured/references?ref=main';
const RAW_REF = 'https://raw.githubusercontent.com/acme/skills/main/measured/references/checklist.md';

const SKILL_UPSTREAM = [
  '---',
  'name: measured-decisions',
  'description: "Decide with measured evidence instead of impressions, every time."',
  'whenToUse: "Cuando una decision necesite un numero medido."',
  '---',
  '',
  '# Measured decisions',
  '',
  '## When to Use',
  '',
  'Cuando hay que decidir algo con evidencia y no con impresiones.',
  '',
  '## Procedure',
  '',
  '1. Mide antes de tocar nada y anota el numero.',
  '2. Compara contra el registro previo y declara la diferencia.',
  '3. Usa `references/checklist.md` para cerrar.',
].join('\n');
const CHECKLIST = '# Checklist\n\n- [ ] La medida existe\n- [ ] Coincide con el registro\n';

/** `fetch` inyectado: responde por URL con la forma de la API de GitHub. Registra lo que se pidio. */
function fakeFetch(routes) {
  const llamadas = [];
  const impl = async (url) => {
    llamadas.push(url);
    const ruta = routes[url];
    if (ruta === undefined) return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'no encontrado' };
    if (typeof ruta === 'string') return { ok: true, status: 200, headers: { get: () => null }, text: async () => ruta };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(ruta) };
  };
  impl.llamadas = llamadas;
  return impl;
}

const rutasDelOrigen = (texto = SKILL_UPSTREAM) => ({
  [API_DIR]: [
    { type: 'file', name: 'SKILL.md', download_url: RAW },
    { type: 'file', name: 'notes.md', download_url: 'https://raw.githubusercontent.com/acme/skills/main/measured/notes.md' },
    { type: 'dir', name: 'references' },
    { type: 'dir', name: 'scripts' },
  ],
  [RAW]: texto,
  [REF_LIST]: [{ type: 'file', name: 'checklist.md', download_url: RAW_REF }],
  [RAW_REF]: CHECKLIST,
});

const dirDe = (root) => join(root, 'projects', KEY, 'proposed', ID);

describe('E2E · vendorizar de punta a punta, con fetch inyectado del mismo camino', () => {
  it('descarga, adapta y deja la propuesta EN DISCO con procedencia y snapshot verbatim', async () => {
    const s = sandbox();
    const fetchImpl = fakeFetch(rutasDelOrigen());
    const r = await vendor({ url: DIR_GH, localNote: 'adaptada a los gates de este repositorio' },
      { root: s.root, cwd: CWD, curated: s.curated, fetchImpl, now: '2026-10-23T00:00:00.000Z' });

    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts ?? []));
    assert.equal(r.id, ID);
    const dir = dirDe(s.root);
    assert.equal(existsSync(join(dir, 'SKILL.md')), true);
    assert.equal(existsSync(join(dir, 'provenance.json')), true);
    assert.equal(existsSync(join(dir, 'upstream', 'SKILL.md')), true);
    assert.equal(existsSync(join(dir, 'upstream', 'references', 'checklist.md')), true);

    // El original se guarda TAL CUAL: es la prueba de que se tomo.
    assert.equal(readFileSync(join(dir, 'upstream', 'SKILL.md'), 'utf8'), SKILL_UPSTREAM);
    assert.equal(readFileSync(join(dir, 'upstream', 'references', 'checklist.md'), 'utf8'), CHECKLIST);

    const { data, body } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    assert.equal(data.metadata.dsh.upstreamUrl, DIR_GH);
    assert.equal(data.metadata.dsh.upstreamRef, 'main');
    assert.match(data.metadata.dsh.upstreamSha256, /^[a-f0-9]{64}$/);
    assert.match(body, /Versión local de una skill externa/);
    assert.match(body, /Adaptación local/);

    const provenance = JSON.parse(readFileSync(join(dir, 'provenance.json'), 'utf8'));
    assert.equal(provenance.source.url, DIR_GH);
    assert.equal(provenance.source.owner, 'acme');
    assert.equal(provenance.upstream.primary, 'SKILL.md');
    assert.equal(provenance.upstream.files.length, 2, 'el SKILL.md y su referencia');
    assert.match(provenance.licenseNote, /no declara licencia/);
    assert.equal(r.provenance.source.url, provenance.source.url, 'lo devuelto y lo escrito no coinciden');
  });

  it('declara lo que se dejo fuera del origen en vez de callarlo', async () => {
    const s = sandbox();
    const r = await vendor({ url: DIR_GH }, { root: s.root, cwd: CWD, curated: s.curated, fetchImpl: fakeFetch(rutasDelOrigen()), now: 't' });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? []));
    const provenance = JSON.parse(readFileSync(join(dirDe(s.root), 'provenance.json'), 'utf8'));
    assert.deepEqual(provenance.skipped.sort(), ['notes.md', 'scripts/'].sort());
    assert.equal(existsSync(join(dirDe(s.root), 'upstream', 'notes.md')), false, 'un no-markdown no se guarda');
  });

  it('no se sirve sin aprobacion; al aprobarla se sirve SOLO en su proyecto y el origen no cambio', async () => {
    const s = sandbox();
    const fetchImpl = fakeFetch(rutasDelOrigen());
    const r = await vendor({ url: DIR_GH }, { root: s.root, cwd: CWD, curated: s.curated, fetchImpl, now: '2026-10-23T00:00:00.000Z' });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? []));
    assert.deepEqual(listForProject(CWD, { root: s.root }), [], 'se sirvio antes de que un humano aprobara');

    const movida = approve(ID, KEY, { root: s.root, curated: s.curated });
    assert.equal(movida.ok, true, movida.reason ?? '');
    const servidas = listForProject(CWD, { root: s.root });
    assert.equal(servidas.length, 1);
    assert.equal(servidas[0].id, ID);
    assert.deepEqual(listForProject('C:\\xampp\\htdocs\\otro', { root: s.root }), [], 'se sirvio en un proyecto ajeno');

    const estado = await upstreamStatus(ID, KEY, { root: s.root, fetchImpl: fakeFetch(rutasDelOrigen()) });
    assert.equal(estado.status, 'checked', JSON.stringify(estado));
    assert.equal(estado.changed, false, 'el origen no cambio');

    const cambiado = await upstreamStatus(ID, KEY, { root: s.root, fetchImpl: fakeFetch(rutasDelOrigen(`${SKILL_UPSTREAM}\n\n4. Un paso nuevo.\n`)) });
    assert.equal(cambiado.changed, true, 'un cambio real en el origen tiene que notarse');

    const procedencia = readProvenance(ID, KEY, { root: s.root });
    assert.equal(procedencia.source.url, DIR_GH, 'la procedencia quedo ilegible tras aprobar');
    assert.equal(procedencia.state, 'approved');
  });

  it('una carpeta con varias skills pide elegir, no se trae el repositorio entero', async () => {
    const s = sandbox();
    const raiz = 'https://api.github.com/repos/acme/skills/contents/';
    const fetchImpl = fakeFetch({
      [raiz]: [{ type: 'dir', name: 'alpha' }, { type: 'dir', name: 'beta' }, { type: 'file', name: 'README.md' }],
    });
    const r = await vendor({ url: 'https://github.com/acme/skills' }, { root: s.root, cwd: CWD, curated: s.curated, fetchImpl, now: 't' });
    assert.equal(r.status, 'needs-choice', JSON.stringify(r));
    assert.deepEqual([...r.dirs].sort(), ['alpha', 'beta']);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed')), false, 'no se escribio nada que decidir');
  });

  it('la prueba escribe en la arena y no toca el almacen real', () => {
    const s = sandbox();
    assert.equal(defaultRoot().startsWith(s.root), true);
    assert.equal(existsSync(join(dirname(s.root), 'skills')), true);
  });
});
