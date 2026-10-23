/**
 * Catálogo de códigos: la fuente de verdad del contrato con el panel.
 *
 * Un código que no esté aquí no puede emitirse; uno que esté aquí y no tenga texto en los dos idiomas sería una
 * clave cruda esperando. Ambas cosas se comprueban en F0, antes de que exista un solo emisor.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CODES, esCodigo, parametrosDe } from '../lib/i18n/codes.mjs';
import en from '../lib/i18n/en.mjs';
import es from '../lib/i18n/es.mjs';

describe('códigos · forma', () => {
  it('todo código declara una lista de parámetros, sin repetidos', () => {
    for (const [code, params] of Object.entries(CODES)) {
      assert.equal(Array.isArray(params), true, `${code}: parámetros deben ser un array`);
      assert.equal(new Set(params).size, params.length, `${code}: parámetro repetido`);
      for (const p of params) assert.match(p, /^[a-z][A-Za-z]*$/, `${code}: parámetro mal formado «${p}»`);
    }
  });

  it('los nombres son kebab-case en inglés y no llevan espacios', () => {
    for (const code of Object.keys(CODES)) assert.match(code, /^[a-z][a-z-]*$/, code);
  });

  it('cada código tiene texto en los dos idiomas', () => {
    for (const code of Object.keys(CODES)) {
      assert.equal(typeof en[`code.${code}`], 'string', `falta en.code.${code}`);
      assert.equal(typeof es[`code.${code}`], 'string', `falta es.code.${code}`);
    }
  });

  it('esCodigo y parametrosDe coinciden con el catálogo', () => {
    assert.equal(esCodigo('activated'), true);
    assert.equal(esCodigo('inventado'), false);
    assert.deepEqual(parametrosDe('activated'), ['id', 'key']);
    assert.equal(parametrosDe('inventado'), null);
    assert.equal(esCodigo(undefined), false);
  });

  it('no hay dos códigos con el mismo nombre normalizado', () => {
    const normal = Object.keys(CODES).map((c) => c.toLowerCase());
    assert.equal(new Set(normal).size, normal.length);
  });
});
