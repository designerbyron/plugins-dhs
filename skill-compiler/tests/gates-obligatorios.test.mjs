/**
 * F3 · las puertas son OBLIGATORIAS: pruebas negativas de verdad.
 *
 * Una puerta que solo se ejecuta si alguien se acuerda no es una puerta. Este fichero mide dos cosas:
 *
 *   1. que `tools/gates-obligatorios.mjs` corre las dos puertas y devuelve distinto de cero si alguna falla;
 *   2. que cada defecto que las puertas dicen vigilar **las pone en rojo**, sembrandolo en una COPIA del
 *      paquete (nunca en el arbol real): clave que falta, codigo sin texto, placeholders inconsistentes,
 *      no-ASCII nuevo, alias con destino invalido y contrato de herramientas alterado.
 *
 * La copia se hace con `fs.cpSync` de `lib/`, `tools/`, `tests/`, `bin/`, `client.js`, `index.js` y
 * `package.json`; el `node_modules` no se copia porque estas pruebas no lo necesitan (las puertas y el contrato
 * de definiciones solo usan modulos del propio paquete y de Node).
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

const PAQUETE = process.cwd();
const ROOTS = [];

after(() => {
  for (const base of ROOTS) rmSync(base, { recursive: true, force: true });
});

/** Una copia del paquete en una caja aparte, para sembrar un defecto sin tocar el arbol real. */
function copia() {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-gates-'));
  ROOTS.push(base);
  for (const rel of ['lib', 'tools', 'tests', 'bin', 'client.js', 'index.js', 'package.json']) {
    cpSync(join(PAQUETE, rel), join(base, rel), { recursive: true });
  }
  return base;
}

/** Sustituye UNA vez y falla si el ancla no casa: un defecto que no se sembro no mide nada. */
function sembrar(base, rel, ancla, reemplazo) {
  const ruta = join(base, rel);
  const texto = readFileSync(ruta, 'utf8');
  assert.equal(texto.split(ancla).length - 1, 1, `el ancla no casa una vez en ${rel}: ${ancla}`);
  writeFileSync(ruta, texto.replace(ancla, reemplazo));
}

/** Anade una linea al final de un fichero copiado: para un defecto que no depende de un ancla unica. */
function sembrarAlFinal(base, rel, linea) {
  const ruta = join(base, rel);
  writeFileSync(ruta, `${readFileSync(ruta, 'utf8')}${linea}\n`);
}

