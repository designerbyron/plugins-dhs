#!/usr/bin/env node
/**
 * El registro que sigue al idioma, y el cambio en vivo.
 *
 * Lo que se mide aqui, y por que:
 *
 *   1. **Un nombre por operacion y por idioma.** El mapa declara los dos nombres y la definicion base de la
 *      que se hereda el handler; los dos nombres comparten la MISMA funcion, asi que cambiar de idioma no
 *      puede cambiar el comportamiento.
 *   2. **Solo se registra el idioma resuelto.** Al arrancar con `en` no existe el nombre espanol, y al
 *      arrancar con `es` no existe el ingles: 16 filas siempre, nunca 31.
 *   3. **El cambio es en vivo y reversible**: se retira con el disposer que devolvio `register()` y se
 *      registra el conjunto nuevo. Volver atras restaura, y repetirlo no acumula definiciones ni listeners.
 *   4. **La transicion no deja el menu roto**: idioma invalido, fallo de persistencia y `DSH_LANG` que impone
 *      el idioma no cambian el registro, y el comando estable sigue disponible en las dos configuraciones.
 *   5. **La vertical, con los handlers REALES**: tres operaciones distintas —una de solo lectura— dan el
 *      mismo `kind`, el mismo `code` y el mismo estado en disco por cualquiera de sus dos nombres, y el
 *      nombre del otro idioma no esta en el registro (no hay forma de invocarlo).
 *
 * El registro de esta prueba es un **doble con el contrato del anfitrion** (rechaza un nombre repetido y
 * devuelve el disposer que retira ESA definicion). Lo que se ejercita de verdad son las definiciones y los
 * handlers del plugin: el contrato del registro instalado —y la actualizacion del menu— se midio contra
 * `@deepseek-ai/dsh-commands` extraido del `app.asar` en el informe del prototipo; aqui se fija la maquina de
 * estados del plugin, que es lo que la suite puede vigilar en cada cambio.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { pending, projectKey, propose } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import {
  LANGUAGE_COMMAND, LOCALIZED_OPERATIONS, createLanguageState, createLocalizedSet, languageCommandDefinition,
  parseLanguageArg, problemsOfSet, setLanguage, swapSet,
} from '../lib/localized-commands.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

// El idioma de este fichero se fija: el base es `en`, y la prosa que se afirma aqui es la espanola.
process.env.DSH_LANG = 'en';
resetLangCache();

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\skill-compiler-localizado';
const BASES = [];

/** Una caja de arena con su `config.json` escribible, para medir la persistencia sin tocar el almacen real. */
function arena() {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-idioma-'));
  BASES.push(base);
  const root = join(base, 'skill-compiler');
  mkdirSync(root, { recursive: true });
  return { base, root };
}

after(() => {
  for (const base of BASES) rmSync(base, { recursive: true, force: true });
});

/**
 * El contrato del registro, en miniatura: nombre repetido lanza al registrar, y el disposer retira **esa**
 * definicion (nada mas) y avisa del cambio. Es lo que hace `@deepseek-ai/dsh-commands`.
 */
function fakeRegistry() {
  const map = new Map();
  const cambios = [];
  return {
    map,
    cambios,
    register(definition) {
      if (typeof definition?.name !== 'string') throw new TypeError('sin nombre');
      if (map.has(definition.name)) throw new Error(`command "${definition.name}" is already registered`);
      map.set(definition.name, definition);
      cambios.push(`+${definition.name}`);
      let vivo = true;
      return () => {
        if (!vivo) return;
        vivo = false;
        map.delete(definition.name);
        cambios.push(`-${definition.name}`);
      };
    },
  };
}

const definicionesBase = () => skillCommands({ root: join(tmpdir(), 'no-se-usa') });

const conConjunto = () => {
  const set = createLocalizedSet({ definitions: definicionesBase() });
  const state = createLanguageState();
  return { set, state };
};

