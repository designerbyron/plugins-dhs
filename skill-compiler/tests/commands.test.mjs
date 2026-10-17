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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands, targetCommands } from '../lib/commands.mjs';
import { approve, disable, pending, projectKey, propose } from '../lib/compiler.mjs';
import { pendingRowsFor } from '../lib/pending-rows.mjs';
import { cleanupSandboxes, fakeExec, goodInput, patchInput, sandbox } from './helpers.mjs';

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

/**
 * La puerta de la gestión: **toda acción que mueve el almacén avisa al catálogo, y ninguna de lectura
 * avisa**. El registro de skills cachea sin TTL, así que una acción que mueve algo y no avisa deja al
 * agente con la versión vieja delante — pasó en vivo: una skill apagada seguía ofreciéndose.
 *
 * Lo que se exige no es una lista de comandos, sino la correspondencia: el aviso tiene que coincidir con
 * lo que de verdad cambió en disco. Así, un comando nuevo que mueva algo y no avise **falla aquí**.
 */
describe('gestión · el aviso al catálogo coincide con lo que cambió en disco', () => {
  /** Los ficheros del almacén del proyecto, por estado: lo que manda es el disco, no la tabla del test. */
  const foto = (root, key) => {
    const base = join(root, 'projects', key);
    if (!existsSync(base)) return '';
    return ['proposed', 'approved', 'disabled', 'rejected', 'superseded']
      .flatMap((estado) => (existsSync(join(base, estado)) ? readdirSync(join(base, estado)).map((id) => `${estado}:${id}`) : []))
      .sort()
      .join('|');
  };

  /** Deja una skill en el estado pedido, por el camino normal. */
  const sembrar = (s, estado) => {
    const r = propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'proposed', JSON.stringify(r));
    if (estado === 'proposed') return r.id;
    assert.equal(approve(r.id, KEY, { root: s.root }).ok, true);
    if (estado === 'approved') return r.id;
    assert.equal(disable(r.id, KEY, { root: s.root }).ok, true);
    return r.id;
  };

  const CASOS = [
    { nombre: 'skill-aprobar', estado: 'proposed', sufijo: ' --local --force', muta: true },
    { nombre: 'skill-globalizar', estado: 'proposed', sufijo: '', muta: true },
    { nombre: 'skill-rechazar', estado: 'proposed', sufijo: '', muta: true },
    { nombre: 'skill-deshabilitar', estado: 'approved', sufijo: '', muta: true },
    { nombre: 'skill-habilitar', estado: 'disabled', sufijo: '', muta: true },
    { nombre: 'skill-eliminar', estado: 'disabled', sufijo: ' --yes', muta: true },
    { nombre: 'skill-propuestas', estado: 'approved', sufijo: null, muta: false },
    { nombre: 'skill-ver', estado: 'approved', sufijo: '', muta: false },
    { nombre: 'skill-retiradas', estado: 'disabled', sufijo: null, muta: false },
  ];

  for (const caso of CASOS) {
    it(`${caso.nombre} avisa si y sólo si cambió el almacén`, () => {
      const s = sandbox();
      const catalog = fakeCatalog();
      const { byName } = commands(s.root, catalog);
      const id = sembrar(s, caso.estado);

      const antes = foto(s.root, KEY);
      const result = byName[caso.nombre].handler({ agent, rawInput: caso.sufijo === null ? undefined : `${id}${caso.sufijo}` });
      const movio = foto(s.root, KEY) !== antes;

      assert.equal(result.kind, 'success', `${caso.nombre} no debe fallar en su camino normal: ${JSON.stringify(result)}`);
      assert.equal(movio, caso.muta, `${caso.nombre}: la tabla dice muta=${caso.muta} y el disco dice ${movio}`);
      if (movio) {
        assert.equal(catalog.count() > 0, true,
          `${caso.nombre} movió una skill y NO avisó al catálogo: el agente la seguiría viendo`);
      } else {
        assert.equal(catalog.count(), 0, `${caso.nombre} no movió nada y avisó igualmente`);
      }
    });
  }
});

