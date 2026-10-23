#!/usr/bin/env node
/**
 * El registro que sigue al idioma, y el cambio en vivo.
 *
 * Lo que se mide aqui, y por que:
 *
 *   1. **Un nombre por operacion.** El mapa declara el nombre de cada idioma y la definicion base de la que
 *      se hereda el handler; los dos nombres comparten la MISMA funcion, asi que cambiar de idioma no puede
 *      cambiar el comportamiento.
 *   2. **Solo se registra el idioma resuelto.** Al arrancar con `en` no existe el nombre espanol, y al
 *      arrancar con `es` no existe el ingles.
 *   3. **El cambio es en vivo y reversible**: se retira con el disposer que devolvio `register()` y se
 *      registra el conjunto nuevo. Volver atras restaura, y repetirlo no acumula definiciones ni listeners.
 *   4. **La transicion no deja el menu roto**: idioma invalido, fallo de persistencia y `DSH_LANG` que impone
 *      el idioma no cambian el registro, y el comando estable sigue disponible en las dos configuraciones.
 *
 * El registro de esta prueba es un **doble con el contrato del anfitrion** (rechaza un nombre repetido y
 * devuelve el disposer que retira ESA definicion). El contrato del registro instalado —y la actualizacion del
 * menu— se mide en el informe del prototipo contra `@deepseek-ai/dsh-commands` extraido del `app.asar`; aqui
 * se fija la maquina de estados del plugin, que es lo que la suite puede vigilar en cada cambio.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { propose } from '../lib/compiler.mjs';
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

const conConjunto = (registry) => {
  const set = createLocalizedSet({ definitions: skillCommands({ root: join(tmpdir(), 'no-se-usa') }) });
  const state = createLanguageState();
  return { set, state };
};

describe('mapa por operacion', () => {
  it('la operacion declara id interno, nombre por idioma y una sola funcion para los dos nombres', () => {
    const set = createLocalizedSet({ definitions: skillCommands({ root: join(tmpdir(), 'no-se-usa') }) });
    assert.equal(set.operations.length, LOCALIZED_OPERATIONS.length);
    const [op] = set.operations;
    assert.equal(op.id, 'approve');
    assert.equal(op.definitionId, 'skill-compiler.approve');
    assert.equal(op.byLang.en.name, 'skill-approve');
    assert.equal(op.byLang.es.name, 'skill-aprobar');

    const en = set.definitionsFor('en');
    const es = set.definitionsFor('es');
    assert.equal(en.length, 1);
    assert.equal(es.length, 1);
    assert.equal(en[0].name, 'skill-approve');
    assert.equal(es[0].name, 'skill-aprobar');
    // La prueba del diseno: mismo handler, misma puerta, mismos efectos. Dos functions distintas dejarian
    // abierta la puerta a que una de las dos se quede atras.
    assert.equal(en[0].handler, es[0].handler);
    assert.equal(en[0].definitionId, es[0].definitionId);
    // La descripcion SI cambia: es texto de la interfaz, en el idioma de su fila.
    assert.notEqual(en[0].description, es[0].description);
    assert.equal([...set.omitNames].sort().join(','), 'skill-approve,skill-aprobar');
  });

  it('un mapa roto se ve al construir y no al cambiar de idioma', () => {
    assert.throws(() => createLocalizedSet({
      definitions: skillCommands({ root: join(tmpdir(), 'no-se-usa') }),
      operations: [{ id: 'x', source: 'no-existe', descriptionKey: 'cmd.approve.description', names: { en: 'a', es: 'b' } }],
    }), /no hay definicion base/u);
    assert.throws(() => createLocalizedSet({
      definitions: skillCommands({ root: join(tmpdir(), 'no-se-usa') }),
      operations: [{ id: 'x', source: 'skill-approve', descriptionKey: 'cmd.approve.description', names: { en: 'Mayusculas', es: 'b' } }],
    }), /nombre invalido/u);
  });

  it('el conjunto destino se valida entero antes de tocar el registro', () => {
    assert.deepEqual(problemsOfSet([{ name: 'ok-name', description: 'algo', handler: () => {} }]), []);
    assert.match(problemsOfSet([{ name: 'ok-name', description: 'algo', handler: () => {} }], { taken: new Set(['ok-name']) })[0], /ya ocupado/u);
    assert.match(problemsOfSet([{ name: 'mal nombre', description: 'algo', handler: () => {} }])[0], /nombre invalido/u);
    assert.match(problemsOfSet([{ name: 'x', description: '  ', handler: () => {} }])[0], /descripcion vacia/u);
  });
});

describe('arranque: solo el idioma resuelto', () => {
  it('con en se registra /skill-approve y no /skill-aprobar', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    const puesto = swapSet({ registry, state, set, lang: 'en' });
    assert.equal(puesto.ok, true);
    assert.deepEqual([...registry.map.keys()], ['skill-approve']);
    assert.equal(registry.map.has('skill-aprobar'), false);
  });

  it('con es se registra /skill-aprobar y no /skill-approve', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    swapSet({ registry, state, set, lang: 'es' });
    assert.deepEqual([...registry.map.keys()], ['skill-aprobar']);
    assert.equal(registry.map.has('skill-approve'), false);
  });

  it('no pisa un nombre que ya ocupa otro comando, y no lo retira al fallar', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    const ajeno = { name: 'skill-aprobar', description: 'de otro', handler: () => {} };
    registry.register(ajeno);
    // Con el nombre declarado como tomado, se ve ANTES de tocar el registro.
    const conAviso = swapSet({ registry, state, set, lang: 'es', taken: new Set(['skill-aprobar']) });
    assert.equal(conAviso.ok, false);
    assert.equal(conAviso.phase, 'validate');
    assert.match(conAviso.problemas[0], /ya ocupado/u);
    // Sin saberlo de antemano, el registro lo rechaza al dar de alta: el ajeno sigue vivo y entero.
    const sinAviso = swapSet({ registry, state, set, lang: 'es' });
    assert.equal(sinAviso.ok, false);
    assert.equal(sinAviso.phase, 'register');
    assert.equal(registry.map.get('skill-aprobar'), ajeno, 'el comando de otro no se toca');
    assert.equal(registry.map.size, 1);
  });
});

describe('cambio en vivo', () => {
  it('en -> es retira el nombre ingles, pone el espanol y conserva la misma funcion', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    swapSet({ registry, state, set, lang: 'en' });
    const antes = registry.map.get('skill-approve');

    const puesto = swapSet({ registry, state, set, lang: 'es' });
    assert.equal(puesto.ok, true);
    assert.deepEqual(puesto.altas, ['skill-aprobar']);
    assert.deepEqual(puesto.bajas, ['skill-approve']);
    assert.deepEqual([...registry.map.keys()], ['skill-aprobar']);
    assert.equal(registry.map.get('skill-aprobar').handler, antes.handler, 'el handler es el mismo objeto');
    // Un alta y una baja: dos avisos, que es lo que el adaptador de UI recibe como `commands/change`.
    assert.deepEqual(registry.cambios, ['+skill-approve', '+skill-aprobar', '-skill-approve']);
  });

  it('es -> en restaura, y cinco vueltas no acumulan definiciones', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    swapSet({ registry, state, set, lang: 'en' });
    for (let i = 0; i < 5; i += 1) {
      swapSet({ registry, state, set, lang: 'es' });
      swapSet({ registry, state, set, lang: 'en' });
    }
    assert.deepEqual([...registry.map.keys()], ['skill-approve']);
    assert.equal(state.live.size, 1, 'el estado no guarda disposers viejos');
    // 1 alta inicial + 10 cambios efectivos x 2 avisos.
    assert.equal(registry.cambios.length, 1 + 10 * 2);
  });

  it('repetir el mismo idioma no toca el registro ni emite avisos', () => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    swapSet({ registry, state, set, lang: 'en' });
    const puesto = swapSet({ registry, state, set, lang: 'en' });
    assert.deepEqual(puesto.altas, []);
    assert.deepEqual(puesto.bajas, []);
    assert.equal(registry.cambios.length, 1);
  });
});

describe('cambio con transicion segura', () => {
  const montar = ({ root }) => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    const tomados = new Set(['skill-pending', 'skill-proposals']);
    swapSet({ registry, state, set, lang: 'en', taken: tomados });
    return { registry, set, state, tomados };
  };

  it('un idioma que no se admite no escribe ni cambia el registro', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar(a);
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--fr', root: a.root });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'language-ask');
    assert.deepEqual([...registry.map.keys()], ['skill-approve']);
    assert.equal(existsSync(join(a.root, 'config.json')), false, 'una opcion invalida no escribe nada');
  });

  it('el cambio efectivo persiste el idioma y deja el conjunto nuevo', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar(a);
    // `env: ''` simula un puesto sin DSH_LANG: el idioma lo decide la configuracion.
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--es', root: a.root, env: '' });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'language-set');
    assert.deepEqual(r.altas, ['skill-aprobar']);
    assert.deepEqual(r.bajas, ['skill-approve']);
    assert.deepEqual([...registry.map.keys()], ['skill-aprobar']);
    assert.equal(existsSync(join(a.root, 'config.json')), true);
  });

  it('si la persistencia falla, vuelve el conjunto anterior y la configuracion no cambia', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar(a);
    // Un directorio con el nombre del fichero hace fallar el rename atomico: el camino de error es real,
    // no una excepcion sembrada a mano.
    mkdirSync(join(a.root, 'config.json'));
    // `env: ''` simula un puesto sin DSH_LANG: el idioma lo decide la configuracion.
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--es', root: a.root, env: '' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'language-persist-failed');
    assert.equal(r.restored, true);
    assert.deepEqual([...registry.map.keys()], ['skill-approve'], 'el registro vuelve al idioma anterior');
    assert.equal(state.lang, 'en');
    // El `.tmp` es el resto del rename que fallo, no una preferencia escrita: `config.json` sigue siendo
    // el directorio que habia, asi que no hay idioma guardado.
    assert.deepEqual(readdirSync(a.root).sort(), ['config.json', 'config.json.tmp']);
  });

  it('con DSH_LANG imponiendo el idioma no se escribe nada y el comando lo dice', () => {
    const a = arena();
    const { registry, set, state, tomados } = montar(a);
    const r = setLanguage({ registry, state, set, taken: tomados, value: '--es', root: a.root, env: 'es' });
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
    assert.equal(r.code, 'language-fixed-by-env');
    assert.equal(r.params.imposed, 'es');
    assert.equal(r.params.requested, 'es');
    assert.deepEqual([...registry.map.keys()], ['skill-approve'], 'la precedencia manda: el registro no se toca');
    assert.equal(existsSync(join(a.root, 'config.json')), false);
  });
});

describe('el comando estable', () => {
  const montar = ({ root }) => {
    const registry = fakeRegistry();
    const { set, state } = conConjunto(registry);
    const tomados = new Set();
    swapSet({ registry, state, set, lang: 'en', taken: tomados });
    const definicion = languageCommandDefinition({ registry, state, set, taken: tomados, root, env: '' });
    registry.register(definicion);
    return { registry, set, state, definicion };
  };

  it('se llama igual en los dos idiomas y sobrevive a los cambios', () => {
    const a = arena();
    const { registry, definicion } = montar(a);
    assert.equal(definicion.name, LANGUAGE_COMMAND);
    assert.equal(definicion.name, 'skill-compiler-language');
    assert.equal(registry.map.has(LANGUAGE_COMMAND), true);

    definicion.handler({ rawInput: '--es' });
    assert.deepEqual([...registry.map.keys()].sort(), ['skill-aprobar', 'skill-compiler-language']);
    definicion.handler({ rawInput: '--en' });
    assert.deepEqual([...registry.map.keys()].sort(), ['skill-approve', 'skill-compiler-language']);
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
    const { registry, definicion } = montar(a);
    const r = definicion.handler({ rawInput: '--fr' });
    assert.equal(r.kind, 'error');
    assert.equal(r.code, 'language-ask');
    assert.deepEqual([...registry.map.keys()].sort(), ['skill-approve', 'skill-compiler-language']);
  });

  it('acepta la forma del CLI, sin guiones', () => {
    assert.deepEqual(parseLanguageArg('es'), { kind: 'lang', lang: 'es' });
    assert.deepEqual(parseLanguageArg('--ES'), { kind: 'lang', lang: 'es' });
    assert.deepEqual(parseLanguageArg(' es-ES '), { kind: 'lang', lang: 'es' });
    assert.equal(parseLanguageArg('').kind, 'none');
    assert.equal(parseLanguageArg('--fr').kind, 'invalid');
  });
});

describe('la prueba vertical sobre approve, con el handler real', () => {
  const definir = (root) => {
    const set = createLocalizedSet({ definitions: skillCommands({ root, catalog: { notify() {} } }) });
    return set;
  };

  it('los dos nombres de la operacion aprueban igual: mismo kind y mismo estado en disco', () => {
    const s1 = sandbox();
    const s2 = sandbox();
    propose(goodInput(), { root: s1.root, curated: s1.curated, cwd: CWD });
    propose(goodInput(), { root: s2.root, curated: s2.curated, cwd: CWD });

    const en = definir(s1.root).definitionsFor('en')[0];
    const es = definir(s2.root).definitionsFor('es')[0];
    const agent = { session: { header: { cwd: CWD } } };
    const porIngles = en.handler({ agent, rawInput: 'measured-decision-check --local' });
    const porEspanol = es.handler({ agent, rawInput: 'measured-decision-check --local' });

    assert.equal(porIngles.kind, 'success', JSON.stringify(porIngles));
    assert.equal(porEspanol.kind, 'success', JSON.stringify(porEspanol));
    assert.equal(porIngles.code, porEspanol.code, 'el codigo del resultado no depende del nombre');
    // El efecto, medido en disco: la propuesta sale de `proposed/` y queda viva en `approved/`.
    const estados = (root) => readdirSync(join(root, 'projects')).flatMap((key) => readdirSync(join(root, 'projects', key)));
    assert.deepEqual(estados(s1.root).sort(), estados(s2.root).sort(), 'los dos nombres dejan el mismo estado');
    assert.equal(estados(s1.root).includes('approved'), true, 'la aprobacion ocurrio de verdad');
  });
});
