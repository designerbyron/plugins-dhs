#!/usr/bin/env node
/**
 * Puerta de las filas de pendientes: la superficie que hace que aprobar sea *elegir en el menú*.
 *
 * Lo que se fija aquí, y por qué cada cosa:
 *
 *   · **La gramática del registro**, porque un nombre inválido no se registra y la fila desaparece sin
 *     que nadie se entere: la comprobación se hace contra la expresión del contrato del harness.
 *   · **Unicidad entre proyectos**: el registro de comandos es global y un nombre repetido lanza al
 *     registrar; dos proyectos con la misma skill pendiente no pueden producir el mismo nombre.
 *   · **Ids editados a mano**: la biblioteca es un directorio. Un id fuera de la gramática se normaliza
 *     o la fila se omite — nunca se devuelve un nombre que el harness vaya a rechazar.
 *   · **Sin ámbito no hay filas**, en vez de filas de un proyecto inventado.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { propose, projectKey } from '../lib/compiler.mjs';
import { COMMAND_NAME, commandSlug, pendingRowsFor, pendingRowsForAll } from '../lib/pending-rows.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const OTHER = 'C:\\xampp\\htdocs\\otro-proyecto';
const KEY = projectKey(CWD);

/** Escribe una propuesta a mano, para cubrir un id que la herramienta nunca generaría. */
function proposeRaw(root, key, directory, name) {
  const dir = join(root, 'projects', key, 'proposed', directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    'description: "Una skill escrita a mano para probar la gramática de los nombres."',
    '---',
    '', '# A mano', '',
  ].join('\n'));
}

describe('filas de pendientes · composición', () => {
  it('una pendiente produce las tres filas, con nombres válidos y descripciones que se leen solas', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });

    const rows = pendingRowsFor({ root: s.root, cwd: CWD });
    assert.deepEqual(rows.map((row) => row.name), [
      'skill-ver-measured-decision-check',
      'skill-aprobar-measured-decision-check',
      'skill-rechazar-measured-decision-check',
    ]);
    for (const row of rows) {
      assert.match(row.name, COMMAND_NAME, `${row.name} no cumple la gramática del harness`);
      assert.equal(row.description.trim().length > 0, true);
      assert.match(row.description, /measured-decision-check/);
      assert.match(row.description, /saas-corporative/);
      assert.equal(row.key, KEY);
      assert.equal(row.id, 'measured-decision-check');
    }
    // Los verbos, en el orden en que se usan.
    assert.deepEqual(rows.map((row) => row.verb), ['ver', 'aprobar', 'rechazar']);
  });

  it('sin pendientes no anuncia nada, y sin ámbito tampoco (no se inventa un proyecto)', () => {
    const s = sandbox();
    assert.deepEqual(pendingRowsFor({ root: s.root, cwd: CWD }), []);
    for (const cwd of [undefined, null, '', '   ']) {
      assert.deepEqual(pendingRowsFor({ root: s.root, cwd }), []);
    }
  });

  it('dos proyectos con la misma skill pendiente no producen el mismo nombre', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: OTHER });

    const rows = pendingRowsForAll({ root: s.root, cwds: [CWD, OTHER] });
    const names = rows.map((row) => row.name);
    assert.equal(names.length, 6, 'tres filas por proyecto');
    assert.equal(new Set(names).size, names.length, 'ningún nombre repetido');
    for (const name of names) assert.match(name, COMMAND_NAME, `${name} no cumple la gramática`);
    // El mismo id, dos ámbitos: cada fila sabe de cuál es.
    assert.deepEqual(new Set(rows.map((row) => row.key)), new Set([KEY, projectKey(OTHER)]));
  });

  it('un id editado a mano se normaliza; si no se puede expresar, la fila se omite', () => {
    const s = sandbox();
    proposeRaw(s.root, KEY, 'dos-fa', '2FA Setup!');
    proposeRaw(s.root, KEY, 'roto', '---');

    const rows = pendingRowsFor({ root: s.root, cwd: CWD });
    const names = rows.map((row) => row.name);
    for (const name of names) assert.match(name, COMMAND_NAME, `${name} no cumple la gramática`);
    // `2FA Setup!` → `2fa-setup`, y el prefijo `skill-` mantiene la letra inicial que exige el registro.
    assert.equal(names.includes('skill-aprobar-2fa-setup'), true);
    // `---` no expresa nada: antes que registrar un nombre inválido, no hay fila para esa propuesta.
    assert.equal(names.some((name) => name.includes('roto')), false);
    assert.equal(commandSlug('---'), null);
    assert.equal(commandSlug('2FA Setup!'), '2fa-setup');
  });

  it('sin biblioteca ni almacén sigue devolviendo una lista vacía, no un fallo', () => {
    assert.deepEqual(pendingRowsFor({ root: 'C:\\no\\existe\\skill-compiler', cwd: CWD }), []);
    assert.deepEqual(pendingRowsForAll({ root: 'C:\\no\\existe\\skill-compiler', cwds: [CWD] }), []);
  });
});
