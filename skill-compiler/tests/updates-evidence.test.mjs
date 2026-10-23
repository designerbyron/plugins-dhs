#!/usr/bin/env node
/**
 * Actualizar una skill viva: evidencia, base y diff.
 *
 * ── Qué protege esta puerta ──────────────────────────────────────────────────────────────────────
 *
 * Una propuesta nueva se juzga por lo que promete. Un **parche**, no: cambia una herramienta que alguien
 * ya usa, y por eso tiene que decir tres cosas y demostrarlas:
 *
 *   1. **Por qué** — qué afirmaba la versión anterior, qué la contradice, con qué se midió y qué cambia.
 *      Un texto largo no es una medición: la medición tiene un número o un comando.
 *   2. **Contra qué** — la versión exacta sobre la que se construyó. Si esa versión se mueve mientras
 *      la propuesta espera, aplicarla sería aplicar un cambio sobre algo que ya no existe: se rechaza.
 *   3. **Qué cambia** — el diff: líneas y material, añadido, modificado y eliminado. Y lo que se elimina
 *      se justifica y no puede evaporarse: el contenido tiene que seguir en alguna parte.
 *
 * ── Por qué está escrita así ─────────────────────────────────────────────────────────────────────
 *
 * El cwd es el directorio real de la suite, para que «la evidencia existe» sea comprobable de verdad y
 * no dependa de la máquina de nadie. Los casos negativos son de **una sola causa**, para que el motivo
 * del rechazo sea inequívoco. Y el último bloque mide lo que el gate exige: que un rechazo no toque la
 * versión aprobada ni deje nada a medias.
 *
 *   node --test tests/updates-evidence.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  approve, checkProposal, checkRevision, diffContra, diffLines, folderHash, projectKey,
  propose, referencesDiff, treeOf, vigenteDe,
} from '../lib/compiler.mjs';
import { skillPropose } from '../lib/definitions.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

// El proyecto real de la suite: así la evidencia «package.json» existe de verdad y el caso «observada»
// no es una simulación.
const CWD = process.cwd();
const ID = 'measured-decision-check';
const KEY = () => projectKey(CWD);
const errores = (r) => r.errors.join(' | ');
const revisionBuena = (over = {}) => ({
  claim: 'La versión anterior afirmaba que el orden de los pasos no importaba.',
  evidence: 'package.json',
  measurement: 'Medido con `node --test`: 3 fallos antes, 0 después.',
  change: 'Ahora el procedimiento declara el orden como parte del contrato.',
  ...over,
});

/** Una skill viva: propuesta y aprobada, con su carpeta. Devuelve la arena. */
function conViva({ body = goodInput().body } = {}) {
  const s = sandbox();
  const r = propose(goodInput({ body }), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors));
  assert.equal(approve(ID, KEY(), { root: s.root }).ok, true);
  return s;
}

// ── la revisión: evidencia, no texto ────────────────────────────────────────────────────────────

