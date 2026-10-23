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
import { buenaRevision, cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

// ── protocolo ────────────────────────────────────────────────────────────────────────────────────

describe('PROTOCOL', () => {
  it('nombra las dos vías, exige el ámbito de proyecto y avisa de que nada se activa solo', () => {
    assert.match(PROTOCOL, /skill_propose/, 'la vía del conocimiento propio');
    assert.match(PROTOCOL, /skill_vendor/, 'la vía de una skill de repositorio');
    assert.match(PROTOCOL, /nothing activates by itself/i);
    assert.match(PROTOCOL, /is blocked/i, 'el bloqueo por contenido ajeno tiene que estar dicho');
  });

  it('es corto: entra en el prompt de todas las sesiones y se paga entero cada vez', () => {
    assert.equal(PROTOCOL.length < 1200, true, `demasiado largo: ${PROTOCOL.length} caracteres`);
  });

  /**
   * El tope de 1.200 caracteres es el contrato; el **presupuesto de trabajo** es el de la medición del
   * 2026-10-15 (941 caracteres · 240 tokens con la vara del harness, `@deepseek-ai/dsh-token-meter`). Se fija
   * aquí para que volver a engordarlo se vea en esta prueba y no en la factura de cada sesión: el protocolo
   * entra en el prompt de TODAS las sesiones, así que cada carácter se paga siempre.
   */
  it('se queda en el presupuesto de trabajo, no sólo por debajo del tope', () => {
    assert.equal(PROTOCOL.length <= 950, true,
      `fuera del presupuesto: ${PROTOCOL.length} caracteres (objetivo ~900, tope 1200)`);
  });

  /**
   * El otro criterio que quedaba flojo —«lo resuelto se reutilizará»— no discrimina nada. Una skill cuesta
   * contexto en cada sesión, así que lo que la justifica es una **evidencia señalable**; las cuatro que se
   * nombran salen de los casos reales del almacén, no de una lista inventada.
   */
  it('nombra las cuatro evidencias que justifican proponer', () => {
    assert.match(PROTOCOL, /contract/i, 'un contrato descubierto a base de pruebas');
    assert.match(PROTOCOL, /trap already paid for/i);
    assert.match(PROTOCOL, /an order/i);
    assert.match(PROTOCOL, /exact value/i);
    // Y el freno explícito al criterio flojo: una posibilidad no es una evidencia.
    assert.match(PROTOCOL, /could be reused/i);
    assert.match(PROTOCOL, /is not enough/i, 'el freno tiene que estar dicho, no insinuado');
  });

  it('no repite lo que ya explica la descripción de skill_vendor', () => {
    // La vía tiene que seguir nombrada —es una decisión, no un adorno—, pero el proceso del vendorizado
    // (original verbatim, no copiar ni instalar del origen) vive en su herramienta: pagarlo dos veces es
    // pagarlo en cada sesión por nada.
    assert.match(PROTOCOL, /skill_vendor/);
    assert.equal(/verbatim/.test(PROTOCOL), false, 'el detalle de la copia es de skill_vendor');
    assert.equal(/no copies ni instales/.test(PROTOCOL), false);
  });

  /**
   * El defecto de uso que reportó el autor: «habiendo aprendido cosas, nunca ha sugerido una skill nueva ni
   * ha actualizado una ya creada». La capacidad existía —`checkOverlap` trata el mismo id del propio
   * proyecto como actualización, y hay pruebas funcionales que lo demuestran— pero **nadie se lo decía al
   * modelo**: ni el protocolo ni la descripción de la herramienta mencionaban que un id existente la
   * actualiza. Una capacidad que nadie sabe que existe es una capacidad que no existe.
   */
  it('declara la vía de actualización, que es la que el modelo no estaba usando', () => {
    assert.match(PROTOCOL, /with the same id/i, 'el protocolo tiene que decir cómo se actualiza: mismo id');
    assert.match(PROTOCOL, /an update, not a duplicate/i);
    assert.match(PROTOCOL, /sets the previous aside, never deletes it/i, 'y qué pasa con la versión anterior al aprobarla');
    assert.match(PROTOCOL, /skill_review/, 'y cómo consultar lo que ya hay antes de proponer');
  });

  it('la descripción de skill_propose invita a actualizar, no sólo a crear', () => {
    const definition = skillPropose({ root: '/no/usado' });
    assert.match(definition.description, /UPDATE it/, 'la descripción es lo que el modelo lee para elegir la herramienta');
    assert.match(definition.description, /superseded\//);
    // El criterio es «se reutilizará», no «tarea compleja»: el freno anterior no mencionaba la actualización.
    assert.equal(/never for a simple query/.test(definition.description), false);
  });

  /**
   * La descripción de la herramienta es lo que el modelo lee **al elegirla**, y era el otro sitio donde el
   * criterio flojo vivía («a procedure you will need again» es una predicción, no una evidencia). Aquí se
   * exige que nombre las cuatro evidencias y que diga en voz alta lo que **no** vale.
   */
  it('exige una evidencia concreta, no una posibilidad', () => {
    const definition = skillPropose({ root: '/no/usado' });
    const descripcion = definition.description;
    assert.match(descripcion, /only with evidence/, 'el «sólo con evidencia» tiene que estar');
    for (const evidencia of ['contract discovered the hard way', 'trap already paid for', 'operational order', 'exact value']) {
      assert.match(descripcion, new RegExp(evidencia), `falta una de las cuatro evidencias: ${evidencia}`);
    }
    assert.match(descripcion, /"It could be reused" is not evidence/, 'y el freno a «podría reutilizarse»');
    assert.match(descripcion, /narrating the session/, 'contar la sesión tampoco es una evidencia');
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
      description: 'Rebuilding the state of a lost or closed session, from its log.',
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
    // Un parche de una skill viva exige su revisión: sin ella la puerta lo rechaza (Fase 3).
    const second = t.execute(goodInput({ body: `${goodInput().body}\n\n4. Un paso más.\n`, revision: buenaRevision() }), fakeExec(CWD));
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
