/**
 * F1.2 · pruebas POR IDIOMA del grupo 3 (reject / disable / enable / retire / retired).
 *
 * Mismo metodo: se mide el contrato y el EFECTO, no la frase. Cada caso corre en ingles (sin `DSH_LANG`) y
 * en español (`DSH_LANG=es`) y exige el mismo `kind`, el mismo `code` y el mismo estado en disco.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { approve, pending, projectKey, propose, retired } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const ID = 'measured-decision-check';

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
const inv = (rawInput) => ({ agent: fakeExec(CWD).agent, rawInput });

const conPropuesta = () => {
  const s = sandbox();
  assert.equal(propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD }).status, 'proposed');
  return s;
};
const conActiva = () => {
  const s = conPropuesta();
  assert.equal(approve(ID, KEY, { root: s.root }).ok, true);
  return s;
};
const ruta = (s, estado) => join(s.root, 'projects', KEY, estado, ID);

describe('F1.2 · grupo 3 en los dos idiomas', () => {
  it('rechazar: mismo codigo y la propuesta acaba en rejected/ en los dos idiomas', () => {
    for (const idioma of [null, 'es']) {
      const s = conPropuesta();
      const r = con(idioma, () => comando(s.root, 'skill-reject').handler(inv(ID)));
      assert.equal(r.kind, 'success', r.text);
      assert.equal(r.code, 'set-aside');
      assert.equal(r.params.id, ID);
      assert.equal(existsSync(ruta(s, 'proposed')), false, 'tiene que salir de proposed');
      assert.equal(existsSync(ruta(s, 'rejected')), true, 'y quedar en rejected, no borrada');
      assert.equal(pending({ root: s.root, key: KEY }).length, 0);
    }
  });

  it('rechazar dos veces: mismo codigo de "ya estaba", sin mover nada', () => {
    for (const idioma of [null, 'es']) {
      const s = conPropuesta();
      con(idioma, () => comando(s.root, 'skill-reject').handler(inv(ID)));
      const r = con(idioma, () => comando(s.root, 'skill-reject').handler(inv(ID)));
      assert.equal(r.kind, 'success');
      assert.equal(r.code, 'already-set-aside');
      assert.equal(existsSync(ruta(s, 'rejected')), true);
    }
  });

  it('rechazar algo activo se niega, y no mueve la skill viva', () => {
    for (const idioma of [null, 'es']) {
      const s = conActiva();
      const r = con(idioma, () => comando(s.root, 'skill-reject').handler(inv(ID)));
      assert.equal(r.kind, 'error');
      assert.equal(existsSync(ruta(s, 'approved')), true, 'rechazar no puede tocar lo aprobado');
    }
  });

  it('apagar y encender: mismo codigo y el mismo ciclo en los dos idiomas', () => {
    for (const idioma of [null, 'es']) {
      const s = conActiva();
      const off = con(idioma, () => comando(s.root, 'skill-disable').handler(inv(ID)));
      assert.equal(off.kind, 'success', off.text);
      assert.equal(off.code, 'disabled');
      assert.equal(existsSync(ruta(s, 'disabled')), true);
      assert.equal(existsSync(ruta(s, 'approved')), false);

      const on = con(idioma, () => comando(s.root, 'skill-enable').handler(inv(ID)));
      assert.equal(on.kind, 'success', on.text);
      assert.equal(on.code, 'enabled');
      assert.equal(existsSync(ruta(s, 'approved')), true, 'encender devuelve la skill al servicio');
    }
  });

  it('apagar algo que no existe: error en los dos idiomas, sin tocar el almacén', () => {
    for (const idioma of [null, 'es']) {
      const s = conPropuesta();
      const r = con(idioma, () => comando(s.root, 'skill-disable').handler(inv('no-existe-esta-skill')));
      assert.equal(r.kind, 'error');
      assert.equal(existsSync(ruta(s, 'proposed')), true);
    }
  });

  it('retirar sin --yes avisa y NO retira; con --yes retira y deja respaldo, en los dos idiomas', () => {
    for (const idioma of [null, 'es']) {
      const s = conActiva();
      const aviso = con(idioma, () => comando(s.root, 'skill-retire').handler(inv(ID)));
      assert.equal(aviso.kind, 'success');
      assert.match(aviso.text, /skill-retire measured-decision-check --yes/, 'tiene que decir cómo hacerlo');
      assert.equal(existsSync(ruta(s, 'approved')), true, 'sin --yes no se retira nada');

      const hecho = con(idioma, () => comando(s.root, 'skill-retire').handler(inv(`${ID} --yes`)));
      assert.equal(hecho.kind, 'success', hecho.text);
      assert.equal(hecho.code, 'retired');
      assert.equal(existsSync(ruta(s, 'approved')), false);
      const fuera = retired(KEY, { root: s.root });
      assert.equal(fuera.some((x) => x.id === ID && x.state === 'retired'), true, 'queda registrada como retirada');
    }
  });

  it('la lista de fuera de servicio dice lo mismo en los dos idiomas y con el mismo contenido', () => {
    const textos = [];
    for (const idioma of [null, 'es']) {
      const s = conActiva();
      con(idioma, () => comando(s.root, 'skill-disable').handler(inv(ID)));
      const r = con(idioma, () => comando(s.root, 'skill-retired').handler({ agent: fakeExec(CWD).agent }));
      assert.equal(r.kind, 'success', r.text);
      assert.equal(r.text.includes(ID), true, 'el id tiene que salir en las dos lenguas');
      textos.push(r.text);
    }
    assert.match(textos[0], /switched off \(reversible\)/);
    assert.match(textos[1], /apagada \(reversible\)/);

    const vacio = [];
    for (const idioma of [null, 'es']) {
      const s = sandbox();
      vacio.push(con(idioma, () => comando(s.root, 'skill-retired').handler({ agent: fakeExec(CWD).agent })).text);
    }
    assert.match(vacio[0], /Nothing switched off or retired/);
    assert.match(vacio[1], /Nada apagado ni retirado/);
  });
});
