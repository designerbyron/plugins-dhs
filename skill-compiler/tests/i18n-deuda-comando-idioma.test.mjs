#!/usr/bin/env node
/**
 * Deuda 3 · la descripcion de `/skill-compiler-language` sigue al idioma, sin dejar sin comando.
 *
 * El anfitrion **no tiene** actualizacion de una definicion registrada (medido en `dsh-commands`: indexa por
 * nombre, `insert` lanza si el nombre ya esta, y `register()` solo devuelve el disposer de ESA alta). Asi que la
 * descripcion se reescribe por la segunda via: retirar y volver a registrar **en el mismo instante**, con el
 * MISMO handler, y con vuelta atras. Lo que se fija aqui:
 *
 *   1. La descripcion se compone en el idioma activo, y cambiar de idioma la reescribe.
 *   2. El nombre no cambia, el handler es **la misma funcion**, y no se acumulan registros.
 *   3. Un argumento invalido no cambia nada; un fallo de persistencia devuelve el registro a donde estaba.
 *   4. Si el alta de la descripcion nueva falla, se repone la anterior: el comando de idioma **nunca** se pierde,
 *      y el resultado lo dice en vez de fingir que se actualizo.
 *   5. `DSH_LANG` sigue mandando: si impide el cambio, se dice y no se escribe nada.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import defaultEn from '../lib/i18n/en.mjs';
import defaultEs from '../lib/i18n/es.mjs';
import {
  LANGUAGE_COMMAND, createLanguageCommand, createLanguageState, createLocalizedSet, swapSet,
} from '../lib/localized-commands.mjs';
import { cleanupSandboxes } from './helpers.mjs';

process.env.DSH_LANG = '';
resetLangCache();
after(cleanupSandboxes);

/** El registro del anfitrion, en miniatura: nombre repetido lanza, y el disposer retira ESA definicion. */
function fakeRegistry({ fallarEn } = {}) {
  const map = new Map();
  const altas = [];
  return {
    map,
    altas,
    register(definition) {
      altas.push(definition.name);
      if (typeof fallarEn === 'function' && fallarEn(definition, altas.length) === true) {
        throw new Error(`el registro rechazo "${definition.name}"`);
      }
      if (map.has(definition.name)) throw new Error(`command "${definition.name}" is already registered`);
      const propia = { ...definition };
      map.set(definition.name, propia);
      return () => {
        if (map.get(definition.name) === propia) map.delete(definition.name);
      };
    },
    names: () => [...map.keys()],
    get: (nombre) => map.get(nombre),
  };
}

const ARENAS = [];
function arena({ configRoto = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'deuda-idioma-'));
  const root = join(base, 'skill-compiler');
  mkdirSync(root, { recursive: true });
  if (configRoto) {
    // `config.json` como CARPETA: escribir el temporal y renombrar encima falla, que es lo que se quiere medir.
    mkdirSync(join(root, 'config.json'), { recursive: true });
  }
  const a = { base, root };
  ARENAS.push(a);
  return a;
}
after(() => {
  for (const a of ARENAS.splice(0)) rmSync(a.base, { recursive: true, force: true });
});

function montar(a, { lang = 'en', fallarEn } = {}) {
  const registry = fakeRegistry({ fallarEn });
  const set = createLocalizedSet({ definitions: skillCommands({ root: a.root, catalog: { notify() {} } }) });
  const state = createLanguageState();
  const tomados = new Set();
  assert.equal(swapSet({ registry, state, set, lang, taken: tomados }).ok, true, 'el conjunto no se pudo montar');
  const avisos = [];
  const comando = createLanguageCommand({
    registry,
    state,
    set,
    taken: tomados,
    root: a.root,
    env: '',
    onChanged: () => {
      avisos.push(state.lang);
      return null;
    },
  });
  assert.equal(comando.install().ok, true, 'el comando de idioma no se pudo instalar');
  return { registry, set, state, tomados, comando, avisos };
}

const ejecutar = (registry, rawInput) => registry.get(LANGUAGE_COMMAND).handler({ rawInput });

