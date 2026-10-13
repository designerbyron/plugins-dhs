#!/usr/bin/env node
/**
 * Contrato de salida de las herramientas, contra el validador **del harness**.
 *
 * Esta puerta existe por un defecto real y medido: `skill_propose` devolvía un campo
 * (`updatesProposal`) que su esquema de salida no declaraba, así que el harness rechazaba el resultado
 * entero —
 *
 *     "value.updatesProposal" is not a declared property (additionalProperties: false)
 *
 * — y la propuesta, que ya estaba escrita en disco, llegaba al modelo como un error: «no se creó nada».
 * Un efecto aplicado con una respuesta rechazada.
 *
 * El motivo de que nadie lo viera: las pruebas miraban `status`, `summary` y el marcador, pero **nunca
 * comparaban el valor que devuelve `execute` con el esquema que el propio harness va a validar**. Aquí se
 * compara, con el juez de verdad (`validateJsonSchemaValue`, el mismo que lanza el error) y contra el
 * esquema **compilado** (`tool.output.schema`, el que `defineTool` produce), no contra una copia del
 * fichero. Cada herramienta recorre **todas las ramas alcanzables** de su `execute`, porque un esquema se
 * equivoca en la rama que nadie ejecuta.
 *
 * Lo que NO cubre, y se dice: no hace red real (el `fetch` va inyectado) ni comprueba el dibujo de la
 * interfaz; y sólo cubre las ramas que se pueden provocar en caja de arena — si alguna no lo fuera, se
 * declara aquí en vez de fingir que está cubierta.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineTool, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';

import { approve, projectKey, propose } from '../lib/compiler.mjs';
import { skillPropose, skillReview, skillUpstreamCheck, skillVendor } from '../lib/definitions.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';
import { after } from 'node:test';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const RAW = 'https://raw.githubusercontent.com/acme/skills/main/measured/SKILL.md';

const UPSTREAM_SKILL = [
  '---',
  'name: measured-decisions',
  'description: "Decide with measured evidence instead of impressions."',
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
  '1. Mide antes de tocar nada y anota el número.',
  '2. Compara contra el registro previo y declara la diferencia.',
].join('\n');

/** Respuestas del `fetch` falso, por URL: sin red y determinista. */
function fakeFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (route === undefined) return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'no encontrado' };
    if (typeof route === 'string') return { ok: true, status: 200, headers: { get: () => null }, text: async () => route };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => route.text };
  };
}

/**
 * Ejecuta una rama y la juzga con el validador del harness.
 *
 * Tres comprobaciones, y la tercera no es ceremonia: el harness materializa el valor como JSON, así que
 * un `undefined` escondido en un campo se pierde por el camino. El round-trip lo delata.
 */
async function judge(definition, label, run) {
  const tool = defineTool(definition);
  const value = await run(tool);
  const violations = validateJsonSchemaValue(tool.output.schema, value);
  assert.deepEqual(violations, [], `${definition.name} · ${label} → el harness rechazaría esto: ${JSON.stringify(violations)}`);
  const roundTrip = JSON.parse(JSON.stringify(value));
  assert.equal(JSON.stringify(roundTrip), JSON.stringify(value),
    `${definition.name} · ${label} → el valor pierde algo al serializarse (¿un undefined en un campo declarado?)`);
  return value;
}

// ── skill_propose ────────────────────────────────────────────────────────────────────────────────

