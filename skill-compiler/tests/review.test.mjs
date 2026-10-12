#!/usr/bin/env node
/**
 * La página de revisión, probada contra un servidor REAL.
 *
 * Es la lección del incidente aplicada: no se prueba la idea con un doble, se levanta el servidor de
 * verdad en un puerto efímero, se le hacen peticiones HTTP de verdad, y se comprueba **el disco** —que la
 * propuesta se movió de `proposed/` a `approved/`— y no solo la respuesta.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, parseFrontmatter, projectKey, propose, reject, validateInput } from '../lib/compiler.mjs';
import { buildReview, createReviewServer, createToken, escapeHtml, resolveAction, tokenMatches } from '../lib/review.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\un\\proyecto';
const KEY = projectKey(CWD);

/** El mismo criterio que usa el terminal para decidir si una propuesta pasa la puerta. */
function check(id, key, root) {
  const file = join(root, 'projects', key, 'proposed', id, 'SKILL.md');
  if (!existsSync(file)) return { ok: false, errors: [`no existe una propuesta ${id}`], warnings: [] };
  const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
  return validateInput({ id: data.name ?? id, description: data.description ?? '', whenToUse: data.whenToUse ?? '', body: body.trim() });
}

/** Levanta el servidor de verdad, con el almacén en la caja de arena. */
async function serve(s) {
  const review = createReviewServer({
    root: s.root,
    key: KEY,
    check: (id, key) => check(id, key, s.root),
    approve: (id, key) => approve(id, key, { root: s.root }),
    reject: (id, key) => reject(id, key, { root: s.root }),
    port: 0,
  });
  const port = await review.listen();
  return { review, port, base: `http://127.0.0.1:${port}` };
}

describe('token y escapado', () => {
  it('el token se compara en tiempo constante y rechaza longitudes distintas', () => {
    const token = createToken();
    assert.equal(token.length, 32);
    assert.equal(tokenMatches(token, token), true);
    assert.equal(tokenMatches(token, token.slice(0, -1)), false);
    assert.equal(tokenMatches(token, ''), false);
    assert.equal(tokenMatches(token, undefined), false);
    assert.equal(tokenMatches(undefined, token), false);
  });

  it('escapa lo que escribe un modelo: una descripción no puede convertirse en marcado', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('a & b "c" \'d\''), 'a &amp; b &quot;c&quot; &#39;d&#39;');
  });
});

describe('página servida de verdad', () => {
  it('sin token no responde, y con el token sirve la propuesta', async () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const { review, base } = await serve(s);
    try {
      const sinToken = await fetch(`${base}/`);
      assert.equal(sinToken.status, 403);
      const conTokenEquivocado = await fetch(`${base}/?token=${'0'.repeat(32)}`);
      assert.equal(conTokenEquivocado.status, 403);

      const ok = await fetch(`${base}/?token=${review.token}`);
      assert.equal(ok.status, 200);
      const html = await ok.text();
      assert.match(html, /measured-decision-check/);
      assert.match(html, /en verde/, 'la página tiene que enseñar el resultado de la validación');
      assert.match(html, /name="action" value="approve"/, 'una propuesta en verde tiene que poder aprobarse');
    } finally {
      review.server.close();
    }
  });

  it('aprobar desde la página mueve la propuesta en el DISCO', async () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const { review, base } = await serve(s);
    try {
      const response = await fetch(`${base}/action?token=${review.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: 'measured-decision-check', action: 'approve' }),
        redirect: 'manual',
      });
      assert.equal(response.status, 303);
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check', 'SKILL.md')), true);
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'measured-decision-check', 'SKILL.md')), false);
    } finally {
      review.server.close();
    }
  });

  it('rechazar mueve a rejected, y no borra nada', async () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const { review, base } = await serve(s);
    try {
      await fetch(`${base}/action?token=${review.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: 'measured-decision-check', action: 'reject' }),
        redirect: 'manual',
      });
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'rejected', 'measured-decision-check', 'SKILL.md')), true);
    } finally {
      review.server.close();
    }
  });

  it('un id desconocido y una acción inventada no tocan nada', async () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const { review, base } = await serve(s);
    try {
      const desconocido = await fetch(`${base}/action?token=${review.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: '../../etc/passwd', action: 'approve' }),
        redirect: 'manual',
      });
      assert.equal(desconocido.status, 404, 'un id que no está pendiente no puede mover nada');

      const inventada = await fetch(`${base}/action?token=${review.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: 'measured-decision-check', action: 'borrar-todo' }),
        redirect: 'manual',
      });
      assert.equal(inventada.status, 400);
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'measured-decision-check', 'SKILL.md')), true);
    } finally {
      review.server.close();
    }
  });

  it('una propuesta que no pasa la puerta no se puede aprobar, ni desde la página', () => {
    const s = sandbox();
    const dir = join(s.root, 'projects', KEY, 'proposed', 'rota-a-mano');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: rota-a-mano\ndescription: "corta"\n---\n\ntexto\n');
    const model = buildReview(s.root, KEY, (id, key) => check(id, key, s.root));
    assert.equal(model.pending.length, 1);
    assert.equal(model.pending[0].check.ok, false, 'la comprobación tiene que cazarla');

    const review = createReviewServer({
      root: s.root, key: KEY,
      check: (id, key) => check(id, key, s.root),
      approve: (id, key) => approve(id, key, { root: s.root }),
      reject: (id, key) => reject(id, key, { root: s.root }),
    });

    // Ni con la petición bien formada: la puerta manda.
    const result = resolveAction(model, 'rota-a-mano', 'approve', {
      approve: (id, key) => approve(id, key, { root: s.root }),
      reject: (id, key) => reject(id, key, { root: s.root }),
    });
    assert.equal(result.status, 303);
    assert.match(result.notice, /no pasa la validación/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'rota-a-mano')), false);
    assert.equal(typeof review.urlFor, 'function');
  });
});
