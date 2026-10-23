/**
 * F1 · contrato de F1: una operacion, un nombre por idioma, y el panel decide por `code`.
 *
 * Dos cosas que, si se rompen, no se notan hasta que un humano aprueba algo y la tarjeta dice que no:
 *   1. cada operacion tiene **un nombre por idioma**, el handler es **el mismo objeto** para los dos, y el
 *      nombre del otro idioma **no es invocable** —no es un alias: es la misma operacion en otra lengua—;
 *   2. el panel tiene que leer el código estable, ignorar la prosa cuando el código llega, y tratar un código
 *      desconocido como fallo visible —nunca como éxito ni como «sigue leyendo el texto»—.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { approve, pending, projectKey, propose } from '../lib/compiler.mjs';
import { LOCALIZED_OPERATIONS, createLocalizedSet } from '../lib/localized-commands.mjs';
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

// Una raiz que no existe: estas dos pruebas miran el mapa, y un handler que no se invoca no toca el almacen.
const RAIZ_FALSA = join(process.cwd(), 'tests', 'arena-que-no-existe');
const conjunto = (root) => createLocalizedSet({ definitions: skillCommands({ root, catalog: { notify() {} } }) });
const definicionDe = (root, lang, id) => {
  const op = conjunto(root).operations.find((o) => o.id === id);
  assert.notEqual(op, undefined, `${id}: la operacion no esta en el mapa`);
  const def = conjunto(root).definitionsFor(lang).find((d) => d.name === op.byLang[lang].name);
  assert.notEqual(def, undefined, `${id}/${lang}: el conjunto no trae su nombre`);
  return def;
};

describe('F1 · una operacion, un nombre por idioma', () => {
  it('cada operacion tiene UN nombre por idioma y el MISMO handler en los dos', () => {
    const set = conjunto(RAIZ_FALSA);
    assert.equal(set.operations.length, 16);
    assert.equal(set.operations.length, LOCALIZED_OPERATIONS.length);
    for (const op of set.operations) {
      const en = set.definitionsFor('en').find((d) => d.name === op.byLang.en.name);
      const es = set.definitionsFor('es').find((d) => d.name === op.byLang.es.name);
      assert.notEqual(en, undefined, `${op.id}: sin definicion inglesa`);
      assert.notEqual(es, undefined, `${op.id}: sin definicion espanola`);
      // La prueba del diseno: mismo handler, misma puerta, mismos efectos. Dos functions distintas dejarian
      // abierta la puerta a que una de las dos se quede atras.
      assert.equal(en.handler, es.handler, `${op.id}: el handler cambia con el idioma`);
      assert.equal(en.definitionId, es.definitionId, `${op.id}: el id de definicion cambia con el idioma`);
      // La FORMA de la entrada es la misma (la pista del menu existe o no); su texto puede ser idioma: la
      // pista de `skill-auto` es `on | off` en ingles y `activar | desactivar` en espanol, y las dos son
      // ciertas porque el handler entiende las cuatro palabras.
      assert.deepEqual(Object.keys(en.input ?? {}), Object.keys(es.input ?? {}), `${op.id}: la forma de la entrada difiere`);
      if (en.input?.hint !== undefined) assert.equal(typeof en.input.hint, 'string', `${op.id}: pista sin texto`);
      assert.equal(typeof en.handler, 'function', `${op.id}: sin handler`);
    }
  });

  it('el nombre del otro idioma NO es invocable: no hay dos filas para la misma operacion', () => {
    const set = conjunto(RAIZ_FALSA);
    const en = set.definitionsFor('en').map((d) => d.name);
    const es = set.definitionsFor('es').map((d) => d.name);
    for (const op of LOCALIZED_OPERATIONS) {
      if (op.names.en === op.names.es) continue; // `skill-auto` es el unico que no se traduce
      assert.equal(en.includes(op.names.es), false, `${op.id}: /${op.names.es} se registra en ingles`);
      assert.equal(es.includes(op.names.en), false, `${op.id}: /${op.names.en} se registra en espanol`);
    }
    // Y el conjunto no admite repetidos: una fila, un duenio.
    assert.equal(new Set(en).size, en.length);
    assert.equal(new Set(es).size, es.length);
  });

  it('aprobar por el nombre de cada idioma deja el mismo estado y el mismo código', () => {
    const a = sandbox();
    const b = sandbox();
    sembrar(a);
    sembrar(b);
    const inv = { agent: { session: { header: { cwd: CWD } } }, rawInput: 'contrato-de-f1 --local' };
    const porIngles = definicionDe(a.root, 'en', 'approve').handler(inv, { ok: true });
    const porEspanol = definicionDe(b.root, 'es', 'approve').handler(inv, { ok: true });
    assert.equal(porIngles.kind, 'success', JSON.stringify(porIngles));
    assert.equal(porEspanol.kind, 'success', JSON.stringify(porEspanol));
    assert.equal(porIngles.code, porEspanol.code);
    assert.equal(porIngles.code, 'activated');
    assert.equal(porIngles.params.id, 'contrato-de-f1');
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
