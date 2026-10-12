#!/usr/bin/env node
/**
 * El contrato de la proyección, ejecutado contra el registro **real** del harness.
 *
 * Esta prueba existe por un incidente con nombre y apellidos:
 *
 *     Failed to load history: failed to project session "session-031083a5-…":
 *     def.wire.viewSchema.parse is not a function
 *
 * El plugin registraba su unidad con esquemas de `@deepseek-ai/schemastery`. Esos esquemas **existen**
 * y se resuelven llamándolos como función, `schema(valor)`, así que el registro los aceptó sin queja:
 * `register()` no valida lo que le dan. El fallo apareció mucho después, al **leer** una sesión, porque
 * el contrato del registro es `ZodType` y llama `schema.parse(...)`. Resultado: un adorno visual dejaba
 * el historial de sesiones sin cargar.
 *
 * Las pruebas que ya había usaban un contexto doble y nunca tocaron el registro. Estas sí: montan el
 * registro real, registran la unidad real y **proyectan**. Si alguien vuelve a registrar esquemas que
 * no validan, esto se pone rojo antes de que nadie pierda su historial.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';

import {
  LEARNING_KEY,
  learningProjection,
  learningStateSchema,
  learningViewSchema,
  projectionContractProblems,
} from '../lib/projection.mjs';

/** El registro REAL, montado como lo monta el harness. */
async function realRegistry() {
  const ctx = new Context();
  ctx.plugin(SessionProjectionRegistry);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const registry = ctx.sessionProjections;
  assert.equal(typeof registry?.register, 'function', 'el registro real no se montó');
  return registry;
}

/** Una sesión mínima con la forma que el registro consume: su log y su cursor. */
function fakeSession(events = []) {
  return {
    seq: events.length,
    header: { id: 'sesión-de-prueba' },
    inheritedEventCount: 0,
    snapshotEvents: () => events,
    eventAt: (seq) => events.find((event) => event.seq === seq),
  };
}

