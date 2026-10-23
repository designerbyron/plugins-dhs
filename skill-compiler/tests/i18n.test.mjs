/**
 * Idioma: resolución determinista, preferencia persistida y traducción.
 *
 * Lo que se fija aquí es el **contrato** de F0: `DSH_LANG` → `config.json` → `en`, sin adivinar el locale del
 * sistema; una opción explícita inválida no escribe; la escritura es aditiva y atómica; y una traducción que
 * falte cae al inglés base.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import {
  BASE, LANGS, clavesFaltantes, configPath, normalizeTag, readConfig, resetLangCache, resolveLang, setLang, storeRoot, t,
} from '../lib/i18n/index.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);
beforeEach(() => resetLangCache());

const sinEnv = (extra = {}) => ({ env: '', ...extra });

describe('idioma · normalización de etiquetas', () => {
  it('acepta las formas reales y devuelve el idioma base', () => {
    for (const [entrada, esperado] of [
      ['es', 'es'], ['es-ES', 'es'], ['es_419', 'es'], ['ES', 'es'], [' es-MX ', 'es'],
      ['en', 'en'], ['en-US', 'en'], ['en_GB', 'en'],
    ]) assert.equal(normalizeTag(entrada), esperado, entrada);
  });

  it('lo que no es un idioma admitido no se adivina: devuelve null', () => {
    for (const entrada of ['fr', 'pt-BR', '', '   ', 'español', null, undefined, 42]) {
      assert.equal(normalizeTag(entrada), null, String(entrada));
    }
  });

  it('los idiomas admitidos son en y es, con en como base', () => {
    assert.deepEqual([...LANGS], ['en', 'es']);
    assert.equal(BASE, 'en');
  });
});

describe('idioma · precedencia', () => {
  it('sin nada configurado, el defecto es en y lo dice', () => {
    const s = sandbox();
    const info = resolveLang(sinEnv({ root: s.root }));
    assert.deepEqual([info.lang, info.source], ['en', 'default']);
  });

  it('config.json gana al defecto', () => {
    const s = sandbox();
    setLang('es', { root: s.root });
    const info = resolveLang(sinEnv({ root: s.root }));
    assert.deepEqual([info.lang, info.source], ['es', 'config']);
  });

  it('DSH_LANG gana a config.json (override de pruebas y automatización)', () => {
    const s = sandbox();
    setLang('es', { root: s.root });
    const info = resolveLang({ env: 'en-US', root: s.root });
    assert.deepEqual([info.lang, info.source], ['en', 'env']);
  });

  it('un DSH_LANG inválido cae a en y se puede diagnosticar con el valor recibido', () => {
    const s = sandbox();
    setLang('es', { root: s.root });
    const info = resolveLang({ env: 'fr', root: s.root });
    assert.deepEqual([info.lang, info.source], ['es', 'config']);
    assert.equal(info.invalidEnv, 'fr');
  });

  it('un config.json con idioma no admitido cae a en, y no se pisa solo', () => {
    const s = sandbox();
    mkdirSync(s.root, { recursive: true });
    writeFileSync(configPath(s.root), `${JSON.stringify({ lang: 'fr', otra: 'x' })}\n`, 'utf8');
    const info = resolveLang(sinEnv({ root: s.root }));
    assert.deepEqual([info.lang, info.source], ['en', 'default']);
    assert.equal(info.invalidConfig, 'fr');
    assert.equal(JSON.parse(readFileSync(configPath(s.root), 'utf8')).otra, 'x');
  });

  it('un config.json ilegible no rompe nada: se usa en y se declara', () => {
    const s = sandbox();
    mkdirSync(s.root, { recursive: true });
    writeFileSync(configPath(s.root), '{ esto no es json', 'utf8');
    const info = resolveLang(sinEnv({ root: s.root }));
    assert.equal(info.lang, 'en');
    assert.equal(info.configUnreadable, true);
  });

  it('el locale del sistema no participa: con LANG=es_ES y sin preferencia, sigue siendo en', () => {
    const s = sandbox();
    const antes = process.env.LANG;
    process.env.LANG = 'es_ES.UTF-8';
    try {
      resetLangCache();
      const info = resolveLang(sinEnv({ root: s.root }));
      assert.equal(info.lang, 'en');
    } finally {
      if (antes === undefined) delete process.env.LANG; else process.env.LANG = antes;
    }
  });
});

describe('idioma · fijarlo', () => {
  it('fija y persiste; el segundo proceso lo lee igual', () => {
    const s = sandbox();
    const r = setLang('es', { root: s.root });
    assert.equal(r.ok, true);
    assert.equal(r.lang, 'es');
    assert.equal(JSON.parse(readFileSync(configPath(s.root), 'utf8')).lang, 'es');
    assert.equal(resolveLang(sinEnv({ root: s.root })).lang, 'es');
  });

  it('un idioma no admitido es un error y NO escribe nada', () => {
    const s = sandbox();
    const r = setLang('fr', { root: s.root });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unsupported');
    assert.equal(existsSync(configPath(s.root)), false, 'no debe crear config.json');
  });

  it('la escritura es aditiva: conserva claves que no son suyas', () => {
    const s = sandbox();
    mkdirSync(s.root, { recursive: true });
    writeFileSync(configPath(s.root), `${JSON.stringify({ otra: 'dato', lang: 'es', anidada: { a: 1 } })}\n`, 'utf8');
    setLang('en', { root: s.root });
    const datos = readConfig(s.root).datos;
    assert.deepEqual(datos, { otra: 'dato', lang: 'en', anidada: { a: 1 } });
  });

  it('no deja ficheros temporales al escribir', () => {
    const s = sandbox();
    setLang('es', { root: s.root });
    assert.equal(existsSync(`${configPath(s.root)}.tmp`), false);
  });
});

describe('idioma · traducción', () => {
  it('interpola los parámetros por nombre', () => {
    assert.equal(t('lang.status', { lang: 'es', source: 'config' }, { lang: 'en' }), 'language: es (source: config)');
    assert.equal(t('lang.status', { lang: 'es', source: 'config' }, { lang: 'es' }), 'idioma: es (fuente: config)');
  });

  it('un parámetro ausente se ve como hueco, no como undefined', () => {
    assert.match(t('lang.status', { lang: 'es' }, { lang: 'en' }), /\{source\}/);
    assert.doesNotMatch(t('lang.status', { lang: 'es' }, { lang: 'en' }), /undefined/);
  });

  it('un idioma desconocido en la llamada cae al base', () => {
    assert.equal(t('lang.status', { lang: 'es', source: 'env' }, { lang: 'fr' }), 'language: es (source: env)');
  });

  it('una clave que no existe devuelve la clave: lo detecta la paridad, no la producción', () => {
    assert.equal(t('no.existe', {}, { lang: 'es' }), 'no.existe');
  });

  it('ningún catálogo tiene claves sin traducir', () => {
    for (const lang of LANGS) assert.deepEqual(clavesFaltantes(lang), [], lang);
  });
});

describe('idioma · la raíz del almacén', () => {
  it('sale de DSH_HOME cuando existe', () => {
    const s = sandbox();
    const antes = process.env.DSH_HOME;
    process.env.DSH_HOME = s.base;
    try {
      assert.equal(storeRoot(), s.root);
      assert.equal(configPath(), join(s.base, 'skill-compiler', 'config.json'));
    } finally {
      if (antes === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = antes;
    }
  });
});
