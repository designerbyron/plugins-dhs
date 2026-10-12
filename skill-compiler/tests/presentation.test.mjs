#!/usr/bin/env node
/**
 * Puerta del feedback visual.
 *
 * Lo que se comprueba aquí es la **lógica** que alimenta la interfaz: el contrato del marcador con las
 * herramientas reales, y el plegado de eventos. Sin esto, la pieza visual sería una promesa; con esto,
 * lo único que queda sin verificar es el dibujo — y eso se dice en la documentación, no se disimula.
 *
 *   node --test
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { projectKey } from '../lib/compiler.mjs';
import { skillPropose, skillVendor } from '../lib/definitions.mjs';
import {
  MARKER_PREFIX, applyLearning, hasSomethingToShow, initialLearning, learningView, markerLine,
  parseMarker,
} from '../lib/presentation.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

// ── el marcador: contrato entre la herramienta y el plegado ──────────────────────────────────────

describe('marcador', () => {
  it('se compone y se lee de vuelta, con y sin id', () => {
    assert.equal(markerLine('created', 'mi-skill'), '[skill-compiler] created mi-skill');
    assert.equal(markerLine('none'), '[skill-compiler] none');
    assert.deepEqual(parseMarker('[skill-compiler] updated mi-skill\n\nresto'), { outcome: 'updated', id: 'mi-skill' });
    assert.deepEqual(parseMarker('  [skill-compiler] blocked  \n'), { outcome: 'blocked', id: '' });
  });

  it('no se confunde con texto que no es suyo', () => {
    assert.equal(parseMarker('Propuesta registrada: algo'), null);
    assert.equal(parseMarker(''), null);
    assert.equal(parseMarker(undefined), null);
    assert.equal(parseMarker('[skill-compiler] inventado x'), null, 'un resultado que no existe no se acepta');
  });

  it('sobrevive a un resultado largo por delante solo si abre la primera línea', () => {
    assert.equal(parseMarker('ruido\n[skill-compiler] created x'), null, 'el marcador tiene que abrir el resultado');
  });
});

// ── la traducción de resultado a palabra ────────────────────────────────────────────────────────

describe('resultado en una palabra', () => {
  const render = (definition, value) => definition.output.render({}, value)[0].text;

  it('distingue crear de actualizar, que es lo que el usuario quiere saber', () => {
    const propose = skillPropose({ root: 'C:\\tmp' });
    assert.match(render(propose, { status: 'proposed', summary: 's', id: 'nueva' }), /^\[skill-compiler\] created nueva/);
    assert.match(render(propose, { status: 'proposed', summary: 's', id: 'vista', updatesProposal: true }), /^\[skill-compiler\] updated vista/);
    assert.match(render(propose, { status: 'proposed', summary: 's', id: 'vista', updatesApproved: true }), /^\[skill-compiler\] updated vista/);
  });

  it('marca como rechazado lo que se rechazó, y como bloqueado lo que se paró a propósito', () => {
    const propose = skillPropose({ root: 'C:\\tmp' });
    assert.match(render(propose, { status: 'conflict', summary: 's', id: 'choca' }), /^\[skill-compiler\] rejected choca/);
    assert.match(render(propose, { status: 'invalid', summary: 's' }), /^\[skill-compiler\] rejected/);
    assert.match(render(propose, { status: 'no-project', summary: 's' }), /^\[skill-compiler\] rejected/);
    const vendor = skillVendor({ root: 'C:\\tmp' });
    assert.match(render(vendor, { status: 'blocked', summary: 's' }), /^\[skill-compiler\] blocked/);
    assert.match(render(vendor, { status: 'fetch-failed', summary: 's' }), /^\[skill-compiler\] none/, 'un fallo de red no es un rechazo: no pasó nada');
  });

  it('las herramientas de solo lectura no llevan marcador', async () => {
    const { skillReview, skillUpstreamCheck } = await import('../lib/definitions.mjs');
    const review = skillReview({ root: 'C:\\tmp' });
    const text = review.output.render({}, { projectKey: 'k', pending: [], approved: [], summary: 'solo leo' })[0].text;
    assert.equal(text, 'solo leo');
    const check = skillUpstreamCheck({ root: 'C:\\tmp' });
    assert.equal(check.output.render({}, { status: 'checked', summary: 'solo compruebo' })[0].text, 'solo compruebo');
  });

  it('el resultado real de una propuesta abre con el marcador correcto', () => {
    const s = sandbox();
    const tool = skillPropose({ root: s.root, curated: s.curated });
    const first = tool.execute(goodInput(), fakeExec(CWD));
    assert.match(tool.output.render({}, first)[0].text, /^\[skill-compiler\] created measured-decision-check/);

    // Reproponer el mismo id es un parche, y tiene que verse distinto.
    const second = tool.execute(goodInput({ body: `${goodInput().body}\n\n4. Un paso más.\n` }), fakeExec(CWD));
    assert.equal(second.updatesProposal, true);
    assert.match(tool.output.render({}, second)[0].text, /^\[skill-compiler\] updated measured-decision-check/);
  });
});

// ── el plegado ──────────────────────────────────────────────────────────────────────────────────

describe('plegado del estado', () => {
  const call = (name, callId, id) => ({ type: 'tool/call', seq: 1, time: 1000, data: { name, callId, arguments: JSON.stringify({ id }) } });
  const result = (callId, text, seq = 2) => ({
    type: 'tool/result', seq, time: 2000,
    data: { message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', content: [{ type: 'text', text }] }] } },
  });

  it('empieza en reposo y sin nada que enseñar', () => {
    const state = initialLearning();
    assert.equal(state.phase, 'idle');
    assert.equal(hasSomethingToShow(learningView(state)), false, 'en reposo no se pinta ni un hueco');
  });

  it('una llamada en vuelo pone el engranaje, y el resultado lo para', () => {
    const s0 = initialLearning();
    const s1 = applyLearning(s0, call('skill_propose', 'c1', 'mi-skill'));
    assert.equal(s1.phase, 'analyzing');
    assert.equal(learningView(s1).analyzers, 1);
    assert.equal(hasSomethingToShow(learningView(s1)), true);

    const s2 = applyLearning(s1, result('c1', `${markerLine('created', 'mi-skill')}\n\ndetalle`));
    assert.equal(s2.phase, 'done');
    assert.equal(s2.outcome, 'created');
    assert.equal(s2.id, 'mi-skill');
    assert.equal(learningView(s2).analyzers, 0);
    assert.equal(learningView(s2).created, 1);
  });

  it('distingue la creación del parche en los contadores', () => {
    let state = initialLearning();
    state = applyLearning(state, call('skill_propose', 'a', 'una'));
    state = applyLearning(state, result('a', markerLine('created', 'una')));
    state = applyLearning(state, call('skill_propose', 'b', 'otra'));
    state = applyLearning(state, result('b', markerLine('updated', 'otra'), 4));
    const view = learningView(state);
    assert.deepEqual([view.created, view.updated], [1, 1]);
    assert.equal(view.outcome, 'updated');
  });

  it('ignora lo que no es suyo devolviendo LA MISMA referencia', () => {
    const state = initialLearning();
    for (const event of [
      { type: 'assistant/message', data: {} },
      { type: 'tool/call', data: { name: 'pwsh', callId: 'x', arguments: '{}' } },
      { type: 'tool/result', data: { message: { source: { callId: 'desconocido' } } } },
      { type: 'turn/start', data: {} },
      null, undefined,
    ]) {
      assert.equal(applyLearning(state, event), state, `debería ignorar ${JSON.stringify(event)}`);
    }
  });

  it('la vista es la misma referencia mientras el estado no cambie', () => {
    const state = initialLearning();
    assert.equal(learningView(state), learningView(state));
  });

  it('un turno que cierra sin aprendizaje dice «sin cambios», que también es una respuesta', () => {
    let state = applyLearning(initialLearning(), { type: 'user/message', seq: 1, data: { source: { kind: 'user' } } });
    state = applyLearning(state, { type: 'turn/end', seq: 9, data: {} });
    assert.equal(state.outcome, 'none');
    assert.equal(state.phase, 'done');
    assert.equal(hasSomethingToShow(learningView(state)), true);
  });

  it('un turno con resultado NO lo convierte en «sin cambios»', () => {
    let state = applyLearning(initialLearning(), call('skill_propose', 'c1', 'x'));
    state = applyLearning(state, result('c1', markerLine('created', 'x')));
    state = applyLearning(state, { type: 'turn/end', seq: 9, data: {} });
    assert.equal(state.outcome, 'created');
  });

  it('un prompt humano nuevo retira el resultado anterior y conserva el acumulado', () => {
    let state = applyLearning(initialLearning(), call('skill_propose', 'c1', 'x'));
    state = applyLearning(state, result('c1', markerLine('created', 'x')));
    const after = applyLearning(state, { type: 'user/message', seq: 20, time: 3000, data: { source: { kind: 'user' } } });
    assert.equal(after.phase, 'idle');
    assert.equal(after.outcome, '');
    assert.equal(learningView(after).created, 1, 'el acumulado de la sesión no se reinicia');
    assert.equal(hasSomethingToShow(learningView(after)), false);
  });

  it('un mensaje de plugin no se confunde con un prompt humano', () => {
    const state = applyLearning(initialLearning(), call('skill_propose', 'c1', 'x'));
    const after = applyLearning(state, { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'user-approval' } } });
    assert.equal(after, state);
  });

  it('dos análisis a la vez mantienen el engranaje hasta que termina el último', () => {
    let state = initialLearning();
    state = applyLearning(state, call('skill_propose', 'a', 'una'));
    state = applyLearning(state, call('skill_vendor', 'b', 'dos'));
    assert.equal(learningView(state).analyzers, 2);
    state = applyLearning(state, result('a', markerLine('created', 'una'), 3));
    assert.equal(state.phase, 'analyzing', 'queda uno en vuelo');
    state = applyLearning(state, result('b', markerLine('updated', 'dos'), 4));
    assert.equal(state.phase, 'done');
  });

  it('un resultado sin marcador no inventa un resultado bueno ni le atribuye una skill', () => {
    let state = applyLearning(initialLearning(), call('skill_propose', 'c1', 'x'));
    state = applyLearning(state, result('c1', 'texto sin marcador'));
    assert.equal(state.outcome, 'none');
    assert.equal(state.id, '', 'sin marcador no se atribuye nada: mejor no decir de quién es que adivinarlo');
    assert.equal(state.phase, 'done');
  });

  it('la vista solo expone primitivos, para que el esquema no tenga sorpresas', () => {
    const view = learningView(initialLearning());
    for (const [key, value] of Object.entries(view)) {
      assert.equal(['string', 'number'].includes(typeof value), true, `${key} debería ser primitivo, es ${typeof value}`);
    }
    assert.deepEqual(Object.keys(view).sort(), ['analyzers', 'at', 'created', 'id', 'outcome', 'phase', 'turn', 'updated']);
  });

  it('una fase o un resultado desconocidos no llegan a la interfaz', () => {
    const view = learningView({ ...initialLearning(), phase: 'inventada', outcome: 'inventado' });
    assert.equal(view.phase, 'idle');
    assert.equal(view.outcome, '');
  });

  it('el id del plegado sobrevive a un resultado que trae el suyo', () => {
    let state = applyLearning(initialLearning(), call('skill_propose', 'c1', 'propuesto'));
    state = applyLearning(state, result('c1', markerLine('updated', 'otro')));
    assert.equal(state.id, 'otro', 'manda el id que la herramienta escribió de verdad');
  });
});

// ── el ámbito no se mezcla ──────────────────────────────────────────────────────────────────────

describe('independencia del ámbito', () => {
  it('el estado visual es de la sesión, y la clave de proyecto sigue saliendo del cwd', () => {
    const state = applyLearning(initialLearning(), {
      type: 'tool/call', seq: 1,
      data: { name: 'skill_vendor', callId: 'v1', arguments: JSON.stringify({ url: 'https://x.example/a.md' }) },
    });
    assert.equal(learningView(state).analyzers, 1);
    assert.equal(projectKey(CWD).startsWith('saas-corporative-'), true);
  });
});
