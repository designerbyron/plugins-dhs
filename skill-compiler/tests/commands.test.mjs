#!/usr/bin/env node
/**
 * Puerta de los comandos humanos: la superficie que permite decidir sin salir del harness.
 *
 * Lo que se fija aquí, y por qué cada cosa:
 *
 *   · **La forma del descriptor** que exige el registro de comandos del harness —nombre en su gramática,
 *     descripción no vacía, `handler` función—, porque un descriptor inválido no se registra y la
 *     superficie desaparece en silencio.
 *   · **Los cinco caminos de cada comando**: sin argumento, id inexistente, propuesta que no pasa la
 *     puerta, aprobación correcta y rechazo. Un comando se equivoca en el camino que nadie ejecuta.
 *   · **Que el handler no lance nunca**: los comandos son superficie humana; un fallo tiene que llegar
 *     como texto, no como excepción hacia el harness.
 *   · **Que aprobar exija la misma puerta que la CLI**: es la regla que impide que esta vía sea una vía
 *     de aprobación sin validación.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands, targetCommands } from '../lib/commands.mjs';
import { approve, projectKey, propose } from '../lib/compiler.mjs';
import { pendingRowsFor } from '../lib/pending-rows.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const agent = { session: { header: { cwd: CWD } } };

/** Un aviso de verdad, del mismo tipo que la CLI reporta: rutas absolutas en el cuerpo. */
const WARNS = { whenToUse: `Cuando trabajes en ${CWD}.` };

function commands(root, catalog) {
  const list = skillCommands({ root, catalog });
  const byName = Object.fromEntries(list.map((c) => [c.name, c]));
  return { list, byName };
}

/** Avisos del catálogo, contados: aquí sólo interesa saber si el comando avisó. */
function fakeCatalog() {
  let count = 0;
  return { notify: () => { count += 1; }, count: () => count };
}

describe('comandos · descriptor', () => {
  it('los cinco se declaran como el registro del harness los exige', () => {
    const { list } = commands('C:\\tmp');
    assert.deepEqual(list.map((c) => c.name).sort(),
      ['skill-aprobar', 'skill-auto', 'skill-propuestas', 'skill-rechazar', 'skill-ver']);
    for (const command of list) {
      assert.match(command.name, /^[a-z][a-z0-9_-]*$/, `${command.name} no cumple la gramática del harness`);
      assert.equal(typeof command.description, 'string');
      assert.equal(command.description.trim().length > 0, true, `${command.name} necesita descripción`);
      assert.equal(typeof command.handler, 'function');
    }
    // Los que toman un id lo anuncian: es lo que el compositor enseña al escribir el comando.
    for (const name of ['skill-ver', 'skill-aprobar', 'skill-rechazar']) {
      const command = list.find((c) => c.name === name);
      assert.equal(typeof command.input?.hint, 'string');
    }
  });
});

describe('comandos · /skill-propuestas', () => {
  it('sin ámbito lo dice, en vez de inventarse un proyecto', () => {
    const { byName } = commands('C:\\tmp');
    const result = byName['skill-propuestas'].handler({ agent: {}, rawInput: '' });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /Sin ámbito/);
  });

  it('distingue lo pendiente de lo aprobado y enseña los ids', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    approve('measured-decision-check', KEY, { root: s.root });
    propose(goodInput({ id: 'otro-tema-distinto', description: 'Otra cosa sin relación con lo anterior.', whenToUse: 'Cuando haga falta otra cosa.' }), { root: s.root, curated: s.curated, cwd: CWD });

    const { byName } = commands(s.root);
    const result = byName['skill-propuestas'].handler({ agent, rawInput: '' });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /Pendientes de tu aprobación \(1\)/);
    assert.match(result.text, /otro-tema-distinto/);
    assert.match(result.text, /Aprobadas y activas \(1\)/);
    assert.match(result.text, /measured-decision-check/);
    assert.match(result.text, /\/skill-aprobar <id>/, 'y dice cómo seguir');
  });
});