describe('actualización · la revisión tiene que ser una evidencia', () => {
  it('sin revisión, un parche de una skill viva se rechaza y no escribe nada', () => {
    const s = conViva();
    const r = propose(goodInput({ body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'invalid');
    assert.match(errores(r), /un parche de una skill viva exige «revision»/);
    assert.equal(existsSync(join(s.root, 'projects', KEY(), 'proposed', ID)), false);
  });

  it('cada campo se exige por su nombre, y falta uno, falta el parche', () => {
    const s = conViva();
    const sin = (campo) => {
      const rev = revisionBuena();
      delete rev[campo];
      return propose(goodInput({ revision: rev, body: `${goodInput().body}\n\n4. Un paso más.\n` }),
        { root: s.root, curated: s.curated, cwd: CWD });
    };
    for (const campo of ['claim', 'evidence', 'measurement', 'change']) {
      const r = sin(campo);
      assert.equal(r.status, 'invalid', `sin ${campo} no puede pasar`);
      assert.match(errores(r), new RegExp(`revision\\.${campo}`), `el motivo tiene que nombrar ${campo}`);
    }
  });

  it('una medición sin número ni comando NO es una medición', () => {
    const s = conViva();
    const r = propose(goodInput({ revision: revisionBuena({ measurement: 'Lo he comprobado yo mismo y funciona bien' }), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'invalid');
    assert.match(errores(r), /no contiene ninguna medición/);
    assert.match(errores(r), /una afirmación del modelo no es una medición/);
    // Y con un número, o con un comando, sí pasa: es la forma, no la longitud.
    for (const buena of ['La suite bajó de 3 fallos a 0.', 'Salida de `node --test`: todo verde.']) {
      const ok = propose(goodInput({ revision: revisionBuena({ measurement: buena }), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
        { root: s.root, curated: s.curated, cwd: CWD });
      assert.equal(ok.status, 'proposed', JSON.stringify(ok.errors));
    }
  });

  it('distingue la evidencia OBSERVADA de la afirmación sin verificar', () => {
    const s = conViva();
    const conRuta = propose(goodInput({ revision: revisionBuena({ evidence: 'package.json' }), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(conRuta.status, 'proposed', JSON.stringify(conRuta.errors));
    assert.equal(conRuta.evidenciaObservada, true, 'la ruta existe: la evidencia es observable');

    const conRutaQueNoEsta = propose(goodInput({ revision: revisionBuena({ evidence: 'informes/no-existe-este-informe.md' }), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(conRutaQueNoEsta.status, 'proposed', 'una evidencia sin verificar no bloquea: se declara');
    assert.equal(conRutaQueNoEsta.evidenciaObservada, false);
    assert.match(conRutaQueNoEsta.warnings.join(' | '), /NO verificada/);

    const conTexto = propose(goodInput({ revision: revisionBuena({ evidence: 'Lo que vimos en la sesión del martes' }), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(conTexto.evidenciaObservada, false);
    assert.match(conTexto.warnings.join(' | '), /no es una ruta del proyecto/);
  });

  it('la herramienta cuenta la corrección en su resumen: base, diff y qué evidencia hay', () => {
    const s = conViva();
    const tool = skillPropose({ root: s.root, curated: s.curated });
    const value = tool.execute(goodInput({ revision: revisionBuena({ evidence: 'package.json' }), body: `${goodInput().body}\n\n4. Un paso más.\n` }), fakeExec(CWD));
    assert.equal(value.status, 'proposed', JSON.stringify(value.errors));
    assert.equal(value.base.state, 'approved');
    assert.equal(typeof value.base.hash, 'string');
    assert.equal(value.evidenciaObservada, true);
    assert.match(value.summary, /Corrige una skill viva: approved, base /);
    assert.match(value.summary, /observada/);
    assert.equal(value.diff.lineas.anadidas.length >= 1, true);
  });
});

// ── la base: contra qué se construyó ────────────────────────────────────────────────────────────

describe('actualización · la versión base', () => {
  it('la propuesta identifica la versión vigente por su huella', () => {
    const s = conViva();
    const viva = vigenteDe(ID, KEY(), { root: s.root, curated: s.curated });
    const r = propose(goodInput({ revision: revisionBuena(), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors));
    assert.deepEqual(r.base, { state: 'approved', hash: viva.hash });
    // Y queda registrado en meta.json, que es donde lo volverá a leer la puerta de aprobar.
    const meta = JSON.parse(readFileSync(join(s.root, 'projects', KEY(), 'proposed', ID, 'meta.json'), 'utf8'));
    assert.deepEqual(meta.base, r.base);
    assert.equal(meta.revision.measurement, revisionBuena().measurement);
    assert.deepEqual(meta.diff.lineas, { anadidas: r.diff.lineas.anadidas.length, eliminadas: r.diff.lineas.eliminadas.length });
  });

  it('base obsoleta: si la vigente cambió, aprobar se rechaza y dice que reconcilie', () => {
    const s = conViva();
    const parche = propose(goodInput({ revision: revisionBuena(), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(parche.status, 'proposed');
    assert.equal(checkProposal(ID, KEY(), { root: s.root, curated: s.curated }).ok, true, 'sobre la base correcta, se puede aprobar');

    // Alguien toca la versión aprobada (a mano, o con otra aprobación): la base deja de ser la vigente.
    const aprobada = join(s.root, 'projects', KEY(), 'approved', ID, 'SKILL.md');
    writeFileSync(aprobada, `${readFileSync(aprobada, 'utf8')}\nCambio hecho por otra vía.\n`);
    const check = checkProposal(ID, KEY(), { root: s.root, curated: s.curated });
    assert.equal(check.ok, false);
    // La frase se compone del catalogo en el idioma de la sesion (`en` sin DSH_LANG): se fija la frase de cada
    // idioma, no la redaccion de un modulo. El DATO -las dos huellas- viaja dentro.
    assert.match(errores(check), /la version vigente cambio desde que se preparo esta correccion|the current version changed since this correction was prepared/);
    assert.match(errores(check), /vuelve a proponer sobre la version nueva|propose it again on top of the new version/);
  });

  it('modificación concurrente: dos correcciones sobre la misma base, la segunda ya no vale', () => {
    const s = conViva();
    const primera = propose(goodInput({ revision: revisionBuena({ change: 'Primera corrección: el orden importa.' }), body: `${goodInput().body}\n\n4. Primera corrección.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(primera.status, 'proposed');
    // La primera se aprueba: la vigente es ahora otra.
    assert.equal(approve(ID, KEY(), { root: s.root }).ok, true);
    // Y ahora la segunda corrección, preparada contra la base vieja: se prepara…
    const segunda = propose(goodInput({ revision: revisionBuena({ change: 'Segunda corrección desde la base original.' }), body: `${goodInput().body}\n\n5. Segunda corrección.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    // …pero la puerta la caza: se construyó contra una versión que ya no es la vigente.
    assert.equal(segunda.status, 'invalid');
    assert.match(errores(segunda), /elimina|revision/);
  });

  it('si la versión base desapareció, tampoco se aplica: se pide volver a proponer', () => {
    const s = conViva();
    const parche = propose(goodInput({ revision: revisionBuena(), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(parche.status, 'proposed');
    // La vigente se retira del almacén (a un respaldo fechado): la base ya no está.
    rmSync(join(s.root, 'projects', KEY(), 'approved', ID), { recursive: true, force: true });
    const check = checkProposal(ID, KEY(), { root: s.root, curated: s.curated });
    assert.equal(check.ok, false);
    assert.match(errores(check), /ya no esta|is no longer there/);
    assert.match(errores(check), /vuelve a proponerla sobre lo que haya ahora|propose it again on top of whatever is there now/);
  });
});

// ── el diff: qué se añade, qué se modifica y qué se elimina ─────────────────────────────────────

describe('actualización · el diff', () => {
  it('líneas: las que estaban y ya no están se cuentan como eliminadas, y al revés', () => {
    const d = diffLines('uno\ndos\ntres\n', 'uno\ntres\ncuatro\n');
    assert.deepEqual(d.eliminadas, ['dos']);
    assert.deepEqual(d.anadidas, ['cuatro']);
    // Canónico: un salto de más al final no es contenido que desaparece.
    assert.deepEqual(diffLines('uno\ndos\n', 'uno\ndos'), { anadidas: [], eliminadas: [] });
    assert.deepEqual(diffLines('uno\r\n', 'uno\n'), { anadidas: [], eliminadas: [] });
  });

  it('material: añadido, modificado y eliminado, con sus huellas', () => {
    const d = referencesDiff(
      [{ path: 'references/a.md', sha256: 'aaa' }, { path: 'references/b.md', sha256: 'bbb' }, { path: 'references/c.md', sha256: 'ccc' }],
      [{ path: 'references/a.md', sha256: 'aaa' }, { path: 'references/b.md', sha256: 'OTRA' }, { path: 'references/d.md', sha256: 'ddd' }],
    );
    assert.deepEqual(d.anadidas, [{ path: 'references/d.md', sha256: 'ddd' }]);
    assert.deepEqual(d.modificadas, [{ path: 'references/b.md', antes: 'bbb', despues: 'OTRA' }]);
    assert.deepEqual(d.eliminadas, [{ path: 'references/c.md', sha256: 'ccc' }]);
  });

  it('una línea eliminada exige justificación: sin ella, no hay parche', () => {
    const s = conViva({ body: `${goodInput().body}\n\n4. Un paso que se va a quitar.\n` });
    const sinRemoved = propose(goodInput({ revision: revisionBuena(), body: goodInput().body }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(sinRemoved.status, 'invalid');
    assert.match(errores(sinRemoved), /elimina 2 línea\(s\) del cuerpo/);
    assert.match(errores(sinRemoved), /revision\.removed/);
    // Con la justificación, pasa — y el diff queda registrado.
    const conRemoved = propose(goodInput({ revision: revisionBuena({ removed: 'Ese cuarto paso era el error: contradecía la medición del informe.' }), body: goodInput().body }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(conRemoved.status, 'proposed', JSON.stringify(conRemoved.errors));
    assert.equal(conRemoved.diff.lineas.eliminadas.length, 2);
  });

  it('material que se elimina: se justifica, y su contenido tiene que seguir vivo', () => {
    const s = sandbox();
    const contenido = '## Contrato\n\nEl valor exacto es 24.000 y el orden importa.\n';
    const cuerpo = `## Uso\n\nVer \`references/contratos.md\`.\n\n## Cierre\n\n${'x'.repeat(200)}`;
    assert.equal(propose(goodInput({ body: cuerpo }), { root: s.root, curated: s.curated, cwd: CWD, references: [{ path: 'references/contratos.md', content: contenido }] }).status, 'proposed');
    assert.equal(approve(ID, KEY(), { root: s.root }).ok, true);

    // La propuesta se lleva el material y no lo conserva en ninguna parte: no pasa, ni con justificación.
    const sinGuardar = propose(
      goodInput({ revision: revisionBuena({ removed: 'Ya no hace falta ese material, el cuerpo lo resume.' }), body: `## Uso\n\nYa no hay material.\n\n## Cierre\n\n${'y'.repeat(200)}` }),
      { root: s.root, curated: s.curated, cwd: CWD },
    );
    assert.equal(sinGuardar.status, 'invalid');
    assert.match(errores(sinGuardar), /su contenido se pierde al eliminar/);
    assert.match(errores(sinGuardar), /references\/contratos\.md/);

    // Y si el contenido viaja al cuerpo, la eliminación del fichero es legítima.
    const conGuardado = propose(
      goodInput({ revision: revisionBuena({ removed: 'El material se mueve al cuerpo: el detalle sigue igual.' }), body: `## Uso\n\n${contenido}\n## Cierre\n\n${'z'.repeat(200)}` }),
      { root: s.root, curated: s.curated, cwd: CWD },
    );
    assert.equal(conGuardado.status, 'proposed', JSON.stringify(conGuardado.errors));
    assert.deepEqual(conGuardado.diff.references.eliminadas.map((r) => r.path), ['references/contratos.md']);
  });

  it('una referencia modificada se ve en el diff, con las dos huellas', () => {
    const s = sandbox();
    const cuerpo = `## Uso\n\nVer \`references/notas.md\`.\n\n## Cierre\n\n${'x'.repeat(200)}`;
    assert.equal(propose(goodInput({ body: cuerpo }), { root: s.root, curated: s.curated, cwd: CWD, references: [{ path: 'references/notas.md', content: 'versión uno\n' }] }).status, 'proposed');
    assert.equal(approve(ID, KEY(), { root: s.root }).ok, true);
    const r = propose(goodInput({ revision: revisionBuena(), body: cuerpo }), {
      root: s.root, curated: s.curated, cwd: CWD,
      references: [{ path: 'references/notas.md', content: 'versión dos, corregida\n' }],
    });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors));
    assert.equal(r.diff.references.modificadas.length, 1);
    assert.equal(r.diff.references.modificadas[0].path, 'references/notas.md');
    assert.notEqual(r.diff.references.modificadas[0].antes, r.diff.references.modificadas[0].despues);
  });
});

// ── el gate: un rechazo no toca lo aprobado ni deja nada a medias ───────────────────────────────

describe('actualización · lo rechazado no toca la versión aprobada', () => {
  it('se rechaza por lo que sea, y la aprobada sigue idéntica, sin restos', () => {
    const s = conViva();
    const carpeta = join(s.root, 'projects', KEY(), 'approved', ID);
    const antes = folderHash(carpeta);
    const metaAntes = readFileSync(join(carpeta, 'meta.json'), 'utf8');

    const intentos = [
      goodInput({ body: `${goodInput().body}\n\n4. Sin revisión.\n` }),
      goodInput({ revision: revisionBuena({ measurement: 'Lo comprobé a ojo' }), body: `${goodInput().body}\n\n4. Medición floja.\n` }),
      goodInput({ revision: revisionBuena(), body: `${goodInput().body}\n\n4. Elimina una línea sin decirlo.\n`.replace('3. Cerrar solo si las dos medidas coinciden.', '') }),
    ];
    for (const intento of intentos) {
      const r = propose(intento, { root: s.root, curated: s.curated, cwd: CWD });
      assert.equal(r.status, 'invalid', 'este intento tiene que rechazarse');
      assert.equal(r.id, undefined, 'y no se atribuye una propuesta que no existe');
    }

    assert.equal(folderHash(carpeta), antes, 'la skill aprobada no cambió');
    assert.equal(readFileSync(join(carpeta, 'meta.json'), 'utf8'), metaAntes);
    assert.equal(existsSync(join(s.root, 'projects', KEY(), 'proposed', ID)), false, 'ni propuesta a medias');
    assert.deepEqual(treeOf(s.root).files.filter((f) => f.includes('.tmp-')), [], 'ni temporales');
    assert.equal(existsSync(join(s.root, 'projects', KEY(), 'superseded')), false, 'ni nada apartado');
  });

  it('el ciclo bueno: se aprueba, la anterior queda apartada con su huella y la nueva vigente es la otra', () => {
    const s = conViva();
    const carpeta = join(s.root, 'projects', KEY(), 'approved', ID);
    const huellaVieja = folderHash(carpeta);
    const parche = propose(goodInput({ revision: revisionBuena({ evidence: 'package.json' }), body: `${goodInput().body}\n\n4. Un paso más.\n` }),
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(parche.status, 'proposed', JSON.stringify(parche.errors));
    assert.equal(checkProposal(ID, KEY(), { root: s.root, curated: s.curated }).ok, true);

    const movido = approve(ID, KEY(), { root: s.root });
    assert.equal(movido.ok, true, movido.reason);
    assert.notEqual(folderHash(carpeta), huellaVieja, 'la vigente es la corrección');
    assert.equal(folderHash(movido.superseded), huellaVieja, 'y la anterior se conserva con su huella exacta');
    assert.match(readFileSync(join(carpeta, 'SKILL.md'), 'utf8'), /Un paso más/);
    assert.equal(readdirSync(join(s.root, 'projects', KEY(), 'superseded')).length, 1, 'una sola versión apartada');
  });

  it('revision sin base viva: se ignora y se dice, no se aplica a una skill nueva', () => {
    const s = sandbox();
    const r = propose(goodInput({ revision: revisionBuena() }), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'proposed');
    assert.equal(r.base, undefined, 'una skill nueva no tiene base');
    assert.match(r.warnings.join(' | '), /no hay ninguna skill viva con ese id/);
  });
});

// ── la puerta de la revisión, sola ──────────────────────────────────────────────────────────────

describe('actualización · checkRevision', () => {
  it('sin revisión dice qué hace falta, y con revisión completa devuelve el valor normalizado', () => {
    const vacia = checkRevision(null, {});
    assert.equal(vacia.ok, false);
    assert.match(vacia.errors[0], /exige «revision»/);

    const completa = checkRevision({ claim: 'c'.repeat(25), evidence: 'e'.repeat(25), measurement: 'Medido con 3 datos reales, recogidos en la sesión', change: 'x'.repeat(25) }, {});
    assert.equal(completa.ok, true, errores(completa));
    assert.deepEqual(Object.keys(completa.valor), ['claim', 'evidence', 'measurement', 'change', 'removed']);
    assert.equal(completa.observada, false, 'una evidencia que no es ruta no se puede observar');
  });

  it('el diff decide si hace falta la justificación de lo eliminado', () => {
    const revision = { claim: 'c'.repeat(25), evidence: 'e'.repeat(25), measurement: 'Medido con 3 datos reales, recogidos en la sesión', change: 'x'.repeat(25) };
    const conEliminacion = checkRevision(revision, { diff: { lineas: { eliminadas: ['una línea'] }, references: { eliminadas: [] } } });
    assert.equal(conEliminacion.ok, false);
    assert.match(conEliminacion.errors.join(' |'), /elimina 1 línea\(s\) del cuerpo/);
    const conJustificacion = checkRevision({ ...revision, removed: 'Se quita porque la medición lo desmiente.' }, { diff: { lineas: { eliminadas: ['una línea'] }, references: { eliminadas: [] } } });
    assert.equal(conJustificacion.ok, true, errores(conJustificacion));
  });

  it('diffContra compara cuerpos como se escriben, no documentos renderizados', () => {
    const base = { body: '## Uno\n\n## Dos\n\ntexto\n', references: [] };
    const d = diffContra(base, { body: '## Uno\n\n## Dos\n\ntexto\n', references: [] });
    assert.deepEqual(d.lineas, { anadidas: [], eliminadas: [] }, 'el mismo contenido no produce diff');
  });
});
