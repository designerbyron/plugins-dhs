/**
 * `doctor` y el almacen que todavia no existe.
 *
 * El defecto que fija este fichero: en un almacen recien instalado —sin `projects/`, porque no hay nada
 * propuesto aun— `doctor` contaba un problema y cerraba con «con esto el plugin falla al activarse». La causa
 * no era el plugin: era la comprobacion de la capa de seguridad, que leia `projects/` sin distinguir «no hay»
 * de «no pude leer».
 *
 * Las tres arenas se construyen aqui, a mano, y se ejecuta el BINARIO: la prueba tiene que ver el veredicto
 * que lee una persona (la ultima linea de recuento y el exit code), no el de una funcion interna.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

// La prosa de este fichero se afirma en espanol: el idioma se fija explicitamente (el base es `en`).
process.env.DSH_LANG = 'es';

const ROOTS = [];
const CLI = join(process.cwd(), 'bin', 'skill-compiler.mjs');

/** Una arena con `$DSH_HOME` propio y, si se pide, la carpeta del almacen. */
function arena({ withStore = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-doctor-'));
  ROOTS.push(base);
  const root = join(base, 'skill-compiler');
  if (withStore) mkdirSync(root, { recursive: true });
  return { base, root };
}

/** Ejecuta `doctor` contra la arena y devuelve lo que de verdad se lee: salida y codigo. */
function doctor(base) {
  const r = spawnSync(process.execPath, [CLI, 'doctor'], {
    env: { ...process.env, DSH_HOME: base, DSH_LANG: 'es' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

after(() => {
  for (const base of ROOTS) rmSync(base, { recursive: true, force: true });
});

describe('doctor · el almacen que aun no tiene projects/', () => {
  it('un almacen sin projects/ (nada propuesto todavia) no es un fallo de activacion', () => {
    const s = arena();
    const { code, salida } = doctor(s.base);
    assert.equal(code, 0, `doctor no puede cerrar en fallo con un almacen vacio:\n${salida}`);
    assert.doesNotMatch(salida, /falla al activarse/, 'un almacen sin propuestas no impide activar el plugin');
    assert.doesNotMatch(salida, /no se pudo revisar/, 'no es un fallo de lectura: no hay nada que leer');
    // Y se dice por que no se reviso nada: un «0 revisadas» a secas ocultaria la causa.
    assert.match(salida, /capa de seguridad: nada que revisar todavia/);
    assert.match(salida, /projects/);
  });

  it('un almacen sin la carpeta del almacen tampoco', () => {
    const s = arena({ withStore: false });
    const { code, salida } = doctor(s.base);
    assert.equal(code, 0, salida);
    assert.match(salida, /capa de seguridad: nada que revisar todavia/);
  });

  it('con projects/ creado y vacio revisa cero skills y sigue en verde', () => {
    const s = arena();
    mkdirSync(join(s.root, 'projects'), { recursive: true });
    const { code, salida } = doctor(s.base);
    assert.equal(code, 0, salida);
    assert.match(salida, /capa de seguridad: 0 skills revisadas/);
    assert.match(salida, /todo en su sitio/);
  });

  it('un projects/ que no se puede leer SIGUE siendo un fallo, con su motivo y su remedio', () => {
    const s = arena();
    // Determinista y sin ACL: `projects` es un FICHERO, asi que listarlo da ENOTDIR. No es «no hay»: es una
    // ruta que existe, con otra forma, y ahi no se puede saber que hay.
    writeFileSync(join(s.root, 'projects'), 'esto no es una carpeta\n');
    const { code, salida } = doctor(s.base);
    assert.equal(code, 1, `un almacen ilegible tiene que fallar:\n${salida}`);
    assert.match(salida, /capa de seguridad: no se pudo leer/);
    assert.match(salida, /projects \(ENOTDIR\)|ENOTDIR/, 'la ruta y el codigo del sistema tienen que aparecer');
    assert.match(salida, /ENOTDIR|not a directory/i, 'el motivo tiene que nombrar el error real');
    assert.match(salida, /comprueba que el almacen existe y se puede leer/);
    assert.match(salida, /falla al activarse/);
  });
});