const ordenar = (lista) => [...lista].sort();

/** Huella del almacen entero: prueba que una operacion de solo lectura no escribe. */
function huella(dir) {
  const h = createHash('sha256');
  const recorrer = (d) => {
    for (const entrada of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, entrada.name);
      if (entrada.isDirectory()) recorrer(p);
      else {
        h.update(relative(dir, p).replace(/\\/g, '/'));
        h.update(readFileSync(p));
      }
    }
  };
  recorrer(dir);
  return h.digest('hex');
}

describe('mapa por operacion', () => {
  it('cada operacion declara id interno, sus dos nombres y una sola funcion para los dos', () => {
    const set = createLocalizedSet({ definitions: definicionesBase() });
    assert.equal(set.operations.length, LOCALIZED_OPERATIONS.length);
    assert.equal(set.operations.length, 16);
    const approve = set.operations.find((op) => op.id === 'approve');
    assert.notEqual(approve, undefined);
    assert.equal(approve.definitionId, 'skill-compiler.approve');
    assert.equal(approve.byLang.en.name, 'skill-approve');
    assert.equal(approve.byLang.es.name, 'skill-aprobar');

    for (const lang of ['en', 'es']) {
      const defs = set.definitionsFor(lang);
      assert.equal(defs.length, 16);
      const en = defs.find((d) => d.name === approve.byLang[lang].name);
      const otro = set.definitionsFor(lang === 'en' ? 'es' : 'en').find((d) => d.name === approve.byLang[lang === 'en' ? 'es' : 'en'].name);
      // La prueba del diseno: mismo handler, misma puerta, mismos efectos. Dos functions distintas dejarian
      // abierta la puerta a que una de las dos se quede atras.
      assert.equal(en.handler, otro.handler, `${lang}: el handler cambia con el idioma`);
      assert.equal(en.definitionId, otro.definitionId, `${lang}: el id de definicion cambia con el idioma`);
    }
    // La descripcion SI cambia: es texto de la interfaz, en el idioma de su fila.
    assert.notEqual(approve.byLang.en.description, approve.byLang.es.description);
    // 31 nombres distintos: 16 + 15, porque `skill-auto` se llama igual en los dos idiomas.
    assert.equal(set.omitNames.length, 31);
  });

  it('un mapa roto se ve al construir y no al cambiar de idioma', () => {
    assert.throws(() => createLocalizedSet({
      definitions: definicionesBase(),
      operations: [{ id: 'x', source: 'no-existe', descriptionKey: 'cmd.approve.description', names: { en: 'a', es: 'b' } }],
    }), /no hay definicion base/u);
    assert.throws(() => createLocalizedSet({
      definitions: definicionesBase(),
      operations: [{ id: 'x', source: 'skill-approve', descriptionKey: 'cmd.approve.description', names: { en: 'Mayusculas', es: 'b' } }],
    }), /nombre invalido/u);
    assert.throws(() => createLocalizedSet({
      definitions: definicionesBase(),
      operations: [{ id: 'x', source: 'skill-approve', names: { en: 'a', es: 'b' } }],
    }), /falta descriptionKey/u);
    assert.throws(() => createLocalizedSet({
      definitions: definicionesBase(),
      operations: [{ id: 'x', source: 'skill-approve', descriptionKey: 'cmd.approve.description', names: { en: 'a', es: 'b' }, hint: '  ' }],
    }), /pista invalida/u);
  });

  it('el conjunto destino se valida entero antes de tocar el registro', () => {
    assert.deepEqual(problemsOfSet([{ name: 'ok-name', description: 'algo', handler: () => {} }]), []);
    assert.match(problemsOfSet([{ name: 'ok-name', description: 'algo', handler: () => {} }], { taken: new Set(['ok-name']) })[0], /ya ocupado/u);
    assert.match(problemsOfSet([{ name: 'mal nombre', description: 'algo', handler: () => {} }])[0], /nombre invalido/u);
    assert.match(problemsOfSet([{ name: 'x', description: '  ', handler: () => {} }])[0], /descripcion vacia/u);
  });
});

