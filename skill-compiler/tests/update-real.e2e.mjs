#!/usr/bin/env node
/**
 * El ciclo de una actualización, medido por las **superficies reales**: la propuesta por la API (como la
 * hace el modelo) y la puerta y la aprobación por el **CLI**, que es lo que usa el humano.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────────────────────────
 *
 * Las pruebas de `updates-evidence.test.mjs` miden las reglas; esta mide el **recorrido completo**, con el
 * proceso del CLI de por medio y su salida real, en una arena (`DSH_HOME` aparte, sin tocar el almacén de
 * la máquina). Es el mismo criterio de `propose-real.e2e.mjs` y `vendor-real.e2e.mjs`: los scripts que se
 * corren a mano para ver el comportamiento de verdad, no el de un doble.
 *
 * Lo que tiene que salir:
 *   1. una primera versión se propone, pasa `check` y se aprueba;
 *   2. un parche **sin revisión** se rechaza;
 *   3. un parche **con evidencia y base identificada** pasa `check`;
 *   4. si la versión aprobada se mueve, `check` la rechaza, `approve` no la aplica, la aprobada conserva
 *      su cambio y la corrección sigue pendiente.
 *
 *   node tests/update-real.e2e.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectKey, propose } from '../lib/compiler.mjs';

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const PAQUETE = fileURLToPath(new URL('..', import.meta.url));
const CWD = process.cwd();
const ID = 'medir-antes-de-decider';

const arena = mkdtempSync(join(tmpdir(), 'skill-compiler-update-'));
const root = join(arena, 'skill-compiler');
const curated = join(arena, 'skills');
mkdirSync(root, { recursive: true });
mkdirSync(curated, { recursive: true });
// La prosa que se afirma aqui es la espanola: el idioma se fija explicitamente (el base es `en`), y el
// subproceso lo hereda por `...process.env`.
process.env.DSH_LANG = 'es';
const env = { ...process.env, DSH_HOME: arena };

/** El CLI real, con la arena como almacén. Devuelve lo que devuelve: código y salida. */
function cli(...args) {
  try {
    return { code: 0, out: String(execFileSync(process.execPath, ['bin/skill-compiler.mjs', ...args], { cwd: PAQUETE, env, encoding: 'utf8' })) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const opts = { root, curated, cwd: CWD };
const revision = (over = {}) => ({
  claim: 'La versión anterior afirmaba que el orden de los pasos no importaba.',
  evidence: 'package.json',
  measurement: 'Medido con `node --test`: 3 fallos antes, 0 después.',
  change: 'Ahora el orden se declara como parte del contrato.',
  ...over,
});
const skill = {
  id: ID,
  description: 'Decide con evidencia medida en vez de con impresiones del momento.',
  whenToUse: 'Cuando una decisión necesite un número medido antes de actuar.',
  body: [
    '## Cuando se usa', '',
    'Cuando hay que decidir con evidencia y no con impresiones sueltas del momento.', '',
    '## Procedimiento', '',
    '1. Medir antes de tocar nada y anotar el número.',
    '2. Comparar contra el registro previo y declarar la diferencia.',
    '3. Cerrar solo si las dos medidas coinciden.',
  ].join('\n'),
};

// 1) La primera versión: se aprueba a mano, como siempre.
assert.equal(propose(skill, opts).status, 'proposed');
assert.match(cli('check', ID).out, /en verde/);
assert.match(cli('approve', ID).out, new RegExp(`Activa: ${ID}`));

// 2) Un parche sin revisión: no pasa.
const sinEvidencia = propose({ ...skill, body: `${skill.body}\n4. Un paso más.` }, opts);
assert.equal(sinEvidencia.status, 'invalid');
assert.match(sinEvidencia.errors.join(' | '), /exige «revision»/);

// 3) Un parche con evidencia y base identificada: se prepara y `check` lo acepta.
const correccion = propose({ ...skill, body: `${skill.body}\n4. Un paso más, que corrige lo anterior.`, revision: revision() }, opts);
assert.equal(correccion.status, 'proposed', JSON.stringify(correccion.errors));
assert.equal(correccion.base.state, 'approved');
assert.equal(correccion.evidenciaObservada, true, 'la evidencia declarada existe en el proyecto');
assert.equal(correccion.diff.lineas.anadidas.length, 1);
assert.match(cli('check', ID).out, /en verde/);

// 4) Alguien mueve la versión aprobada: la base deja de ser la vigente.
const aprobada = join(root, 'projects', projectKey(CWD), 'approved', ID, 'SKILL.md');
writeFileSync(aprobada, `${readFileSync(aprobada, 'utf8')}\nCambio hecho por otra vía.\n`);
const check = cli('check', ID);
assert.equal(check.code, 1, 'check tiene que fallar');
assert.match(check.out, /la versión vigente cambió desde que se preparó esta corrección/);
assert.match(check.out, /vuelve a proponer sobre la versión nueva/);
const aprobar = cli('approve', ID);
assert.equal(aprobar.code, 1, 'approve tiene que negarse');
assert.match(aprobar.out, /RECHAZADA/);

// Y nada se movió: la aprobada conserva su cambio, la corrección sigue pendiente.
assert.match(readFileSync(aprobada, 'utf8'), /Cambio hecho por otra vía/);
const meta = JSON.parse(readFileSync(join(root, 'projects', projectKey(CWD), 'proposed', ID, 'meta.json'), 'utf8'));
assert.equal(meta.state, 'proposed');

process.stdout.write([
  'recorrido completo, en una arena:',
  `  1. la primera versión se propuso, pasó check y se aprobó`,
  `  2. un parche sin revisión se rechazó: ${(sinEvidencia.errors[0] ?? '').slice(0, 60)}…`,
  `  3. un parche con evidencia (base ${correccion.base.hash}) pasó check, con diff +${correccion.diff.lineas.anadidas.length}/-${correccion.diff.lineas.eliminadas.length}`,
  `  4. con la base movida: check falla, approve se niega, la aprobada conserva su cambio y la corrección sigue ${meta.state}`,
  '',
].join('\n'));
