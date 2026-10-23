/**
 * F1.1 · el menu localizado: una fila por operacion, en el idioma activo.
 *
 * Lo que se mide aqui, y por que:
 *
 *   1. las 16 operaciones declaran **un nombre por idioma**, y el conjunto ocupa 31 nombres distintos
 *      (el unico que no se traduce es `skill-auto`);
 *   2. el conjunto activo tiene **16 filas** en cualquier idioma, todas distintas, y el nombre del otro
 *      idioma no esta dentro: no es un alias, es el nombre de la misma operacion en otra lengua;
 *   3. cambiar de idioma no deja el nombre anterior registrado, y cinco vueltas no acumulan filas ni
 *      disposers;
 *   4. un mapa roto (una operacion sin nombre, o dos con el mismo) se ve **al construir**, no al cambiar
 *      de idioma;
 *   5. `doctor` cuenta lo que el registro va a servir —16 filas, un nombre por operacion— y no un numero
 *      escrito a mano, en los dos idiomas;
 *   6. ninguna definicion lleva metadatos de alias: el modelo se retiro, y una fila del menu no puede
 *      declarar que su nombre esta obsoleto.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import {
  LOCALIZED_OPERATIONS, createLanguageState, createLocalizedSet, localizedNamesOf, operationIdOf, swapSet,
} from '../lib/localized-commands.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

// El idioma de este fichero se fija: la prosa que se afirma aqui es la espanola, y el base es `en`.
process.env.DSH_LANG = 'es';
resetLangCache();

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-correccion-f1-1';
const ROOTS = [];

function arena() {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-menu-'));
  ROOTS.push(base);
  const root = join(base, 'skill-compiler');
  mkdirSync(root, { recursive: true });
  return { base, root };
}

after(() => {
  for (const base of ROOTS) rmSync(base, { recursive: true, force: true });
});

/** El contrato del registro, en miniatura: nombre repetido lanza, y el disposer retira ESA definicion. */
function fakeRegistry() {
  const map = new Map();
  const cambios = [];
  return {
    map,
    cambios,
    register(definition) {
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

const definiciones = () => skillCommands({ root: join(tmpdir(), 'no-se-usa') });
const conjuntoReal = () => createLocalizedSet({ definitions: definiciones() });
const ordenar = (lista) => [...lista].sort();

describe('F1.1 · una operacion, un nombre por idioma', () => {
  it('las 16 operaciones declaran sus dos nombres y ocupan 31 nombres distintos', () => {
    const set = conjuntoReal();
    assert.equal(set.operations.length, 16);
    assert.equal(LOCALIZED_OPERATIONS.length, 16);
    for (const op of LOCALIZED_OPERATIONS) {
      assert.equal(typeof op.names.en, 'string', `${op.id}: sin nombre ingles`);
      assert.equal(typeof op.names.es, 'string', `${op.id}: sin nombre espanol`);
      assert.match(op.names.en, /^skill-[a-z][a-z0-9-]*$/, `${op.id}: nombre ingles fuera de la gramatica`);
      assert.match(op.names.es, /^skill-[a-z][a-z0-9-]*$/, `${op.id}: nombre espanol fuera de la gramatica`);
    }
    // 16 + 15: `skill-auto` es el unico nombre que vale en los dos idiomas.
    assert.equal(set.omitNames.length, 31);
    assert.equal(new Set(set.omitNames).size, 31);
    assert.equal(set.omitNames.filter((n) => n === 'skill-auto').length, 1);
  });

  it('el conjunto de cada idioma tiene 16 filas, todas distintas, y el nombre del otro no esta dentro', () => {
    const set = conjuntoReal();
    const en = set.namesFor('en');
    const es = set.namesFor('es');
    for (const [idioma, filas] of [['en', en], ['es', es]]) {
      assert.equal(filas.length, 16, `${idioma}: filas`);
      assert.equal(new Set(filas).size, 16, `${idioma}: un nombre repetido`);
    }
    for (const op of LOCALIZED_OPERATIONS) {
      const [nombreEn, nombreEs] = localizedNamesOf(op.id);
      if (nombreEn === nombreEs) {
        // `skill-auto`: el mismo nombre en los dos idiomas, y una sola fila en cada uno.
        assert.equal(en.includes(nombreEn) && es.includes(nombreEs), true, `${op.id}: falta`);
        continue;
      }
      assert.equal(en.includes(nombreEs), false, `${op.id}: el nombre espanol se registra en ingles`);
      assert.equal(es.includes(nombreEn), false, `${op.id}: el nombre ingles se registra en espanol`);
    }
  });

  it('el id interno resuelve cualquiera de sus dos nombres, y solo los suyos', () => {
    for (const op of LOCALIZED_OPERATIONS) {
      assert.equal(operationIdOf(op.names.en), op.id);
      assert.equal(operationIdOf(op.names.es), op.id);
    }
    assert.equal(operationIdOf('skill-que-no-existe'), null);
    assert.equal(operationIdOf(''), null);
    assert.deepEqual([...localizedNamesOf('approve')], ['skill-approve', 'skill-aprobar']);
    assert.deepEqual([...localizedNamesOf('no-existe')], []);
  });

  it('ninguna definicion lleva metadatos de alias, y la descripcion es la de su idioma', () => {
    const set = conjuntoReal();
    for (const idioma of ['en', 'es']) {
      for (const def of set.definitionsFor(idioma)) {
        assert.equal(def.aliasOf, undefined, `${def.name}: declara aliasOf`);
        assert.equal(def.deprecatedIn, undefined, `${def.name}: declara deprecatedIn`);
        assert.equal(typeof def.definitionId, 'string', `${def.name}: sin id de definicion`);
        assert.equal(def.description.trim().length > 0, true, `${def.name}: sin descripcion`);
      }
    }
    // La misma operacion, dos textos: no es el canonico con un aviso delante, es la descripcion de su idioma.
    const porId = new Map(set.operations.map((op) => [op.id, op]));
    assert.notEqual(porId.get('approve').byLang.en.description, porId.get('approve').byLang.es.description);
    assert.equal(/alias/i.test(porId.get('approve').byLang.es.description), false, 'la descripcion habla de alias');
  });
});

describe('F1.1 · el registro activo, y cinco cambios', () => {
  it('con en se registran los 16 nombres ingleses y ninguno espanol', () => {
    const registry = fakeRegistry();
    const set = conjuntoReal();
    const state = createLanguageState();
    const puesto = swapSet({ registry, state, set, lang: 'en' });
    assert.equal(puesto.ok, true);
    assert.equal(registry.map.size, 16);
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('en')));
    for (const op of LOCALIZED_OPERATIONS) {
      if (op.names.en !== op.names.es) assert.equal(registry.map.has(op.names.es), false, `${op.id}: nombre espanol en ingles`);
    }
  });

  it('con es se registran los 16 espanoles y ninguno ingles, sin acumular', () => {
    const registry = fakeRegistry();
    const set = conjuntoReal();
    const state = createLanguageState();
    swapSet({ registry, state, set, lang: 'en' });
    const puesto = swapSet({ registry, state, set, lang: 'es' });
    assert.equal(puesto.ok, true);
    assert.equal(registry.map.size, 16);
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('es')));
    for (const op of LOCALIZED_OPERATIONS) {
      if (op.names.en !== op.names.es) assert.equal(registry.map.has(op.names.en), false, `${op.id}: nombre ingles en espanol`);
    }
    // Altas antes que bajas: 15 altas + 15 bajas son 30 avisos, y `skill-auto` no se toca.
    assert.equal(puesto.altas.length, 15);
    assert.equal(puesto.bajas.length, 15);
    assert.equal(puesto.altas.includes('skill-auto'), false, 'skill-auto no cambia de nombre');
  });

  it('cinco vueltas dejan 16 filas, 16 disposers y ningun nombre del idioma anterior', () => {
    const registry = fakeRegistry();
    const set = conjuntoReal();
    const state = createLanguageState();
    swapSet({ registry, state, set, lang: 'en' });
    for (let i = 0; i < 5; i += 1) {
      swapSet({ registry, state, set, lang: 'es' });
      swapSet({ registry, state, set, lang: 'en' });
    }
    assert.equal(registry.map.size, 16);
    assert.equal(state.live.size, 16, 'el estado no guarda disposers viejos');
    assert.equal(state.lang, 'en');
    assert.deepEqual(ordenar(registry.map.keys()), ordenar(set.namesFor('en')));
    // 1 alta inicial (16 avisos) + 10 cambios efectivos (15 altas + 15 bajas cada uno).
    assert.equal(registry.cambios.length, 16 + 10 * 30);
  });
});