describe('contrato de salida · skill_propose', () => {
  const factory = (s) => skillPropose({ root: s.root, curated: s.curated });

  it('propuesta nueva', async () => {
    const s = sandbox();
    const value = await judge(factory(s), 'nueva', (tool) => tool.execute(goodInput(), fakeExec(CWD)));
    assert.equal(value.status, 'proposed');
  });

  it('propuesta que actualiza una ya propuesta (updatesProposal)', async () => {
    const s = sandbox();
    const tool = factory(s);
    const value = await judge(tool, 'actualiza propuesta', async () => {
      tool.execute(goodInput(), fakeExec(CWD));
      return tool.execute(goodInput({ body: `${goodInput().body}\n\n4. Un paso más.\n` }), fakeExec(CWD));
    });
    assert.equal(value.updatesProposal, true, 'la rama tiene que salir con updatesProposal');
  });

  it('propuesta que reemplazaría una aprobada (updatesApproved)', async () => {
    const s = sandbox();
    const tool = factory(s);
    const value = await judge(tool, 'reemplaza aprobada', async () => {
      tool.execute(goodInput(), fakeExec(CWD));
      approve('measured-decision-check', projectKey(CWD), { root: s.root });
      return tool.execute(goodInput({ body: `${goodInput().body}\n\n4. Un paso más.\n` }), fakeExec(CWD));
    });
    assert.equal(value.updatesApproved, true);
  });

  it('solapamiento con la biblioteca curada (conflict)', async () => {
    const s = sandbox();
    const value = await judge(factory(s), 'conflict', (tool) => tool.execute(goodInput({
      id: 'session-recovery-state',
      description: 'Rebuilding the state of a lost or closed session.',
      whenToUse: 'Cuando una sesión se cerró y hay que reconstruir su estado.',
    }), fakeExec(CWD)));
    assert.equal(value.status, 'conflict');
  });

  it('entrada inválida (invalid)', async () => {
    const s = sandbox();
    const value = await judge(factory(s), 'invalid', (tool) => tool.execute(goodInput({ id: 'Mala-Id' }), fakeExec(CWD)));
    assert.equal(value.status, 'invalid');
  });

  it('sin ámbito (no-project)', async () => {
    const s = sandbox();
    const value = await judge(factory(s), 'no-project', (tool) => tool.execute(goodInput(), {}));
    assert.equal(value.status, 'no-project');
  });

  it('mismo tema en otro proyecto (relatedElsewhere)', async () => {
    const s = sandbox();
    const tool = factory(s);
    const value = await judge(tool, 'relatedElsewhere', async () => {
      tool.execute(goodInput(), fakeExec('C:\\otro-proyecto'));
      return tool.execute(goodInput({ id: 'evidence-first-decision' }), fakeExec(CWD));
    });
    assert.equal(value.relatedElsewhere.length > 0, true);
  });

  it('con el modo de esta sesión activo (autoApproved)', async () => {
    const s = sandbox();
    const catalog = { notify: () => {} };
    const modeOn = { agent: { session: { header: { cwd: CWD }, snapshotEvents: () => [{ type: 'command/run', data: { name: 'skill-auto', args: ' activar' } }] } } };
    const value = await judge(skillPropose({ root: s.root, curated: s.curated, catalog }), 'autoApproved', (tool) => tool.execute(goodInput(), modeOn));
    assert.equal(value.autoApproved, true);
  });
});

// ── skill_review ─────────────────────────────────────────────────────────────────────────────────

describe('contrato de salida · skill_review', () => {
  it('con proyecto, sin nada dentro', async () => {
    const s = sandbox();
    await judge(skillReview({ root: s.root }), 'vacío', (tool) => tool.execute({}, fakeExec(CWD)));
  });

  it('con propuestas y aprobadas', async () => {
    const s = sandbox();
    const value = await judge(skillReview({ root: s.root }), 'con contenido', async (tool) => {
      propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
      approve('measured-decision-check', projectKey(CWD), { root: s.root });
      // Un tema distinto a propósito: con la misma descripción, el anti-solapamiento la rechazaría y la
      // prueba mediría otra cosa (el conflicto) creyendo medir el listado.
      propose(
        goodInput({
          id: 'otro-tema-distinto',
          description: 'Otra cosa sin relación con lo anterior, para que no solape con nada.',
          whenToUse: 'Cuando haga falta otra cosa.',
        }),
        { root: s.root, curated: s.curated, cwd: CWD },
      );
      return tool.execute({}, fakeExec(CWD));
    });
    assert.deepEqual(value.approved.map((x) => x.id), ['measured-decision-check']);
    assert.deepEqual(value.pending.map((x) => x.id), ['otro-tema-distinto']);
  });

  it('sin ámbito (no-project)', async () => {
    const s = sandbox();
    const value = await judge(skillReview({ root: s.root }), 'no-project', (tool) => tool.execute({}, {}));
    assert.equal(value.projectKey, '(sin proyecto)');
  });
});

// ── skill_vendor ─────────────────────────────────────────────────────────────────────────────────

