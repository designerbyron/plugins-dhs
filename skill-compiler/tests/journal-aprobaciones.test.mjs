/**
 * El rastro del aprendizaje: **toda** aprobación queda en el diario, encadenada.
 *
 * Hasta v3.6.0 el diario sólo anotaba las promociones del motor. Las aprobaciones —lo que de verdad convierte
 * una propuesta en conocimiento servido— no dejaban rastro: «se aprobó» era una afirmación sin respaldo, y el
 * modo automático era el único camino que no anotaba nada. Ahora escriben los tres caminos (humano por comando,
 * humano en lote y herramienta automática) con el **mismo** escritor encadenado, así que la cadena que verifica
 * `security` cubre todo el ciclo: proponer → decidir → activar.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { AUTO_COMMAND } from '../lib/auto-approve.mjs';
import { approveProposal, rejectProposal, skillCommands } from '../lib/commands.mjs';
import { ambito, projectKey, propose } from '../lib/compiler.mjs';
import { autoApproveIfAsked } from '../lib/definitions.mjs';
import { leerDiario, diarioDe } from '../lib/promote.mjs';
import { verificarCadena } from '../lib/security.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD_DE = (s) => s.base;
const clave = (s) => projectKey(s.base);
const agente = (s) => ({ session: { header: { cwd: s.base } } });

/** Una propuesta nueva con tema propio (el veto mira el tema, no el id). */
function otra(s, id, tema) {
  const r = propose(goodInput({
    id,
    description: `${tema} con el detalle suficiente para pasar la puerta.`,
    whenToUse: `Cuando haya que ocuparse de ${tema.toLowerCase()} y falte criterio.`,
    body: [
      '## Antes', '', `${tema}: se lee el estado y se anota la cifra.`, '',
      '## Pasos', '', '1. Contar y anotar.', '2. Contrastar con el sistema.', '3. Cerrar con firma.', '',
      '## Cuándo no aplica', '', 'Si no se puede leer, se para y se avisa.', '',
    ].join('\n'),
    group: { id: 'lote-del-acto', motivo: 'Propuestas del mismo acto de prueba, para medir el rastro.' },
  }), { root: s.root, curated: s.curated, cwd: s.base });
  assert.equal(r.status, 'proposed', `${id}: ${JSON.stringify(r.errors ?? r.conflicts)}`);
  return r;
}

const entradas = (s) => leerDiario(clave(s), { root: s.root });

describe('diario del aprendizaje · toda aprobación deja rastro encadenado', () => {
  it('aprobar en local anota «aprobada», con la huella del contenido aprobado', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD_DE(s) });
    const r = approveProposal({ root: s.root, key: clave(s), id: 'measured-decision-check', scope: 'project' });
    assert.equal(r.kind, 'success', r.text);

    const lista = entradas(s);
    assert.equal(lista.length, 1, 'una decisión, una entrada');
    const e = lista[0];
    assert.equal(e.decision, 'aprobada');
    assert.equal(e.ambito, 'project');
    assert.equal(e.por, 'humano');
    assert.equal(e.canal, 'comando');
    assert.equal(typeof e.hashAnterior, 'string');
    assert.equal(e.hashAnterior, e.hashResultante, 'lo aprobado es lo que quedó');
    assert.equal(verificarCadena(lista).ok, true);
  });

  it('publicar para todos anota «publicada» y su ámbito', () => {
    const s = sandbox();
    otra(s, 'cuadre-del-inventario', 'Cuadrar el inventario físico del almacén');
    const r = approveProposal({ root: s.root, key: clave(s), id: 'cuadre-del-inventario', scope: 'global' });
    assert.equal(r.kind, 'success', r.text);
    const e = entradas(s).at(-1);
    assert.equal(e.decision, 'publicada');
    assert.equal(e.ambito, 'global');
    assert.equal(existsSync(join(s.curated, 'cuadre-del-inventario', 'SKILL.md')), true);
  });

  it('un lote deja una entrada por elemento, y la cadena sigue entera', () => {
    const s = sandbox();
    const ids = ['cierre-de-caja', 'turno-de-limpieza'];
    otra(s, ids[0], 'Cerrar la caja del día en el mostrador');
    otra(s, ids[1], 'Repartir el turno de limpieza del local');
    const byName = Object.fromEntries(skillCommands({ root: s.root }).map((c) => [c.name, c]));
    const r = byName['skill-aprobar'].handler({ agent: agente(s), rawInput: `${ids.join(',')} --local` });
    assert.equal(r.kind, 'success', r.text);

    const lista = entradas(s);
    assert.equal(lista.length, 2);
    assert.deepEqual(lista.map((e) => e.id).sort(), [...ids].sort());
    assert.ok(lista.every((e) => e.decision === 'aprobada' && e.canal === 'comando'));
    assert.equal(verificarCadena(lista).ok, true, 'la cadena cubre el lote');
  });

  it('apartar también se anota: es una decisión, no un silencio', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD_DE(s) });
    const r = rejectProposal({ root: s.root, key: clave(s), id: 'measured-decision-check' });
    assert.equal(r.kind, 'success', r.text);
    const e = entradas(s).at(-1);
    assert.equal(e.decision, 'apartada');
    assert.equal(e.por, 'humano');
  });

  it('la herramienta automática anota con `por: auto`, y aprueba el contenido que validó', () => {
    const s = sandbox();
    const cwd = CWD_DE(s);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    // El modo se pliega de `command/run` (es donde vive la entrada cruda del humano).
    const eventos = [{ type: 'command/run', data: { name: AUTO_COMMAND, args: ' activar' } }];
    const auto = autoApproveIfAsked({
      exec: { agent: { session: { header: { cwd }, snapshotEvents: () => eventos } } },
      root: s.root,
      id: 'measured-decision-check',
      key: clave(s),
      curated: s.curated,
      esCorreccion: false,
    });
    assert.equal(auto.asked, true);
    assert.equal(auto.approved, true, auto.reason);
    const e = entradas(s).at(-1);
    assert.equal(e.decision, 'aprobada');
    assert.equal(e.por, 'auto');
    assert.equal(e.canal, 'herramienta');
    assert.equal(e.hashAnterior, e.hashResultante);
  });

  it('la cadena del diario del aprendizaje detecta una entrada editada', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD_DE(s) });
    approveProposal({ root: s.root, key: clave(s), id: 'measured-decision-check', scope: 'project' });
    const lista = entradas(s).map((e) => ({ ...e }));
    lista[0].hashResultante = 'falsa';
    const r = verificarCadena(lista);
    assert.equal(r.ok, false);
    assert.ok(r.roturas.some((x) => x.rule === 'journal-tamper'));
  });
});

