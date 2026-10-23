/**
 * F2 · el contrato por ELEMENTO: el productor lo expone y el panel decide por el.
 *
 * Lo que se mide, y por que importa:
 *
 *   1. `aprobarLote` devuelve `items: [{id, kind, code, state, params, text}]` —el veredicto de cada elemento
 *      como DATO— sin quitar ni cambiar `kind`, `text` ni las lineas de siempre;
 *   2. el panel (`client.js`) usa `items` cuando esta: ni un elemento de un id no pedido se convierte en
 *      veredicto, ni un estado desconocido se convierte en exito;
 *   3. sin `items` la reserva de prosa sigue funcionando, y ahora **tambien en ingles** (las frases del
 *      veredicto estaban solo en espanol: una aprobacion correcta se contaba como fallo);
 *   4. un lote MIXTO se cuenta por id, y en ingles igual.
 *
 * Limite medido y declarado aparte (`docs/ANFITRION.md`): el anfitrion instalado recorta el resultado de un
 * comando a `{kind, text}` en `normalizeResult`, asi que hoy `items` (y `code`, y `params`) no llegan al panel
 * por `runCommand`. El camino de `items` queda escrito y probado en el consumidor, y entra en cuanto el
 * anfitrion transporte el objeto; la prosa es la reserva mientras tanto (retirada prevista en 4.2.0).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { aprobarLote, skillCommands } from '../lib/commands.mjs';
import { pending, projectKey, propose } from '../lib/compiler.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporativa-f2';
const KEY = projectKey(CWD);

function veredictoReal() {
  const t = readFileSync(join(process.cwd(), 'client.js'), 'utf8');
  const ini = t.indexOf('// <veredicto>');
  const fin = t.indexOf('// </veredicto>');
  assert.equal(ini > 0 && fin > ini, true, 'faltan los marcadores del veredicto en client.js');
  const cuerpo = t.slice(ini, fin);
  // El trozo es independiente (solo usa Set/Map/RegExp), asi que se evalua tal cual: se prueba el parser que
  // se entrega, no una copia.
  return new Function(`${cuerpo.replace('// <veredicto>', '')}\nreturn veredicto;`)();
}

function sembrar(s, over = {}) {
  const r = propose(goodInput(over), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
  return r.id;
}

describe('F2 · el productor expone el veredicto por elemento', () => {
  it('un lote MIXTO trae items con id, kind, code, state, params y text, y conserva el texto de siempre', () => {
    const s = sandbox();
    const id = sembrar(s);
    const r = aprobarLote({ root: s.root, key: KEY, ids: [id, 'no-existe-jamas'], scope: 'project' });
    assert.equal(r.kind, 'error', 'un lote con un fallo es error');
    assert.equal(Array.isArray(r.items), true, 'falta items');
    assert.equal(r.items.length, 2);
    const bueno = r.items.find((i) => i.id === id);
    const malo = r.items.find((i) => i.id === 'no-existe-jamas');
    assert.deepEqual(
      { kind: bueno.kind, code: bueno.code, state: bueno.state },
      { kind: 'success', code: 'activated', state: 'approved' },
    );
    assert.equal(bueno.params.id, id, 'los params del elemento llevan el id');
    assert.equal(typeof bueno.text, 'string');
    assert.match(bueno.text, new RegExp(`^Active: ${id}`), 'el texto del elemento es la frase humana');
    assert.deepEqual(
      { kind: malo.kind, code: malo.code, state: malo.state },
      { kind: 'error', code: 'no-proposal', state: 'failed' },
    );
    // Los campos de siempre siguen: `kind` global y las lineas que el humano ve.
    assert.equal(typeof r.text, 'string');
    assert.match(r.text, new RegExp(`^ok\\s+${id}`, 'm'));
    assert.match(r.text, /^FALLO\s+no-existe-jamas/m);
    // Y el efecto es el real: el bueno salio de `proposed`.
    assert.equal(pending({ root: s.root, key: KEY }).length, 0);
  });

  it('un lote que sale entero deja todos los elementos en approved, y uno que falla entero en failed', () => {
    const s = sandbox();
    const uno = sembrar(s);
    const dos = sembrar(s, { id: 'segunda-propuesta-f2', description: 'Segundo procedimiento para medir el lote completo con dos elementos.' });
    const bien = aprobarLote({ root: s.root, key: KEY, ids: [uno, dos], scope: 'project' });
    assert.equal(bien.kind, 'success');
    assert.deepEqual(bien.items.map((i) => i.state), ['approved', 'approved']);
    assert.deepEqual(bien.items.map((i) => i.ok === undefined), [true, true], 'el elemento no repite el booleano interno');
    const mal = aprobarLote({ root: s.root, key: KEY, ids: ['no-existe-a', 'no-existe-b'], scope: 'project' });
    assert.equal(mal.kind, 'error');
    assert.deepEqual(mal.items.map((i) => i.state), ['failed', 'failed']);
    assert.deepEqual(mal.items.map((i) => i.code), ['no-proposal', 'no-proposal']);
  });

  it('un lote sin ids no inventa elementos', () => {
    const s = sandbox();
    const r = aprobarLote({ root: s.root, key: KEY, ids: [], scope: 'project' });
    assert.equal(r.kind, 'error');
    assert.equal(r.items, undefined);
  });
});

describe('F2 · el panel usa items cuando esta', () => {
  const veredicto = veredictoReal();

  it('lote mixto: cuenta por id, sin leer la prosa', () => {
    // El texto se pone a proposito en contra: si el panel leyera la prosa, diria lo mismo que ella.
    const items = [
      { id: 'a', kind: 'success', code: 'activated', state: 'approved', params: { id: 'a' }, text: 'Active: a [k]' },
      { id: 'b', kind: 'error', code: 'gate-failed', state: 'failed', params: { id: 'b' }, text: 'no' },
    ];
    const v = veredicto('todo bien: ok a, ok b', ['a', 'b'], undefined, undefined, items);
    assert.deepEqual([...v.hechos], ['a']);
    assert.equal(v.fallos.get('b'), 'gate-failed');
  });

  it('un estado que no es hecho es fallo, aunque el codigo sea de exito', () => {
    const items = [{ id: 'a', kind: 'success', code: 'activated', state: 'unknown', params: { id: 'a' }, text: '' }];
    const v = veredicto('Active: a [k]', ['a'], undefined, undefined, items);
    assert.equal(v.hechos.size, 0, 'un estado desconocido no puede contarse como hecho');
    assert.equal(v.fallos.get('a'), 'activated');
  });

  it('un elemento de un id que no se pidio no se convierte en veredicto', () => {
    const items = [{ id: 'otro', kind: 'success', code: 'activated', state: 'approved', params: { id: 'otro' }, text: '' }];
    const v = veredicto('Nada que ver', ['a'], undefined, undefined, items);
    assert.equal(v.hechos.size, 0);
    assert.equal(v.fallos.size, 0);
  });

  it('todos los hechos del lote cuentan, no solo el primero', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id, kind: 'success', code: 'published', state: 'published', params: { id }, text: '' }));
    const v = veredicto('', ['a', 'b', 'c'], undefined, undefined, items);
    assert.deepEqual([...v.hechos].sort(), ['a', 'b', 'c']);
    assert.equal(v.fallos.size, 0);
  });
});

describe('F2 · sin items, la reserva de prosa sigue contando (y en ingles)', () => {
  const veredicto = veredictoReal();

  it('el lote del servidor se lee por sus marcadores en los dos idiomas', () => {
    for (const texto of [
      'Batch of 2: 1 approved - 1 failed\n\nok    a - Active: a [k]\nFALLO b - There is no proposal "b".',
      'Lote de 2: 1 aprobada(s) - 1 con fallo\n\nok    a - Activa: a [k]\nFALLO b - No hay ninguna propuesta "b".',
    ]) {
      const v = veredicto(texto, ['a', 'b']);
      assert.deepEqual([...v.hechos], ['a'], texto);
      assert.equal(v.fallos.has('b'), true, texto);
    }
  });

  it('una aprobacion suelta se cuenta igual en ingles que en espanol', () => {
    const en = veredicto('Active: x [k]\n', ['x']);
    const es = veredicto('Activa: x [k]\n', ['x']);
    assert.deepEqual([...en.hechos], ['x'], 'el texto ingles no se reconocia');
    assert.deepEqual([...es.hechos], ['x']);
    assert.deepEqual([...veredicto('Set aside: y [k]\n', ['y']).hechos], ['y']);
    assert.deepEqual([...veredicto('Already active: z [k]\n', ['z']).hechos], ['z']);
  });

  it('las lineas de la puerta (sangradas, sin id pedido) no cuentan como fallo', () => {
    const v = veredicto('  FALLO  body-max - too long', ['a']);
    assert.equal(v.fallos.size, 0);
  });
});
