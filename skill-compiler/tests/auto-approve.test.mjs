#!/usr/bin/env node
/**
 * Puerta del modo «aprobar automáticamente en esta sesión».
 *
 * Lo que se fija, y por qué:
 *
 *   · **El estado se pliega del log de la sesión.** No es un flag en memoria: sobrevive a recargar el
 *     plugin o reiniciar la app, y deja rastro de quién lo activó. Aquí se prueba el plegado con logs
 *     sintéticos, incluidos los que no deben cambiar nada (otro comando, `/skill-auto` sin argumento) y
 *     un log corrupto, que nunca puede dar «activo».
 *   · **El comando informa y cambia el modo**, con textos que dicen lo que sí y lo que no se delega.
 *   · **La delegación es real para las dos vías**: skill nueva (`skill_propose`) y parche o actualización
 *     (`skill_vendor`), que es lo que pidió el dueño.
 *   · **La puerta NO se delega**: con el modo activo, una propuesta que no pasa la validación no se
 *     aprueba, y un conflicto tampoco. Es la diferencia entre delegar la confirmación y desactivar la
 *     revisión.
 *   · **Aprobar avisa al catálogo**, que es lo que hace que la skill esté disponible en el acto.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { AUTO_COMMAND, autoApproveFromEvents, parseAutoCommand } from '../lib/auto-approve.mjs';
import { skillCommands } from '../lib/commands.mjs';
import { approve, projectKey } from '../lib/compiler.mjs';
import { autoApproveIfAsked, skillPropose, skillVendor } from '../lib/definitions.mjs';
import { buenaRevision, cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);

/** Un evento de comando, tal y como lo anexa el registro del harness. */
const commandRun = (name, args) => ({ type: 'command/run', data: { commandId: 'c1', name, args, source: { kind: 'user' } } });

/** El modo activo, escrito en el log exactamente como lo dejaría `/skill-auto activar`. */
const WITH_MODE_ON = [commandRun(AUTO_COMMAND, ' activar')];
const WITH_MODE_OFF = [commandRun(AUTO_COMMAND, ' activar'), commandRun(AUTO_COMMAND, ' desactivar')];

const execWith = (events) => ({ agent: { session: { header: { cwd: CWD }, snapshotEvents: () => events } } });

/** Avisos al catálogo, contados. */
function fakeCatalog() {
  let count = 0;
  return { notify: () => { count += 1; }, count: () => count };
}

describe('modo automático · el estado vive en el log', () => {
  it('sin comandos, el modo está desactivado', () => {
    assert.equal(autoApproveFromEvents([]), false);
    assert.equal(autoApproveFromEvents(undefined), false);
  });

  it('lo activa el comando, y lo desactiva el mismo comando', () => {
    assert.equal(autoApproveFromEvents(WITH_MODE_ON), true);
    assert.equal(autoApproveFromEvents(WITH_MODE_OFF), false);
    assert.equal(autoApproveFromEvents([...WITH_MODE_OFF, commandRun(AUTO_COMMAND, 'activar')]), true, 'el último manda');
  });

  it('lo que no cambia nada no lo cambia: otro comando, o /skill-auto sin argumento', () => {
    assert.equal(autoApproveFromEvents([commandRun('skill-proposals', '')]), false);
    assert.equal(autoApproveFromEvents([...WITH_MODE_ON, commandRun(AUTO_COMMAND, '')]), true, 'preguntar el estado no lo apaga');
    assert.equal(autoApproveFromEvents([...WITH_MODE_ON, commandRun(AUTO_COMMAND, '   ')]), true);
    assert.equal(autoApproveFromEvents([...WITH_MODE_ON, commandRun(AUTO_COMMAND, ' no-se-que')]), true, 'una palabra rara no decide');
  });

  it('un log corrupto nunca da «activo»', () => {
    for (const junk of [null, [null], [{ type: 'command/run' }], [{ type: 'command/run', data: { name: AUTO_COMMAND, args: 42 } }], ['no soy un evento']]) {
      assert.equal(autoApproveFromEvents(junk), false, `con ${JSON.stringify(junk)}`);
    }
  });

  it('acepta las palabras en español y en inglés, y sólo ésas', () => {
    for (const word of ['activar', 'ACTIVAR', 'on', 'sí', 'si']) assert.equal(parseAutoCommand(` ${word} `), true, word);
    for (const word of ['desactivar', 'off', 'no']) assert.equal(parseAutoCommand(word), false, word);
    for (const word of ['', '   ', 'quizá']) assert.equal(parseAutoCommand(word), null, word);
  });
});

