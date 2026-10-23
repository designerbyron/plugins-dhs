#!/usr/bin/env node
/**
 * Deuda 2 · los nombres de las FILAS son comandos registrados, y siguen al idioma.
 *
 * Una fila del menu `/` no es texto: es un comando que se ejecuta al elegirla. Por eso su nombre no puede
 * quedarse en el idioma anterior ni ofrecer uno que el registro no tenga. Lo que se fija aqui:
 *
 *   1. **El nombre sale del mapa.** En `en` las filas son `skill-approve-<id>`; en `es`, `skill-aprobar-<id>`.
 *      El nombre del otro idioma no se produce.
 *   2. **Cada nombre esta en el registro activo.** Se registran las filas en el doble del contrato y se comprueba
 *      que el nombre existe, que el prefijo es el de una de las 16 operaciones y que el del otro idioma no esta.
 *   3. **Cada comando CITADO en un mensaje existe.** Se ejecutan comandos reales en los dos idiomas y cada
 *      `/skill-...` que aparece en su texto se busca en el conjunto activo: una instruccion falsa se lee como
 *      un defecto del plugin.
 *   4. **Mismo handler y mismos efectos.** Aprobar desde la fila deja el mismo estado en disco y devuelve el
 *      mismo `code` en los dos idiomas.
 *   5. **`skill-auto` una sola vez**, y las filas de lo apagado despachan (se ofrecian y contestaban «fila
 *      desconocida»).
 *   6. **Cinco vueltas EN/ES** no acumulan nombres ni definiciones: 16 filas y las mismas filas al volver.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands, targetCommands } from '../lib/commands.mjs';
import { disable, projectKey, propose } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import { createLanguageState, createLocalizedSet, setLanguage, swapSet } from '../lib/localized-commands.mjs';
import { LOCALIZED_OPERATIONS, rowPrefixOf } from '../lib/operations.mjs';
import { pendingRowsFor, retiredRowsFor } from '../lib/pending-rows.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

process.env.DSH_LANG = '';
resetLangCache();

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\deuda-filas';
const ID = 'measured-decision-check';
const KEY = projectKey(CWD);

/** El registro del anfitrion, en miniatura: nombre repetido lanza, y el disposer retira ESA definicion. */
function fakeRegistry() {
  const map = new Map();
  const cambios = [];
  return {
    map,
    cambios,
    register(definition) {
      if (map.has(definition.name)) throw new Error(`command "${definition.name}" is already registered`);
      const propia = { ...definition };
      map.set(definition.name, propia);
      cambios.push({ tipo: 'alta', name: definition.name });
      return () => {
        if (map.get(definition.name) === propia) {
          map.delete(definition.name);
          cambios.push({ tipo: 'baja', name: definition.name });
        }
      };
    },
    has: (nombre) => map.has(nombre),
    get: (nombre) => map.get(nombre),
    names: () => [...map.keys()],
  };
}

/** Un almacen propio por caso: nada lee el del operador. */
const ARENAS = [];
function nuevaArena() {
  const base = mkdtempSync(join(tmpdir(), 'deuda-filas-'));
  const root = join(base, 'skill-compiler');
  const curated = join(base, 'skills');
  mkdirSync(root, { recursive: true });
  mkdirSync(curated, { recursive: true });
  const a = { base, root, curated };
  ARENAS.push(a);
  return a;
}
after(() => {
  for (const a of ARENAS.splice(0)) rmSync(a.base, { recursive: true, force: true });
});

/** El plugin completo en un registro: las 16 localizadas puestas por el mismo camino que en `index.js`. */
function montar(a, lang) {
  const registry = fakeRegistry();
  const set = createLocalizedSet({ definitions: skillCommands({ root: a.root, catalog: { notify() {} } }) });
  const state = createLanguageState();
  const tomados = new Set();
  const puesto = swapSet({ registry, state, set, lang, taken: tomados });
  assert.equal(puesto.ok, true, `no se pudo montar el conjunto ${lang}: ${JSON.stringify(puesto.problemas ?? [])}`);
  return { registry, set, state, tomados };
}

