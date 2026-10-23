/**
 * E2E · el ciclo de una ACTUALIZACION por las superficies reales: la propuesta por la API (como la hace el
 * modelo) y la puerta y la aprobacion por el **CLI**, con su proceso y su salida de verdad, en arena.
 *
 * Era `update-real.e2e.mjs`: un guion con `assert` suelto que `node --test` no recogia por la extension, asi
 * que pasaba versiones enteras sin proteger nada y nadie veia si seguia midiendo lo mismo. Ahora es una
 * prueba descubierta, con una arena por caso, y mide lo que dejo EN DISCO:
 *
 *   1. una primera version se propone, pasa `check` y se aprueba;
 *   2. un parche **sin revision** se rechaza;
 *   3. un parche **con evidencia y base identificada** pasa `check`;
 *   4. si la version aprobada se mueve, `check` la rechaza, `approve` se niega, la aprobada conserva su
 *      cambio y la correccion sigue pendiente.
 *
 * No hay servicio externo ni almacen real en el camino: `DSH_HOME` apunta a la arena y el idioma se fija
 * aqui (la prosa que se afirma es la espanola, y el base es `en`).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, defaultRoot, projectKey, propose } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

// El idioma se fija por FICHERO: `node --test` corre cada uno en su proceso, asi que esto no toca a los demas.
process.env.DSH_LANG = 'es';
resetLangCache();

const PAQUETE = process.cwd();
const CWD = process.cwd();
const ID = 'medir-antes-de-decider';
const KEY = projectKey(CWD);

/** El CLI real, con la arena como almacen: lo que hace el humano, no una funcion de libreria. */
function cli(arena, ...args) {
  const r = spawnSync(process.execPath, ['bin/skill-compiler.mjs', ...args], {
    cwd: PAQUETE,
    env: { ...process.env, DSH_HOME: arena.base },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const revision = (over = {}) => ({
  claim: 'La version anterior afirmaba que el orden de los pasos no importaba.',
  evidence: 'package.json',
  measurement: 'Medido con `node --test`: 3 fallos antes, 0 despues.',
  change: 'Ahora el orden se declara como parte del contrato.',
  ...over,
});

const skill = () => ({
  id: ID,
  description: 'Decide con evidencia medida en vez de con impresiones del momento.',
  whenToUse: 'Cuando una decision necesite un numero medido antes de actuar.',
  body: [
    '## Cuando se usa', '',
    'Cuando hay que decidir con evidencia y no con impresiones sueltas del momento.', '',
    '## Procedimiento', '',
    '1. Medir antes de tocar nada y anotar el numero.',
    '2. Comparar contra el registro previo y declarar la diferencia.',
    '3. Cerrar solo si las dos medidas coinciden.',
  ].join('\n'),
});

const rutas = (root) => ({
  aprobada: join(root, 'projects', KEY, 'approved', ID),
  propuesta: join(root, 'projects', KEY, 'proposed', ID),
});

/** Arena con la primera version ya aprobada: el punto de partida de una actualizacion. */
function conPrimeraVersionAprobada() {
  const s = sandbox();
  const r = propose(skill(), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
  const aprobada = cli(s, 'approve', ID);
  assert.match(aprobada.out, new RegExp(`Activa: ${ID}`));
  assert.equal(existsSync(join(rutas(s.root).aprobada, 'SKILL.md')), true, 'la version aprobada no esta en disco');
  return s;
}

describe('E2E · una actualizacion, de la propuesta a la negativa por base movida', () => {
  it('la primera version se propone, pasa check y queda aprobada en disco', () => {
    const s = sandbox();
    const r = propose(skill(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
    assert.match(cli(s, 'check', ID).out, /en verde/);
    const aprobada = cli(s, 'approve', ID);
    assert.match(aprobada.out, new RegExp(`Activa: ${ID}`));
    assert.equal(existsSync(join(rutas(s.root).aprobada, 'SKILL.md')), true, 'la version aprobada no esta en disco');
    assert.equal(existsSync(rutas(s.root).propuesta), false, 'la propuesta aprobada sigue en proposed/');
    assert.equal(approve(ID, KEY, { root: s.root, curated: s.curated }).ok, false, 'aprobar dos veces no puede pasar');
  });

  it('un parche sin revision se rechaza antes de escribir nada', () => {
    const s = conPrimeraVersionAprobada();
    const antes = readFileSync(join(rutas(s.root).aprobada, 'SKILL.md'), 'utf8');
    const sinEvidencia = propose({ ...skill(), body: `${skill().body}\n4. Un paso mas.` }, { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(sinEvidencia.status, 'invalid');
    assert.match(sinEvidencia.errors.join(' | '), /exige .{0,2}revision/);
    assert.equal(readFileSync(join(rutas(s.root).aprobada, 'SKILL.md'), 'utf8'), antes, 'el rechazo movio la version activa');
  });

  it('un parche con evidencia y base identificada se prepara y check lo acepta', () => {
    const s = conPrimeraVersionAprobada();
    const correccion = propose(
      { ...skill(), body: `${skill().body}\n4. Un paso mas, que corrige lo anterior.`, revision: revision() },
      { root: s.root, curated: s.curated, cwd: CWD },
    );
    assert.equal(correccion.status, 'proposed', JSON.stringify(correccion.errors));
    assert.equal(correccion.base.state, 'approved');
    assert.equal(correccion.evidenciaObservada, true, 'la evidencia declarada existe en el proyecto');
    assert.equal(correccion.diff.lineas.anadidas.length, 1);
    assert.match(cli(s, 'check', ID).out, /en verde/);
    assert.equal(existsSync(join(rutas(s.root).propuesta, 'SKILL.md')), true, 'la correccion no esta en disco');
  });

  it('con la base movida: check falla, approve se niega y nada se mueve', () => {
    const s = conPrimeraVersionAprobada();
    const correccion = propose(
      { ...skill(), body: `${skill().body}\n4. Un paso mas, que corrige lo anterior.`, revision: revision() },
      { root: s.root, curated: s.curated, cwd: CWD },
    );
    assert.equal(correccion.status, 'proposed');

    // Alguien mueve la version aprobada por otra via: la base de la correccion deja de ser la vigente.
    const aprobada = join(rutas(s.root).aprobada, 'SKILL.md');
    writeFileSync(aprobada, `${readFileSync(aprobada, 'utf8')}\nCambio hecho por otra via.\n`);

    const check = cli(s, 'check', ID);
    assert.equal(check.code, 1, 'check tiene que fallar');
    assert.match(check.out, /la versi[oó]n vigente cambi[oó] desde que se prepar[oó] esta correcci[oó]n/);
    assert.match(check.out, /vuelve a proponer sobre la versi[oó]n nueva/);

    const aprobar = cli(s, 'approve', ID);
    assert.equal(aprobar.code, 1, 'approve tiene que negarse');
    assert.match(aprobar.out, /RECHAZADA/);

    // Y nada se movio: la aprobada conserva su cambio, la correccion sigue pendiente con su estado.
    assert.match(readFileSync(aprobada, 'utf8'), /Cambio hecho por otra via/);
    const meta = JSON.parse(readFileSync(join(rutas(s.root).propuesta, 'meta.json'), 'utf8'));
    assert.equal(meta.state, 'proposed');
  });

  it('la prueba corre en la arena, no en el almacen de la maquina', () => {
    const s = conPrimeraVersionAprobada();
    assert.equal(defaultRoot().startsWith(s.root), true, `defaultRoot fuera de la arena: ${defaultRoot()}`);
  });
});