describe('comandos · /skill-ver', () => {
  it('pide el id si falta', () => {
    const { byName } = commands('C:\\tmp');
    const result = byName['skill-ver'].handler({ agent, rawInput: '   ' });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /Uso: \/skill-ver <id>/);
  });

  it('avisa cuando el id no existe', () => {
    const s = sandbox();
    const { byName } = commands(s.root);
    const result = byName['skill-ver'].handler({ agent, rawInput: 'no-existe' });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /no hay ninguna skill aprendida/i);
  });

  it('enseña la propuesta entera y marca que está pendiente', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const { byName } = commands(s.root);
    const result = byName['skill-ver'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /Propuesta pendiente de aprobación/);
    assert.match(result.text, /## Procedure/, 'el cuerpo entero, no un resumen');
  });

  it('enseña también una ya aprobada, diciendo que está activa', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    approve('measured-decision-check', KEY, { root: s.root });
    const { byName } = commands(s.root);
    const result = byName['skill-ver'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /Activa en este proyecto/);
  });
});

describe('comandos · /skill-aprobar', () => {
  it('pide el id si falta', () => {
    const { byName } = commands('C:\\tmp');
    const result = byName['skill-aprobar'].handler({ agent, rawInput: '' });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /Uso: \/skill-aprobar <id>/);
  });

  it('no aprueba lo que no existe', () => {
    const s = sandbox();
    const { byName } = commands(s.root);
    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'no-existe' });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /no existe una propuesta/);
  });

  it('respeta la puerta: una propuesta que no la pasa no se aprueba, y nada se mueve', () => {
    const s = sandbox();
    // Una propuesta tocada a mano después de proponerla: cuerpo por debajo del mínimo.
    const dir = join(s.root, 'projects', KEY, 'proposed', 'tocada-a-mano');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), ['---', 'name: tocada-a-mano', 'description: "Una propuesta que alguien editó a mano y rompió."', '---', '', 'Muy corto.'].join('\n'));

    const { byName } = commands(s.root);
    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'tocada-a-mano' });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /no pasa la puerta/);
    assert.match(result.text, /body demasiado corto/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'tocada-a-mano')), false, 'y no se movió nada');
  });

  it('aprueba cuando todo está en orden, y avisa al catálogo', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const catalog = fakeCatalog();
    const { byName } = commands(s.root, catalog);

    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(result.kind, 'success', JSON.stringify(result));
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check', 'SKILL.md')), true);
    assert.equal(catalog.count(), 1, 'el aviso al catálogo es lo que la hace usable sin reiniciar');
    assert.match(result.text, /sin reiniciar/);
    assert.match(result.text, /Invocarla tú: \/measured-decision-check/);
  });

  it('con avisos exige confirmación explícita, y la acepta con --force', () => {
    const s = sandbox();
    propose(goodInput(WARNS), { root: s.root, curated: s.curated, cwd: CWD });
    const catalog = fakeCatalog();
    const { byName } = commands(s.root, catalog);

    const sinForzar = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(sinForzar.kind, 'error');
    assert.match(sinForzar.text, /tiene avisos/);
    assert.match(sinForzar.text, /--force/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false, 'con avisos no se aprueba sola');

    const forzado = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check --force' });
    assert.equal(forzado.kind, 'success', JSON.stringify(forzado));
    assert.equal(catalog.count(), 1);
    assert.match(forzado.text, /Aprobada con avisos/);
  });
});

describe('comandos · /skill-rechazar', () => {
  it('no aparta lo que no existe', () => {
    const s = sandbox();
    const { byName } = commands(s.root);
    const result = byName['skill-rechazar'].handler({ agent, rawInput: 'no-existe' });
    assert.equal(result.kind, 'error');
  });

  it('aparta sin borrar, y avisa al catálogo', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const catalog = fakeCatalog();
    const { byName } = commands(s.root, catalog);

    const result = byName['skill-rechazar'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(result.kind, 'success');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'rejected', 'measured-decision-check', 'SKILL.md')), true, 'queda guardada');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'measured-decision-check')), false);
    assert.equal(catalog.count(), 1);
  });
});

describe('comandos · resiliencia', () => {
  it('ningún camino raro lanza: siempre vuelve texto', () => {
    const s = sandbox();
    const { list } = commands(s.root);
    for (const command of list) {
      for (const invocation of [{}, { agent: null, rawInput: null }, { agent: { session: {} }, rawInput: 42 }, { agent, rawInput: 'x'.repeat(500) }]) {
        const result = command.handler(invocation);
        assert.equal(result.kind === 'success' || result.kind === 'error', true, `${command.name} devolvió ${JSON.stringify(result)}`);
        assert.equal(typeof result.text, 'string');
        assert.equal(result.text.trim().length > 0, true, `${command.name} devolvió texto vacío`);
      }
    }
  });
});

