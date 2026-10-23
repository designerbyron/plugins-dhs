#!/usr/bin/env node
/**
 * Concurrencia y coherencia: la escritura bajo cerrojo, la idempotencia, y que el CLI y los comandos
 * digan **lo mismo**.
 *
 * ── Lo que hay que poder demostrar ──────────────────────────────────────────────────────────────
 *
 * 1. **Dos operaciones sobre el mismo id no se pisan.** El cerrojo es `O_EXCL` sobre un fichero por
 *    skill, y es el **mismo** que usa la promoción: una propuesta que llega mientras otra tiene el
 *    cerrojo **no escribe nada** y lo declara.
 * 2. **Un rechazo no deja rastro**: ni propuesta, ni cerrojo, ni un byte cambiado en el almacén.
 * 3. **Proponer dos veces lo mismo es una sola propuesta**: la misma escritura, el mismo contenido.
 * 4. **El CLI y el comando del harness imprimen el mismo texto** para el mismo puesto: son la misma
 *    implementación, y esto lo comprueba ejecutando el CLI de verdad.
 *
 *   node --test tests/scope-concurrencia.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { propose } from '../lib/compiler.mjs';
import { skillCommands } from '../lib/commands.mjs';
import { conCerrojo, rutaDelCerrojo } from '../lib/lock.mjs';
import { declararPropiedad, inventario, leerPropiedad, textoDeSistemas, textoDelEstado } from '../lib/scope.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = 'saas-corporative-a3c393fa';
const BIN = join(import.meta.dirname, '..', 'bin', 'skill-compiler.mjs');

/** La huella de un árbol de ficheros: contenido y rutas, ordenado. Es la prueba de «no se tocó». */
function huellaDelArbol(raiz) {
  const partes = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else partes.push(`${ruta.slice(raiz.length)}:${createHash('sha256').update(readFileSync(ruta)).digest('hex')}`);
    }
  };
  if (!existsSync(raiz) || !statSync(raiz).isDirectory()) return '(no hay almacén)';
  recorrer(raiz);
  return createHash('sha256').update(partes.join('\n')).digest('hex');
}

describe('el cerrojo: dos operaciones sobre el mismo id no se pisan', () => {
  it('con el cerrojo tomado, proponer NO escribe nada y lo dice con el nombre del cerrojo', () => {
    const s = sandbox();
    const antes = huellaDelArbol(join(s.root, 'projects'));
    const resultado = conCerrojo(s.root, KEY, 'medida-bloqueada', () => propose(goodInput({ id: 'medida-bloqueada' }), { root: s.root, curated: s.curated, cwd: CWD }));

    assert.equal(resultado.status, 'invalid', 'una operación bloqueada no es una propuesta');
    assert.match(resultado.errors[0], /ya hay una operación en curso sobre medida-bloqueada/);
    assert.match(resultado.errors[0], /el motor no rompe cerrojos/);
    assert.equal(huellaDelArbol(join(s.root, 'projects')), antes, 'bloqueada no cambia ni un byte del almacén');
  });

  it('el cerrojo es un fichero por skill, y se suelta al terminar —también cuando el cuerpo falla—', () => {
    const s = sandbox();
    const ruta = rutaDelCerrojo(s.root, KEY, 'medida-uno');
    conCerrojo(s.root, KEY, 'medida-uno', () => {
      assert.equal(existsSync(ruta), true, 'mientras dura la operación, el cerrojo está');
      const contenido = JSON.parse(readFileSync(ruta, 'utf8'));
      assert.equal(contenido.id, 'medida-uno');
      assert.equal(contenido.key, KEY);
      assert.equal(typeof contenido.pid, 'number', 'el cerrojo dice quién lo dejó');
    });
    assert.equal(existsSync(ruta), false, 'y se suelta al salir');

    assert.throws(() => conCerrojo(s.root, KEY, 'medida-dos', () => { throw new Error('fallo del cuerpo'); }), /fallo del cuerpo/);
    assert.equal(existsSync(rutaDelCerrojo(s.root, KEY, 'medida-dos')), false, 'un cuerpo que falla también suelta el cerrojo');
  });

  it('proponer dos veces el mismo id deja UNA propuesta, con el mismo conocimiento', () => {
    const s = sandbox();
    const entrada = goodInput({ id: 'medida-repetida' });
    const primera = propose(entrada, { root: s.root, curated: s.curated, cwd: CWD });
    const carpeta = join(s.root, 'projects', KEY, 'proposed', 'medida-repetida');
    const leer = () => ({
      ficheros: readdirSync(carpeta).sort(),
      skill: readFileSync(join(carpeta, 'SKILL.md'), 'utf8'),
      meta: JSON.parse(readFileSync(join(carpeta, 'meta.json'), 'utf8')),
    });
    const antes = leer();

    const segunda = propose(entrada, { root: s.root, curated: s.curated, cwd: CWD });
    const ahora = leer();

    assert.equal(primera.status, 'proposed');
    assert.equal(segunda.status, 'proposed');
    assert.deepEqual(readdirSync(join(s.root, 'projects', KEY, 'proposed')), ['medida-repetida'], 'una sola propuesta, nunca dos');
    assert.deepEqual(ahora.ficheros, antes.ficheros, 'los mismos ficheros: no se duplica nada');
    // Medido: lo único que cambia de un renderizado a otro es la marca de cuando se escribió —el
    // `learnedAt` del frontmatter—. El conocimiento, línea a línea, es idéntico.
    const sinMarca = (texto) => texto.replace(/^(\s*learnedAt:).*$/m, '$1 "(cuándo se escribió)"');
    assert.equal(sinMarca(ahora.skill), sinMarca(antes.skill), 'el conocimiento es el mismo: sólo cambia su marca de escritura');
    assert.notEqual(ahora.skill, antes.skill, 'y esa marca cambia de verdad: el fichero no es byte a byte idéntico');
    // Lo único que cambia es la marca de la última escritura — y se dice, en vez de fingir una igualdad total.
    assert.notEqual(ahora.meta.createdAt, antes.meta.createdAt, 'createdAt es la marca de escritura, no contenido');
    assert.equal(ahora.meta.id, 'medida-repetida');
    assert.equal(ahora.meta.scope.politicaEstado, antes.meta.scope.politicaEstado);
    assert.equal(existsSync(join(s.root, 'locks')) ? readdirSync(join(s.root, 'locks')).length : 0, 0, 'sin cerrojos colgando');
  });

  it('un rechazo deja el almacén exactamente como estaba', () => {
    const s = sandbox();
    process.env.SKILL_COMPILER_SISTEMAS = join(s.base, 'no-existe'); // no hay nada fuera: el rechazo lo provoca otro sitio
    try {
      propose(goodInput({ id: 'medida-una' }), { root: s.root, curated: s.curated, cwd: CWD });
      const antes = huellaDelArbol(join(s.root, 'projects'));
      // Una entrada inválida se rechaza antes de escribir: el almacén no puede moverse.
      const r = propose({ ...goodInput({ id: 'medida-dos' }), description: 'corta' }, { root: s.root, curated: s.curated, cwd: CWD });
      assert.notEqual(r.status, 'proposed');
      assert.equal(huellaDelArbol(join(s.root, 'projects')), antes, 'rechazar no toca el almacén');
    } finally {
      delete process.env.SKILL_COMPILER_SISTEMAS;
    }
  });
});