const toolCall = (seq, callId) => ({
  type: 'tool/call',
  seq,
  time: 1_000 + seq,
  data: { name: 'skill_propose', callId, arguments: JSON.stringify({ id: 'medida-por-evidencia' }) },
});
/** La forma real del resultado, la misma que usa `presentation.test.mjs`: el texto va anidado. */
const toolResult = (seq, callId, text) => ({
  type: 'tool/result',
  seq,
  time: 1_000 + seq,
  data: { message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', content: [{ type: 'text', text }] }] } },
});

describe('contrato de la proyección con el registro real', () => {
  it('la unidad cumple el contrato que el registro NO comprueba por nosotros', () => {
    assert.deepEqual(projectionContractProblems(learningProjection()), []);
  });

  it('los esquemas son Zod: el registro los llama con parse()', () => {
    // La comprobación que habría cazado el incidente en una línea.
    assert.equal(typeof learningStateSchema.parse, 'function', 'stateSchema tiene que validar con parse');
    assert.equal(typeof learningViewSchema.parse, 'function', 'viewSchema tiene que validar con parse');
    assert.equal(learningProjection().wire.viewSchema, learningViewSchema);
  });

  it('el guardián caza una unidad con esquemas que existen pero no validan', () => {
    // La forma exacta del defecto: un objeto con `object()` al estilo de schemastery, sin `parse`.
    const fake = (schema) => ({ object: () => schema, __kind: 'esquema que no valida' });
    const defective = { ...learningProjection(), stateSchema: fake({}), wire: { ...learningProjection().wire, viewSchema: fake({}) } };
    const problems = projectionContractProblems(defective);
    assert.equal(problems.length >= 2, true, `el guardián tiene que ver los dos esquemas: ${JSON.stringify(problems)}`);
    assert.match(problems.join(' '), /stateSchema/);
    assert.match(problems.join(' '), /wire\.viewSchema/);
  });

  it('el registro real proyecta la sesión sin lanzar, y con el valor esperado', async () => {
    const registry = await realRegistry();
    registry.register(learningProjection());

    const events = [toolCall(0, 'call-1'), toolResult(1, 'call-1', '[skill-compiler] created medida-por-evidencia')];
    const { asOfSeq, values } = registry.snapshot(fakeSession(events), [LEARNING_KEY]);

    assert.equal(asOfSeq, events.length - 1, 'el corte tiene que reflejar el último evento');
    assert.deepEqual(values[LEARNING_KEY], {
      phase: 'done',
      outcome: 'created',
      id: 'medida-por-evidencia',
      analyzers: 0,
      created: 1,
      updated: 0,
      at: 1_001,
      turn: 0,
    });
  });

  it('la lectura en frío del historial restaura desde un punto de control, y es lo que fallaba', async () => {
    const registry = await realRegistry();
    registry.register(learningProjection());

    // Un punto de control con la forma exacta que se encontró en disco para la sesión del incidente.
    const checkpoint = {
      [LEARNING_KEY]: {
        ver: 1,
        seq: 4_025,
        val: { phase: 'idle', outcome: '', id: '', pending: [], created: 0, updated: 0, at: 0, turn: 0, seq: 3_959 },
      },
    };

    // Sin el arreglo, esta llamada lanzaba `def.wire.viewSchema.parse is not a function`.
    const restored = registry.restore(checkpoint, [], 0, { id: 'sesión-de-prueba' }, 0);
    assert.deepEqual(restored.snapshot.values[LEARNING_KEY], {
      phase: 'idle',
      outcome: '',
      id: '',
      analyzers: 0,
      created: 0,
      updated: 0,
      at: 0,
      turn: 0,
    });
    // Y la fila refrescada conserva la versión del estado para el siguiente ciclo.
    assert.equal(restored.checkpoint[LEARNING_KEY].ver, 1);
  });

  it('un punto de control ilegible no impide leer la sesión', async () => {
    const registry = await realRegistry();
    registry.register(learningProjection());

    const corruptos = [42, 'texto', null, [], {}, { pending: 'no', created: 'muchos' }, { phase: 7, outcome: {}, id: [] }];
    for (const val of corruptos) {
      const checkpoint = { [LEARNING_KEY]: { ver: 1, seq: 0, val } };
      // Ninguna de las tres lecturas puede lanzar: el estado se repara, no se rechaza.
      const restored = registry.restore(checkpoint, [], 0, {}, 0);
      const checkpointValues = registry.viewCheckpoint(checkpoint, [LEARNING_KEY]);
      const live = registry.snapshot(fakeSession(), [LEARNING_KEY]);
      for (const view of [restored.snapshot.values[LEARNING_KEY], checkpointValues[LEARNING_KEY], live.values[LEARNING_KEY]]) {
        assert.equal(typeof view.phase, 'string', `la vista tiene que salir válida con el estado ${JSON.stringify(val)}`);
        assert.equal(Number.isInteger(view.analyzers), true);
      }
    }
  });

  it('una fila de otra versión del estado se descarta en vez de tumbar la lectura', async () => {
    const registry = await realRegistry();
    registry.register(learningProjection());
    const checkpoint = { [LEARNING_KEY]: { ver: 99, seq: 0, val: { phase: 'idle' } } };
    const restored = registry.restore(checkpoint, [], 0, {}, 0);
    assert.equal(restored.checkpoint[LEARNING_KEY].ver, 1, 'se reindexa con la versión viva');
    assert.equal(typeof restored.snapshot.values[LEARNING_KEY].phase, 'string');
  });

  it('la vista aguanta estados corruptos sin salirse del esquema', () => {
    // El otro extremo del contrato: si la vista dejara de encajar con su esquema, el registro lanzaría
    // al servir el valor. Se comprueba con basura, no solo con el estado inicial.
    for (const state of [null, undefined, 42, 'texto', [], {}, { pending: 'no' }, { phase: '¿?' }]) {
      const view = learningProjection().wire.view(state);
      assert.deepEqual(learningViewSchema.parse(view), view, `la vista de ${JSON.stringify(state)} tiene que validar tal cual`);
    }
  });
});