describe('comandos · descriptor', () => {
  it('se declaran como el registro del harness los exige', () => {
    const { list } = commands('C:\\tmp');
    assert.deepEqual(list.map((c) => c.name).sort(),
      [
        'skill-ambito', 'skill-aprobar', 'skill-auto', 'skill-deshabilitar', 'skill-eliminar', 'skill-globalizar', 'skill-habilitar',
        'skill-propiedad', 'skill-propiedad-dsh-only', 'skill-propiedad-machine', 'skill-propuestas', 'skill-rechazar',
        'skill-retiradas', 'skill-sistemas', 'skill-ver',
      ]);
    for (const command of list) {
      assert.match(command.name, /^[a-z][a-z0-9_-]*$/, `${command.name} no cumple la gramática del harness`);
      assert.equal(typeof command.description, 'string');
      assert.equal(command.description.trim().length > 0, true, `${command.name} necesita descripción`);
      assert.equal(typeof command.handler, 'function');
    }
    // Los que toman un id lo anuncian: es lo que el compositor enseña al escribir el comando.
    // Los que toman un id lo anuncian, y también los del ciclo de vida.
    for (const name of ['skill-ver', 'skill-aprobar', 'skill-globalizar', 'skill-ambito', 'skill-rechazar', 'skill-deshabilitar', 'skill-habilitar', 'skill-eliminar']) {
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
    propose(goodInput({ id: 'otro-tema-distinto', description: 'Otra cosa sin relación con lo anterior, con su propio detalle.', whenToUse: 'Cuando haga falta otra cosa.' }), { root: s.root, curated: s.curated, cwd: CWD });

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
  it('sin decir el ámbito pregunta, y no aprueba en ninguna parte', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const catalog = fakeCatalog();
    const { byName } = commands(s.root, catalog);

    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(result.kind, 'success', 'preguntar no es un fallo: es la pregunta');
    assert.match(result.text, /¿Dónde quieres que viva/);
    assert.match(result.text, /--local/, 'tiene que ofrecer el proyecto');
    assert.match(result.text, /--global/, 'y tiene que ofrecer la biblioteca de usuario');
    assert.match(result.text, /skill-globalizar/, 'y el nombre de su fila, para el ratón');

    // Y no se movió nada, ni en este proyecto ni en la biblioteca.
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'published', 'measured-decision-check')), false);
    assert.equal(catalog.count(), 0, 'preguntar no avisa al catálogo: no cambió nada');
  });
  it('sin id no pide sintaxis: enseña lo que hay (y arma las filas)', () => {
    const s = sandbox();
    const { byName } = commands(s.root);
    const result = byName['skill-aprobar'].handler({ agent, rawInput: '' });
    assert.equal(result.kind, 'success', 'debe listar, no exigir que el humano recuerde un id');
    assert.match(result.text, /Pendientes de tu aprobación/);
    assert.match(result.text, /Aprobadas y activas/);
  });

  it('no aprueba lo que no existe', () => {
    const s = sandbox();
    const { byName } = commands(s.root);
    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'no-existe' });
    assert.equal(result.kind, 'error');
    assert.match(result.text, /No hay ninguna propuesta/);
    assert.match(result.text, /skill-propuestas/, 'dice dónde mirar, en vez de solo que no existe');
  });

  it('respeta la puerta: una propuesta que no la pasa no se aprueba, y nada se mueve', () => {
    const s = sandbox();
    // Una propuesta tocada a mano después de proponerla: cuerpo por debajo del mínimo.
    const dir = join(s.root, 'projects', KEY, 'proposed', 'tocada-a-mano');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), ['---', 'name: tocada-a-mano', 'description: "Una propuesta que alguien editó a mano y rompió."', '---', '', 'Muy corto.'].join('\n'));

    const { byName } = commands(s.root);
    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'tocada-a-mano --local' });
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

    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check --local' });
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

    const sinForzar = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check --local' });
    assert.equal(sinForzar.kind, 'error');
    assert.match(sinForzar.text, /tiene avisos/);
    assert.match(sinForzar.text, /--force/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false, 'con avisos no se aprueba sola');

    const forzado = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check --local --force' });
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

  it('aprobar dos veces no es un fallo: la segunda dice que ya estaba activa', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const catalog = fakeCatalog();
    // La fila se captura UNA vez: es la misma acción, y aprobar la retira del conjunto de pendientes.
    const fila = targetCommands({ root: s.root, catalog, rows: pendingRowsFor({ root: s.root, cwd: CWD }) })
      .find((row) => row.name === 'skill-aprobar-measured-decision-check');

    const primera = fila.handler({ agent });
    assert.equal(primera.kind, 'success');
    // Medido con el usuario delante: el segundo intento respondía «failed» — un mensaje que parecía decir
    // que la primera aprobación no había servido. Ahora dice lo que pasó, sin mover nada.
    const segunda = fila.handler({ agent });
    assert.equal(segunda.kind, 'success', 'aprobar algo ya aprobado no es un error');
    assert.match(segunda.text, /Ya estaba activa/);
    assert.match(segunda.text, /No se ha cambiado nada/);
    assert.equal(catalog.count(), 1, 'la segunda vez no vuelve a avisar al catálogo: no cambió nada');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check', 'SKILL.md')), true);
  });

  it('el resultado de decidir trae la lista al día, para no tener que volver a pedirla', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    propose(goodInput({ id: 'otro-tema-distinto', description: 'Otra cosa sin relación con lo anterior, con su propio detalle.', whenToUse: 'Cuando haga falta otra cosa.' }),
      { root: s.root, curated: s.curated, cwd: CWD });
    const { byName } = commands(s.root);

    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check --local' });
    assert.equal(result.kind, 'success');
    assert.match(result.text, /Pendientes de tu aprobación \(1\):/);
    assert.match(result.text, /otro-tema-distinto/);
    assert.equal(result.text.includes('measured-decision-check — ') && /Pendientes[\s\S]*measured-decision-check — /.test(result.text), false,
      'la recién aprobada no puede seguir apareciendo como pendiente');

    // Y cuando no queda nada, se dice sin rodeos.
    const ultima = byName['skill-aprobar'].handler({ agent, rawInput: 'otro-tema-distinto --local' });
    assert.match(ultima.text, /Pendientes de tu aprobación \(0\):[\s\S]*ninguna/);
  });

  it('aprobar algo apartado, o apartar algo activo, lo dice con el estado real', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const { byName } = commands(s.root);
    byName['skill-rechazar'].handler({ agent, rawInput: 'measured-decision-check' });

    const apartada = byName['skill-aprobar'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(apartada.kind, 'error');
    assert.match(apartada.text, /está apartada/);
    assert.match(apartada.text, /rejected/);

    const deNuevo = byName['skill-rechazar'].handler({ agent, rawInput: 'measured-decision-check' });
    assert.equal(deNuevo.kind, 'success', 'apartar algo ya apartado tampoco es un fallo');
    assert.match(deNuevo.text, /Ya estaba apartada/);
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

describe('comandos · un id mal tecleado no es un callejón sin salida', () => {
  /** Una pendiente mínima: estos casos sólo miran el camino «ese id no está», no la puerta. */
  const pendiente = (root, id) => {
    const dir = join(root, 'projects', KEY, 'proposed', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), [
      '---', `name: ${id}`, `description: "Una propuesta pendiente llamada ${id}."`, '---', '', '# ' + id, '',
    ].join('\n'));
  };

  it('con una letra cambiada de sitio, ofrece el id que sí está (medido con dsh-nexus-protocol)', () => {
    const s = sandbox();
    pendiente(s.root, 'dsh-nexus-protocol');
    const { byName } = commands(s.root);

    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'dhs-nexus-protocol --local' });
    assert.equal(result.kind, 'error', 'no había nada con ese id: se dice');
    assert.match(result.text, /No hay ninguna propuesta «dhs-nexus-protocol»/);
    assert.match(result.text, /¿Querías decir «dsh-nexus-protocol»\?/);
    assert.match(result.text, /skill-propuestas/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'dsh-nexus-protocol')), false, 'y no se movió nada');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'dsh-nexus-protocol')), true);
  });

  it('con un id que no se parece a nada, no inventa una sugerencia', () => {
    const s = sandbox();
    pendiente(s.root, 'dsh-nexus-protocol');
    const { byName } = commands(s.root);

    const result = byName['skill-aprobar'].handler({ agent, rawInput: 'otra-cosa-muy-distinta --local' });
    assert.equal(result.kind, 'error');
    assert.doesNotMatch(result.text, /¿Querías decir/);
    assert.match(result.text, /Míralas con \/skill-propuestas/);
  });

  it('con dos candidatos igual de cerca, elige siempre el mismo', () => {
    const s = sandbox();
    pendiente(s.root, 'medida-una');
    pendiente(s.root, 'medida-uno');
    const { byName } = commands(s.root);

    const primera = byName['skill-aprobar'].handler({ agent, rawInput: 'medida-unz --local' });
    const segunda = byName['skill-aprobar'].handler({ agent, rawInput: 'medida-unz --local' });
    assert.match(primera.text, /¿Querías decir «medida-una»\?/, 'el empate lo rompe el orden, no el azar');
    assert.equal(primera.text, segunda.text);
  });

  it('la misma ayuda en /skill-ver y /skill-rechazar', () => {
    const s = sandbox();
    pendiente(s.root, 'dsh-nexus-protocol');
    const { byName } = commands(s.root);

    for (const comando of ['skill-ver', 'skill-rechazar']) {
      const result = byName[comando].handler({ agent, rawInput: 'dsh-nexus-protoocl' });
      assert.equal(result.kind, 'error', comando);
      assert.match(result.text, /¿Querías decir «dsh-nexus-protocol»\?/, comando);
    }
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'rejected', 'dsh-nexus-protocol')), false);
  });
});