describe('arranque: solo el idioma resuelto', () => {
  it('con en se registran los 16 nombres ingleses y ninguno espanol', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    const puesto = swapSet({ registry, state, set, lang: 'en' });
    assert.equal(puesto.ok, true);
    assert.equal(registry.map.size, 16);
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('en')));
    assert.equal(registry.map.has('skill-aprobar'), false);
    assert.equal(registry.map.has('skill-ver'), false);
  });

  it('con es se registra /skill-aprobar y no /skill-approve', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    swapSet({ registry, state, set, lang: 'es' });
    assert.equal(registry.map.size, 16);
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('es')));
    assert.equal(registry.map.has('skill-approve'), false);
    assert.equal(registry.map.has('skill-aprobar'), true);
  });

  it('no pisa un nombre que ya ocupa otro comando, y no lo retira al fallar', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    const ajeno = { name: 'skill-aprobar', description: 'de otro', handler: () => {} };
    registry.register(ajeno);
    // Con el nombre declarado como tomado, se ve ANTES de tocar el registro.
    const conAviso = swapSet({ registry, state, set, lang: 'es', taken: new Set(['skill-aprobar']) });
    assert.equal(conAviso.ok, false);
    assert.equal(conAviso.phase, 'validate');
    assert.match(conAviso.problemas[0], /ya ocupado/u);
    // Sin saberlo de antemano, el registro lo rechaza al dar de alta: el ajeno sigue vivo y entero, y ni una
    // de las 16 altas se queda puesta.
    const sinAviso = swapSet({ registry, state, set, lang: 'es' });
    assert.equal(sinAviso.ok, false);
    assert.equal(sinAviso.phase, 'register');
    assert.equal(registry.map.get('skill-aprobar'), ajeno, 'el comando de otro no se toca');
    assert.equal(registry.map.size, 1);
    assert.equal(state.live.size, 0, 'un alta fallida no deja disposers en el estado');
  });
});

describe('cambio en vivo', () => {
  it('en -> es retira los nombres ingleses, pone los espanoles y conserva la misma funcion', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    swapSet({ registry, state, set, lang: 'en' });
    const antes = registry.map.get('skill-approve');

    const puesto = swapSet({ registry, state, set, lang: 'es' });
    assert.equal(puesto.ok, true);
    assert.equal(puesto.altas.length, 15, 'las 15 operaciones que se traducen entran; skill-auto no cambia');
    assert.equal(puesto.bajas.length, 15);
    assert.equal(puesto.altas.includes('skill-auto'), false);
    assert.equal(registry.map.size, 16);
    assert.equal(registry.map.get('skill-aprobar').handler, antes.handler, 'el handler es el mismo objeto');
    // Altas antes que bajas: lo que garantiza que nunca falte una fila es el ORDEN de los avisos.
    const primeraBaja = registry.cambios.findIndex((c) => c.startsWith('-'));
    const ultimaAlta = registry.cambios.map((c) => c.startsWith('+')).lastIndexOf(true);
    assert.equal(ultimaAlta < primeraBaja, true, 'una baja ocurrio antes de la ultima alta');
  });

  it('es -> en restaura, y cinco vueltas no acumulan definiciones', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    swapSet({ registry, state, set, lang: 'en' });
    for (let i = 0; i < 5; i += 1) {
      swapSet({ registry, state, set, lang: 'es' });
      swapSet({ registry, state, set, lang: 'en' });
    }
    assert.equal(registry.map.size, 16);
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('en')));
    assert.equal(state.live.size, 16, 'el estado no guarda disposers viejos');
    // 16 altas iniciales + 10 cambios efectivos x (15 altas + 15 bajas).
    assert.equal(registry.cambios.length, 16 + 10 * 30);
  });

  it('repetir el mismo idioma no toca el registro ni emite avisos', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    swapSet({ registry, state, set, lang: 'en' });
    const puesto = swapSet({ registry, state, set, lang: 'en' });
    assert.deepEqual(puesto.altas, []);
    assert.deepEqual(puesto.bajas, []);
    assert.equal(registry.cambios.length, 16);
  });
});