/** Corre un script del paquete copiado y devuelve salida y codigo. */
function corre(base, script, args = [], cwd = base) {
  const r = spawnSync(process.execPath, [join(base, script), ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const gates = (base) => corre(base, 'tools/gates-obligatorios.mjs', ['--root', base]);
const i18n = (base) => corre(base, 'tools/i18n-gate.mjs', ['--root', base]);
const ascii = (base) => corre(base, 'tools/ascii-gate.mjs', ['--root', base]);

describe('F3 · el punto obligatorio corre las dos puertas', () => {
  it('sobre el arbol real, en verde y con las dos', () => {
    const r = corre(PAQUETE, 'tools/gates-obligatorios.mjs', [], PAQUETE);
    assert.equal(r.code, 0, r.salida);
    assert.match(r.salida, /I18N: en orden/);
    assert.match(r.salida, /ASCII: en orden/);
    assert.match(r.salida, /GATES: i18n y ascii en verde/);
  });

  it('con una puerta en rojo devuelve 1 y dice CUAL', () => {
    const base = copia();
    sembrarAlFinal(base, 'lib/scope.mjs', 'export const DEUDA = "\u00f1";');
    const r = gates(base);
    assert.equal(r.code, 1, r.salida);
    assert.match(r.salida, /GATES: la puerta ascii esta en rojo/);
    assert.match(r.salida, /GATES: no se valida ni se publica/);
  });
});

describe('F3 · cada defecto pone en rojo su puerta', () => {
  it('una clave que falta en un idioma es un fallo de paridad', () => {
    const base = copia();
    sembrar(base, 'lib/i18n/es.mjs', "  'code.activated':", "  'code.activated-renombrado':");
    const r = i18n(base);
    assert.equal(r.code, 1, r.salida);
    assert.match(r.salida, /FALLO paridad · es:code\.activated/);
  });

  it('un codigo sin texto en los dos idiomas', () => {
    const base = copia();
    sembrar(base, 'lib/i18n/codes.mjs', '  activated: [', "  'codigo-inventado': [],\n  activated: [");
    const r = i18n(base);
    assert.equal(r.code, 1, r.salida);
    assert.match(r.salida, /FALLO codigo-sin-texto · es:code\.codigo-inventado/);
    assert.match(r.salida, /FALLO codigo-sin-texto · en:code\.codigo-inventado/);
  });

  it('placeholders inconsistentes entre los dos catalogos', () => {
    const base = copia();
    sembrar(base, 'lib/i18n/es.mjs', 'Alias obsoleto de /{nuevo}: se retira en {retirada}.', 'Alias obsoleto de /{nombre}: se retira en {retirada}.');
    const r = i18n(base);
    assert.equal(r.code, 1, r.salida);
    assert.match(r.salida, /FALLO placeholders · es:cmd\.alias\.deprecated/);
  });

  it('un caracter no ASCII nuevo en el texto del plugin', () => {
    const base = copia();
    sembrarAlFinal(base, 'lib/scope.mjs', 'export const DEUDA = "\u00f1";');
    const r = ascii(base);
    assert.equal(r.code, 1, r.salida);
    assert.match(r.salida, /FALLO ascii-nuevo · lib\/scope\.mjs/);
  });

  it('un alias con destino invalido', () => {
    const base = copia();
    sembrar(base, 'lib/commands.mjs', "'skill-ver': 'skill-show'", "'skill-ver': 'skill-show-typo'");
    const r = i18n(base);
    assert.equal(r.code, 1, r.salida);
    assert.match(r.salida, /FALLO alias-destino · lib\/commands\.mjs:skill-ver/);
  });

  it('el contrato de herramientas alterado: la prueba congelada se pone roja', () => {
    const base = copia();
    // Un parametro obligatorio que deja de serlo es un cambio de ESQUEMA: la superficie visible al modelo
    // cambio y el manifiesto congelado tiene que notarlo.
    sembrar(base, 'lib/definitions.mjs',
      "      id: { type: 'string', required: true, description: 'Unique kebab-case id of the skill",
      "      id: { type: 'string', required: false, description: 'Unique kebab-case id of the skill");
    const r = corre(base, 'tests/definitions-schema.test.mjs');
    assert.notEqual(r.code, 0, `la prueba del contrato no noto el cambio de esquema:\n${r.salida.slice(0, 800)}`);
  });

  it('la expectativa congelada tocada tambien se nota (no se regenera sola)', () => {
    const base = copia();
    const ruta = join(base, 'tests', 'fixtures', 'definitions-contract.json');
    const manifiesto = JSON.parse(readFileSync(ruta, 'utf8'));
    const herramienta = manifiesto.tools;
    const primera = Object.keys(herramienta).find((k) => herramienta[k]?.params !== undefined);
    assert.notEqual(primera, undefined, 'el manifiesto no tiene la forma esperada');
    herramienta[primera].params['parametros_inventados'] = { type: 'string', required: false };
    writeFileSync(ruta, JSON.stringify(manifiesto, null, 2));
    const r = corre(base, 'tests/definitions-schema.test.mjs');
    assert.notEqual(r.code, 0, `la prueba acepto un manifiesto alterado:\n${r.salida.slice(0, 800)}`);
  });
});

describe('F3 · la ruta normal no puede saltarse las puertas', () => {
  it('`npm test` pasa por `pretest` y `test:hermetic` corre las puertas antes de la suite', () => {
    const pkg = JSON.parse(readFileSync(join(PAQUETE, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.pretest, 'node tools/gates-obligatorios.mjs', 'npm test se saltaria las puertas');
    assert.equal(pkg.scripts.gate, 'node tools/gates-obligatorios.mjs');
    assert.equal(pkg.scripts['gate:i18n'], 'node tools/i18n-gate.mjs');
    assert.equal(pkg.scripts['gate:ascii'], 'node tools/ascii-gate.mjs');

    const hermetico = readFileSync(join(PAQUETE, 'tests', 'check-hermetic.mjs'), 'utf8');
    const posGate = hermetico.indexOf('gates-obligatorios.mjs');
    const posSuite = hermetico.indexOf("spawnSync(process.execPath, ['--test']");
    assert.notEqual(posGate, -1, 'test:hermetic no corre las puertas');
    assert.notEqual(posSuite, -1, 'test:hermetic no corre la suite');
    assert.equal(posGate < posSuite, true, 'las puertas tienen que correr ANTES de la suite');
    assert.match(hermetico, /una puerta obligatoria esta en rojo/, 'sin puerta en rojo no hay aborto declarado');
  });
});