describe('comandos · una pendiente que actualiza algo activo lo dice', () => {
  it('el listado y la fila la llaman actualización, no skill nueva', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    approve('measured-decision-check', KEY, { root: s.root });
    // Ahora llega un parche sobre lo aprobado: mismo id, otra versión.
    const parche = propose(patchInput({ body: `${goodInput().body}\n\nUn paso más, medido.\n` }), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(parche.status, 'proposed', parche.errors?.join(' | '));

    const fila = pending({ root: s.root, key: KEY }).find((p) => p.id === 'measured-decision-check');
    assert.equal(fila.updatesActive, true, 'la propuesta sustituye una versión activa y hay que decirlo');

    const { byName } = commands(s.root);
    const listado = byName['skill-propuestas'].handler({ agent, rawInput: '' });
    assert.match(listado.text, /actualización de la versión activa/);

    const filas = pendingRowsFor({ root: s.root, cwd: CWD });
    const aprobar = filas.find((f) => f.verb === 'aprobar' && f.id === 'measured-decision-check');
    assert.match(aprobar.description, /Actualiza una skill que ya está activa/);
    assert.match(aprobar.description, /la anterior queda apartada/);
  });

  it('una pendiente nueva no se anuncia como actualización', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const fila = pending({ root: s.root, key: KEY }).find((p) => p.id === 'measured-decision-check');
    assert.equal(fila.updatesActive, false);
    assert.doesNotMatch(filasTexto(s), /actualización de la versión activa/);
  });

  const filasTexto = (s) => commands(s.root).byName['skill-propuestas'].handler({ agent, rawInput: '' }).text;
});