const agente = () => ({ session: { header: { cwd: CWD } } });
const texto = (salida) => String(salida?.text ?? '');
const comandosBase = (root) => new Map(
  skillCommands({ root, catalog: { notify() {} }, onMount: () => ({ ok: true }) }).map((command) => [command.name, command]),
);
/** El nombre de la definición BASE de una operación: `skill-reject`, aunque el idioma activo la llame `skill-rechazar`. */
const nombreBase = (id) => LOCALIZED_OPERATIONS.find((op) => op.id === id).source;

describe('deuda 2 · el nombre de una fila es un comando del idioma activo', () => {
  it('en inglés las filas son skill-<verbo>-<id>; en español, el nombre español y nunca el inglés', () => {
    const a = nuevaArena();
    propose(goodInput({ id: ID }), { root: a.root, curated: a.curated, cwd: CWD });

    const en = pendingRowsFor({ root: a.root, cwd: CWD, lang: 'en' });
    const es = pendingRowsFor({ root: a.root, cwd: CWD, lang: 'es' });

    assert.deepEqual(en.map((f) => f.name), [
      `skill-show-${ID}`, `skill-approve-${ID}`, `skill-publish-${ID}`, `skill-reject-${ID}`,
    ]);
    assert.deepEqual(es.map((f) => f.name), [
      `skill-ver-${ID}`, `skill-aprobar-${ID}`, `skill-globalizar-${ID}`, `skill-rechazar-${ID}`,
    ]);
    // El codigo interno del verbo NO cambia de idioma: es con lo que se despacha.
    assert.deepEqual(en.map((f) => f.verb), es.map((f) => f.verb));
    for (const fila of es) assert.doesNotMatch(fila.name, /^skill-(show|approve|publish|reject)-/);
    for (const fila of en) assert.doesNotMatch(fila.name, /^skill-(ver|aprobar|globalizar|rechazar)-/);
  });

  it('cada fila se registra, su prefijo es una de las 16 operaciones, y el otro idioma no queda en el registro', () => {
    const a = nuevaArena();
    propose(goodInput({ id: ID }), { root: a.root, curated: a.curated, cwd: CWD });
    const { registry } = montar(a, 'en');
    const filasEn = targetCommands({ root: a.root, rows: pendingRowsFor({ root: a.root, cwd: CWD, lang: 'en' }) });
    for (const fila of filasEn) registry.register(fila);
    for (const fila of filasEn) assert.equal(registry.has(fila.name), true, `${fila.name} no quedo registrada`);

    for (const fila of pendingRowsFor({ root: a.root, cwd: CWD, lang: 'es' })) {
      assert.equal(registry.has(fila.name), false, `en inglés se registró el nombre español ${fila.name}`);
    }

    // Cada prefijo de fila es el nombre de una de las 16 operaciones: no hay una segunda tabla de nombres.
    const nombresDelConjunto = new Set(registry.names());
    for (const fila of filasEn) {
      const prefijo = fila.name.slice(0, -(ID.length + 1));
      const operacion = LOCALIZED_OPERATIONS.find((op) => op.names.en === prefijo);
      assert.notEqual(operacion, undefined, `${fila.name} no sale de ninguna operación del mapa`);
      assert.equal(nombresDelConjunto.has(operacion.names.en), true, `${operacion.names.en} no está en el registro`);
    }
  });

  it('los comandos que los mensajes CITAN existen en el registro activo, en los dos idiomas', () => {
    const a = nuevaArena();
    propose(goodInput({ id: ID }), { root: a.root, curated: a.curated, cwd: CWD });
    for (const lang of ['en', 'es']) {
      const { registry } = montar(a, lang);
      // El catalogo resuelve el idioma por la precedencia normal (`DSH_LANG` -> config -> base). Aqui se fija
      // el mismo idioma que se acaba de poner en el registro, que es lo que hace `setLanguage` en produccion
      // al persistirlo: sin esto, la prueba mediria la prosa del almacen real del operador.
      const guardado = process.env.DSH_LANG;
      process.env.DSH_LANG = lang;
      resetLangCache();
      const activos = new Set([...registry.names(), 'skill-compiler-language']);
      const base = comandosBase(a.root);
      const salidas = [];
      // Cinco caminos que citan comandos: la lista, la pregunta de ámbito y los tres huecos de argumento.
      salidas.push(base.get(nombreBase('proposals')).handler({ agent: agente() }));
      salidas.push(base.get(nombreBase('scope')).handler({ agent: agente(), rawInput: ID }));
      salidas.push(base.get(nombreBase('enable')).handler({ agent: agente(), rawInput: '' }));
      salidas.push(base.get(nombreBase('retire')).handler({ agent: agente(), rawInput: '' }));
      salidas.push(base.get(nombreBase('disable')).handler({ agent: agente(), rawInput: '' }));
      let citas = 0;
      for (const salida of salidas) {
        for (const [, citado] of texto(salida).matchAll(/(?<![A-Za-z0-9_.])\/(skill-[a-z][a-z0-9-]*)/g)) {
          citas += 1;
          assert.equal(activos.has(citado), true, `el mensaje cita /${citado}, que no está en el registro ${lang}:\n${texto(salida)}`);
        }
      }
      process.env.DSH_LANG = guardado ?? '';
      resetLangCache();
      assert.ok(citas > 0, `en ${lang} no se citó ningún comando: el caso no midió nada`);
      // Y una fila no se presenta como comando de barra: `/skill-show-<id>` no existe en el registro.
      for (const salida of salidas) {
        assert.doesNotMatch(texto(salida), /\/skill-[a-z][a-z0-9_-]*-[a-z0-9]/, `una fila se presenta como comando de barra:\n${texto(salida)}`);
      }
    }
  });

  it('la fila localizada invoca el mismo handler, con el mismo code y el mismo estado en disco', () => {
    const resultados = [];
    for (const lang of ['en', 'es']) {
      const a = nuevaArena();
      propose(goodInput({ id: ID }), { root: a.root, curated: a.curated, cwd: CWD });
      const fila = targetCommands({ root: a.root, catalog: { notify() {} }, rows: pendingRowsFor({ root: a.root, cwd: CWD, lang }) })
        .find((f) => f.name === `${rowPrefixOf('approve', lang)}${ID}`);
      assert.notEqual(fila, undefined, `no hay fila de aprobar en ${lang}`);
      const salida = fila.handler({ agent: agente() });
      resultados.push({
        lang,
        kind: salida.kind,
        code: salida.code,
        enDisco: readdirSync(join(a.root, 'projects', KEY)).sort(),
        aprobada: existsSync(join(a.root, 'projects', KEY, 'approved', ID, 'SKILL.md')),
      });
    }
    assert.deepEqual(resultados.map((r) => [r.kind, r.code, r.aprobada]), [
      ['success', 'activated', true],
      ['success', 'activated', true],
    ], JSON.stringify(resultados));
    assert.deepEqual(resultados[0].enDisco, resultados[1].enDisco, 'los dos idiomas no dejan el mismo almacén');
  });

  it('las filas de lo apagado despachan: encender mueve, retirar pide la orden exacta', () => {
    const a = nuevaArena();
    propose(goodInput({ id: ID }), { root: a.root, curated: a.curated, cwd: CWD });
    const base = comandosBase(a.root);
    assert.equal(base.get('skill-approve').handler({ agent: agente(), rawInput: `${ID} --local` }).kind, 'success');
    assert.equal(disable(ID, KEY, { root: a.root }).ok, true);

    for (const lang of ['en', 'es']) {
      const filas = retiredRowsFor({ root: a.root, cwd: CWD, lang });
      assert.deepEqual(filas.map((f) => f.name).sort(), [
        `${rowPrefixOf('enable', lang)}${ID}`, `${rowPrefixOf('retire', lang)}${ID}`,
      ].sort());
      for (const fila of filas) {
        assert.equal(fila.key, KEY, 'la fila viaja sin ámbito: se negaría en todas partes');
        assert.equal(fila.project, 'deuda-filas');
      }
    }

    const filasEn = retiredRowsFor({ root: a.root, cwd: CWD, lang: 'en' });
    const activas = targetCommands({ root: a.root, rows: filasEn });
    const retirar = activas.find((f) => f.name === `${rowPrefixOf('retire', 'en')}${ID}`);
    const dicho = retirar.handler({ agent: agente() });
    assert.equal(dicho.kind, 'success');
    assert.match(texto(dicho), /--yes/, 'retirar exige la orden explícita y la fila la dice');
    assert.equal(existsSync(join(a.root, 'projects', KEY, 'disabled', ID)), true, 'la fila de retirar no escribió: es lo correcto');

    const encender = activas.find((f) => f.name === `${rowPrefixOf('enable', 'en')}${ID}`);
    const vuelta = encender.handler({ agent: agente() });
    assert.equal(vuelta.kind, 'success', texto(vuelta));
    assert.equal(existsSync(join(a.root, 'projects', KEY, 'approved', ID, 'SKILL.md')), true, 'encender desde la fila no movió la skill');
  });

  it('skill-auto tiene una sola definición activa en el registro, y el mismo nombre en los dos idiomas', () => {
    const a = nuevaArena();
    const { registry, set } = montar(a, 'en');
    assert.equal(registry.names().filter((n) => n === 'skill-auto').length, 1);
    assert.equal(set.namesFor('es').includes('skill-auto'), true, 'auto no se traduce: es el mismo nombre');
    assert.equal(set.namesFor('en').filter((n) => n === 'skill-auto').length, 1);
  });

  it('cinco vueltas EN→ES→EN no acumulan nombres, y las filas vuelven a ser las mismas', () => {
    const a = nuevaArena();
    propose(goodInput({ id: ID }), { root: a.root, curated: a.curated, cwd: CWD });
    const { registry, set, state, tomados } = montar(a, 'en');
    const filasEn = pendingRowsFor({ root: a.root, cwd: CWD, lang: 'en' }).map((f) => f.name);
    const cuantas = () => registry.names().filter((n) => n.startsWith('skill-')).length;
    for (let i = 0; i < 5; i += 1) {
      const aEs = setLanguage({ registry, state, set, taken: tomados, value: '--es', root: a.root, env: '' });
      assert.equal(aEs.ok, true, `vuelta ${i} a es: ${aEs.code}`);
      assert.equal(cuantas(), 16, `vuelta ${i} en es: ${registry.names().join(', ')}`);
      const aEn = setLanguage({ registry, state, set, taken: tomados, value: '--en', root: a.root, env: '' });
      assert.equal(aEn.ok, true, `vuelta ${i} a en: ${aEn.code}`);
      assert.equal(cuantas(), 16, `vuelta ${i} en en`);
    }
    assert.deepEqual(pendingRowsFor({ root: a.root, cwd: CWD, lang: 'en' }).map((f) => f.name), filasEn);
    assert.equal(state.live.size, 16, 'el estado del conjunto guarda disposers de más o de menos');
    assert.equal(new Set(registry.names()).size, registry.names().length, 'hay nombres repetidos en el registro');
  });

  it('la arena de la suite no es la del operador: sin almacén no hay filas, y no se lee su config', () => {
    const s = sandbox();
    assert.deepEqual(pendingRowsFor({ root: s.root, cwd: CWD, lang: 'es' }), []);
    assert.equal(existsSync(join(s.root, 'config.json')), false, 'la arena escribe su propio idioma, no lee el real');
  });
});
