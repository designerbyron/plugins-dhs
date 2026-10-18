/**
 * Integridad de la aprobación: la decisión humana queda atada al contenido que se revisó.
 *
 * Nace de un aviso que salió en producción y que era **falso**: «el árbol que se movió no es el que se
 * validó». La comprobación medía el árbol entero, `meta.json` incluido, y `move` reescribe ese fichero a
 * propósito (`state`, `approvedAt`, `supersededPrevious`) — así que avisaba en **todas** las aprobaciones.
 * Lo que se mide ahora es el **contenido** (`SKILL.md` y su material), que es lo que la puerta valida, y la
 * comprobación se hace **antes** de mover: una divergencia aborta, no avisa.
 *
 * El contrato de «lote» de la interfaz no es un comando distinto: el panel ejecuta una aprobación por id y
 * pinta el resultado de cada una. Aquí se prueba exactamente eso: N individuales con resultado por elemento.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approveProposal, skillCommands } from '../lib/commands.mjs';
import { approve, checkProposal, projectKey, propose } from '../lib/compiler.mjs';
import { huellaDeContenido } from '../lib/security.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const clave = (s) => projectKey(s.base);
const agente = (s) => ({ session: { header: { cwd: s.base } } });

/** Una propuesta nueva con un tema propio: el veto de solapamiento compara temas, no ids. */
function otra(s, id, tema) {
  const r = propose(goodInput({
    id,
    description: `${tema} con el detalle suficiente para pasar la puerta de calidad.`,
    whenToUse: `Cuando haya que ocuparse de ${tema.toLowerCase()} y falte criterio.`,
    // Cuerpo propio y **con otro vocabulario**: el veto mide también el cuerpo, y dos textos que comparten
    // treinta líneas se parecen aunque traten de cosas distintas. Aquí la propuesta es de verdad otra.
    body: [
      '## Antes de empezar',
      '',
      `${tema}: se comprueba el estado y se anota el número del día.`,
      '',
      '## Pasos',
      '',
      `1. Abrir el registro de ${tema.toLowerCase()} y leer la última anotación.`,
      '2. Contrastar la cifra con la del sistema y apuntar la diferencia.',
      '3. Si hay diferencia, repetir la lectura antes de escribir nada.',
      '4. Cerrar con la firma de quien lo hizo y la hora.',
      '',
      '## Cuándo no aplica',
      '',
      'Si el registro no se puede leer, se para y se avisa: no se inventa la cifra.',
      '',
    ].join('\n'),
  }), {
    root: s.root,
    curated: s.curated,
    cwd: s.base,
    // Varias propuestas del mismo acto van en lote: es la vía **diseñada** para que no se vetén entre sí
    // (se avisa del parecido, no se veta). Lo que esta prueba mide es la aprobación, no el veto.
    group: { id: 'lote-de-prueba', motivo: 'Propuestas del mismo acto de prueba, para medir la aprobación una a una.' },
  });
  // El veto de solapamiento puede vetar por parecido: el mensaje tiene que decir cuál, no «undefined».
  assert.equal(r.status, 'proposed', `${id}: ${JSON.stringify(r.errors ?? r.conflicts ?? r)}`);
  return r;
}

const contenido = (dir) => Object.fromEntries(
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== 'meta.json')
    .map((e) => [e.name, createHash('sha256').update(readFileSync(join(dir, e.name))).digest('hex')]),
);

