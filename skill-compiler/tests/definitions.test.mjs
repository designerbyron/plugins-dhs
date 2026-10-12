#!/usr/bin/env node
/**
 * Puerta de las DEFINICIONES del plugin: protocolo, herramientas y proveedor.
 *
 * `index.js` no se puede importar fuera del harness, así que aquí se prueban las definiciones planas
 * que `index.js` solo envuelve. Es la parte que decide qué se propone, qué se rechaza y qué se sirve,
 * y por eso es la que más cobertura necesita antes de instalar nada.
 *
 *   node --test
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, describe, it } from 'node:test';

import { approve, projectKey, propose } from '../lib/compiler.mjs';
import { PROTOCOL, PROVIDER_RANK, skillPropose, skillProvider, skillReview, scopeOf } from '../lib/definitions.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

// ── protocolo ────────────────────────────────────────────────────────────────────────────────────

describe('PROTOCOL', () => {
  it('nombra las dos vías, exige el ámbito de proyecto y avisa de que nada se activa solo', () => {
    assert.match(PROTOCOL, /skill_propose/, 'la vía del conocimiento propio');
    assert.match(PROTOCOL, /skill_vendor/, 'la vía de una skill de repositorio');
    assert.match(PROTOCOL, /nada se activa solo/i);
    assert.match(PROTOCOL, /bloquea/i, 'el bloqueo por contenido ajeno tiene que estar dicho');
  });

  it('es corto: entra en el prompt de todas las sesiones y se paga entero cada vez', () => {
    assert.equal(PROTOCOL.length < 1200, true, `demasiado largo: ${PROTOCOL.length} caracteres`);
  });
});

describe('scopeOf', () => {
  it('saca el ámbito del cwd de la sesión y tolera un exec incompleto', () => {
    assert.equal(scopeOf(fakeExec(CWD)), CWD);
    assert.equal(scopeOf({}), undefined);
    assert.equal(scopeOf(undefined), undefined);
  });
});

// ── skill_propose ────────────────────────────────────────────────────────────────────────────────

describe('skill_propose', () => {
  // La raíz curada se inyecta para que la prueba sea hermética: sin ella, el veto se mediría contra la
  // biblioteca real de la máquina y el resultado dependería del puesto, no del código.
  const tool = (s) => skillPropose({ root: s.root, curated: s.curated });

  it('propone, no activa, y dice el comando exacto para aprobar', () => {
    const s = sandbox();
    const result = tool(s).execute(goodInput(), fakeExec(CWD));
    assert.equal(result.status, 'proposed');
    assert.equal(existsSync(result.path), true);
    assert.match(result.summary, /NO está activa/);
    assert.match(result.summary, /skill-compiler\.mjs" approve measured-decision-check/);
    assert.equal(result.projectKey, projectKey(CWD));
  });

  it('rechaza por solapamiento sin escribir nada, y nombra con qué choca', () => {
    const s = sandbox();
    const result = tool(s).execute(goodInput({
      id: 'session-recovery-state',
      description: 'Rebuilding the state of a lost or closed session.',
      whenToUse: 'Cuando una sesión se cerró y hay que reconstruir su estado.',
    }), fakeExec(CWD));
    assert.equal(result.status, 'conflict');
    assert.match(result.summary, /No se escribió nada/);
    assert.match(result.summary, /session-state-recovery/);
    assert.equal(result.conflicts[0].id, 'session-state-recovery');
    assert.equal(JSON.stringify(result).includes('session-recovery-state'), true, 'nombra la rechazada');
  });

  it('rechaza una entrada inválida enumerando el motivo', () => {
    const s = sandbox();
    const result = tool(s).execute(goodInput({ id: 'Mala-Id' }), fakeExec(CWD));
    assert.equal(result.status, 'invalid');
    assert.equal(result.errors.length > 0, true);
    assert.match(result.summary, /kebab-case/);
    assert.equal(result.id, undefined, 'no se atribuye una propuesta que no existe');
  });

  it('se niega sin ámbito: sin proyecto no hay dónde aprender', () => {
    const s = sandbox();
    const result = tool(s).execute(goodInput(), {});
    assert.equal(result.status, 'no-project');
    assert.match(result.summary, /RECHAZADA/);
  });

  it('avisa cuando la propuesta reemplazaría una skill ya aprobada', () => {
    const s = sandbox();
    const t = tool(s);
    t.execute(goodInput(), fakeExec(CWD));
    approve('measured-decision-check', projectKey(CWD), { root: s.root });
    const second = t.execute(goodInput({ body: `${goodInput().body}\n\n4. Un paso más.\n` }), fakeExec(CWD));
    assert.equal(second.status, 'proposed');
    assert.equal(second.updatesApproved, true);
    assert.match(second.summary, /reemplazará una skill ya aprobada/);
  });

  it('informa del mismo tema en otro proyecto sin vetarlo', () => {
    const s = sandbox();
    const t = tool(s);
    t.execute(goodInput(), fakeExec('C:\\otro-proyecto'));
    const result = t.execute(goodInput({ id: 'evidence-first-decision' }), fakeExec(CWD));
    assert.equal(result.status, 'proposed');
    assert.equal(result.relatedElsewhere[0].id, 'measured-decision-check');
    assert.match(result.summary, /ya vive en otro proyecto/);
  });

  it('declara la forma que el harness valida: parámetros obligatorios y esquema de salida', () => {
    const definition = skillPropose({ root: 'C:\\tmp' });
    assert.equal(definition.name, 'skill_propose');
    for (const key of ['id', 'description', 'body']) assert.equal(definition.parameters[key].required, true, `${key} debe ser obligatorio`);
    assert.equal(typeof definition.output.schema.properties.status.required, 'boolean');
    assert.equal(typeof definition.output.render, 'function');
    // El resultado abre con el marcador: es el contrato del que depende el plegado del feedback visual.
    const rendered = definition.output.render({}, { status: 'proposed', summary: 'hola', id: 'x-y' });
    assert.equal(rendered[0].text.startsWith('[skill-compiler] '), true, rendered[0].text);
    assert.match(rendered[0].text, /hola/);
  });
});

// ── skill_review ─────────────────────────────────────────────────────────────────────────────────

describe('skill_review', () => {
  const tool = (root) => skillReview({ root });

  it('no tiene parámetros y solo lee', () => {
    const definition = tool('C:\\tmp');
    assert.deepEqual(definition.parameters, {});
    const empty = tool(sandbox().root).execute({}, fakeExec(CWD));
    assert.deepEqual(empty.pending, []);
    assert.deepEqual(empty.approved, []);
    assert.match(empty.summary, /Pendientes de aprobación: ninguna/);
  });

  it('distingue lo pendiente de lo aprobado', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const before = tool(s.root).execute({}, fakeExec(CWD));
    assert.deepEqual(before.pending.map((p) => p.id), ['measured-decision-check']);
    assert.deepEqual(before.approved, []);

    approve('measured-decision-check', projectKey(CWD), { root: s.root });
    const after = tool(s.root).execute({}, fakeExec(CWD));
    assert.deepEqual(after.pending, []);
    assert.deepEqual(after.approved.map((p) => p.id), ['measured-decision-check']);
  });

  it('no se inventa un ámbito cuando la sesión no tiene cwd', () => {
    const result = tool(sandbox().root).execute({}, {});
    assert.equal(result.projectKey, '(sin proyecto)');
    assert.deepEqual(result.approved, []);
  });
});

// ── proveedor de skills ──────────────────────────────────────────────────────────────────────────

describe('skill_provider', () => {
  const withApproved = (cwd = CWD) => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    approve('measured-decision-check', projectKey(cwd), { root: s.root });
    return s;
  };

  it('sirve solo lo aprobado, y solo del proyecto que pregunta', async () => {
    const s = withApproved();
    const provider = skillProvider({ root: s.root });
    const mine = await provider.list({ cwd: CWD });
    assert.deepEqual(mine.map((c) => c.name), ['measured-decision-check']);
    assert.deepEqual(await provider.list({ cwd: 'C:\\otro-proyecto' }), [], 'no debe cargarse fuera de su proyecto');
    assert.deepEqual(await provider.list({}), [], 'sin cwd no hay ámbito, y sin ámbito no se sirve nada');
  });

  it('entrega candidatos con la forma que el registro de skills espera', async () => {
    const s = withApproved();
    const [candidate] = await skillProvider({ root: s.root }).list({ cwd: CWD });
    assert.equal(candidate.provider, 'skill-compiler');
    assert.equal(candidate.source, 'aprendido');
    assert.equal(candidate.rank, PROVIDER_RANK);
    assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true });
    assert.equal(candidate.whenToUse, goodInput().whenToUse);
    assert.equal(typeof candidate.locator.path, 'string');
    assert.equal(candidate.resourceBase.kind, 'directory');
    assert.equal(/(modelInvocable|userInvocable)/.test(candidate.name), false);
  });

  it('carga el cuerpo sin frontmatter y devuelve undefined si desapareció', async () => {
    const s = withApproved();
    const provider = skillProvider({ root: s.root });
    const [candidate] = await provider.list({ cwd: CWD });
    const loaded = await provider.get(candidate);
    assert.equal(loaded.name, 'measured-decision-check');
    assert.equal(loaded.content.startsWith('# '), true);
    assert.equal(/^---/.test(loaded.content), false);
    assert.equal(await provider.get({ locator: { path: 'C:\\no\\existe\\SKILL.md' } }), undefined);
    assert.equal(await provider.get({}), undefined);
  });

  it('salta una skill aprobada que perdió su descripción, sin tumbar el catálogo', async () => {
    const s = withApproved();
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const broken = join(s.root, 'projects', projectKey(CWD), 'approved', 'rota');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'SKILL.md'), '---\nname: rota\n---\n\n# sin descripcion\n');
    const list = await skillProvider({ root: s.root }).list({ cwd: CWD });
    assert.deepEqual(list.map((c) => c.name), ['measured-decision-check'], 'la rota se salta, la buena sigue');
  });
});
