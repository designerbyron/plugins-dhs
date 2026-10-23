/**
 * F1.2 · pruebas POR IDIOMA del grupo 2 (approve / publish / scope).
 *
 * Mismo metodo que el grupo 1: lo que se mide es el contrato, no la frase.
 *
 *   · el idioma base es `en` y con `DSH_LANG=es` se lee español;
 *   · la MISMA operacion deja el MISMO `kind`, el MISMO `code` y el MISMO estado en disco en los dos idiomas;
 *   · una pregunta de ambito sigue siendo NEUTRA (`scope-ask`), no un éxito por parecerse a uno;
 *   · un id inseguro sigue siendo un error en los dos idiomas;
 *   · `--force` sigue siendo obligatorio con avisos, y publicar sigue publicando.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { pending, projectKey, propose } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);

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
const inv = (extra = {}) => ({ agent: fakeExec(CWD).agent, ...extra });

function sembrar(over = {}) {
  const s = sandbox();
  const r = propose(goodInput(over), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
  return s;
}

/** Cuerpo grande: la puerta lo acepta con aviso (se paga entero en cada invocacion). */
const CUERPO_LARGO = `${goodInput().body}\n\n## Extra\n\n${'material de consulta. '.repeat(700)}`;

describe('F1.2 · grupo 2 en los dos idiomas', () => {
  it('aprobar: mismo codigo y mismo estado en ingles y en español', () => {
    const a = sembrar();
    const b = sembrar();
    const en = con(null, () => comando(a.root, 'skill-approve').handler(inv({ rawInput: 'measured-decision-check --local' })));
    const es = con('es', () => comando(b.root, 'skill-approve').handler(inv({ rawInput: 'measured-decision-check --local' })));
    for (const r of [en, es]) {
      assert.equal(r.kind, 'success');
      assert.equal(r.code, 'activated');
      assert.equal(r.params.id, 'measured-decision-check');
    }
    assert.match(en.text, /^Active: measured-decision-check \[/m);
    assert.match(es.text, /^Activa: measured-decision-check \[/m);
    // El efecto, no el texto: en las dos arenas la propuesta salio de proposed y está activa.
    for (const s of [a, b]) {
      assert.equal(pending({ root: s.root, key: KEY }).length, 0);
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), true);
    }
  });

  it('los avisos exigen --force en los dos idiomas, y con --force se activa igual', () => {
    const sinForzar = [];
    for (const idioma of [null, 'es']) {
      const s = sembrar({ body: CUERPO_LARGO });
      sinForzar.push(con(idioma, () => comando(s.root, 'skill-approve').handler(inv({ rawInput: 'measured-decision-check --local' }))));
    }
    for (const r of sinForzar) {
      assert.equal(r.kind, 'error');
      assert.equal(r.code, 'with-warnings');
    }
    assert.match(sinForzar[0].text, /has warnings/);
    assert.match(sinForzar[1].text, /tiene avisos/);

    const forzado = [];
    for (const idioma of [null, 'es']) {
      const s = sembrar({ body: CUERPO_LARGO });
      forzado.push({ r: con(idioma, () => comando(s.root, 'skill-approve').handler(inv({ rawInput: 'measured-decision-check --local --force' }))), s });
    }
    for (const { r, s } of forzado) {
      assert.equal(r.kind, 'success', r.text);
      assert.equal(r.code, 'activated');
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), true, 'forzar no puede dejar de activar');
    }
  });

  it('publicar: mismo codigo y la misma publicacion real en los dos idiomas', () => {
    const resultados = [];
    for (const idioma of [null, 'es']) {
      const s = sembrar();
      resultados.push({
        r: con(idioma, () => comando(s.root, 'skill-publish').handler(inv({ rawInput: 'measured-decision-check' }))),
        s,
      });
    }
    for (const { r, s } of resultados) {
      assert.equal(r.kind, 'success', r.text);
      assert.equal(r.code, 'published');
      assert.equal(existsSync(join(s.curated, 'measured-decision-check')), true, 'publicar tiene que dejar la skill en la biblioteca');
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', 'measured-decision-check')), false);
    }
    assert.match(resultados[0].r.text, /^Active: measured-decision-check \[/m);
    assert.match(resultados[1].r.text, /^Activa: measured-decision-check \[/m);
  });

  it('preguntar el ambito es NEUTRO en los dos idiomas, no un exito', () => {
    for (const idioma of [null, 'es']) {
      const s = sembrar();
      const r = con(idioma, () => comando(s.root, 'skill-approve').handler(inv({ rawInput: 'measured-decision-check' })));
      assert.equal(r.kind, 'success', 'la pregunta no rompe la ejecucion');
      assert.equal(r.code, 'scope-ask', 'y viaja con el codigo neutro que el panel no cuenta como decision');
      assert.equal(r.params.id, 'measured-decision-check');
      // La prueba de que NO se movio nada: la propuesta sigue pendiente y no hay nada aprobado.
      assert.equal(pending({ root: s.root, key: KEY }).length, 1);
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false);
    }
  });

  it('un lote pregunta el ambito con el mismo codigo neutro, y no aprueba de paso', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    propose(goodInput({ id: 'segunda-propuesta', description: 'Segunda propuesta de prueba, distinta de la primera en tema.' }),
      { root: s.root, curated: s.curated, cwd: CWD });
    for (const idioma of [null, 'es']) {
      const r = con(idioma, () => comando(s.root, 'skill-approve').handler(inv({ rawInput: 'measured-decision-check,segunda-propuesta' })));
      assert.equal(r.code, 'scope-ask');
      assert.equal(pending({ root: s.root, key: KEY }).length, 2, 'preguntar no puede aprobar nada');
    }
  });

  it('el id que es una ruta sigue siendo un error en los dos idiomas', () => {
    const s = sembrar();
    for (const idioma of [null, 'es']) {
      const r = con(idioma, () => comando(s.root, 'skill-approve').handler(inv({ rawInput: '../../etc --local' })));
      assert.equal(r.kind, 'error');
      assert.equal(r.code, 'unsafe-id');
      assert.equal(pending({ root: s.root, key: KEY }).length, 1, 'un id inseguro no puede tocar el almacén');
    }
  });

  it('cambiar de ambito deja el mismo estado en los dos idiomas', () => {
    const arenas = [];
    for (const idioma of [null, 'es']) {
      const s = sembrar();
      con(idioma, () => comando(s.root, 'skill-approve').handler(inv({ rawInput: 'measured-decision-check --local' })));
      const r = con(idioma, () => comando(s.root, 'skill-scope').handler(inv({ rawInput: 'measured-decision-check --global' })));
      assert.equal(r.kind, 'success', r.text);
      arenas.push({ s, r });
    }
    assert.match(arenas[0].r.text, /lives in the user library/);
    assert.match(arenas[1].r.text, /vive en la biblioteca de usuario/);
    for (const { s } of arenas) {
      assert.equal(existsSync(join(s.curated, 'measured-decision-check')), true, 'tiene que quedar en la biblioteca');
      assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', 'measured-decision-check')), false, 'y salir del proyecto');
    }
  });
});