describe('F1.1 · el mapa roto se ve al construir', () => {
  it('una operacion sin nombre en un idioma lanza al construir el conjunto', () => {
    assert.throws(() => createLocalizedSet({
      definitions: definiciones(),
      operations: [{ id: 'x', source: 'skill-approve', descriptionKey: 'cmd.approve.description', names: { en: 'skill-x' } }],
    }), /nombre invalido/u);
  });

  it('dos operaciones con el mismo nombre lanzan: una fila no puede tener dos duenios', () => {
    assert.throws(() => createLocalizedSet({
      definitions: definiciones(),
      operations: [
        { id: 'a', source: 'skill-approve', descriptionKey: 'cmd.approve.description', names: { en: 'skill-mismo', es: 'skill-a' } },
        { id: 'b', source: 'skill-reject', descriptionKey: 'cmd.reject.description', names: { en: 'skill-mismo', es: 'skill-b' } },
      ],
    }), /ya lo ocupa otra operacion/u);
  });

  it('el mismo nombre en los dos idiomas SI vale: es una operacion que no se traduce', () => {
    const set = createLocalizedSet({
      definitions: definiciones(),
      operations: [{ id: 'auto', source: 'skill-auto', descriptionKey: 'cmd.auto.description', names: { en: 'skill-auto', es: 'skill-auto' } }],
    });
    assert.deepEqual(set.namesFor('en'), ['skill-auto']);
    assert.deepEqual(set.namesFor('es'), ['skill-auto']);
    assert.equal(set.omitNames.length, 1);
  });
});

