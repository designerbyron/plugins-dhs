/**
 * F1.2 · pruebas POR IDIOMA de los comandos migrados al catalogo (grupo 1: proposals, pending, show).
 *
 * Lo que se fija aqui no es el texto: es el **contrato de idioma** de la arquitectura.
 *
 *   1. El idioma base es `en`: sin `DSH_LANG` y sin `config.json`, el humano lee ingles. Si algun dia una
 *      frase vuelve a estar escrita a mano en español, esta prueba se pone roja.
 *   2. Con `DSH_LANG=es` se lee español, y es español de verdad (las claves existen y no se cae al base).
 *   3. Cambiar de idioma **no cambia la decision**: mismo `kind`, mismo `code` y el mismo estado en disco.
 *      El panel decide por `code`, asi que la prosa puede cambiar sin romper la tarjeta.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { pending, projectKey, propose } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);

/** Ejecuta un comando con el idioma pedido, sin dejar el proceso en ese idioma. */
function con(idioma, ejecutar) {
  const previo = process.env.DSH_LANG;
  try {
    if (idioma === null) delete process.env.DSH_LANG;
    else process.env.DSH_LANG = idioma;
    resetLangCache();
    return ejecutar();
  } finally {
    if (previo === undefined) delete process.env.DSH_LANG;
    else process.env.DSH_LANG = previo;
    resetLangCache();
  }
}

const comando = (root, nombre) => new Map(skillCommands({ root }).map((c) => [c.name, c])).get(nombre);

function sembrar() {
  const s = sandbox();
  const r = propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
  return s;
}

describe('F1.2 · el idioma de la superficie humana', () => {
  it('sin idioma configurado, el humano lee INGLES (el base)', () => {
    const s = sembrar();
    const r = con(null, () => comando(s.root, 'skill-proposals').handler({ agent: fakeExec(CWD).agent }));
    assert.equal(r.kind, 'success');
    assert.match(r.text, /Waiting for your approval \(1\):/);
    assert.match(r.text, /Approved and active \(0\):/);
    assert.match(r.text, /One order for all: \/skill-approve measured-decision-check --local/);
    // Y no queda prosa española escondida en la salida.
    assert.equal(/Pendientes de tu aprobacion|Aprobadas y activas|Sin ambito/.test(r.text), false, r.text);
  });

  it('con DSH_LANG=es se lee español, la misma lista', () => {
    const s = sembrar();
    const r = con('es', () => comando(s.root, 'skill-proposals').handler({ agent: fakeExec(CWD).agent }));
    assert.equal(r.kind, 'success');
    assert.match(r.text, /Pendientes de tu aprobacion \(1\):/);
    assert.match(r.text, /Aprobadas y activas \(0\):/);
    assert.match(r.text, /Una orden para todas: \/skill-approve measured-decision-check --local/);
  });

  it('el id que no existe: mismo aviso, mismo codigo, en los dos idiomas', () => {
    const s = sembrar();
    const en = con(null, () => comando(s.root, 'skill-show').handler({ agent: fakeExec(CWD).agent, rawInput: 'measured-decision-chek' }));
    const es = con('es', () => comando(s.root, 'skill-show').handler({ agent: fakeExec(CWD).agent, rawInput: 'measured-decision-chek' }));
    for (const r of [en, es]) {
      assert.equal(r.kind, 'error');
      assert.equal(r.code, 'no-proposal');
      assert.equal(r.params.id, 'measured-decision-chek');
      // La salida se ofrece igual: el id correcto, sugerido.
      assert.match(r.text, /measured-decision-check/);
    }
    assert.match(en.text, /There is no learned skill/);
    assert.match(es.text, /No hay ninguna skill aprendida/);
  });

  it('la lista para la tarjeta conserva su codigo en los dos idiomas', () => {
    const s = sembrar();
    const en = con(null, () => comando(s.root, 'skill-pending').handler({ agent: fakeExec(CWD).agent }));
    const es = con('es', () => comando(s.root, 'skill-pending').handler({ agent: fakeExec(CWD).agent }));
    for (const r of [en, es]) {
      assert.equal(r.code, 'pending-list');
      assert.deepEqual(r.params.ids, ['measured-decision-check']);
    }
    assert.match(en.text, /^pendientes: 1/m);
    assert.match(es.text, /^pendientes: 1/m, 'las lineas de datos no se traducen: son contrato con el panel');
  });

  it('decidir en un idioma y leer en otro deja el mismo estado', () => {
    const s = sembrar();
    con('es', () => comando(s.root, 'skill-approve').handler({ agent: fakeExec(CWD).agent, rawInput: 'measured-decision-check --local' }));
    assert.equal(pending({ root: s.root, key: KEY }).length, 0);
    const r = con(null, () => comando(s.root, 'skill-proposals').handler({ agent: fakeExec(CWD).agent }));
    assert.match(r.text, /Waiting for your approval \(0\):/);
    assert.match(r.text, /Approved and active \(1\):/);
  });
});