describe('modo automático · el comando', () => {
  const auto = (root, events) => skillCommands({ root }).find((c) => c.name === AUTO_COMMAND);

  it('informa del estado sin cambiar nada', () => {
    const s = sandbox();
    const off = auto(s.root).handler({ agent: { session: { header: { cwd: CWD }, snapshotEvents: () => [] } }, rawInput: '' });
    assert.equal(off.kind, 'success');
    assert.match(off.text, /desactivada/);

    const on = auto(s.root).handler({ agent: { session: { header: { cwd: CWD }, snapshotEvents: () => WITH_MODE_ON } }, rawInput: '' });
    assert.match(on.text, /ACTIVA/);
    assert.match(on.text, /La validación previa se aplica siempre/);
  });

  it('activa y desactiva diciendo lo que se delega y lo que no', () => {
    const s = sandbox();
    const turningOn = auto(s.root).handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: 'activar' });
    assert.equal(turningOn.kind, 'success');
    assert.match(turningOn.text, /Aprobación automática ACTIVA/);
    assert.match(turningOn.text, /la validación previa, el anti-solapamiento, el bloqueo de orígenes/);

    const turningOff = auto(s.root).handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: 'desactivar' });
    assert.match(turningOff.text, /desactivada/);
  });
});

describe('modo automático · la delegación, en las dos vías', () => {
  it('una skill nueva se activa sola, avisa al catálogo y lo cuenta', () => {
    const s = sandbox();
    const catalog = fakeCatalog();
    const tool = skillPropose({ root: s.root, curated: s.curated, catalog });

    const value = tool.execute(goodInput(), execWith(WITH_MODE_ON));

    assert.equal(value.status, 'proposed');
    assert.equal(value.autoApproved, true);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check', 'SKILL.md')), true, 'queda activa');
    assert.equal(catalog.count(), 1, 'y el catálogo se entera: disponible al instante');
    assert.match(value.summary, /APROBADA AUTOMÁTICAMENTE/);
    assert.equal(/NO está activa/.test(value.summary), false, 'el resumen no puede mentir');
  });

  it('un parche de una skill VIVA no se activa solo, ni con el modo encendido', () => {
    const s = sandbox();
    const catalog = fakeCatalog();
    const tool = skillPropose({ root: s.root, curated: s.curated, catalog });

    // La primera se aprueba a mano: sin el modo, nada se activa solo.
    tool.execute(goodInput(), execWith([]));
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false, 'sin modo, espera decisión');
    assert.equal(approve('measured-decision-check', KEY, { root: s.root }).ok, true);

    // Y ahora una corrección, con el modo encendido: cambia una herramienta que alguien ya usa, así que
    // no se delega. El modo auto existe para no repetir la confirmación de una skill nueva, no para
    // corregir por su cuenta (Fase 3: la promoción automática de correcciones queda para otra fase).
    const patch = tool.execute(
      goodInput({ body: `${goodInput().body}\n\n4. Un paso más, que corrige lo anterior.\n`, revision: buenaRevision() }),
      execWith(WITH_MODE_ON),
    );
    assert.equal(patch.status, 'proposed', JSON.stringify(patch.errors));
    assert.equal(patch.autoApproved, false, 'una corrección no se delega');
    assert.match(patch.summary, /corrección de una skill viva/);
    assert.equal(patch.updatesApproved, true);

    // Nada se movió: la aprobada sigue en pie, la corrección espera, y no hay nada apartado.
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), true);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'measured-decision-check')), true);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'superseded')), false, 'no se apartó nada');
    assert.equal(catalog.count(), 0, 'el catálogo no cambió: nada se activó');

    // Y cuando el humano decide, la anterior se aparta (nunca se borra).
    const decidido = approve('measured-decision-check', KEY, { root: s.root });
    assert.equal(decidido.ok, true, decidido.reason);
    assert.equal(typeof decidido.superseded, 'string', 'la versión anterior tiene que quedar apartada');
    const apartadas = readdirSync(join(s.root, 'projects', KEY, 'superseded')).filter((name) => name.startsWith('measured-decision-check'));
    assert.equal(apartadas.length, 1);
  });

  it('una vendorización se activa sola igual', async () => {
    const s = sandbox();
    const catalog = fakeCatalog();
    const RAW = 'https://raw.githubusercontent.com/acme/skills/main/measured/SKILL.md';
    const upstream = [
      '---', 'name: measured-decisions',
      'description: "Decide with measured evidence instead of impressions, every time."', '---', '',
      '# Measured decisions', '', '## When to Use', '',
      'Cuando hay que decidir algo con evidencia y no con impresiones del momento.', '',
      '## Procedure', '',
      '1. Mide antes de tocar nada y anota el número exacto.',
      '2. Compara contra el registro previo y declara la diferencia.',
      '3. Cierra sólo cuando las dos medidas coincidan.',
    ].join('\n');
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => upstream });

    const tool = skillVendor({ root: s.root, curated: s.curated, fetchImpl, catalog });
    const value = await tool.execute({ url: RAW }, execWith(WITH_MODE_ON));

    assert.equal(value.status, 'proposed');
    assert.equal(value.autoApproved, true);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decisions', 'SKILL.md')), true);
    assert.equal(catalog.count(), 1);
  });

  it('sin el modo, todo sigue esperando tu decisión', () => {
    const s = sandbox();
    const catalog = fakeCatalog();
    const tool = skillPropose({ root: s.root, curated: s.curated, catalog });

    const value = tool.execute(goodInput(), execWith([]));
    assert.equal(value.autoApproved, undefined, 'el campo sólo existe cuando el modo está activo');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false);
    assert.equal(catalog.count(), 0);
    assert.match(value.summary, /NO está activa: espera aprobación humana/);
  });
});