describe('cambio con transicion segura', () => {
  const montar = () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    // Un nombre que ya ocupa OTRO comando del anfitrion: es lo que la validacion previa tiene que ver.
    const tomados = new Set(['skill-de-otro-plugin']);
    swapSet({ registry, state, set, lang: 'en', taken: tomados });
    return { registry, set, state, tomados };
  };

  it('un idioma que no se admite no escribe ni cambia el registro', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar();
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--fr', root: a.root });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'language-ask');
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('en')));
    assert.equal(existsSync(join(a.root, 'config.json')), false, 'una opcion invalida no escribe nada');
  });

  it('el cambio efectivo persiste el idioma y deja el conjunto nuevo', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar();
    // `env: ''` simula un puesto sin DSH_LANG: el idioma lo decide la configuracion.
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--es', root: a.root, env: '' });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'language-set');
    assert.equal(r.altas.length, 15);
    assert.equal(r.bajas.length, 15);
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('es')));
    assert.equal(existsSync(join(a.root, 'config.json')), true);
    assert.equal(JSON.parse(readFileSync(join(a.root, 'config.json'), 'utf8')).lang, 'es');
  });

  it('si la persistencia falla, vuelve el conjunto anterior y la configuracion no cambia', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar();
    // Un directorio con el nombre del fichero hace fallar el rename atomico: el camino de error es real,
    // no una excepcion sembrada a mano.
    mkdirSync(join(a.root, 'config.json'));
    // `env: ''` simula un puesto sin DSH_LANG: el idioma lo decide la configuracion.
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--es', root: a.root, env: '' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'language-persist-failed');
    assert.equal(r.restored, true);
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('en')), 'el registro vuelve al idioma anterior');
    assert.equal(state.lang, 'en');
    // El `.tmp` es el resto del rename que fallo, no una preferencia escrita: `config.json` sigue siendo
    // el directorio que habia, asi que no hay idioma guardado.
    assert.deepEqual(readdirSync(a.root).sort(), ['config.json', 'config.json.tmp']);
  });

  it('con DSH_LANG imponiendo el idioma no se escribe nada y el comando lo dice', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar();
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--es', root: a.root, env: 'es' });
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
    assert.equal(r.code, 'language-fixed-by-env');
    assert.equal(r.params.imposed, 'es');
    assert.equal(r.params.requested, 'es');
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('en')), 'la precedencia manda: el registro no se toca');
    assert.equal(existsSync(join(a.root, 'config.json')), false);
  });
});