describe('comandos · filas de pendientes', () => {
  it('la fila que se elige en el menú mueve la propuesta, con la misma puerta', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const catalog = fakeCatalog();
    const rows = targetCommands({ root: s.root, catalog, rows: pendingRowsFor({ root: s.root, cwd: CWD }) });

    const aprobar = rows.find((row) => row.name === 'skill-aprobar-measured-decision-check');
    const result = aprobar.handler({ agent });
    assert.equal(result.kind, 'success', JSON.stringify(result));
    assert.equal(catalog.count(), 1, 'la fila avisa al catálogo igual que el comando con argumentos');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check', 'SKILL.md')), true);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'measured-decision-check')), false);
  });

  it('la fila no puede saltarse la puerta: una propuesta que no la pasa no se aprueba', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    // El caso real que la puerta existe para atrapar: la propuesta se escribió bien y **después** alguien
    // la tocó a mano. La herramienta no puede crear una inválida, así que aquí se rompe en el disco.
    writeFileSync(
      join(s.root, 'projects', KEY, 'proposed', 'measured-decision-check', 'SKILL.md'),
      ['---', 'name: measured-decision-check', 'description: "Decide with measured evidence."', '---', '', '# Corto', '', 'nada.'].join('\n'),
    );
    const catalog = fakeCatalog();
    const rows = targetCommands({ root: s.root, catalog, rows: pendingRowsFor({ root: s.root, cwd: CWD }) });

    const result = rows.find((row) => row.name === 'skill-aprobar-measured-decision-check').handler({ agent });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /no pasa la puerta/);
    assert.equal(catalog.count(), 0, 'nada se movió, así que nada cambió');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false);
  });

  it('con avisos la fila no aprueba: aceptarlos exige decirlo, y eso es del comando con argumentos', () => {
    const s = sandbox();
    propose(goodInput(WARNS), { root: s.root, curated: s.curated, cwd: CWD });
    const rows = targetCommands({ root: s.root, catalog: fakeCatalog(), rows: pendingRowsFor({ root: s.root, cwd: CWD }) });

    const result = rows.find((row) => row.name === 'skill-aprobar-measured-decision-check').handler({ agent });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /--force/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false);
  });

  it('la fila de otro proyecto falla con el motivo, en vez de decidir en el proyecto equivocado', () => {
    const s = sandbox();
    const otro = 'C:\\xampp\\htdocs\\otro-proyecto';
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: otro });
    const rows = targetCommands({ root: s.root, catalog: fakeCatalog(), rows: pendingRowsFor({ root: s.root, cwd: otro }) });

    const result = rows.find((row) => row.name === 'skill-aprobar-measured-decision-check').handler({ agent });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /no en esta sesión/);
    assert.equal(existsSync(join(s.root, 'projects', projectKey(otro), 'approved', 'measured-decision-check')), false);
  });

  it('leer una pendiente enseña el veredicto de la puerta antes de decidir', () => {
    const s = sandbox();
    propose(goodInput(WARNS), { root: s.root, curated: s.curated, cwd: CWD });
    const rows = targetCommands({ root: s.root, catalog: fakeCatalog(), rows: pendingRowsFor({ root: s.root, cwd: CWD }) });

    const result = rows.find((row) => row.name === 'skill-ver-measured-decision-check').handler({ agent });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /Puerta de validación: pasa\./);
    assert.match(result.text, /aviso/);
    assert.match(result.text, /Aprobarla con estos avisos exige decirlo/);
    // Y el contenido entero, para poder leer antes de decidir.
    assert.match(result.text, /## When to Use/);
  });

  it('apartar desde la fila no borra nada', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const rows = targetCommands({ root: s.root, catalog: fakeCatalog(), rows: pendingRowsFor({ root: s.root, cwd: CWD }) });

    const result = rows.find((row) => row.name === 'skill-rechazar-measured-decision-check').handler({ agent });
    assert.equal(result.kind, 'success');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'rejected', 'measured-decision-check', 'SKILL.md')), true);
  });
});