describe('modo automático · lo que NO se delega', () => {
  it('no aprueba un conflicto: no hay nada que aprobar', () => {
    const s = sandbox();
    const catalog = fakeCatalog();
    const tool = skillPropose({ root: s.root, curated: s.curated, catalog });

    const value = tool.execute(goodInput({
      id: 'session-recovery-state',
      description: 'Rebuilding the state of a lost or closed session, from its log.',
      whenToUse: 'Cuando una sesión se cerró y hay que reconstruir su estado.',
    }), execWith(WITH_MODE_ON));

    assert.equal(value.status, 'conflict');
    assert.equal(value.autoApproved, undefined);
    assert.equal(catalog.count(), 0);
  });

  it('no salta la puerta: con el modo activo, una propuesta que no la pasa sigue pendiente', () => {
    const s = sandbox();
    // Una propuesta tocada a mano hasta romperla: es el caso que la herramienta no puede producir sola.
    const dir = join(s.root, 'projects', KEY, 'proposed', 'rota-a-mano');
    mkdirSync(dir, { recursive: true });
    // Rota por **una sola** razón (el cuerpo), con el resto del contrato cumplido: así el motivo que
    // reporta el modo automático es inequívoco y la prueba dice de verdad qué puerta no se saltó.
    writeFileSync(join(dir, 'SKILL.md'), [
      '---', 'name: rota-a-mano',
      'description: "Una propuesta que alguien rompió después de haberla propuesto."',
      'whenToUse: "Cuando alguien edite a mano una propuesta y la rompa."',
      '---', '', 'Corto.',
    ].join('\n'));

    const catalog = fakeCatalog();
    const result = autoApproveIfAsked({ exec: execWith(WITH_MODE_ON), root: s.root, catalog, id: 'rota-a-mano', key: KEY });

    assert.equal(result.asked, true);
    assert.equal(result.approved, false);
    assert.match(result.reason, /body demasiado corto/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'rota-a-mano')), false, 'nada se movió');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'rota-a-mano', 'SKILL.md')), true);
    assert.equal(catalog.count(), 0);
  });
});