describe('contrato de salida · skill_vendor', () => {
  const routes = (text = UPSTREAM_SKILL) => ({ [RAW]: text });
  const factory = (s, fetchImpl) => skillVendor({ root: s.root, curated: s.curated, fetchImpl });

  it('nuestra versión creada (proposed)', async () => {
    const s = sandbox();
    const value = await judge(factory(s, fakeFetch(routes())), 'proposed', (tool) => tool.execute({ url: RAW }, fakeExec(CWD)));
    assert.equal(value.status, 'proposed');
  });

  it('nuestra versión actualizada (proposed con updatesProposal)', async () => {
    const s = sandbox();
    const value = await judge(factory(s, fakeFetch(routes())), 'updatesProposal', async (tool) => {
      await tool.execute({ url: RAW }, fakeExec(CWD));
      return tool.execute({ url: RAW, localNote: 'segunda pasada' }, fakeExec(CWD));
    });
    assert.equal(value.updatesProposal, true);
  });

  it('origen con secreto (blocked)', async () => {
    const s = sandbox();
    const value = await judge(factory(s, fakeFetch(routes(`${UPSTREAM_SKILL}\n\ntoken = \"eyJEXA...0000\"\n`))), 'blocked', (tool) => tool.execute({ url: RAW }, fakeExec(CWD)));
    assert.equal(value.status, 'blocked');
  });

  it('solapamiento con la curada (conflict)', async () => {
    const s = sandbox();
    const colision = UPSTREAM_SKILL
      .replace('name: measured-decisions', 'name: session-state-recovery')
      .replace(/^description: .*$/m, 'description: "Rebuild state after a lost or closed session."');
    const value = await judge(factory(s, fakeFetch(routes(colision))), 'conflict', (tool) => tool.execute({ url: RAW }, fakeExec(CWD)));
    assert.equal(value.status, 'conflict');
  });

  it('enlace que no sabe leer (bad-url)', async () => {
    const s = sandbox();
    const value = await judge(factory(s, fakeFetch({})), 'bad-url', (tool) => tool.execute({ url: 'https://github.com/acme/skills/issues/3' }, fakeExec(CWD)));
    assert.equal(value.status, 'bad-url');
  });

  it('fallo de red (fetch-failed)', async () => {
    const s = sandbox();
    const value = await judge(factory(s, fakeFetch({})), 'fetch-failed', (tool) => tool.execute({ url: RAW }, fakeExec(CWD)));
    assert.equal(value.status, 'fetch-failed');
  });

  it('sin ámbito (no-project)', async () => {
    const s = sandbox();
    const value = await judge(factory(s, fakeFetch(routes())), 'no-project', (tool) => tool.execute({ url: RAW }, {}));
    assert.equal(value.status, 'no-project');
  });

  it('con el modo de esta sesión activo (autoApproved)', async () => {
    const s = sandbox();
    const catalog = { notify: () => {} };
    const modeOn = { agent: { session: { header: { cwd: CWD }, snapshotEvents: () => [{ type: 'command/run', data: { name: 'skill-auto', args: ' activar' } }] } } };
    const value = await judge(skillVendor({ root: s.root, curated: s.curated, fetchImpl: fakeFetch(routes()), catalog }), 'autoApproved', (tool) => tool.execute({ url: RAW }, modeOn));
    assert.equal(value.autoApproved, true);
  });
});

// ── skill_upstream_check ─────────────────────────────────────────────────────────────────────────

describe('contrato de salida · skill_upstream_check', () => {
  it('sin ámbito (no-project)', async () => {
    const s = sandbox();
    const value = await judge(skillUpstreamCheck({ root: s.root }), 'no-project', (tool) => tool.execute({ id: 'x' }, {}));
    assert.equal(value.status, 'no-project');
  });

  it('id que no viene de fuera (rama de error)', async () => {
    const s = sandbox();
    const value = await judge(skillUpstreamCheck({ root: s.root }), 'no vendorizada', (tool) => tool.execute({ id: 'no-existe' }, fakeExec(CWD)));
    assert.notEqual(value.status, 'checked');
  });

  it('origen sin cambios (checked, changed:false)', async () => {
    const s = sandbox();
    const fetchImpl = fakeFetch({ [RAW]: UPSTREAM_SKILL });
    const value = await judge(skillUpstreamCheck({ root: s.root, fetchImpl }), 'checked igual', async (tool) => {
      await skillVendor({ root: s.root, curated: s.curated, fetchImpl }).execute({ url: RAW }, fakeExec(CWD));
      return tool.execute({ id: 'measured-decisions' }, fakeExec(CWD));
    });
    assert.equal(value.status, 'checked');
    assert.equal(value.changed, false);
  });

  it('origen cambiado (checked, changed:true)', async () => {
    const s = sandbox();
    const fetchImpl = fakeFetch({ [RAW]: `${UPSTREAM_SKILL}\n\n5. Un paso nuevo en el origen.\n` });
    const value = await judge(skillUpstreamCheck({ root: s.root, fetchImpl }), 'checked cambiado', async (tool) => {
      await skillVendor({ root: s.root, curated: s.curated, fetchImpl: fakeFetch({ [RAW]: UPSTREAM_SKILL }) }).execute({ url: RAW }, fakeExec(CWD));
      return tool.execute({ id: 'measured-decisions' }, fakeExec(CWD));
    });
    assert.equal(value.changed, true);
  });
});
