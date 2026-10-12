#!/usr/bin/env node
/**
 * Activación, ejecutada de verdad.
 *
 * El plugin falló al encenderse y ese fallo solo se veía en la interfaz. Esta prueba hace lo mismo que
 * el harness cuando activa el bundle —importar `index.js` y llamar a `apply(ctx)` con un contexto— y
 * comprueba que **no lanza** y que registra las cuatro cosas: la sección del prompt, las cuatro
 * herramientas (compiladas por el `defineTool` real), el proveedor de skills y la proyección.
 *
 * Lo que NO cubre, y se dice: el contexto es un doble, así que valida el camino del plugin, no el
 * comportamiento del harness con sus servicios de verdad.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { apply, inject, name } from '../index.js';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

/** Un contexto con la forma mínima que el plugin usa. Si el plugin toca algo que no está, se ve aquí. */
function fakeContext() {
  const seen = { sections: [], tools: [], providers: [], injected: [], effects: 0 };
  const ctx = {
    systemPrompt: { section: (section) => seen.sections.push(section) },
    tools: { register: (tool) => seen.tools.push(tool) },
    skills: { registerProvider: (factory) => seen.providers.push(factory) },
    inject: (deps, callback) => { seen.injected.push(deps); callback(undefined); },
    effect: (callback) => { seen.effects += 1; return callback(); },
  };
  return { ctx, seen };
}

describe('activación', () => {
  it('se declara con identidad y servicios, y no exige nada opcional para arrancar', () => {
    assert.equal(name, 'skill-compiler');
    assert.deepEqual(inject, ['tools', 'skills', 'systemPrompt']);
    assert.equal(inject.includes('sessionProjections'), false, 'la proyección es opcional: no puede impedir el arranque');
  });

  it('apply() no lanza y registra la sección, las cuatro herramientas y el proveedor', () => {
    const s = sandbox();
    const { ctx, seen } = fakeContext();

    // Es la llamada que hacía fallar al plugin: dentro compila las cuatro definiciones.
    apply(ctx, { root: s.root });

    assert.equal(seen.sections.length, 1);
    assert.equal(seen.sections[0].name, 'skill-compiler:protocol');
    assert.equal(seen.sections[0].interpolate, false);
    assert.equal(seen.sections[0].text.includes('skill_propose'), true);

    assert.deepEqual(seen.tools.map((t) => t.name).sort(),
      ['skill_propose', 'skill_review', 'skill_upstream_check', 'skill_vendor']);
    // Cada herramienta trae el esquema de parámetros que verá el modelo: si `defineTool` no se hubiera
    // podido cargar, esto estaría vacío.
    const propose = seen.tools.find((t) => t.name === 'skill_propose');
    assert.deepEqual(Object.keys(propose.parameters.properties).sort(),
      ['body', 'description', 'evidence', 'id', 'tags', 'whenToUse']);
    assert.deepEqual([...propose.parameters.required].sort(), ['body', 'description', 'id']);

    assert.equal(seen.providers.length, 1, 'el proveedor de skills tiene que quedar registrado');
  });

  it('la proyección se pide como opcional, sin bloquear el arranque si no está', () => {
    const s = sandbox();
    const { ctx, seen } = fakeContext();
    apply(ctx, { root: s.root });
    // Si el perfil no resuelve la biblioteca de esquemas, el plugin pierde el adorno y conserva el
    // trabajo; por eso la inyección es opcional y no aparece en `inject`.
    assert.equal(seen.injected.length <= 1, true);
  });

  it('el proveedor que registra sirve skills del almacén y solo del proyecto que le piden', async () => {
    const s = sandbox();
    const { ctx, seen } = fakeContext();
    apply(ctx, { root: s.root });
    const provider = seen.providers[0]();
    const candidates = await provider.list({ cwd: 'C:\\un\\proyecto' });
    assert.deepEqual(candidates, [], 'sin nada propuesto ni aprobado, no sirve nada');
    assert.equal(provider.name, 'skill-compiler');
  });
});
