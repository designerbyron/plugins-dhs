/**
 * Puerta ASCII: verde sobre el repositorio, y roja en cuanto entra prosa con acentos o un fichero de
 * primera parte sin clasificar.
 *
 * La linea base existe para cerrar la regla sin apagar el repo entero de golpe; lo que no puede es crecer.
 * Las pruebas negativas se siembran en una COPIA del paquete (nunca en el arbol real), y miden las cuatro
 * cosas que la puerta declara: no-ASCII nuevo, cobertura (un fichero antes no vigilado), inventario
 * (un fichero de primera parte sin clasificar) y holgura (la linea base no guarda margen ni sube un tope).
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

import { FICHEROS, auditar, cuenta, primeraParte } from '../tools/ascii-gate.mjs';

const RAIZ = process.cwd();
const GATE = join(RAIZ, 'tools', 'ascii-gate.mjs');
const temporales = [];
after(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

const corre = (raiz, extra = []) => spawnSync(process.execPath, [GATE, '--root', raiz, ...extra], { encoding: 'utf8' });

/** Copia del paquete en una caja aparte: se siembra el defecto aqui, no en el arbol real. */
function copia() {
  const base = mkdtempSync(join(tmpdir(), 'ascii-gate-'));
  temporales.push(base);
  for (const rel of ['lib', 'bin', 'tools', 'client.js', 'index.js']) {
    cpSync(join(RAIZ, rel), join(base, rel), { recursive: true });
  }
  return base;
}

/** Anade texto al final de un fichero copiado. */
function sembrarAlFinal(base, rel, texto) {
  const ruta = join(base, rel);
  writeFileSync(ruta, `${readFileSync(ruta, 'utf8')}${texto}\n`);
}

describe('ASCII · el repositorio pasa', () => {
  it('sin texto nuevo fuera de ASCII', () => {
    const r = corre(RAIZ);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ASCII: en orden/);
    const n = primeraParte(RAIZ).length;
    assert.ok(r.stdout.includes(`ASCII: cobertura ${n}/${n} ficheros de primera parte`), r.stdout);
  });

  it('vigila TODOS los ficheros de primera parte, tambien los tres que se entregaron fuera', () => {
    // El numero sale de la lista que lo gobierna, no escrito a mano: al entrar dos modulos nuevos en la
    // cobertura, un literal 24 habria puesto la prueba en rojo por un dato que la puerta ya mide sola.
    const r = corre(RAIZ, ['--json']);
    const informe = JSON.parse(r.stdout);
    const n = primeraParte(RAIZ).length;
    assert.equal(informe.ok, true, r.stdout);
    assert.equal(informe.cobertura.primeraParte, n);
    assert.equal(informe.cobertura.vigilados, n);
    assert.equal(informe.cobertura.excluidos, 0);
    for (const rel of ['lib/vendor.mjs', 'lib/catalog-signal.mjs', 'lib/review.mjs']) {
      assert.ok(FICHEROS.includes(rel), `${rel} tiene que estar vigilado`);
      assert.ok(informe.medido[rel] > 0, `${rel} medido: ${informe.medido[rel]}`);
    }
  });

  it('la linea base es EXACTA: sin holgura por fichero y sin claves de mas ni de menos', () => {
    const base = JSON.parse(readFileSync(join(RAIZ, 'tools', 'ascii-baseline.json'), 'utf8'));
    const informe = auditar(RAIZ);
    assert.equal(informe.total, informe.totalBase, 'el tope total no puede superar lo medido');
    assert.deepEqual(Object.keys(base.ficheros).sort(), [...FICHEROS].sort(), 'la linea base y la lista no son el mismo conjunto');
    for (const rel of FICHEROS) {
      assert.equal(base.ficheros[rel], cuenta(readFileSync(join(RAIZ, rel), 'utf8')), `${rel} tiene holgura en la linea base`);
    }
    assert.deepEqual(primeraParte(RAIZ), [...FICHEROS].sort(), 'hay ficheros de primera parte fuera de la lista');
  });
});