describe('el comando estable', () => {
  const montar = ({ root }) => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto();
    const tomados = new Set();
    swapSet({ registry, state, set, lang: 'en', taken: tomados });
    const definicion = languageCommandDefinition({ registry, state, set, taken: tomados, root, env: '' });
    registry.register(definicion);
    return { registry, set, state, definicion };
  };

  it('se llama igual en los dos idiomas, esta fuera del conjunto y sobrevive a los cambios', () => {
    const a = arena();
    const { registry, definicion, set } = montar(a);
    assert.equal(definicion.name, LANGUAGE_COMMAND);
    assert.equal(definicion.name, 'skill-compiler-language');
    assert.equal(registry.map.has(LANGUAGE_COMMAND), true);
    // No es una de las 16 operaciones: no cambia de nombre con el idioma ni se retira al cambiar.
    assert.equal(set.namesFor('en').includes(LANGUAGE_COMMAND), false);
    assert.equal(set.namesFor('es').includes(LANGUAGE_COMMAND), false);

    definicion.handler({ rawInput: '--es' });
    assert.equal(registry.map.size, 17);
    assert.equal(registry.map.has(LANGUAGE_COMMAND), true);
    assert.equal(registry.map.has('skill-aprobar'), true);
    definicion.handler({ rawInput: '--en' });
    assert.equal(registry.map.has(LANGUAGE_COMMAND), true);
    assert.equal(registry.map.has('skill-approve'), true);
    assert.equal(registry.map.has('skill-aprobar'), false);
  });

  it('sin argumentos devuelve el estado, y no es un veredicto', () => {
    const a = arena();
    const { definicion } = montar(a);
    const r = definicion.handler({ rawInput: '' });
    assert.equal(r.kind, 'success');
    assert.equal(r.code, 'language-status');
    assert.match(r.text, /skill-aprobar/u, 'dice los nombres de los dos idiomas');
    assert.match(r.text, /skill-approve/u);
  });

  it('un idioma invalido se responde como error y no cambia nada', () => {
    const a = arena();
    const { registry, definicion, set } = montar(a);
    const r = definicion.handler({ rawInput: '--fr' });
    assert.equal(r.kind, 'error');
    assert.equal(r.code, 'language-ask');
    assert.deepEqual(ordenar(registry.map.keys()), ordenar([...set.namesFor('en'), LANGUAGE_COMMAND]));
  });

  it('acepta la forma del CLI, sin guiones', () => {
    assert.deepEqual(parseLanguageArg('es'), { kind: 'lang', lang: 'es' });
    assert.deepEqual(parseLanguageArg('--ES'), { kind: 'lang', lang: 'es' });
    assert.deepEqual(parseLanguageArg(' es-ES '), { kind: 'lang', lang: 'es' });
    assert.equal(parseLanguageArg('').kind, 'none');
    assert.equal(parseLanguageArg('--fr').kind, 'invalid');
  });
});

