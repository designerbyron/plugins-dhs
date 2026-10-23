/**
 * Contrato de las herramientas: congelado antes de tocar una sola descripción.
 *
 * El manifiesto `fixtures/definitions-contract.json` se generó con las definiciones **anteriores** a la
 * traducción, y no se regenera desde el código: si la prueba construyera la expectativa a partir de la misma
 * definición, aceptaría cualquier regresión. Traducir la prosa no puede mover ni un nombre, ni un tipo, ni un
 * obligatorio, ni el esquema de salida — y aquí se comprueba.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  skillPropose, skillReview, skillUpstreamCheck, skillVendor,
} from '../lib/definitions.mjs';

const MANIFIESTO = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/definitions-contract.json'), 'utf8'));
const FABRICAS = { skillPropose, skillReview, skillVendor, skillUpstreamCheck };

const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v)));
const viva = (nombre) => {
  const t = FABRICAS[MANIFIESTO.tools[nombre].factory]({});
  const params = {};
  for (const k of Object.keys(t.parameters ?? {}).sort()) {
    const p = t.parameters[k] ?? {};
    params[k] = { type: p.type ?? null, required: p.required === true, enum: Array.isArray(p.enum) ? [...p.enum].sort() : null };
  }
  return { name: t.name, params, output: norm(t.output) ?? null };
};

describe('definitions · contrato congelado', () => {
  it('están las cuatro herramientas esperadas, con su nombre real', () => {
    const esperadas = Object.keys(MANIFIESTO.tools).sort();
    assert.deepEqual(esperadas, ['skill_propose', 'skill_review', 'skill_upstream_check', 'skill_vendor']);
    for (const nombre of esperadas) assert.equal(viva(nombre).name, nombre);
  });

  it('cada herramienta conserva sus parámetros: nombre, tipo, obligatoriedad y enum', () => {
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      const actual = viva(nombre);
      assert.deepEqual(actual.params, esperado.params, `${nombre}: cambió el contrato de parámetros`);
    }
  });

  it('el esquema de salida no cambia', () => {
    for (const [nombre, esperado] of Object.entries(MANIFIESTO.tools)) {
      assert.deepEqual(viva(nombre).output, esperado.output, `${nombre}: cambió el esquema de salida`);
    }
  });

  it('las descripciones NO están en el manifiesto: traducirlas no puede excusar un cambio de esquema', () => {
    for (const esperado of Object.values(MANIFIESTO.tools)) {
      assert.equal(/description/i.test(JSON.stringify(Object.keys(esperado))), false);
    }
  });
});
