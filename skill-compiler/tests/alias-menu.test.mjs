/**
 * F1.1 · alias y menu: el dato, su coherencia y lo que el harness hace con el.
 *
 * Lo que se mide aqui, y por que:
 *
 *   1. los 15 alias siguen siendo **invocables** y devuelven el mismo `kind` y el mismo `code` que su
 *      canonico (mismo efecto, una sola implementacion);
 *   2. sus **metadatos** son coherentes (`aliasOf` a un canonico registrado, `deprecatedIn` que es una
 *      version, descripcion que explica que hace, handler de verdad);
 *   3. `aliasProblems()` **detecta** el defecto silencioso de toda tabla de alias: un destino mal escrito que
 *      deja el alias sin registrar y no lo dice nadie;
 *   4. `doctor` cuenta en voz alta lo que el menu va a ensenar. Medido en el build instalado del harness
 *      (`@deepseek-ai/dsh-commands` recorta el descriptor a `{definitionId, name, description, input}`, y
 *      `dsh-client-ui-commands` compone cada fila con `name` + `description` + `input.hint`): `aliasOf` y
 *      `deprecatedIn` NO llegan a la interfaz, asi que el menu anuncia las 16 filas canonicas MAS los 15
 *      alias y no puede filtrarlos. Ocultarlos no registrandolos les quitaria la invocabilidad, que es
 *      justo lo que el humano usa hasta la retirada.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

// La prosa que se afirma en este fichero es la espanola: el idioma base es `en`.
process.env.DSH_LANG = 'es';

import { ALIAS_ESPERADOS, RETIRADA_DE_ALIAS, aliasProblems, aliasSummary, skillCommands } from '../lib/commands.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-correccion-f1-1';
const ROOTS = [];

function arena() {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-alias-'));
  ROOTS.push(base);
  const root = join(base, 'skill-compiler');
  mkdirSync(root, { recursive: true });
  return { base, root };
}

after(() => {
  for (const base of ROOTS) rmSync(base, { recursive: true, force: true });
});

const porNombre = (root) => new Map(skillCommands({ root }).map((c) => [c.name, c]));

describe('F1.1 · los alias son el mismo comando', () => {
  it('los 15 alias existen, apuntan a un canonico registrado y declaran su retirada', () => {
    assert.equal(Object.keys(ALIAS_ESPERADOS).length, 15);
    assert.equal(RETIRADA_DE_ALIAS, '5.0.0');
    const mapa = porNombre(undefined);
    for (const [viejo, nuevo] of Object.entries(ALIAS_ESPERADOS)) {
      const alias = mapa.get(viejo);
      assert.notEqual(alias, undefined, `${viejo}: no se registra`);
      assert.equal(alias.aliasOf, nuevo, `${viejo}: aliasOf`);
      assert.equal(alias.deprecatedIn, '4.0.0', `${viejo}: deprecatedIn`);
      assert.equal(typeof alias.handler, 'function', `${viejo}: sin handler`);
      assert.equal(alias.description.endsWith(mapa.get(nuevo).description), true, `${viejo}: el canonico se perdio en la descripcion`);
    }
  });

  it('cada alias devuelve el mismo tipo y el mismo codigo que su canonico, ejecutando de verdad', () => {
    // Un id que no existe lleva a los quince por su camino de error: es suficiente para comparar el contrato
    // (kind y code) sin sembrar quince arenas ni tocar el almacen real.
    const a = sandbox();
    const b = sandbox();
    const inv = { agent: { session: { header: { cwd: CWD } } }, rawInput: 'id-que-no-existe-jamas' };
    const conAlias = porNombre(a.root);
    const conCanonico = porNombre(b.root);
    for (const [viejo, nuevo] of Object.entries(ALIAS_ESPERADOS)) {
      const r1 = conAlias.get(viejo).handler(inv, { ok: true });
      const r2 = conCanonico.get(nuevo).handler(inv, { ok: true });
      assert.equal(r1.kind, r2.kind, `${viejo}: kind distinto de ${nuevo}`);
      assert.equal(r1.code, r2.code, `${viejo}: code distinto de ${nuevo}`);
    }
  });

  it('las definiciones reales no tienen ningun problema de alias, y el menu anuncia 31 filas', () => {
    const definiciones = skillCommands({ root: sandbox().root });
    assert.deepEqual(aliasProblems(definiciones), []);
    const resumen = aliasSummary(definiciones);
    assert.equal(resumen.canonicos, 16);
    assert.equal(resumen.alias, 15);
    assert.equal(resumen.filas, 31);
    assert.deepEqual(resumen.aliasNames, Object.keys(ALIAS_ESPERADOS).sort());
  });
});

describe('F1.1 · la tabla de alias no puede mentir en silencio', () => {
  const canonico = { name: 'skill-demo', description: 'hace algo', handler: () => ({}) };
  const alias = (extra = {}) => ({
    name: 'skill-demo-viejo', aliasOf: 'skill-demo', deprecatedIn: '4.0.0',
    description: 'Alias obsoleto. hace algo', handler: () => ({}), ...extra,
  });
  const reglas = (definiciones, esperados) => aliasProblems(definiciones, esperados).map((p) => p.regla).sort();

  it('un destino que no existe es un problema, no un alias que desaparece', () => {
    // El defecto que esto vigila: `if (canonico === undefined) continue;` y nadie se entera.
    assert.deepEqual(reglas([canonico], { 'skill-demo-viejo': 'skill-que-no-existe' }), ['alias-destino']);
  });

  it('un alias que no se registro, o que apunta a otro sitio, tambien', () => {
    assert.deepEqual(reglas([canonico], { 'skill-demo-viejo': 'skill-demo' }), ['alias-ausente']);
    assert.deepEqual(reglas([canonico, alias({ aliasOf: 'otro' })], { 'skill-demo-viejo': 'skill-demo' }), ['alias-destino']);
  });

  it('metadatos incoherentes: retirada que no es version, handler ausente, descripcion vacia', () => {
    const esperados = { 'skill-demo-viejo': 'skill-demo' };
    assert.deepEqual(reglas([canonico, alias({ deprecatedIn: 'cuatro' })], esperados), ['alias-retirada']);
    assert.deepEqual(reglas([canonico, alias({ handler: undefined })], esperados), ['alias-handler']);
    assert.deepEqual(reglas([canonico, alias({ description: '  ' })], esperados), ['alias-descripcion']);
  });

  it('un alias que no esta en la tabla, un nombre repetido y un alias de si mismo', () => {
    assert.deepEqual(reglas([canonico, alias()], {}), ['alias-sobrante']);
    assert.deepEqual(reglas([canonico, canonico], {}), ['alias-duplicado']);
    assert.deepEqual(reglas([canonico, alias({ aliasOf: 'skill-demo-viejo' })], {}).includes('alias-ciclo'), true);
  });
});

describe('F1.1 · doctor cuenta lo que el menu va a ensenar', () => {
  it('dice cuantos alias hay, cuantas filas se anuncian y no falla', () => {
    const s = arena();
    const r = spawnSync(process.execPath, [join(process.cwd(), 'bin', 'skill-compiler.mjs'), 'doctor'], {
      cwd: s.base,
      env: { ...process.env, DSH_HOME: s.base, DSH_LANG: 'es' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, `doctor no puede cerrar en fallo:\n${salida}`);
    // 15 alias sobre 31 filas del menu, con 16 canonicos: el numero es la prueba de que no se filtran.
    assert.match(salida, /15 de 31 filas del menu \(16 canonicos\)/);
    assert.match(salida, /el harness no filtra por metadatos/);
    assert.doesNotMatch(salida, /alias-destino|alias-retirada|alias-ausente/);
  });

  it('en ingles dice lo mismo, con el mismo recuento', () => {
    const s = arena();
    const r = spawnSync(process.execPath, [join(process.cwd(), 'bin', 'skill-compiler.mjs'), 'doctor'], {
      cwd: s.base,
      env: { ...process.env, DSH_HOME: s.base, DSH_LANG: 'en' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, salida);
    assert.match(salida, /15 of 31 menu rows \(16 canonical\)/);
  });
});