describe('F1.1 · doctor cuenta lo que el registro va a servir', () => {
  const doctor = (idioma) => {
    const s = arena();
    const r = spawnSync(process.execPath, [join(process.cwd(), 'bin', 'skill-compiler.mjs'), 'doctor'], {
      cwd: s.base,
      env: { ...process.env, DSH_HOME: s.base, DSH_LANG: idioma },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  it('en espanol: 16 operaciones, 16 filas y los nombres espanoles', () => {
    const { status, salida } = doctor('es');
    assert.equal(status, 0, `doctor no puede cerrar en fallo:\n${salida}`);
    assert.match(salida, /16 operaciones y 16 filas en es/);
    assert.match(salida, /skill-aprobar/);
    assert.doesNotMatch(salida, /31 filas|16 canonicos|alias/i);
  });

  it('en ingles dice lo mismo, con los nombres ingleses', () => {
    const { status, salida } = doctor('en');
    assert.equal(status, 0, salida);
    assert.match(salida, /16 operations and 16 rows in en/);
    assert.match(salida, /skill-approve/);
    assert.doesNotMatch(salida, /skill-aprobar/, 'en ingles no se anuncia un nombre espanol');
  });

  it('sin almacen el doctor sigue midiendo el mapa, no el contenido del proyecto', () => {
    const s = sandbox({ curated: false });
    const r = spawnSync(process.execPath, [join(process.cwd(), 'bin', 'skill-compiler.mjs'), 'doctor'], {
      cwd: s.root,
      env: { ...process.env, DSH_HOME: s.root, DSH_LANG: 'es' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.match(salida, /16 operaciones y 16 filas en es/);
  });
});
