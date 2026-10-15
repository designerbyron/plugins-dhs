#!/usr/bin/env node
/**
 * El ciclo de vida completo: apagar, retirar y volver.
 *
 * ── Qué cierra ────────────────────────────────────────────────────────────────────────────────────
 *
 * «¿Y si ya no quiero una skill?» Hasta esta ronda no había respuesta: sobre una skill **aprobada** el
 * único gesto era pedir una actualización. Faltaban los dos verbos que sí existen ahora:
 *
 *   · **apagar** (`disable`): reversible, la skill se conserva entera y deja de servirse.
 *   · **retirar** (`retire`): el gesto irreversible, y por eso **mueve** a un respaldo fechado con su
 *     huella en vez de borrar, y deja el camino de vuelta (`restore`).
 *
 * Las pruebas van contra el provider **real** —lo que de verdad ve el agente— y contra cajas de arena
 * (`DSH_HOME` redirigido), así que el respaldo también cae dentro de la arena.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  approve, disable, enable, folderHash, propose, retired, restore, retire, retiredRoot,
} from '../lib/compiler.mjs';
import { skillProvider } from '../lib/definitions.mjs';
import { buenaRevision, cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const ID = 'measured-decision-check';

/** Una skill aprobada de verdad, por el camino de verdad. Devuelve la clave del proyecto. */
function aprobada(s) {
  const r = propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r));
  assert.equal(approve(ID, r.projectKey, { root: s.root }).ok, true);
  return r.projectKey;
}

/** Lo que el agente ve en ese proyecto, con el mismo provider que usa el harness. */
const servidas = async (s) => (await skillProvider({ root: s.root }).list({ cwd: CWD })).map((skill) => skill.name);

describe('apagar una skill', () => {
  it('sale del catálogo servido, no se borra, y vuelve con un gesto', async () => {
    const s = sandbox();
    const key = aprobada(s);
    assert.deepEqual(await servidas(s), [ID]);

    const activa = join(s.root, 'projects', key, 'approved', ID);
    const huella = folderHash(activa);
    assert.equal(disable(ID, key, { root: s.root }).ok, true);

    assert.deepEqual(await servidas(s), [], 'una skill apagada no se sirve');
    const apagada = join(s.root, 'projects', key, 'disabled', ID);
    assert.equal(existsSync(apagada), true, 'no se borra: se conserva entera');
    assert.equal(folderHash(apagada), huella, 'y sin cambiarle ni un byte');

    assert.equal(enable(ID, key, { root: s.root }).ok, true);
    assert.deepEqual(await servidas(s), [ID], 'y vuelve al catálogo, sin reiniciar');
  });

  it('no se enciende si ya hay una aprobada con ese id: lo dice en vez de pisarla', () => {
    const s = sandbox();
    const key = aprobada(s);
    disable(ID, key, { root: s.root });
    propose(goodInput({ revision: buenaRevision() }), { root: s.root, curated: s.curated, cwd: CWD });
    approve(ID, key, { root: s.root });

    const r = enable(ID, key, { root: s.root });
    assert.equal(r.ok, false);
    assert.match(r.reason, /ya hay una skill aprobada/);
  });

  it('aprobar con una versión apagada del mismo id deja una sola: la apagada se aparta', () => {
    const s = sandbox();
    const key = aprobada(s);
    disable(ID, key, { root: s.root });
    propose(goodInput({ revision: buenaRevision() }), { root: s.root, curated: s.curated, cwd: CWD });

    const r = approve(ID, key, { root: s.root });
    assert.equal(r.ok, true);
    assert.equal(existsSync(join(s.root, 'projects', key, 'disabled', ID)), false,
      'dos estados con el mismo id serían servir una y esconder la otra');
    assert.equal(typeof r.superseded, 'string', 'y queda el rastro de lo reemplazado');
  });
});

describe('retirar una skill', () => {
  it('deja respaldo con la huella idéntica, la quita del almacén y se puede volver', async () => {
    const s = sandbox();
    const key = aprobada(s);
    const activa = join(s.root, 'projects', key, 'approved', ID);
    const huella = folderHash(activa);

    const r = retire(ID, key, { root: s.root });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(existsSync(activa), false, 'sale del almacén');
    assert.equal(folderHash(r.backup), huella, 'el respaldo es idéntico: se mueve, no se copia a medias');
    assert.equal(r.backup.startsWith(retiredRoot()), true, 'con fecha, y fuera del almacén');
    assert.deepEqual(await servidas(s), []);

    const v = restore(ID, key, { root: s.root });
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(v.hash, huella, 'y vuelve lo mismo');
    assert.deepEqual(await servidas(s), [ID]);
  });

  it('no sobrescribe un respaldo del mismo día, y restaurar se niega si el id ya existe', () => {
    const s = sandbox();
    const key = aprobada(s);
    assert.equal(retire(ID, key, { root: s.root }).ok, true);

    // Mismo id otra vez, y el respaldo de hoy ya está: no se pisa un archivo por accidente.
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    approve(ID, key, { root: s.root });
    const repetido = retire(ID, key, { root: s.root });
    assert.equal(repetido.ok, false);
    assert.match(repetido.reason, /ya hay un respaldo/);

    // Y con una skill viva con ese id, restaurar no puede destruirla.
    const v = restore(ID, key, { root: s.root });
    assert.equal(v.ok, false);
    assert.match(v.reason, /ya existe/);
  });

  it('retirar también funciona sobre una apagada, y la lista dice el estado y la fecha', () => {
    const s = sandbox();
    const key = aprobada(s);
    disable(ID, key, { root: s.root });
    assert.deepEqual(retired(key, { root: s.root }).map((x) => [x.id, x.state]), [[ID, 'disabled']]);

    assert.equal(retire(ID, key, { root: s.root }).ok, true, 'una apagada también se puede retirar');
    const lista = retired(key, { root: s.root });
    assert.deepEqual(lista.map((x) => x.state), ['retired']);
    assert.equal(typeof lista[0].retiredAt, 'string', 'con la fecha del respaldo');
  });

  it('lo apagado sigue contando para el anti-solapamiento: no se propone como nueva', () => {
    const s = sandbox();
    const key = aprobada(s);
    disable(ID, key, { root: s.root });
    const otra = propose({ ...goodInput(), id: 'otra-idea-distinta', description: 'Otra cosa completamente distinta que no solapa en nada de nada, con su propio procedimiento.' },
      { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(otra.status, 'proposed', JSON.stringify(otra.errors), 'una idea nueva sí entra');
    // Y el mismo id se admite como actualización, no como duplicado — con su evidencia, porque la
    // apagada sigue siendo una skill viva (se puede volver a encender).
    const misma = propose(goodInput({ revision: buenaRevision(), body: `${goodInput().body}\n\n4. Un paso más.\n` }), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(misma.status, 'proposed', JSON.stringify(misma.errors));
    assert.equal(misma.updatesDisabled, true, 'no choca con la apagada, y avisa de que la reemplazará');
    assert.equal(misma.updatesApproved, false, 'no está aprobada: está apagada, y son cosas distintas');
    assert.equal(misma.base.state, 'disabled', 'y la base identificada es la apagada');
  });
});