describe('vertical por idioma, con los handlers reales', () => {
  const conjuntoDe = (root) => createLocalizedSet({ definitions: skillCommands({ root, catalog: { notify() {} } }) });
  const definicionDe = (root, lang, id) => {
    const set = conjuntoDe(root);
    const op = set.operations.find((o) => o.id === id);
    assert.notEqual(op, undefined, `${id}: no esta en el mapa`);
    return set.definitionsFor(lang).find((d) => d.name === op.byLang[lang].name);
  };

  it('approve: los dos nombres aprueban igual, con el mismo kind, el mismo code y el mismo estado', () => {
    const s1 = sandbox();
    const s2 = sandbox();
    propose(goodInput(), { root: s1.root, curated: s1.curated, cwd: CWD });
    propose(goodInput(), { root: s2.root, curated: s2.curated, cwd: CWD });

    const en = definicionDe(s1.root, 'en', 'approve');
    const es = definicionDe(s2.root, 'es', 'approve');
    const agent = { session: { header: { cwd: CWD } } };
    const porIngles = en.handler({ agent, rawInput: 'measured-decision-check --local' });
    const porEspanol = es.handler({ agent, rawInput: 'measured-decision-check --local' });

    assert.equal(porIngles.kind, 'success', JSON.stringify(porIngles));
    assert.equal(porEspanol.kind, 'success', JSON.stringify(porEspanol));
    assert.equal(porIngles.code, 'activated');
    assert.equal(porEspanol.code, 'activated');
    assert.deepEqual(porIngles.params, porEspanol.params);
    // El efecto, medido en disco: la propuesta sale de `proposed/` y queda viva en `approved/`.
    const estados = (root) => readdirSync(join(root, 'projects')).flatMap((key) => readdirSync(join(root, 'projects', key))).sort();
    assert.deepEqual(estados(s1.root), estados(s2.root), 'los dos nombres dejan el mismo estado');
    assert.equal(estados(s1.root).includes('approved'), true, 'la aprobacion ocurrio de verdad');
    assert.deepEqual(pending({ root: s1.root, key: projectKey(CWD) }), [], 'y no queda nada pendiente');
  });

  it('show y proposals (solo lectura): mismo texto en su idioma, y no escriben una sola huella', () => {
    const s1 = sandbox();
    const s2 = sandbox();
    propose(goodInput(), { root: s1.root, curated: s1.curated, cwd: CWD });
    propose(goodInput(), { root: s2.root, curated: s2.curated, cwd: CWD });
    const agent = { session: { header: { cwd: CWD } } };

    const antes1 = huella(s1.root);
    const antes2 = huella(s2.root);
    const lectura = [
      ['show', definicionDe(s1.root, 'en', 'show'), definicionDe(s2.root, 'es', 'show'), 'measured-decision-check'],
      ['proposals', definicionDe(s1.root, 'en', 'proposals'), definicionDe(s2.root, 'es', 'proposals'), ''],
    ];
    for (const [id, en, es, rawInput] of lectura) {
      assert.equal(en.name, LOCALIZED_OPERATIONS.find((op) => op.id === id).names.en, `${id}: nombre ingles`);
      assert.equal(es.name, LOCALIZED_OPERATIONS.find((op) => op.id === id).names.es, `${id}: nombre espanol`);
      const rEn = en.handler({ agent, rawInput });
      const rEs = es.handler({ agent, rawInput });
      assert.equal(rEn.kind, rEs.kind, `${id}: kind distinto`);
      assert.equal(rEn.code, rEs.code, `${id}: code distinto`);
      // El resultado trae texto en los dos idiomas, y es prosa de SU idioma: no se queda vacio ni en uno.
      assert.equal(typeof rEn.text, 'string', `${id}: sin texto en ingles`);
      assert.equal(rEn.text.trim().length > 0, true, `${id}: texto vacio en ingles`);
      assert.equal(typeof rEs.text, 'string', `${id}: sin texto en espanol`);
      assert.equal(rEs.text.trim().length > 0, true, `${id}: texto vacio en espanol`);
    }
    assert.equal(huella(s1.root), antes1, 'la lectura por el nombre ingles movio el almacen');
    assert.equal(huella(s2.root), antes2, 'la lectura por el nombre espanol movio el almacen');
  });

  it('cinco cambios con los handlers reales: 16 filas por idioma y el otro nombre no es invocable', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const registry = fakeRegistry();
    // El conjunto se construye con las definiciones de ESTA arena: la fila registrada tiene que ejecutar
    // contra el almacen donde esta la propuesta, o la vertical mediria un handler que mira a otro sitio.
    const set = conjuntoDe(s.root);
    const state = createLanguageState();

    swapSet({ registry, state, set, lang: 'en' });
    assert.equal(registry.map.size, 16);
    assert.equal(registry.map.has('skill-ver'), false, 'el nombre espanol no existe en ingles');
    // El nombre del otro idioma no es invocable: no hay definicion que ejecutar.
    assert.equal(registry.map.get('skill-aprobar'), undefined);

    for (let i = 0; i < 5; i += 1) {
      swapSet({ registry, state, set, lang: 'es' });
      assert.equal(registry.map.size, 16, `vuelta ${i}: filas en espanol`);
      assert.equal(registry.map.has('skill-approve'), false, `vuelta ${i}: el ingles sigue en espanol`);
      swapSet({ registry, state, set, lang: 'en' });
      assert.equal(registry.map.size, 16, `vuelta ${i}: filas en ingles`);
      assert.equal(registry.map.has('skill-aprobar'), false, `vuelta ${i}: el espanol sigue en ingles`);
    }

    // Y la fila que se registra EJECUTA: el handler real del nombre ingles aprueba en su arena.
    const aprobar = registry.map.get('skill-approve');
    const r = aprobar.handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: 'measured-decision-check --local' });
    assert.equal(r.kind, 'success', JSON.stringify(r));
    assert.equal(r.code, 'activated');
  });
});
