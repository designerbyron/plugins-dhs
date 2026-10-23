/**
 * Puerta ASCII: verde sobre el repositorio, y roja en cuanto entra prosa con acentos.
 *
 * La linea base existe para poder cerrar la regla sin apagar el repo entero de golpe; lo que no puede es
 * crecer. La prueba negativa escribe un fichero con una tilde en una copia temporal y exige el fallo.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

const RAIZ = process.cwd();
const GATE = join(RAIZ, 'tools', 'ascii-gate.mjs');
const temporales = [];
after(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

const corre = (raiz) => spawnSync(process.execPath, [GATE, '--root', raiz], { encoding: 'utf8' });

describe('ASCII · el repositorio pasa', () => {
  it('sin texto nuevo fuera de ASCII', () => {
    const r = corre(RAIZ);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ASCII: en orden/);
  });
});

describe('ASCII · detecta lo que tiene que detectar', () => {
  it('una tilde nueva en un fichero controlado rompe la puerta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ascii-gate-'));
    temporales.push(dir);
    mkdirSync(join(dir, 'tools'), { recursive: true });
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'ascii-baseline.json'), JSON.stringify({ ficheros: { 'lib/commands.mjs': 0 } }), 'utf8');
    writeFileSync(join(dir, 'lib', 'commands.mjs'), "export const x = 'La configuracion se actualizó';\n", 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /FALLO ascii-nuevo · lib\/commands\.mjs/);
  });

  it('un fichero sin linea base se mide contra cero: cualquier acento es nuevo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ascii-gate-'));
    temporales.push(dir);
    mkdirSync(join(dir, 'tools'), { recursive: true });
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'ascii-baseline.json'), JSON.stringify({ ficheros: {} }), 'utf8');
    writeFileSync(join(dir, 'lib', 'audit.mjs'), 'const s = "revisión";\n', 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /lib\/audit\.mjs/);
  });

  it('el texto ASCII puro no dispara nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ascii-gate-'));
    temporales.push(dir);
    mkdirSync(join(dir, 'tools'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'ascii-baseline.json'), JSON.stringify({ ficheros: {} }), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 0, r.stdout);
  });
});
