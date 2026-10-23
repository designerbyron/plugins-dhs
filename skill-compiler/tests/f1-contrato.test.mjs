/**
 * F1 · contrato de F1: los alias son el mismo comando, y el panel decide por `code`.
 *
 * Dos cosas que, si se rompen, no se notan hasta que un humano aprueba algo y la tarjeta dice que no:
 *   1. un alias tiene que ejecutar **el mismo handler** y dejar **el mismo estado** que su canónico;
 *   2. el panel tiene que leer el código estable, ignorar la prosa cuando el código llega, y tratar un código
 *      desconocido como fallo visible —nunca como éxito ni como «sigue leyendo el texto»—.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { approve, pending, projectKey, propose } from '../lib/compiler.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CLI = join(process.cwd(), 'client.js');
const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);

function veredictoReal() {
  const t = readFileSync(CLI, 'utf8');
  const ini = t.indexOf('// <veredicto>');
  const fin = t.indexOf('// </veredicto>');
  assert.equal(ini > 0 && fin > ini, true, 'faltan los marcadores del veredicto en client.js');
  // El trozo es independiente: sólo usa Set/Map/RegExp, así que se puede evaluar tal cual.
  const cuerpo = t.slice(ini, fin);
  const fabrica = new Function(`${cuerpo.replace('// <veredicto>', '')}\nreturn veredicto;`);
  return fabrica();
}

function sembrar(s, id = 'contrato-de-f1') {
  const r = propose({
    id,
    description: 'Procedimiento de contrato para la fase uno: mide, anota la cifra y cierra con firma.',
    whenToUse: 'Cuando haya que comprobar el contrato de comandos y códigos sin tocar el almacén real.',
    body: [
      '## Antes', '', 'Se lee el estado y se anota la cifra delante de la decisión.', '',
      '## Pasos', '', '1. Contar y anotar.', '2. Contrastar con el sistema.', '3. Cerrar con firma.', '',
      '## Cuándo no aplica', '', 'Si no se puede leer, se para y se avisa.', '',
    ].join('\n'),
  }, { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
}

describe('F1 · alias = canónico', () => {
  it('cada alias apunta al MISMO handler y declara su canónico y su retirada', () => {
    const cmds = skillCommands({});
    const porNombre = new Map(cmds.map((c) => [c.name, c]));
    const alias = cmds.filter((c) => c.aliasOf !== undefined);
    assert.equal(alias.length, 15);
    for (const a of alias) {
      const canonico = porNombre.get(a.aliasOf);
      assert.notEqual(canonico, undefined, `${a.name}: su canónico no existe`);
      // Mismo contrato de invocación: mismas entradas declaradas y mismo handler por dentro. La identidad de
      // la función no se puede comparar porque `skillCommands` envuelve cada comando para montar las filas;
      // lo que importa —y se prueba abajo— es que el efecto sea el mismo.
      assert.deepEqual(a.input ?? {}, canonico.input ?? {}, `${a.name}: entradas distintas`);
      assert.equal(typeof a.handler, 'function');
      assert.equal(a.description.replace(/^Alias obsoleto de \/\S+: se retira en 5\.0\.0\. /, ''), canonico.description,
        `${a.name}: la descripción no es la del canónico`);
      assert.equal(a.deprecatedIn, '4.0.0');
      assert.match(a.description, /^Alias obsoleto de \/skill-/);
    }
  });

  it('aprobar con el nombre viejo y con el nuevo deja el mismo estado y el mismo código', () => {
    const a = sandbox();
    const b = sandbox();
    sembrar(a);
    sembrar(b);
    const inv = { agent: { session: { header: { cwd: CWD } } }, rawInput: 'contrato-de-f1 --local' };
    const conAlias = new Map(skillCommands({ root: a.root }).map((c) => [c.name, c])).get('skill-aprobar').handler(inv, { ok: true });
    const canonico = new Map(skillCommands({ root: b.root }).map((c) => [c.name, c])).get('skill-approve').handler(inv, { ok: true });
    assert.equal(conAlias.kind, 'success');
    assert.equal(canonico.kind, 'success');
    assert.equal(conAlias.code, canonico.code);
    assert.equal(conAlias.code, 'activated');
    assert.equal(conAlias.params.id, 'contrato-de-f1');
    // Los dos sacaron la propuesta de `proposed` (cada uno en SU caja, así que se comprueba por el estado propio).
    for (const s of [a, b]) assert.equal(pending({ root: s.root, key: KEY }).length, 0);
  });
});

describe('F1 · el panel decide por código', () => {
  const veredicto = veredictoReal();

  it('un código conocido manda, aunque el texto diga otra cosa', () => {
    const v = veredicto('texto que no dice nada', ['x'], 'activated', { id: 'x' });
    assert.deepEqual([...v.hechos], ['x']);
    assert.equal(v.fallos.size, 0);
    assert.equal(v.code, 'activated');
  });

  it('un aviso con código es fallo aunque el texto parezca correcto', () => {
    const v = veredicto('Activa: x [k]', ['x'], 'with-warnings', { id: 'x' });
    assert.equal(v.hechos.size, 0);
    assert.equal(v.fallos.get('x'), 'with-warnings');
  });

  it('un código desconocido es fallo visible, no éxito ni prosa', () => {
    const v = veredicto('Activa: x [k]', ['x'], 'codigo-que-no-existe', { id: 'x' });
    assert.equal(v.hechos.size, 0);
    assert.match(v.fallos.get('x'), /código desconocido/);
  });

  it('sin código, la prosa de compatibilidad sigue funcionando (hasta 4.2.0)', () => {
    const v = veredicto('Activa: x [k]\n', ['x']);
    assert.deepEqual([...v.hechos], ['x']);
    assert.equal(v.fallos.size, 0);
  });

  it('una pregunta o un listado no se cuentan como veredicto', () => {
    for (const code of ['scope-ask', 'language-ask', 'pending-list']) {
      const v = veredicto('lo que sea', ['x'], code, { id: 'x' });
      assert.equal(v.hechos.size, 0, code);
      assert.equal(v.fallos.size, 0, code);
    }
  });

  it('un hecho con código pero sin id pedido no se inventa: cae a la prosa', () => {
    const v = veredicto('Nada que ver aqui', ['x'], 'activated', { id: 'otro' });
    assert.equal(v.hechos.size, 0);
    assert.equal(v.fallos.size, 0);
  });
});