describe('deuda 3 · la descripción del comando de idioma', () => {
  it('se compone en el idioma activo, y cambiar de idioma la reescribe con el MISMO handler', () => {
    const a = arena();
    const { registry, comando } = montar(a, { lang: 'en' });
    const en = registry.get(LANGUAGE_COMMAND);
    assert.equal(en.description, defaultEn['cmd.language.description']);
    const handler = en.handler;
    assert.equal(typeof handler, 'function');

    const dicho = ejecutar(registry, '--es');
    assert.equal(dicho.kind, 'success', dicho.text);
    assert.equal(dicho.code, 'language-set');

    const es = registry.get(LANGUAGE_COMMAND);
    assert.equal(es.name, LANGUAGE_COMMAND, 'el nombre no cambia: es el comando estable');
    assert.equal(es.description, defaultEs['cmd.language.description'], 'la descripción no siguió al idioma');
    assert.equal(es.handler, handler, 'el handler cambió: no sería el mismo comando');
    assert.equal(comando.definition().description, es.description);
    assert.equal(registry.names().filter((n) => n === LANGUAGE_COMMAND).length, 1);
  });

  it('cinco cambios no acumulan registros: una sola definición y un solo handler', () => {
    const a = arena();
    const { registry, avisos } = montar(a);
    const handler = registry.get(LANGUAGE_COMMAND).handler;
    for (const valor of ['--es', '--en', '--es', '--en', '--es']) {
      const r = ejecutar(registry, valor);
      assert.equal(r.kind, 'success', r.text);
    }
    assert.equal(registry.names().filter((n) => n === LANGUAGE_COMMAND).length, 1, 'el comando quedó registrado dos veces');
    assert.equal(registry.get(LANGUAGE_COMMAND).handler, handler);
    assert.equal(registry.get(LANGUAGE_COMMAND).description, defaultEs['cmd.language.description']);
    assert.deepEqual(avisos, ['es', 'en', 'es', 'en', 'es'], 'no se avisó del cambio una vez por cambio');
    assert.equal(readFileSync(join(a.root, 'config.json'), 'utf8').includes('"lang": "es"'), true, 'el idioma no se persistió');
  });

  it('repetir el idioma no toca nada, y un argumento invalido no cambia ni la descripción ni el registro', () => {
    const a = arena();
    const { registry } = montar(a);
    const alta = registry.altas.length;
    const igual = ejecutar(registry, '--en');
    assert.equal(igual.code, 'language-unchanged');
    assert.equal(registry.altas.length, alta, 'repetir el idioma volvió a registrar el comando');

    const malo = ejecutar(registry, '--fr');
    assert.equal(malo.kind, 'error');
    assert.equal(malo.code, 'language-ask');
    assert.match(malo.text, /fr/u, 'el error cita el valor que llegó');
    assert.equal(registry.get(LANGUAGE_COMMAND).description, defaultEn['cmd.language.description']);
    assert.equal(registry.names().filter((n) => n.startsWith('skill-aprobar') || n === 'skill-approve').length, 1, 'el registro se movió');
    assert.equal(existsSync(join(a.root, 'config.json')), false, 'un valor inválido no escribe nada');
  });

  it('si la persistencia falla, el registro vuelve a donde estaba y el comando sigue disponible', () => {
    const a = arena({ configRoto: true });
    const { registry } = montar(a);
    const antes = registry.names().sort();
    const r = ejecutar(registry, '--es');
    assert.equal(r.kind, 'error');
    assert.equal(r.code, 'language-persist-failed', r.text);
    assert.deepEqual(registry.names().sort(), antes, 'el registro se quedó a medio cambiar');
    assert.equal(registry.get(LANGUAGE_COMMAND).description, defaultEn['cmd.language.description'], 'la descripción no volvió');
    assert.equal(registry.get(LANGUAGE_COMMAND).handler !== undefined, true, 'el comando de idioma desapareció');
    // Y sigue sirviendo para informar del estado, que es su otro trabajo.
    assert.equal(ejecutar(registry, '').code, 'language-status');
  });

  it('si el alta de la descripción nueva falla, se repone la anterior y el resultado lo dice', () => {
    const a = arena();
    // El segundo alta de `skill-compiler-language` es la reescritura: ahí se simula el rechazo del registro.
    let cuentas = 0;
    const { registry } = montar(a, {
      lang: 'en',
      fallarEn: (definicion) => {
        if (definicion.name !== LANGUAGE_COMMAND) return false;
        cuentas += 1;
        return cuentas === 2;
      },
    });
    const r = ejecutar(registry, '--es');
    assert.equal(r.kind, 'success', 'el idioma cambió: la descripción no puede deshacer un cambio hecho');
    assert.equal(r.code, 'language-set');
    assert.match(r.text, /description keeps the previous language|descripcion de este comando se queda|descripción/u,
      `el resultado no declara que la descripción se quedó: ${r.text}`);
    // El comando sigue ahí, con la descripción anterior y el mismo handler: no se perdió nada.
    const definicion = registry.get(LANGUAGE_COMMAND);
    assert.notEqual(definicion, undefined, 'el comando de idioma se perdió en el fallo');
    assert.equal(definicion.description, defaultEn['cmd.language.description']);

    // Y el siguiente cambio (ya sin el fallo simulado) reescribe la descripción: el error se puede reparar.
    const otra = ejecutar(registry, '--en');
    assert.equal(otra.kind, 'success', otra.text);
    assert.equal(registry.get(LANGUAGE_COMMAND).description, defaultEn['cmd.language.description']);
  });

  it('con DSH_LANG imponiendo el idioma no se escribe nada, la descripción no cambia y el comando lo dice', () => {
    const a = arena();
    const registry = fakeRegistry();
    const set = createLocalizedSet({ definitions: skillCommands({ root: a.root, catalog: { notify() {} } }) });
    const state = createLanguageState();
    const tomados = new Set();
    swapSet({ registry, state, set, lang: 'en', taken: tomados });
    const comando = createLanguageCommand({ registry, state, set, taken: tomados, root: a.root, env: 'en' });
    assert.equal(comando.install().ok, true, 'el comando de idioma no se pudo instalar');

    const r = ejecutar(registry, '--es');
    assert.equal(r.kind, 'success');
    assert.equal(r.code, 'language-fixed-by-env');
    assert.match(r.text, /DSH_LANG/u);
    assert.equal(registry.get(LANGUAGE_COMMAND).description, defaultEn['cmd.language.description']);
    assert.deepEqual(registry.names().sort(), [...set.namesFor('en'), LANGUAGE_COMMAND].sort());
    assert.equal(existsSync(join(a.root, 'config.json')), false, 'con DSH_LANG no se persiste una preferencia inútil');
  });
});
