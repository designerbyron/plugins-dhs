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
import { createCatalogSignal } from '../lib/catalog-signal.mjs';
import { propose } from '../lib/compiler.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

/** Un contexto con la forma mínima que el plugin usa. Si el plugin toca algo que no está, se ve aquí. */
function fakeContext(services = {}) {
  const seen = { sections: [], tools: [], providers: [], injected: [], effects: 0 };
  const disposers = [];
  const ctx = {
    systemPrompt: { section: (section) => seen.sections.push(section) },
    tools: { register: (tool) => seen.tools.push(tool) },
    skills: { registerProvider: (factory) => seen.providers.push(factory) },
    inject: (deps, callback) => { seen.injected.push(deps); callback(services); },
    // El efecto devuelve el disposer real: el harness los llama al descargar el plugin, y la prueba tiene
    // que hacer lo mismo — dejar la vigilancia de catálogo abierta sería dejar un recurso vivo.
    effect: (callback) => { seen.effects += 1; const dispose = callback(); disposers.push(dispose); return dispose; },
  };
  const disposeAll = () => {
    for (const dispose of disposers.splice(0)) if (typeof dispose === 'function') dispose();
  };
  return { ctx, seen, disposeAll };
}

describe('activación', () => {
  it('se declara con identidad y servicios, y no exige nada opcional para arrancar', () => {
    assert.equal(name, 'skill-compiler');
    assert.deepEqual(inject, ['tools', 'skills', 'systemPrompt']);
    assert.equal(inject.includes('sessionProjections'), false, 'la proyección es opcional: no puede impedir el arranque');
  });

  it('apply() no lanza y registra la sección, las cuatro herramientas y el proveedor', () => {
    const s = sandbox();
    const { ctx, seen, disposeAll } = fakeContext();

    // Es la llamada que hacía fallar al plugin: dentro compila las cuatro definiciones.
    // Señal propia sin vigilancia: esta prueba mide la activación, no el sistema de ficheros.
    apply(ctx, { root: s.root, catalog: createCatalogSignal({ root: s.root, watch: false }) });

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
    disposeAll();
  });

  it('la proyección y los comandos se piden como opcionales, sin bloquear el arranque si no están', () => {
    const s = sandbox();
    const { ctx, seen, disposeAll } = fakeContext();
    apply(ctx, { root: s.root });
    disposeAll();
    // Si el perfil no resuelve la biblioteca de esquemas —o no monta el registro de comandos—, el plugin
    // pierde ese adorno o esa superficie y conserva el trabajo: por eso ninguna de las dos aparece en
    // `inject`, que es la lista de dependencias que el harness exige para activar el plugin.
    assert.deepEqual(seen.injected.map((deps) => deps.join()) .sort(), ['commands', 'sessionProjections']);
    assert.equal(inject.includes('commands'), false);
    assert.equal(inject.includes('sessionProjections'), false);
  });

  it('el proveedor que registra sirve skills del almacén y solo del proyecto que le piden', async () => {
    const s = sandbox();
    const { ctx, seen, disposeAll } = fakeContext();
    apply(ctx, { root: s.root });
    const provider = seen.providers[0]();
    const candidates = await provider.list({ cwd: 'C:\\un\\proyecto' });
    assert.deepEqual(candidates, [], 'sin nada propuesto ni aprobado, no sirve nada');
    assert.equal(provider.name, 'skill-compiler');
    disposeAll();
  });

  it('registra los cinco comandos humanos, con la forma que el harness exige', () => {
    const s = sandbox();
    const registered = [];
    const { ctx, disposeAll } = fakeContext({ commands: { register: (command) => { registered.push(command); return () => {}; } } });
    apply(ctx, { root: s.root });
    disposeAll();

    assert.deepEqual(registered.map((c) => c.name).sort(),
      ['skill-aprobar', 'skill-auto', 'skill-propuestas', 'skill-rechazar', 'skill-ver']);
    for (const command of registered) {
      assert.match(command.name, /^[a-z][a-z0-9_-]*$/);
      assert.equal(command.description.trim().length > 0, true);
      assert.equal(typeof command.handler, 'function');
    }
  });

  it('conserva la invalidación del registro y la usa al aprobar: la frescura sin reiniciar', () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    const registered = [];
    let invalidations = 0;

    const { ctx, seen, disposeAll } = fakeContext({ commands: { register: (command) => { registered.push(command); return () => {}; } } });
    apply(ctx, { root: s.root, catalog: signal });

    // El registro entrega su capacidad de invalidación al registrar el provider. El plugin tiene que
    // CONSERVARLA: sin ella, el catálogo cacheado no cambia nunca y una skill aprobada no llega al agente.
    const provider = seen.providers[0]({ invalidate: () => { invalidations += 1; } });
    assert.equal(provider.name, 'skill-compiler');
    signal.notify();
    assert.equal(invalidations, 1, 'la señal tiene que estar atada a la invalidación del registro');

    // Y aprobar desde el harness avisa a esa misma capacidad: es lo que hace usable la skill al instante.
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const aprobar = registered.find((c) => c.name === 'skill-aprobar');
    const result = aprobar.handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: 'measured-decision-check' });
    assert.equal(result.kind, 'success', JSON.stringify(result));
    assert.equal(invalidations, 2, 'aprobar tiene que avisar al catálogo');
    disposeAll();
  });
  it('las filas de pendientes aparecen cuando la sesión pide su catálogo, y se retiran al decidir', async () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    // Un registro de verdad en miniatura: acepta definiciones y honra el disposer que devuelve, que es
    // exactamente el contrato del registro de comandos del harness.
    const registry = new Map();
    const commands = {
      register: (command) => {
        registry.set(command.name, command);
        return () => registry.delete(command.name);
      },
    };
    const { ctx, seen, disposeAll } = fakeContext({ commands });
    apply(ctx, { root: s.root, catalog: signal });

    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(registry.size, 5, 'sin ámbito conocido sólo están los comandos base, no filas de otro proyecto');

    // El harness pide el catálogo de la sesión: es el único momento en que el plugin conoce el ámbito.
    const provider = seen.providers[0]();
    await provider.list({ cwd: CWD });
    const rows = ['skill-ver-measured-decision-check', 'skill-aprobar-measured-decision-check', 'skill-rechazar-measured-decision-check'];
    for (const name of rows) assert.equal(registry.has(name), true, `falta la fila ${name}`);
    assert.equal(registry.get(rows[1]).input, undefined, 'la fila se ejecuta al elegirla: no reclama argumentos');

    // Elegirla en el menú es la decisión completa: se llama al handler sin argumentos.
    const result = registry.get(rows[1]).handler({ agent: { session: { header: { cwd: CWD } } } });
    assert.equal(result.kind, 'success', JSON.stringify(result));

    // Y al aprobar, las filas se recomponen: una pendiente que ya no lo está no puede seguir ofreciéndose.
    for (const name of rows) assert.equal(registry.has(name), false, `sigue anunciada ${name}`);
    assert.equal(registry.size, 5, 'los cinco comandos base no se tocan al recomponer');

    disposeAll();
    assert.equal(registry.size, 0, 'descargar el plugin no deja comandos colgando');
  });

  it('recomputar no re-registra lo mismo: sin cambio real, el menú no parpadea', async () => {
    const s = sandbox();
    const signal = createCatalogSignal({ root: s.root, watch: false });
    let registrations = 0;
    const registry = new Map();
    const commands = {
      register: (command) => {
        registrations += 1;
        registry.set(command.name, command);
        return () => registry.delete(command.name);
      },
    };
    const { ctx, seen, disposeAll } = fakeContext({ commands });
    apply(ctx, { root: s.root, catalog: signal });
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });

    const provider = seen.providers[0]();
    await provider.list({ cwd: CWD });
    const afterArming = registrations;
    // Un cambio del almacén sin efecto sobre las pendientes (aquí: la misma lista) no vuelve a registrar.
    signal.notify();
    assert.equal(registrations, afterArming, 'no se re-registra una fila idéntica');
    assert.equal(registry.has('skill-aprobar-measured-decision-check'), true);
    disposeAll();
  });
});
