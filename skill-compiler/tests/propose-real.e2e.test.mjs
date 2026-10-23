/**
 * E2E · proponer el conocimiento REAL de este repositorio, de punta a punta y en una caja de arena.
 *
 * Era `propose-real.e2e.mjs`: un guion con `console.log`, sin una sola asercion, que ademas escribia en el
 * almacen REAL (usaba `defaultRoot()` y el `cwd` del paquete) y que `node --test` no recogia por la
 * extension. Ahora es una prueba de verdad y se ejecuta con la suite:
 *
 *   · el cuerpo es el que se escribio ese dia, guardado en `tests/fixtures/propose-real-body.md` — la
 *     marca de verdad es que ese texto largo sobreviva entero, no que la funcion devuelva `proposed`;
 *   · la propuesta queda EN DISCO, con su `SKILL.md`, su `meta.json` y la huella que devolvio el motor;
 *   · no se sirve hasta que un humano la aprueba, y al aprobarla se sirve el MISMO contenido;
 *   · `DSH_HOME` apunta a la arena: el almacen real no se toca (lo mide tambien `check-hermetic`).
 *
 * Regresion que detecta (comprobada con mutacion controlada): que la composicion del `SKILL.md` deje de
 * escribir el cuerpo y solo guarde el frontmatter. Antes pasaba en verde porque nadie miraba el fichero.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, defaultRoot, listForProject, parseFrontmatter, projectKey, propose } from '../lib/compiler.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const PAQUETE = process.cwd();
const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const ID = 'dsh-skill-library-authoring';
const DESCRIPCION = 'Author, scope and de-duplicate skills in the DSH library without breaking discovery.';

/** El cuerpo que se escribio aquel dia, tal cual: es el dato que la prueba tiene que conservar. */
const CUERPO = readFileSync(join(PAQUETE, 'tests', 'fixtures', 'propose-real-body.md'), 'utf8');

const entrada = () => ({
  id: ID,
  description: DESCRIPCION,
  whenToUse: 'Antes de crear, editar o importar una skill de DSH, o cuando una skill no aparece en el catalogo.',
  tags: ['skills', 'authoring', 'library', 'frontmatter', 'canonical'],
  evidence: ['README.md'],
  body: CUERPO,
});

const rutaPropuesta = (root) => join(root, 'projects', KEY, 'proposed', ID);

describe('E2E · la propuesta real se escribe en disco y se verifica', () => {
  it('el motor la acepta, la escribe y devuelve la huella del fichero que dejo', () => {
    const s = sandbox();
    const r = propose(entrada(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts ?? []));
    assert.equal(r.id, ID);
    assert.equal(r.projectKey, KEY);

    const dir = rutaPropuesta(s.root);
    assert.equal(existsSync(join(dir, 'SKILL.md')), true, 'no hay SKILL.md en disco');
    assert.equal(existsSync(join(dir, 'meta.json')), true, 'no hay meta.json en disco');
    assert.deepEqual([...r.files].sort(), ['SKILL.md', 'meta.json']);

    const escrito = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    assert.equal(createHash('sha256').update(escrito).digest('hex'), r.sha256, 'la huella devuelta no es la del fichero');
    assert.equal(readFileSync(r.path, 'utf8'), escrito);
  });

  it('el cuerpo largo sobrevive ENTERO: ninguna linea del original se pierde', () => {
    const s = sandbox();
    const r = propose(entrada(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? []));
    const { data, body } = parseFrontmatter(readFileSync(join(rutaPropuesta(s.root), 'SKILL.md'), 'utf8'));

    assert.equal(data.name, ID);
    assert.equal(data.description, DESCRIPCION);
    assert.equal(data.metadata.dsh.origin, 'skill-compiler');
    assert.equal(data.metadata.dsh.projectKey, KEY);
    assert.equal(body.includes(`# ${DESCRIPCION}`), true, 'el titulo no se compone de la descripcion');

    const perdidas = CUERPO.split('\n').filter((linea) => linea.trim() !== '' && !body.includes(linea));
    assert.deepEqual(perdidas, [], `lineas del cuerpo que no llegaron al SKILL.md: ${perdidas.slice(0, 3).join(' | ')}`);
    assert.equal(body.includes('## Pitfalls'), true);
    assert.equal(body.includes('## When to Use'), true);
    assert.equal(body.includes('profundidad de descubrimiento es uno'), true);
    assert.equal(CUERPO.split('\n').length, 75, 'el fixture cambio de tamano: revisa que sigue siendo el cuerpo real');
  });

  it('el meta dice lo que la propuesta es, y la puerta dejo sus avisos', () => {
    const s = sandbox();
    const r = propose(entrada(), { root: s.root, curated: s.curated, cwd: CWD });
    const meta = JSON.parse(readFileSync(join(rutaPropuesta(s.root), 'meta.json'), 'utf8'));
    assert.equal(meta.id, ID);
    assert.equal(meta.state, 'proposed');
    assert.equal(meta.projectKey, KEY);
    assert.equal(meta.description, DESCRIPCION);
    assert.equal(Array.isArray(meta.warnings), true, 'la puerta tiene que declarar sus avisos');
    assert.deepEqual(meta.warnings, r.warnings, 'los avisos guardados no son los que devolvio el motor');
  });

  it('NO se sirve hasta que un humano la aprueba; al aprobarla se sirve el MISMO contenido', () => {
    const s = sandbox();
    const r = propose(entrada(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.deepEqual(listForProject(CWD, { root: s.root }), [], 'se sirvio antes de aprobar');

    const antes = readFileSync(join(rutaPropuesta(s.root), 'SKILL.md'), 'utf8');
    const movida = approve(ID, KEY, { root: s.root, curated: s.curated });
    assert.equal(movida.ok, true, movida.reason ?? '');

    const servidas = listForProject(CWD, { root: s.root });
    assert.equal(servidas.length, 1, 'aprobada y no servida en su proyecto');
    assert.equal(servidas[0].id, ID);
    assert.equal(readFileSync(servidas[0].path, 'utf8'), antes, 'lo servido no es lo que se valido');
    assert.deepEqual(listForProject('C:\\xampp\\htdocs\\otro', { root: s.root }), [], 'se sirvio en un proyecto ajeno');
    assert.equal(existsSync(rutaPropuesta(s.root)), false, 'la propuesta aprobada sigue en proposed');
  });

  it('la prueba escribe en la arena, no en el almacen real', () => {
    const s = sandbox();
    propose(entrada(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(defaultRoot().startsWith(s.root), true, `defaultRoot fuera de la arena: ${defaultRoot()}`);
    assert.equal(existsSync(join(dirname(s.root), 'skills')), true, 'la biblioteca curada de la arena no existe');
  });
});
