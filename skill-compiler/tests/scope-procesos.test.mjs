#!/usr/bin/env node
/**
 * Concurrencia **entre procesos**: el cerrojo, con procesos Node separados y sincronización explícita.
 *
 * ── Lo que hay que poder demostrar ──────────────────────────────────────────────────────────────
 *
 * La prueba del cerrojo dentro de un solo proceso demuestra que el mecanismo existe; no demuestra que dos
 * procesos independientes no se pisen. Aquí se lanzan procesos de verdad (`spawn`), cada uno con su propia
 * memoria, y se coordinan **por condiciones** —ficheros marcador que el otro espera, con tiempo máximo—,
 * nunca por esperas arbitrarias: si un proceso no llega al punto acordado, la prueba falla y lo dice.
 *
 * Se comprueba: que sólo uno obtiene el cerrojo · que el que no lo obtiene **no modifica nada** · que el
 * dueño completa y libera · que una muerte con el cerrojo tomado **no** lo rompe ni deja pasar al siguiente
 * · que las skills distintas no se estorban · y que una versión base movida durante la operación se detecta
 * **antes** de publicar.
 *
 * Todo vive en cajas de arena temporales: el almacén real no se toca (`DSH_HOME` se redirige y los hijos
 * reciben la raíz explícita).
 *
 *   node --test tests/scope-procesos.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';

import { approve, projectKey, propose } from '../lib/compiler.mjs';
import { rutaDelCerrojo } from '../lib/lock.mjs';
import { declararPropiedad } from '../lib/scope.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const RAIZ_DEL_PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const ESPERA_MAXIMA = 25000;

// Los hijos importan por **URL de fichero**: en ESM un `C:\…` se leería como un esquema de URL, no como
// una ruta, y el hijo moriría al arrancar (que es exactamente lo que pasó al escribirlo con la ruta cruda).
const rutaLib = (nombre) => JSON.stringify(pathToFileURL(join(RAIZ_DEL_PLUGIN, 'lib', nombre)).href);

/** El hijo: se escribe en la caja de arena al vuelo, así no hay ficheros fixture sueltos en el repositorio. */
const HIJO = `
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conCerrojo } from ${rutaLib('lock.mjs')};
import { propose } from ${rutaLib('compiler.mjs')};
import { reparar } from ${rutaLib('repair.mjs')};
import { promover } from ${rutaLib('promote.mjs')};
import { declararPropiedad } from ${rutaLib('scope.mjs')};

const [modo, root, key, id, marcas, cwd, extra] = process.argv.slice(2);
const curada = join(root, '..', 'skills');

// Las esperas son **por condición** (el marcador existe o no): el tiempo solo es el tope.
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const esperarSync = (nombre) => {
  const fichero = join(marcas, nombre);
  const desde = Date.now();
  for (;;) {
    if (existsSync(fichero)) return true;
    if (Date.now() - desde > ${ESPERA_MAXIMA}) return false;
    dormir(25);
  }
};
const marcar = (nombre) => writeFileSync(join(marcas, nombre), String(process.pid));
const anotar = (nombre, datos) => writeFileSync(join(marcas, nombre), JSON.stringify(datos));

// El texto depende del id: dos skills distintas tienen que tener **temas distintos**, o el veto de
// solapamiento las compara entre sí (y entonces la prueba mediría el veto, no el cerrojo).
const tema = id.replace(/-/g, ' ');
const textoDe = (id, n) => ({ description: 'Procedimiento de ' + tema + ' con detalle suficiente para pasar la puerta de calidad.', whenToUse: 'Cuando haya que trabajar con ' + tema + ' y haga falta decidir con evidencia medida.', body: Array.from({ length: 10 }, (_, i) => '## Apartado de ' + tema + ' ' + i + '\\n\\n' + ('Detalle operativo de ' + tema + ' con números 42. ').repeat(30) + '\\n').join('\\n') });

if (modo === 'tomar-y-esperar') {
  const hecho = conCerrojo(root, key, id, () => {
    marcar('cerrojo-tomado');
    const visto = esperarSync('sigue'); // no suelta hasta que el padre lo diga
    return visto ? 'dueño terminó' : 'dueño se cansó de esperar';
  });
  marcar(hecho === 'dueño terminó' ? 'resultado-ok' : 'resultado-cansado');
  process.exit(hecho === 'dueño terminó' ? 0 : 3);
}

if (modo === 'tomar-y-morir') {
  conCerrojo(root, key, id, () => {
    marcar('cerrojo-tomado');
    process.exit(7); // muere DENTRO del cerrojo: no hay liberación ordenada
  });
  process.exit(0);
}

if (modo === 'proponer') {
  const r = propose({ id, ...textoDe(id), evidence: ['un gate real'] }, { root, curated: curada, cwd });
  marcar('propuesto');
  anotar('resultado-propuesta.json', { status: r.status, errors: r.errors ?? [], conflicts: (r.conflicts ?? []).map((c) => c.reason) });
  process.exit(0);
}

if (modo === 'reparar-esperar-y-promover') {
  const r = reparar(id, key, { root, curated: curada, cwd });
  marcar('propuesto');
  anotar('resultado-reparacion.json', { status: r.status, reason: r.reason ?? null });
  if (r.status !== 'proposed') process.exit(0);
  if (!esperarSync('adelante')) process.exit(4);
  const p = promover(id, key, { root, curated: curada, cwd, niveles: [2] });
  anotar('resultado-promocion.json', { status: p.status, reason: p.reason ?? null, pruebasFallidas: (p.regresion?.pruebas ?? []).filter((x) => !x.ok).map((x) => x.nombre) });
  process.exit(0);
}

if (modo === 'declarar-propiedad') {
  if (!esperarSync('adelante')) process.exit(4);
  anotar('resultado-propiedad.json', declararPropiedad(extra, { root, por: 'otro-proceso' }));
  process.exit(0);
}

writeFileSync(join(marcas, 'error.txt'), 'modo desconocido: ' + modo);
process.exit(2);
`;