describe('aprobación · integridad del contenido', () => {
  it('1 · aprobar sin cambios no avisa, y el contenido activado es idéntico al validado', () => {
    const s = sandbox();
    const k = clave(s);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: s.base });
    const dir = join(s.root, 'projects', k, 'proposed', 'measured-decision-check');
    const antes = contenido(dir);

    const r = approveProposal({ root: s.root, key: k, id: 'measured-decision-check', scope: 'project' });
    assert.equal(r.kind, 'success', r.text);
    assert.doesNotMatch(r.text, /AVISO|no es el que se validó/, 'el aviso de huella era un falso positivo');
    assert.deepEqual(contenido(join(s.root, 'projects', k, 'approved', 'measured-decision-check')), antes);
  });

  it('2 · local aprueba en el proyecto; global publica con el MISMO contenido', () => {
    const s = sandbox();
    const k = clave(s);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: s.base });
    const dir = join(s.root, 'projects', k, 'proposed', 'measured-decision-check');
    const antes = contenido(dir);

    const local = approveProposal({ root: s.root, key: k, id: 'measured-decision-check', scope: 'project' });
    assert.equal(local.kind, 'success', local.text);
    assert.deepEqual(contenido(join(s.root, 'projects', k, 'approved', 'measured-decision-check')), antes);

    otra(s, 'cuadre-del-inventario', 'Cuadrar el inventario físico con el registrado');
    const dirB = join(s.root, 'projects', k, 'proposed', 'cuadre-del-inventario');
    const antesB = contenido(dirB);
    const global = approveProposal({ root: s.root, key: k, id: 'cuadre-del-inventario', scope: 'global' });
    assert.equal(global.kind, 'success', global.text);
    assert.deepEqual(contenido(join(s.curated, 'cuadre-del-inventario')), antesB, 'la biblioteca sirve lo validado');
    assert.equal(existsSync(join(s.root, 'projects', k, 'published', 'cuadre-del-inventario')), true);
  });

  it('3 · el «lote» es N aprobaciones individuales: cada una con su resultado', () => {
    const s = sandbox();
    const k = clave(s);
    const ids = ['cuadre-del-inventario', 'turno-de-limpieza', 'cierre-de-caja'];
    const temas = ['Cuadrar el inventario físico', 'Repartir el turno de limpieza', 'Cerrar la caja del día'];
    ids.forEach((id, i) => otra(s, id, temas[i]));

    const byName = Object.fromEntries(skillCommands({ root: s.root }).map((c) => [c.name, c]));
    const resultados = ids.map((id) => byName['skill-aprobar'].handler({ agent: agente(s), rawInput: `${id} --local` }));
    assert.deepEqual(resultados.map((r) => r.kind), ['success', 'success', 'success'], resultados.map((r) => r.text).join('\n---\n'));
    for (const r of resultados) assert.doesNotMatch(r.text, /AVISO/);
    for (const id of ids) assert.equal(existsSync(join(s.root, 'projects', k, 'approved', id, 'SKILL.md')), true);
  });

  it('4 · un elemento que falla no arrastra a los demás: éxito y error, cada uno con su motivo', () => {
    const s = sandbox();
    const k = clave(s);
    otra(s, 'cuadre-del-inventario', 'Cuadrar el inventario físico con el registrado');
    otra(s, 'turno-de-limpieza', 'Repartir el turno de limpieza del local');

    const byName = Object.fromEntries(skillCommands({ root: s.root }).map((c) => [c.name, c]));
    const buena = byName['skill-aprobar'].handler({ agent: agente(s), rawInput: 'cuadre-del-inventario --local' });
    const inexistente = byName['skill-aprobar'].handler({ agent: agente(s), rawInput: 'no-existe-esta-propuesta --local' });
    assert.equal(buena.kind, 'success');
    assert.equal(inexistente.kind, 'error');
    assert.match(inexistente.text, /No hay ninguna propuesta/);
    assert.equal(existsSync(join(s.root, 'projects', k, 'approved', 'cuadre-del-inventario')), true);
  });

  it('5 · si el contenido cambia después de validar, NO se mueve nada y se dice por qué', () => {
    const s = sandbox();
    const k = clave(s);
    otra(s, 'cuadre-del-inventario', 'Cuadrar el inventario físico con el registrado');
    const chk = checkProposal('cuadre-del-inventario', k, { root: s.root });
    const esperada = huellaDeContenido(chk.dir);

    const fichero = join(chk.dir, 'SKILL.md');
    writeFileSync(fichero, `${readFileSync(fichero, 'utf8')}\n\nUn cambio que nadie revisó.\n`);

    const movido = approve('cuadre-del-inventario', k, { root: s.root, esperada });
    assert.equal(movido.ok, false);
    assert.match(movido.reason, /el contenido cambió después de validarse/);
    assert.match(movido.reason, /no se movió nada/);
    assert.equal(existsSync(join(s.root, 'projects', k, 'approved', 'cuadre-del-inventario')), false, 'no queda activa');
    assert.equal(existsSync(fichero), true, 'sigue en propuestas, con su contenido');
  });

  it('6 · la transformación legítima del meta no cuenta como cambio de contenido (la regresión del aviso)', () => {
    const s = sandbox();
    const k = clave(s);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: s.base });
    const dir = join(s.root, 'projects', k, 'proposed', 'measured-decision-check');
    const metaAntes = readFileSync(join(dir, 'meta.json'), 'utf8');
    const contenidoAntes = contenido(dir);
    const hContenido = huellaDeContenido(dir);

    assert.equal(approve('measured-decision-check', k, { root: s.root, esperada: hContenido }).ok, true);
    const destino = join(s.root, 'projects', k, 'approved', 'measured-decision-check');
    assert.notEqual(readFileSync(join(destino, 'meta.json'), 'utf8'), metaAntes, 'el meta SÍ cambia (state/approvedAt)');
    assert.equal(huellaDeContenido(destino), hContenido, 'y el contenido es el mismo');
    assert.deepEqual(contenido(destino), contenidoAntes, 'ningún fichero de contenido difiere');
  });

  it('7 · un fallo al mover devuelve motivo, deja la propuesta intacta y no activa nada', () => {
    const s = sandbox();
    const k = clave(s);
    otra(s, 'cuadre-del-inventario', 'Cuadrar el inventario físico con el registrado');
    // La carpeta de estado `approved/` está ocupada por un FICHERO: el movimiento no puede crear su destino.
    mkdirSync(join(s.root, 'projects', k), { recursive: true });
    writeFileSync(join(s.root, 'projects', k, 'approved'), 'esto no es una carpeta');

    const r = approveProposal({ root: s.root, key: k, id: 'cuadre-del-inventario', scope: 'project' });
    assert.equal(r.kind, 'error');
    assert.match(r.text, /No se pudo aprobar|no se pudo mover/i);
    assert.equal(existsSync(join(s.root, 'projects', k, 'proposed', 'cuadre-del-inventario', 'SKILL.md')), true, 'la propuesta sigue entera');
  });

  it('8 · una skill con divergencia no queda activa: el comando lo declara fallido', () => {
    const s = sandbox();
    const k = clave(s);
    otra(s, 'cuadre-del-inventario', 'Cuadrar el inventario físico con el registrado');
    const chk = checkProposal('cuadre-del-inventario', k, { root: s.root });
    const esperada = huellaDeContenido(chk.dir);
    writeFileSync(join(chk.dir, 'references-no-existe.md'), 'ruido');
    const movido = approve('cuadre-del-inventario', k, { root: s.root, esperada });
    assert.equal(movido.ok, false);
    assert.equal(existsSync(join(s.root, 'projects', k, 'approved', 'cuadre-del-inventario')), false);
    // Y el fichero de más sigue en propuestas: nada se validó dos veces ni se movió a medias.
    assert.equal(existsSync(join(chk.dir, 'references-no-existe.md')), true);
  });
});