describe('ASCII · detecta lo que tiene que detectar', () => {
  it('una tilde nueva en un fichero controlado rompe la puerta', () => {
    const base = copia();
    sembrarAlFinal(base, 'lib/commands.mjs', "export const DEUDA = '\u00f3';");
    const r = corre(base);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FALLO ascii-nuevo · lib\/commands\.mjs/);
  });

  it('una tilde en un modulo que antes no estaba vigilado tambien rompe', () => {
    // Antes de esta puerta, `vendor`, `catalog-signal` y `review` estaban fuera de la lista: un acento
    // nuevo en ellos no disparaba nada. Ahora cada uno se mide contra su tope.
    for (const rel of ['lib/vendor.mjs', 'lib/catalog-signal.mjs', 'lib/review.mjs']) {
      const base = copia();
      sembrarAlFinal(base, rel, "export const DEUDA = '\u00f1';");
      const r = corre(base);
      assert.equal(r.status, 1, `${rel} no disparo:\n${r.stdout}`);
      const linea = new RegExp(`FALLO ascii-nuevo · ${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — (\\d+) caracteres no ASCII, tope (\\d+)`).exec(r.stdout);
      assert.notEqual(linea, null, `${rel} no disparo con su tope:\n${r.stdout}`);
      const topeBase = JSON.parse(readFileSync(join(RAIZ, 'tools', 'ascii-baseline.json'), 'utf8')).ficheros[rel];
      assert.equal(Number(linea[2]), topeBase, `${rel}: el tope no es el de la linea base`);
      assert.equal(Number(linea[1]), topeBase + 1, `${rel}: el defecto sembrado es UN caracter`);
    }
  });

  it('un fichero de primera parte nuevo y sin clasificar es un fallo, aunque sea ASCII puro', () => {
    const base = copia();
    writeFileSync(join(base, 'lib', 'modulo-nuevo.mjs'), "export const x = 1;\n");
    const r = corre(base);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FALLO ascii-sin-clasificar · lib\/modulo-nuevo\.mjs/);
    assert.match(r.stdout, /anadelo a FICHEROS o a EXCLUIDOS con su motivo/);
  });

  it('un fichero nuevo con acentos tampoco se cuela por no estar clasificado', () => {
    const base = copia();
    writeFileSync(join(base, 'lib', 'i18n', 'fr.mjs'), "export default { hola: 'caf\u00e9' };\n");
    const r = corre(base);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FALLO ascii-sin-clasificar · lib\/i18n\/fr\.mjs/);
  });

  it('un fichero que la linea base vigilaba y ya no existe es una puerta rota', () => {
    const base = copia();
    rmSync(join(base, 'lib', 'vendor.mjs'));
    const r = corre(base);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FALLO ascii-ausente · lib\/vendor\.mjs/);
  });

  it('excluir un fichero exige motivo; el mecanismo de exclusion no es un agujero', () => {
    const base = copia();
    writeFileSync(join(base, 'lib', 'borrador.mjs'), "export const x = 1;\n");
    const sinMotivo = auditar(base, { excluidos: [{ ruta: 'lib/borrador.mjs', motivo: 'corto' }] });
    assert.ok(sinMotivo.fallos.some((f) => f.regla === 'ascii-excluido-sin-motivo'), JSON.stringify(sinMotivo.fallos));
    const doble = auditar(base, { excluidos: [{ ruta: 'lib/commands.mjs', motivo: 'motivo suficientemente largo' }] });
    assert.ok(doble.fallos.some((f) => f.regla === 'ascii-excluido-duplicado'), JSON.stringify(doble.fallos));
    const conMotivo = auditar(base, { excluidos: [{ ruta: 'lib/borrador.mjs', motivo: 'no se entrega: es un borrador de trabajo' }] });
    assert.equal(conMotivo.cobertura.sinClasificar.length, 0);
    assert.equal(conMotivo.fallos.filter((f) => f.regla === 'ascii-sin-clasificar').length, 0);
  });

  it('--update NO sube el tope de un fichero ya vigilado', () => {
    const base = copia();
    sembrarAlFinal(base, 'lib/scope.mjs', "export const DEUDA = '\u00f3';");
    const r = corre(base, ['--update']);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FALLO ascii-tope-sube · lib\/scope\.mjs/);
    const despues = JSON.parse(readFileSync(join(base, 'tools', 'ascii-baseline.json'), 'utf8'));
    assert.equal(despues.ficheros['lib/scope.mjs'], JSON.parse(readFileSync(join(RAIZ, 'tools', 'ascii-baseline.json'), 'utf8')).ficheros['lib/scope.mjs']);
  });

  it('--update con --allow-raise lo sube a proposito y lo dice', () => {
    const base = copia();
    const antes = JSON.parse(readFileSync(join(base, 'tools', 'ascii-baseline.json'), 'utf8')).ficheros['lib/scope.mjs'];
    sembrarAlFinal(base, 'lib/scope.mjs', "export const DEUDA = '\u00f3';");
    const r = corre(base, ['--update', '--allow-raise']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /AVISO ascii-tope-sube · lib\/scope\.mjs/);
    const despues = JSON.parse(readFileSync(join(base, 'tools', 'ascii-baseline.json'), 'utf8'));
    assert.equal(despues.ficheros['lib/scope.mjs'], antes + 1);
  });

  it('--update se niega a presupuestar un arbol con ficheros sin clasificar', () => {
    const base = copia();
    writeFileSync(join(base, 'lib', 'modulo-nuevo.mjs'), "export const x = 1;\n");
    const r = corre(base, ['--update']);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /no se reescribe la linea base con ficheros de primera parte sin clasificar/);
  });

  it('el texto ASCII puro no dispara nada', () => {
    // Arbol minimo: un fichero de primera parte, ASCII, declarado en la lista que se le pasa. Ni un fallo.
    const base = mkdtempSync(join(tmpdir(), 'ascii-gate-'));
    temporales.push(base);
    mkdirSync(join(base, 'tools'), { recursive: true });
    mkdirSync(join(base, 'lib'), { recursive: true });
    writeFileSync(join(base, 'tools', 'ascii-baseline.json'), JSON.stringify({ ficheros: { 'lib/solo-ascii.mjs': 0 } }), 'utf8');
    writeFileSync(join(base, 'lib', 'solo-ascii.mjs'), "export const saludo = 'hola';\n");
    const informe = auditar(base, { vigilados: ['lib/solo-ascii.mjs'] });
    assert.equal(informe.ok, true, JSON.stringify(informe.fallos));
    assert.equal(informe.total, 0);
    assert.equal(informe.cobertura.primeraParte, 1);
    assert.equal(informe.cobertura.excluidos, 0);
  });
});