/** Un hijo con su propia memoria y su propio proceso, con la caja de arena pasada explícita. */
function lanzarHijo({ marcas, root, key = KEY, id, modo, extra = '' }) {
  const script = join(marcas, `hijo-${modo}-${id}.mjs`);
  writeFileSync(script, HIJO, 'utf8');
  return spawn(process.execPath, [script, modo, root, key, id, marcas, CWD, extra], {
    env: { ...process.env, DSH_HOME: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Espera a que el hijo termine, o falla declarando lo que dijo. */
function esperarHijo(hijo, { timeout = ESPERA_MAXIMA } = {}) {
  return new Promise((listo, fallo) => {
    let salida = '';
    let errores = '';
    const reloj = setTimeout(() => { hijo.kill(); fallo(new Error(`el hijo no terminó en ${timeout} ms · stdout: ${salida} · stderr: ${errores}`)); }, timeout);
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { errores += d; });
    hijo.on('exit', (codigo) => { clearTimeout(reloj); listo({ codigo, salida, errores }); });
  });
}

/** Espera a que aparezca un marcador: la sincronización es una condición, no un tiempo. */
async function esperarMarca(marcas, nombre, { timeout = ESPERA_MAXIMA } = {}) {
  const desde = Date.now();
  const fichero = join(marcas, nombre);
  while (!existsSync(fichero)) {
    if (Date.now() - desde > timeout) throw new Error(`tiempo agotado esperando el marcador «${nombre}»`);
    await new Promise((listo) => setTimeout(listo, 20));
  }
}

const leerJson = (marcas, nombre) => JSON.parse(readFileSync(join(marcas, nombre), 'utf8'));
const marcadores = (marcas) => { mkdirSync(marcas, { recursive: true }); return marcas; };

/** La huella de un árbol: rutas y contenido. Es la prueba de «no se tocó». */
function huellaDelArbol(raiz) {
  const partes = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else partes.push(`${ruta.slice(raiz.length)}:${createHash('sha256').update(readFileSync(ruta)).digest('hex')}`);
    }
  };
  if (!existsSync(raiz) || !statSync(raiz).isDirectory()) return '(no hay)';
  recorrer(raiz);
  return createHash('sha256').update(partes.join('\n')).digest('hex');
}

/** Una skill viva en `approved/`, con un cuerpo que el motor sí puede reparar. */
function skillViva(arena, id) {
  const cuerpo = Array.from({ length: 10 }, (_, i) => `## Parte ${i}\n\n${'Detalle operativo con números 42. '.repeat(30)}\n`).join('\n');
  const r = propose({
    id,
    description: 'Una skill de prueba con descripción suficiente para pasar la puerta de calidad.',
    whenToUse: 'Cuando haga falta medir qué pasa con dos procesos sobre el mismo id.',
    body: cuerpo,
    evidence: ['un gate real'],
  }, { root: arena.root, curated: arena.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', r.errors?.[0] ?? r.reason ?? '');
  const movido = approve(id, KEY, { root: arena.root, curated: arena.curated });
  assert.equal(movido.ok, true);
  return join(arena.root, 'projects', KEY, 'approved', id);
}

describe('dos procesos sobre la misma skill: sólo uno escribe', () => {
  it('el que no obtiene el cerrojo NO modifica nada, y el dueño completa y libera', async () => {
    const s = sandbox();
    const marcas = marcadores(join(s.base, 'marcas'));
    // El id está libre a propósito: así el competidor pasa la puerta de entrada y llega **al cerrojo**, que es
    // el recurso en disputa. (Con un id que ya vive aquí, la puerta lo pararía antes por otro motivo y la
    // prueba mediría otra cosa.)
    const dueño = lanzarHijo({ marcas, root: s.root, id: 'medida-en-disputa', modo: 'tomar-y-esperar' });
    await esperarMarca(marcas, 'cerrojo-tomado'); // el cerrojo está tomado: desde aquí se compite de verdad

    const antes = huellaDelArbol(join(s.root, 'projects'));
    const competidor = lanzarHijo({ marcas, root: s.root, id: 'medida-en-disputa', modo: 'proponer' });
    const salidaCompetidor = await esperarHijo(competidor);
    const intento = leerJson(marcas, 'resultado-propuesta.json');

    assert.equal(salidaCompetidor.codigo, 0, salidaCompetidor.errores);
    assert.equal(intento.status, 'invalid', 'el que llega segundo no propone');
    assert.match(intento.errors[0], /ya hay una operación en curso sobre medida-en-disputa/);
    assert.equal(huellaDelArbol(join(s.root, 'projects')), antes, 'el que no obtiene el cerrojo no toca el almacén');

    // El dueño suelta cuando el padre se lo dice, y lo deja libre.
    writeFileSync(join(marcas, 'sigue'), 'adelante');
    const salidaDueño = await esperarHijo(dueño);
    assert.equal(salidaDueño.codigo, 0, salidaDueño.errores);
    assert.equal(existsSync(join(marcas, 'resultado-ok')), true, 'el dueño completó su sección crítica');
    assert.equal(existsSync(rutaDelCerrojo(s.root, KEY, 'medida-en-disputa')), false, 'y lo liberó');

    // Con el cerrojo libre, otro proceso con otro id entra sin problema: el rechazo era por el cerrojo.
    const despues = lanzarHijo({ marcas, root: s.root, id: 'medida-sin-disputa', modo: 'proponer' });
    await esperarHijo(despues);
    assert.equal(leerJson(marcas, 'resultado-propuesta.json').status, 'proposed');
  });

  it('una muerte con el cerrojo tomado NO se rompe sola: el siguiente se para y lo declara', async () => {
    const s = sandbox();
    const marcas = marcadores(join(s.base, 'marcas'));
    const rutaCerrojo = rutaDelCerrojo(s.root, KEY, 'medida-huerfana');

    const muerto = lanzarHijo({ marcas, root: s.root, id: 'medida-huerfana', modo: 'tomar-y-morir' });
    await esperarMarca(marcas, 'cerrojo-tomado');
    const salidaMuerto = await esperarHijo(muerto);
    assert.notEqual(salidaMuerto.codigo, 0, 'el hijo murió con el cerrojo tomado');
    assert.equal(existsSync(rutaCerrojo), true, 'el cerrojo queda: una muerte no lo borra');

    const antes = huellaDelArbol(join(s.root, 'projects'));
    const siguiente = lanzarHijo({ marcas, root: s.root, id: 'medida-huerfana', modo: 'proponer' });
    await esperarHijo(siguiente);
    const intento = leerJson(marcas, 'resultado-propuesta.json');
    assert.equal(intento.status, 'invalid');
    assert.match(intento.errors[0], /el motor no rompe cerrojos/, 'y dice qué hacer con él');
    assert.equal(existsSync(rutaCerrojo), true, 'el cerrojo del que murió sigue ahí: no lo rompe nadie');
    assert.equal(huellaDelArbol(join(s.root, 'projects')), antes);

    // Recuperarlo es una decisión humana: se retira a mano y entonces sí entra.
    rmSync(rutaCerrojo, { force: true });
    const despues = lanzarHijo({ marcas, root: s.root, id: 'medida-huerfana', modo: 'proponer' });
    await esperarHijo(despues);
    assert.equal(leerJson(marcas, 'resultado-propuesta.json').status, 'proposed');
  });

  it('dos skills distintas no se estorban: cada proceso entra con su propio cerrojo', async () => {
    const s = sandbox();
    const marcasA = marcadores(join(s.base, 'marcas-a'));
    const marcasB = marcadores(join(s.base, 'marcas-b'));

    const a = lanzarHijo({ marcas: marcasA, root: s.root, id: 'medida-uno', modo: 'proponer' });
    const b = lanzarHijo({ marcas: marcasB, root: s.root, id: 'medida-dos', modo: 'proponer' });
    const [ra, rb] = await Promise.all([esperarHijo(a), esperarHijo(b)]);
    assert.equal(ra.codigo, 0, ra.errores);
    assert.equal(rb.codigo, 0, rb.errores);
    assert.equal(leerJson(marcasA, 'resultado-propuesta.json').status, 'proposed');
    assert.equal(leerJson(marcasB, 'resultado-propuesta.json').status, 'proposed');
    assert.deepEqual(readdirSync(join(s.root, 'projects', KEY, 'proposed')).sort(), ['medida-dos', 'medida-uno'], 'las dos, y ninguna pisó a la otra');
    assert.deepEqual(existsSync(join(s.root, 'locks')) ? readdirSync(join(s.root, 'locks')) : [], [], 'sin cerrojos colgando');
  });
});

describe('la versión base se mueve durante la operación: se detecta ANTES de publicar', () => {
  it('promover se niega si la skill viva cambió mientras la propuesta estaba preparada', async () => {
    const s = sandbox();
    const marcas = marcadores(join(s.base, 'marcas'));
    const dir = skillViva(s, 'medida-movida');

    // Un proceso prepara la reparación sobre la versión viva de ahora, y espera.
    const hijo = lanzarHijo({ marcas, root: s.root, id: 'medida-movida', modo: 'reparar-esperar-y-promover' });
    await esperarMarca(marcas, 'propuesto');
    const preparada = leerJson(marcas, 'resultado-reparacion.json');
    assert.equal(preparada.status, 'proposed', preparada.reason ?? '');

    // Mientras espera, OTRO proceso mueve la base: la skill viva cambia de contenido.
    const fichero = join(dir, 'SKILL.md');
    const original = readFileSync(fichero, 'utf8');
    writeFileSync(fichero, `${original}\n\n## Añadido por el otro proceso\n\nEsto mueve la huella de la base.\n`, 'utf8');

    writeFileSync(join(marcas, 'adelante'), 'sigue');
    const salida = await esperarHijo(hijo);
    const resultado = leerJson(marcas, 'resultado-promocion.json');

    assert.equal(salida.codigo, 0, salida.errores);
    assert.equal(resultado.status, 'regression', 'la regresión para la promoción, y el estado lo dice');
    assert.equal(resultado.pruebasFallidas.includes('base-vigente'), true, 'la prueba que falla es la de la base');
    assert.match(resultado.reason ?? '', /base-vigente/, 'y el motivo nombra la prueba que lo detectó');
    // Y la versión que movió el otro proceso sigue intacta: nadie la pisó.
    assert.match(readFileSync(fichero, 'utf8'), /Añadido por el otro proceso/);
  });

  it('una declaración escrita por otro proceso llega entera, y el CAS impide pisarla con una huella vieja', async () => {
    const s = sandbox();
    const marcas = marcadores(join(s.base, 'marcas'));
    declararPropiedad('dsh-only', { root: s.root, por: 'primero', now: '2026-10-16T00:00:00.000Z' });

    const hijo = lanzarHijo({ marcas, root: s.root, id: 'cualquiera', modo: 'declarar-propiedad', extra: 'machine' });
    writeFileSync(join(marcas, 'adelante'), 'sigue');
    await esperarHijo(hijo);
    assert.equal(leerJson(marcas, 'resultado-propiedad.json').ok, true);
    const escrita = JSON.parse(readFileSync(join(s.root, 'ownership.json'), 'utf8'));
    assert.equal(escrita.ownership, 'machine');
    assert.equal(typeof escrita.declaredAt, 'string', 'la declaración escrita por otro proceso está entera, no a medias');

    const negada = declararPropiedad('dsh-only', { root: s.root, por: 'tarde', esperadaHuella: 'huella-vieja' });
    assert.equal(negada.status, 'concurrente', 'una huella vieja no pisa la respuesta del otro proceso');
    assert.equal(JSON.parse(readFileSync(join(s.root, 'ownership.json'), 'utf8')).ownership, 'machine');
  });
});
