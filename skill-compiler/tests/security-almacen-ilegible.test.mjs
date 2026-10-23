/**
 * `security` · un almacen que no se puede leer no puede salir en verde.
 *
 * El defecto que fija este fichero: el comando `security` leia `projects/` con un `try`/`catch` mudo
 * (`catch { proyectos = [] }`), asi que un `projects` que existe con otra forma —un FICHERO, que da
 * ENOTDIR— o una carpeta sin permiso se contaban como «0 proyectos»: la salida era
 * «0 skills revisadas en 0 proyecto(s) · cadena valida · sin bloqueos» y el exit code 0. Un lector que
 * devuelve cero por un `catch` no distingue «no hay» de «no pude leer», y esa confusion es justo la que
 * la regla del repo prohibe: ENOENT es «todavia no hay» (valido), ENOTDIR/EACCES es un fallo con motivo.
 *
 * Se mide con el BINARIO y sobre arenas deterministas (sin ACL, que una cuenta privilegiada se salta):
 * un almacen sin `projects/`, y `projects` sustituido por un fichero.
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

/** Un `$DSH_HOME` efimero propio; el almacen es `<base>/skill-compiler`. */
function arena() {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-security-'));
  ROOTS.push(base);
  return { base, root: join(base, 'skill-compiler') };
}

function security(a) {
  const r = spawnSync(process.execPath, [CLI, 'security'], {
    env: { ...process.env, DSH_HOME: a.base, DSH_LANG: 'es' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

after(() => {
  for (const base of ROOTS) rmSync(base, { recursive: true, force: true });
});

describe('security · el almacen que todavia no existe y el que no se puede leer', () => {
  it('sin la carpeta del almacen no es un fallo: no hay nada que revisar', () => {
    const a = arena();
    const { code, salida } = security(a);
    assert.equal(code, 0, salida);
    assert.match(salida, /0 skills revisadas/);
    assert.doesNotMatch(salida, /no se pudo leer/, 'un almacen ausente (ENOENT) no es un fallo de lectura');
  });

  it('un projects/ que es un FICHERO sale en rojo, con la ruta y el motivo', () => {
    const a = arena();
    mkdirSync(a.root, { recursive: true });
    writeFileSync(join(a.root, 'projects'), 'esto no es una carpeta\n');
    const { code, salida } = security(a);
    assert.equal(code, 1, `un almacen ilegible tiene que fallar:\n${salida}`);
    assert.match(salida, /no se pudo leer/, salida);
    assert.match(salida, /ENOTDIR/, 'el motivo tiene que nombrar el error real');
    assert.doesNotMatch(salida, /sin bloqueos y con el diario integro/, 'no puede cerrar como si estuviera limpio');
  });
});