describe('diario del aprendizaje · publicar no se salta los avisos', () => {
  it('con avisos, `skill-globalizar` pide `--force` en vez de forzar solo', () => {
    const s = sandbox();
    // Una ruta absoluta en prosa es un aviso de la puerta (no un error): sirve para medir la exigencia.
    const r = propose(goodInput({
      id: 'con-aviso',
      description: 'Ruta absoluta del puesto para probar la exigencia de confirmación.',
      whenToUse: 'Cuando haya que probar la exigencia de confirmación del ámbito global.',
      body: `${goodInput().body}\n\nEl material está en C:\\xampp\\htdocs\\saas-corporative\\docs.\n`,
      group: { id: 'lote-del-acto', motivo: 'Propuestas del mismo acto de prueba, para medir la exigencia.' },
    }), { root: s.root, curated: s.curated, cwd: CWD_DE(s) });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));

    const byName = Object.fromEntries(skillCommands({ root: s.root }).map((c) => [c.name, c]));
    const sinForce = byName['skill-globalizar'].handler({ agent: agente(s), rawInput: 'con-aviso' });
    assert.equal(sinForce.kind, 'error', 'con avisos no puede publicar sin decirlo');
    assert.match(sinForce.text, /--force/);
    assert.equal(existsSync(join(s.curated, 'con-aviso')), false);

    const conForce = byName['skill-globalizar'].handler({ agent: agente(s), rawInput: 'con-aviso --force' });
    assert.equal(conForce.kind, 'success', conForce.text);
    assert.equal(existsSync(join(s.curated, 'con-aviso', 'SKILL.md')), true);
    assert.equal(entradas(s).at(-1).ambito, 'global');
  });
});

describe('diario · cambiar de ámbito deja asiento', () => {
  it('publicar y volver a local queda anotado, y la cadena sigue válida', () => {
    const s = sandbox();
    otra(s, 'ambito-con-rastro', 'Cambio de ámbito con rastro');
    const k = clave(s);
    const a = approveProposal({ root: s.root, key: k, id: 'ambito-con-rastro', scope: 'project' });
    assert.equal(a.kind, 'success', a.text);

    const aGlobal = ambito('ambito-con-rastro', k, { root: s.root, library: s.curated, to: 'global' });
    assert.equal(aGlobal.ok, true, aGlobal.reason);
    const aLocal = ambito('ambito-con-rastro', k, { root: s.root, library: s.curated, to: 'project' });
    assert.equal(aLocal.ok, true, aLocal.reason);

    assert.deepEqual(entradas(s).slice(-2).map((e) => e.decision), ['globalizada', 'localizada']);
    assert.equal(verificarCadena(entradas(s)).ok, true, 'la cadena sigue válida');
  });
});