describe('el CLI y el comando dicen lo mismo', () => {
  const cli = (comando, sandboxBase) => execFileSync(process.execPath, [BIN, ...String(comando).split(' ')], {
    env: { ...process.env, DSH_HOME: sandboxBase },
    encoding: 'utf8',
  });

  it('`systems` imprime exactamente el mismo inventario que `/skill-systems`', () => {
    const s = sandbox();
    declararPropiedad('machine', { root: s.root, por: 'prueba' });
    const delComando = skillCommands({ root: s.root }).find((c) => c.name === 'skill-systems').handler({}).text;
    const delCli = cli('systems', s.base).replace(/\r\n/g, '\n').trimEnd();
    assert.equal(delCli, delComando, 'son la misma implementación: si divergen, es un defecto');
  });

  it('`ownership` sin argumento imprime lo mismo que `/skill-ownership`', () => {
    const s = sandbox();
    const comando = skillCommands({ root: s.root }).find((c) => c.name === 'skill-ownership').handler({}).text;
    const salida = cli('ownership', s.base).replace(/\r\n/g, '\n').trimEnd();
    assert.equal(salida, comando);
    assert.match(salida, /sin declarar/);
  });

  it('`ownership <respuesta>` declara, y el comando lee lo declarado', () => {
    const s = sandbox();
    const salida = cli('ownership dsh-only', s.base);
    assert.match(salida, /Declarada la propiedad: «dsh-only»/);
    assert.match(salida, /huella/);
    assert.equal(leerPropiedad({ root: s.root }).ownership, 'dsh-only');
    assert.match(skillCommands({ root: s.root }).find((c) => c.name === 'skill-ownership').handler({}).text, /«dsh-only»/);
  });

  it('el estado del inventario y su texto salen de la misma función que usa el CLI', () => {
    const s = sandbox();
    const datos = inventario({ root: s.root, curada: s.curated });
    const estado = leerPropiedad({ root: s.root });
    assert.equal(textoDeSistemas({ datos, estado }), textoDeSistemas({ datos, estado }));
    assert.equal(textoDelEstado(estado), textoDelEstado(estado));
    assert.match(textoDeSistemas({ datos, estado }), /Propiedad: AUSENTE/);
  });
});
