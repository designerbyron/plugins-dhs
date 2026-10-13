#!/usr/bin/env node
/**
 * La puerta de la frescura: una skill aprobada tiene que llegar al catálogo **sin reiniciar**.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────────────────────────
 *
 * El registro de skills del harness cachea los catálogos y **no tiene TTL**: sólo se limpia cuando un
 * provider llama a la invalidación que el registro le entregó al registrarse. El plugin no la retenía,
 * así que aprobar una skill no servía de nada hasta el siguiente arranque: el flujo entero —proponer,
 * revisar, aprobar, usar— se rompía en su último paso.
 *
 * ── Cómo se prueba, y por qué así ────────────────────────────────────────────────────────────────
 *
 * Contra el **registro real** (`@deepseek-ai/dsh-skill`, dependencia de desarrollo: es el juez, no un
 * doble) y el provider **real** del plugin, montados como en producción. El primer caso **demuestra el
 * rojo**: sin aviso, el catálogo sigue sirviendo la lista vieja. Sin ese paso, esta puerta no probaría
 * nada — una prueba que nunca vio el defecto no distingue el arreglo de la casualidad.
 *
 * Después, las dos vías que tiene que cubrir el aviso:
 *   · la explícita: el comando `/skill-aprobar`, que muta dentro de este proceso;
 *   · la observada: la CLI (o una edición a mano) que muta fuera, detectada por la vigilancia del almacén.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';

import { createCatalogSignal } from '../lib/catalog-signal.mjs';
import { skillCommands } from '../lib/commands.mjs';
import { approve, projectKey, propose } from '../lib/compiler.mjs';
import { skillProvider } from '../lib/definitions.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const AGENT = { session: { header: { cwd: CWD } } };

/** El registro real, con el provider real del plugin: el montaje de producción, sin el harness. */
async function mount(root, { watch = true } = {}) {
  const ctx = new Context();
  ctx.plugin(SkillRegistry);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(typeof ctx.skills?.registerProvider, 'function', 'el registro real no se montó');

  const catalog = createCatalogSignal({ root, watch, debounceMs: 10 });
  ctx.skills.registerProvider((control) => {
    catalog.bind(control?.invalidate);
    return skillProvider({ root });
  });
  catalog.start();
  return { skills: ctx.skills, catalog };
}

const names = (rows) => rows.map((row) => row.name);

/** Espera a que se cumpla una condición, sin dormir a ciegas más de lo necesario. */
async function waitFor(predicate, { timeout = 2000, step = 20 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, step));
  }
  return predicate();
}

/** Aprueba «desde fuera del proceso», como haría la CLI: sólo escribe en el almacén. */
function approveFromOutside(root, curated) {
  propose(goodInput(), { root, curated, cwd: CWD });
  return approve('measured-decision-check', projectKey(CWD), { root });
}

describe('frescura del catálogo de skills', () => {
  it('sin aviso, el catálogo sigue cacheado — el defecto, medido', async () => {
    const s = sandbox();
    const { skills, catalog } = await mount(s.root, { watch: false });
    try {
      assert.deepEqual(names(await skills.list({ cwd: CWD })), [], 'arranca sin skills del proyecto');

      const moved = approveFromOutside(s.root, s.curated);
      assert.equal(moved.ok, true);

      // El registro no tiene TTL: sin aviso, la lectura sigue siendo la de antes.
      assert.deepEqual(names(await skills.list({ cwd: CWD })), [],
        'la caché sirve el catálogo viejo: exactamente lo que impedía usar una skill recién aprobada');
    } finally {
      catalog.stop();
    }
  });

  it('el aviso explícito del comando basta: aprobar y poder usarla en la misma sesión', async () => {
    const s = sandbox();
    const { skills, catalog } = await mount(s.root, { watch: false });
    try {
      propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
      await skills.list({ cwd: CWD }); // deja el catálogo cacheado ANTES de aprobar

      const aprobar = skillCommands({ root: s.root, catalog }).find((c) => c.name === 'skill-aprobar');
      const result = aprobar.handler({ agent: AGENT, rawInput: 'measured-decision-check' });

      assert.equal(result.kind, 'success', JSON.stringify(result));
      assert.deepEqual(names(await skills.list({ cwd: CWD })), ['measured-decision-check'],
        'la skill recién aprobada tiene que estar ya en el catálogo, sin reiniciar');
      assert.equal(catalog.count() > 0, true, 'el comando tiene que haber avisado al catálogo');
    } finally {
      catalog.stop();
    }
  });

  it('la vigilancia del almacén cubre lo que muta fuera del proceso (la CLI, una edición a mano)', async () => {
    const s = sandbox();
    const { skills, catalog } = await mount(s.root, { watch: true });
    try {
      assert.deepEqual(names(await skills.list({ cwd: CWD })), []);

      // Nadie avisa aquí: se aprueba "por fuera", como hace el CLI en otra terminal.
      assert.equal(approveFromOutside(s.root, s.curated).ok, true);
      const saw = await waitFor(() => catalog.count() > 0);

      assert.equal(saw, true, 'la vigilancia del almacén no detectó el cambio: sin ella, aprobar por CLI exigiría reiniciar');
      assert.deepEqual(names(await skills.list({ cwd: CWD })), ['measured-decision-check']);
    } finally {
      catalog.stop();
    }
  });

  it('la señal se detiene sin dejar vigilancia viva', async () => {
    const s = sandbox();
    const { catalog } = await mount(s.root, { watch: true });
    assert.equal(catalog.start(), false, 'arrancar dos veces no abre una segunda vigilancia');
    catalog.stop();
    assert.equal(catalog.start(), false, 'una señal detenida no vuelve a arrancar');
  });
});
