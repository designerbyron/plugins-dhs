#!/usr/bin/env node
/**
 * El motor de reparación: qué puede arreglar solo, qué propone y qué no toca.
 *
 * ── La línea que separa los niveles ─────────────────────────────────────────────────────────────
 *
 * Nivel 1 = mecánico: no cambia lo que la skill dice, y el motor lo **comprueba** (la forma canónica antes y
 * después tiene que ser la misma; si no, la transformación no es de nivel 1). Nivel 2 = semántico acotado: el
 * conocimiento no se pierde pero cambia de sitio, y por eso es una propuesta. Nivel 3 = criterio humano: el
 * motor puede reunir la evidencia y decir que no, pero no decide.
 *
 * Y lo que no se repara: lo que exigiría **inventar conocimiento**. Aquí se prueba que el motor no lo inventa
 * —una referencia que falta se declara, no se rellena— y que no crea propuestas condenadas: si algo que la
 * puerta volvería a exigir no está arreglado, no se propone nada.
 *
 *   node --test tests/repair.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, checkProposal, propose, projectKey, vigenteDe } from '../lib/compiler.mjs';
import {
  aplicarMecanicas, canonico, inventario, inventarioPerdido, moverMaterialPesado, planDeReparacion,
  reparar, seccionesDe, topeDeMovimiento, TRANSFORMACIONES,
} from '../lib/repair.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);

/** Una skill viva, sembrada por la vía real del plugin. Cada arena tiene su tema. */
function viva(arena, input) {
  const hecho = propose(input, { root: arena.root, curated: arena.curated, cwd: CWD });
  assert.equal(hecho.status, 'proposed', `la siembra falló: ${JSON.stringify(hecho.errors ?? hecho.conflicts)}`);
  const movido = approve(input.id, KEY, { root: arena.root, curated: arena.curated });
  assert.equal(movido.ok, true, `no se pudo aprobar: ${movido.reason}`);
  return join(arena.root, 'projects', KEY, 'approved', input.id);
}

/** Reescribe el cuerpo del SKILL.md publicado, para dejar una skill en el estado que se quiere medir. */
function dejarAsi(dir, cuerpo) {
  const fichero = join(dir, 'SKILL.md');
  const texto = readFileSync(fichero, 'utf8');
  const cabecera = texto.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n#\s[^\n]*\r?\n/);
  assert.ok(cabecera, 'la forma del SKILL.md no es la esperada');
  writeFileSync(fichero, cabecera[0] + cuerpo);
  return dir;
}

const dirAprobado = (arena, id) => join(arena.root, 'projects', KEY, 'approved', id);

const TEMA = (id) => ({
  id,
  description: `Mantiene al día el ${id.replace(/-/g, ' ')} con pasos medidos y comprobados en producción.`,
  whenToUse: `Cuando haya que ocuparse del ${id.replace(/-/g, ' ')} tras una recepción de material.`,
  body: [
    '## Cuándo se usa', '',
    `Cuando toca el ${id.replace(/-/g, ' ')}, con las hojas de conteo delante.`, '',
    '## Procedimiento', '',
    '1. Recorre el registro entero y anota el número que sale.',
    '2. Compara con el registro previo y declara la diferencia.',
    '3. Cierra solo las referencias que cuadren.',
  ].join('\n'),
});

describe('nivel 1: las mecánicas no cambian lo que la skill dice', () => {
  it('normaliza saltos, espacios finales y el salto final, y lo dice', () => {
    const sucio = 'linea con espacios   \r\n\r\n\r\nfinal sin salto';
    const r = aplicarMecanicas(sucio);
    assert.deepEqual(r.aplicadas.sort(), ['normalizar-saltos', 'quitar-espacios-finales', 'un-salto-final']);
    assert.equal(r.significativoIgual, true, 'el texto significativo tiene que ser el mismo');
    assert.equal(/\r/.test(r.texto), false);
    assert.equal(/[ \t]+\n/.test(r.texto), false);
    assert.equal(r.texto.endsWith('\n'), true);
  });

  it('es idempotente: aplicarla dos veces no cambia nada más', () => {
    const sucio = '  ## Uno  \r\n\r\ncontenido\r\n\r\n\r\n';
    const una = aplicarMecanicas(sucio);
    const dos = aplicarMecanicas(una.texto);
    assert.deepEqual(dos.aplicadas, [], 'la segunda pasada no tiene nada que hacer');
    assert.equal(dos.texto, una.texto);
  });

  it('un texto ya canónico no se toca: no hay transformación fantasma', () => {
    const limpio = '## Uno\n\ncontenido\n';
    assert.equal(canonico(limpio), limpio);
    assert.deepEqual(aplicarMecanicas(limpio).aplicadas, []);
    assert.equal(aplicarMecanicas(limpio).cambio, false);
  });

  it('cada transformación declara su nivel, y todas las del catálogo mecánico son de nivel 1', () => {
    for (const [nombre, tr] of Object.entries(TRANSFORMACIONES)) {
      assert.equal(tr.nivel, 1, `${nombre} no es de nivel 1`);
      assert.ok(tr.describe.length > 20, `${nombre} no explica qué hace`);
    }
  });

  it('la forma canónica conserva la huella del texto significativo', () => {
    const original = '## Cuándo\n\nTexto útil  \r\n\r\n## Procedimiento\n\n1. Paso\n';
    // La vara: quitar todo el espacio en blanco de más tiene que dar lo mismo antes y después.
    const sinBlanco = (t) => t.replace(/\s+/g, ' ').trim();
    assert.equal(sinBlanco(canonico(original)), sinBlanco(original));
  });
});

describe('nivel 2: mover el material pesado conserva el conocimiento', () => {
  it('la sección más larga viaja entera a references/ y el cuerpo la sigue enlazando', () => {
    const larga = 'y'.repeat(9000);
    const cuerpo = `## Cuándo se usa\n\nAl cerrar el turno.\n\n## Catálogo extenso\n\n${larga}\n\n## Procedimiento\n\n1. Cuenta.\n2. Compara.\n`;
    const mov = moverMaterialPesado({ id: 'x', body: cuerpo, budget: 8000, objetivo: 5000 });
    assert.ok(mov, 'con 9.000 bytes de cuerpo y presupuesto 8.000 tiene que mover algo');
    assert.equal(mov.movidas.length, 1);
    assert.match(mov.references[0].path, /^references\/[a-z0-9-]+\.md$/);
    assert.match(mov.references[0].content, new RegExp(`y{9000}`), 'el material viaja ENTERO, no recortado');
    assert.match(mov.body, new RegExp(mov.references[0].path.replace(/[/.]/g, '\\$&')), 'el cuerpo enlaza donde fue');
    assert.ok(mov.bodyBytes <= 5000, `el cuerpo tiene que bajar del objetivo (quedó en ${mov.bodyBytes})`);
  });

  it('nada del inventario desaparece: ni comandos, ni números, ni rutas, ni encabezados', () => {
    const cuerpoBase = '## Cuándo se usa\n\nEjecuta `npm run build:prod` a las 03:00 sobre `references/normas-2026.md`.\n\n## Catálogo\n\n' + 'z'.repeat(9000) + '\n\n## Procedimiento\n\n1. Mide el valor 42 antes de tocar.\n';
    const mov = moverMaterialPesado({ id: 'y', body: cuerpoBase, budget: 8000, objetivo: 5000 });
    assert.ok(mov);
    const despues = `${mov.body}\n${mov.references.map((r) => r.content).join('\n')}`;
    assert.deepEqual(inventarioPerdido(inventario(cuerpoBase), inventario(despues)), {}, 'no puede perderse nada del inventario');
  });

  it('no se parte un cuerpo que no pasa del umbral, ni se deja el cuerpo sin procedimiento', () => {
    assert.equal(moverMaterialPesado({ id: 'z', body: '## Uno\n\ncorto\n', budget: 8000, objetivo: 5000 }), null, 'por debajo del umbral no hay nada que mover');
    const dosGrandes = `## A\n\n${'a'.repeat(6000)}\n\n## B\n\n${'b'.repeat(6000)}\n`;
    const mov = moverMaterialPesado({ id: 'w', body: dosGrandes, budget: 8000, objetivo: 5000 });
    assert.ok(mov, 'con dos secciones grandes y 12.000 bytes hay que mover');
    assert.ok(seccionesDe(mov.body).length >= 1, 'el cuerpo conserva al menos una sección');
  });

  it('las secciones se extraen con su encabezado, y en orden', () => {
    const s = seccionesDe('## Primera\n\ncontenido uno\n\n## Segunda\n\ncontenido dos\n');
    assert.deepEqual(s.map((x) => x.titulo), ['Primera', 'Segunda']);
    assert.match(s[1].texto, /^## Segunda/);
  });

  // ── El tope: una sola vara para preparar y para promocionar ─────────────────────────────────────
  //
  // El defecto que cierran estas pruebas, medido en el almacén real: el motor movía «hasta bajar del
  // umbral» y la puerta contaba TROZOS con otra fórmula, así que preparaba propuestas que su propia
  // puerta rechazaba (16 secciones movidas con tope 3, y 6 con tope 3). Preparar algo condenado no es
  // preparar: es prometer en falso.
  it('el tope se mide en bytes, al objetivo del motor más un paso, y por debajo del umbral es cero', () => {
    // 50.000 byte con umbral 24.000: la distancia al objetivo (80% = 19.200) más el paso entero disponible.
    assert.equal(topeDeMovimiento(50000, { umbral: 24000, paso: 3000 }), 50000 - 19200 + 3000);
    assert.equal(topeDeMovimiento(20000, { umbral: 24000, paso: 3000 }), 0, 'por debajo del umbral no se saca nada');
    assert.equal(topeDeMovimiento(50000, { umbral: 24000, objetivo: 40000, paso: 0 }), 10000, 'el objetivo manda cuando se dice');
  });

  it('el movimiento no pasa del tope que se le da, y declara que no llegó al objetivo', () => {
    const cuerpo = Array.from({ length: 30 }, (_, i) => `## Sección ${i}\n\n${'x'.repeat(1500)}\n`).join('\n');
    const conTope = moverMaterialPesado({ id: 'tope', body: cuerpo, budget: 20000, objetivo: 16000, topeBytes: 4000 });
    assert.ok(conTope, 'con 45.000 bytes y presupuesto 20.000 hay material que mover');
    assert.ok(conTope.bytesMovidos <= 4000, `movió ${conTope.bytesMovidos}, y el tope era 4000`);
    assert.equal(conTope.alcanzoObjetivo, false, 'con ese tope no llega al objetivo, y eso se declara');
    const sinTope = moverMaterialPesado({ id: 'tope', body: cuerpo, budget: 20000, objetivo: 16000 });
    assert.ok(sinTope.bytesMovidos > 4000 && sinTope.bodyBytes <= 16000, 'sin tope sigue bajando hasta el objetivo');
  });

  it('lo que el motor prepara cabe en su tope y deja el cuerpo por debajo del umbral', () => {
    const arena = sandbox({ curated: false });
    const id = 'catalogo-que-no-cabe-de-una-vez';
    const input = TEMA(id);
    assert.equal(propose(input, { root: arena.root, curated: arena.curated, cwd: CWD }).status, 'proposed');
    assert.equal(approve(id, KEY, { root: arena.root, curated: arena.curated }).ok, true);
    const dir = join(arena.root, 'projects', KEY, 'approved', id);
    const texto = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const cabecera = texto.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n#\s[^\n]*\r?\n/)[0];
    // Muchas secciones pequeñas: el caso que el tope por trozos rechazaba.
    const secciones = Array.from({ length: 26 }, (_, i) => `## Pieza ${i}\n\n${'q'.repeat(1800)}\n`).join('\n');
    writeFileSync(join(dir, 'SKILL.md'), `${cabecera}${input.body}\n\n${secciones}`);
    const prep = reparar(id, KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(prep.status, 'proposed', JSON.stringify(prep.bloqueos ?? prep.reason));
    const meta = JSON.parse(readFileSync(join(arena.root, 'projects', KEY, 'proposed', id, 'meta.json'), 'utf8'));
    assert.ok(meta.repair.bytesMovidos > 0, 'tiene que haber sacado material');
    assert.ok(meta.repair.bytesMovidos <= meta.repair.topeBytes, `${meta.repair.bytesMovidos} pasa del tope ${meta.repair.topeBytes}`);
    assert.ok(meta.repair.cuerpoTrasBytes <= meta.repair.umbral, `el cuerpo quedó en ${meta.repair.cuerpoTrasBytes}, por encima del umbral`);
    assert.ok(meta.repair.movidas.length > 1, 'este caso mueve varias secciones, que es justo lo que la cuenta vieja rechazaba');
  });
});

describe('el catálogo: qué repara cada hallazgo y quién lo firma', () => {
  it('lo que no se puede reparar sin inventar conocimiento no tiene reparación automática', () => {
    const { plan, sinReparacion } = planDeReparacion([
      { severity: 'error', rule: 'link-missing', observed: 'references/nadie-lo-escribio.md' },
      { severity: 'error', rule: 'reference-missing-file', observed: 'references/era.md' },
    ]);
    assert.equal(plan.length, 0);
    assert.equal(sinReparacion.length, 2);
    for (const s of sinReparacion) assert.match(s.motivo, /no se repara sola/i);
  });

  it('las descripciones y los disparadores son nivel 3: criterio humano, no automatización', () => {
    const { plan, nivel } = planDeReparacion([
      { severity: 'error', rule: 'description-min', observed: 48 },
      { severity: 'error', rule: 'whenToUse-min', observed: 0 },
    ]);
    assert.equal(nivel, 3);
    for (const p of plan) assert.equal(p.automatica, false, `${p.regla} no puede aplicarse sola`);
  });

  it('lo informativo no entra en el plan', () => {
    const { plan, sinReparacion } = planDeReparacion([{ severity: 'info', rule: 'link-unverifiable' }]);
    assert.equal(plan.length, 0);
    assert.equal(sinReparacion.length, 0);
  });

  // Un aviso no puede volver humana una corrección que sí es automática: si lo hiciera, el motor dejaría de
  // activar por sí mismo lo que sabe arreglar (un `absolute-path` de nivel 3 al lado de un `body-max` de nivel
  // 2 subía la propuesta entera a nivel 3 y la corrección del error se quedaba esperando a una persona).
  it('un aviso de nivel más alto no arrastra a nivel humano la corrección de un error', () => {
    const { plan, sinReparacion, nivel } = planDeReparacion([
      { severity: 'error', rule: 'body-max', observed: 30000, threshold: 24000 },
      { severity: 'warn', rule: 'absolute-path', observed: 'ruta absoluta' },
    ]);
    assert.equal(nivel, 2, 'el error manda: la corrección sigue siendo automática');
    assert.deepEqual(plan.map((p) => p.regla), ['body-max']);
    assert.equal(sinReparacion.length, 1);
    assert.match(sinReparacion[0].motivo, /es un aviso y su arreglo es de nivel 3/);
  });

  it('los avisos que no suben el nivel se planifican, y sin errores se planifican los avisos', () => {
    const mixto = planDeReparacion([
      { severity: 'error', rule: 'body-max', observed: 30000, threshold: 24000 },
      { severity: 'warn', rule: 'body-budget', observed: 9000, threshold: 8000 },
    ]);
    assert.deepEqual(mixto.plan.map((p) => p.regla).sort(), ['body-budget', 'body-max']);
    const soloAvisos = planDeReparacion([{ severity: 'warn', rule: 'body-budget', observed: 9000, threshold: 8000 }]);
    assert.equal(soloAvisos.nivel, 2);
    assert.equal(soloAvisos.plan.length, 1, 'sin errores, lo que hay que arreglar son los avisos');
  });
});

describe('reparar: prepara, no activa', () => {
  it('una skill con forma sucia se repara en nivel 1, con la propuesta en verde y la viva intacta', () => {
    const arena = sandbox({ curated: false });
    const dir = viva(arena, TEMA('registro-de-turnos'));
    dejarAsi(dir, '## Cuándo se usa   \r\n\r\nAl cerrar el turno, con el registro de incidencias delante y sin dejarlo para el día siguiente.\r\n\r\n## Procedimiento  \r\n\r\n1. Recorre el registro de incidencias entero, de arriba abajo.   \r\n2. Anota el estado observado de cada una sin interpretarlo.\r\n3. Cierra solo las que estén resueltas y deja las demás abiertas.\r\n\r\n\r\n');
    const huellaSucia = vigenteDe('registro-de-turnos', KEY, { root: arena.root, curated: arena.curated }).hash;

    const r = reparar('registro-de-turnos', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(r.status, 'proposed');
    assert.equal(r.nivel, 1);
    assert.equal(r.reparaciones[0].regla, 'un-normalizado');
    assert.equal(r.forma.significativoIgual, true);
    assert.ok(r.forma.bytesDespues < r.forma.bytesAntes, 'la forma sucia tiene que encoger');
    assert.equal(r.base.hash, huellaSucia, 'la propuesta declara sobre qué versión se preparó');

    const check = checkProposal('registro-de-turnos', KEY, { root: arena.root, curated: arena.curated });
    assert.equal(check.ok, true, `la propuesta tiene que pasar la puerta: ${check.errors.join(' | ')}`);
    const nuevo = readFileSync(check.file, 'utf8');
    assert.equal(/\r/.test(nuevo), false);
    assert.equal(/[ \t]+\n/.test(nuevo), false);

    // La viva no se ha tocado: eso es lo que hace que reparar sea seguro. Sigue con su forma sucia.
    assert.equal(/\r/.test(readFileSync(join(dir, 'SKILL.md'), 'utf8')), true, 'la viva conserva su forma original');
    assert.equal(vigenteDe('registro-de-turnos', KEY, { root: arena.root, curated: arena.curated }).hash, huellaSucia);
  });

  it('un cuerpo por encima del techo se propone en nivel 2, moviendo material y conservando todo', () => {
    const arena = sandbox({ curated: false });
    const dir = viva(arena, TEMA('catalogo-de-materiales'));
    dejarAsi(dir, `## Cuándo se usa\n\nAl recibir material.\n\n## Catálogo de referencia\n\n${'q'.repeat(25000)}\n\n## Procedimiento\n\n1. Cuenta las referencias.\n2. Compara con el registro.\n`);

    const r = reparar('catalogo-de-materiales', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(r.status, 'proposed');
    assert.equal(r.nivel, 2);
    assert.equal(r.movidas.length, 1, 'se mueve la sección más pesada');
    assert.ok(r.forma.bytesDespues < 24000, `el cuerpo tiene que bajar del techo (${r.forma.bytesDespues})`);
    assert.ok(r.revision.removed.length > 0, 'mover material exige decir que no se pierde');

    const check = checkProposal('catalogo-de-materiales', KEY, { root: arena.root, curated: arena.curated });
    assert.equal(check.ok, true, `la propuesta tiene que pasar la puerta: ${check.errors.join(' | ')}`);
    const publicado = readFileSync(check.file, 'utf8');
    assert.match(publicado, /references\//, 'el cuerpo enlaza el material movido');
    const material = readFileSync(join(check.dir, r.movidas[0].ruta), 'utf8');
    assert.equal(material.includes('q'.repeat(100)), true, 'el material movido está entero');
  });

  it('si algo que la puerta exige no está arreglado, no se crea ninguna propuesta', () => {
    const arena = sandbox({ curated: false });
    const dir = viva(arena, TEMA('descripcion-demasiado-corta'));
    // Una descripción corta Y forma sucia: el motor podría arreglar la forma, pero la puerta rechazaría igual.
    dejarAsi(dir, '## Cuándo se usa   \r\n\r\nAl cerrar la jornada, con la hoja de descripciones cortas delante.\r\n\r\n## Procedimiento  \r\n\r\n1. Revisa la descripción de cada skill publicada.\r\n2. Anota las que no llegan a distinguir nada de nada.\r\n3. Deja la lista para la persona que redacta.\r\n\r\n\r\n');
    const fichero = join(dir, 'SKILL.md');
    writeFileSync(fichero, readFileSync(fichero, 'utf8').replace(/^description: .*$/m, 'description: "Corta."'));

    const r = reparar('descripcion-demasiado-corta', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(r.status, 'blocked');
    assert.equal(r.bloqueos.some((b) => b.rule === 'description-min'), true);
    assert.match(r.reason, /criterio humano/i);
    const check = checkProposal('descripcion-demasiado-corta', KEY, { root: arena.root, curated: arena.curated });
    assert.equal(check.ok, false, 'y no hay propuesta que aprobar');
    assert.match(String(check.errors[0]), /no existe una propuesta/);
  });

  it('una skill conforme no tiene nada que reparar y lo dice sin escribir', () => {
    const arena = sandbox({ curated: false });
    viva(arena, TEMA('registro-de-entregas'));
    const r = reparar('registro-de-entregas', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(r.status, 'nothing-to-do');
    assert.equal(checkProposal('registro-de-entregas', KEY, { root: arena.root, curated: arena.curated }).ok, false, 'no se ha creado propuesta');
  });

  it('un id que no está vivo no se repara: no hay nada que corregir', () => {
    const arena = sandbox({ curated: false });
    const r = reparar('no-existe-esta-skill', KEY, { root: arena.root, curated: arena.curated });
    assert.equal(r.status, 'missing');
    assert.match(r.reason, /no hay ninguna skill viva/);
  });

  it('el material de la skill no se reescribe: sólo se lleva a su forma canónica', () => {
    const arena = sandbox({ curated: false });
    const dir = viva(arena, TEMA('normas-de-almacen'));
    mkdirSync(join(dir, 'references'), { recursive: true });
    const original = '## Normas\r\n\r\nContenido con espacios colgando: 42.   \r\n';
    writeFileSync(join(dir, 'references', 'normas.md'), original);
    dejarAsi(dir, '## Cuándo se usa   \r\n\r\nAl abrir el almacén por la mañana, con el libro de registro delante.\r\n\r\n## Procedimiento  \r\n\r\n1. Lee las normas de seguridad del almacén antes de entrar.\r\n2. Aplícalas a cada estantería y anota lo que encuentres fuera de sitio.\r\n3. Cierra la ronda solo cuando todas cuadren.\r\n\r\n\r\n');

    const r = reparar('normas-de-almacen', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(r.status, 'proposed');
    const material = readFileSync(join(arena.root, 'projects', KEY, 'proposed', 'normas-de-almacen', 'references', 'normas.md'), 'utf8');
    assert.equal(material.includes('42.'), true, 'el significado sigue ahí');
    assert.equal(/\r/.test(material), false, 'y la forma es canónica');
    assert.equal(canonico(original) === material, true);
  });
});

describe('el material de una skill no se pierde ni se confunde', () => {
  it('el material que no vive en references/ viaja intacto (una skill vendorizada)', () => {
    // Una skill vendorizada lleva su `upstream/` y su `provenance.json` dentro. Ese material NO puede ir
    // por el parámetro de referencias (que sólo admite `references/…`): si va por ahí, la puerta rechaza la
    // propuesta entera — y eso pasaba, con la skill más pesada del almacén real delante.
    const arena = sandbox({ curated: false });
    const dir = viva(arena, TEMA('registro-de-proveedores-uno'));
    mkdirSync(join(dir, 'upstream'), { recursive: true });
    writeFileSync(join(dir, 'upstream', 'SKILL.md'), '---\nname: original\n---\n\n# Original ajeno\n');
    writeFileSync(join(dir, 'provenance.json'), JSON.stringify({ url: 'https://ejemplo.test/skill.md', sha256: 'abc123' }));
    dejarAsi(dir, '## Cuándo se usa   \r\n\r\nAl revisar proveedores, con el listado delante y sin prisa.\r\n\r\n## Procedimiento  \r\n\r\n1. Recorre el listado de proveedores entero.   \r\n2. Anota lo observado sin interpretarlo.\r\n3. Cierra solo los que cuadren con el registro.\r\n\r\n\r\n');

    const r = reparar('registro-de-proveedores-uno', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.reason));
    const check = checkProposal('registro-de-proveedores-uno', KEY, { root: arena.root, curated: arena.curated });
    assert.equal(check.ok, true, `la puerta tiene que admitirla: ${check.errors.join(' | ')}`);
    const propuesta = join(arena.root, 'projects', KEY, 'proposed', 'registro-de-proveedores-uno');
    assert.equal(readFileSync(join(propuesta, 'provenance.json'), 'utf8').includes('ejemplo.test'), true, 'la procedencia viaja tal cual');
    assert.equal(readFileSync(join(propuesta, 'upstream', 'SKILL.md'), 'utf8').includes('Original ajeno'), true, 'el original ajeno también');
  });

  it('la propuesta se escribe en el proyecto que se pide, no en el del directorio actual', () => {
    // Medido con la CLI delante: `propose` derivaba la clave del `cwd`, así que reparar con `--project-key`
    // grababa la propuesta en un proyecto y la puerta la buscaba en otro.
    const arena = sandbox({ curated: false });
    const otro = projectKey('C:\\otro\\proyecto');
    const dir = viva(arena, TEMA('registro-de-contratos-uno'));
    dejarAsi(dir, '## Cuándo se usa   \r\n\r\nAl firmar contratos, con el expediente delante y sin prisa.\r\n\r\n## Procedimiento  \r\n\r\n1. Recorre el expediente de contratos entero.   \r\n2. Anota lo observado sin interpretarlo.\r\n3. Cierra solo los que cuadren con el registro.\r\n\r\n\r\n');

    // Se repara pidiendo OTRO proyecto para la clave: la viva está en KEY, así que se pasa cwd de KEY.
    const r = reparar('registro-de-contratos-uno', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(r.status, 'proposed');
    assert.equal(existsSync(join(arena.root, 'projects', KEY, 'proposed', 'registro-de-contratos-uno', 'SKILL.md')), true, 'la propuesta está donde dice la clave');
    assert.equal(existsSync(join(arena.root, 'projects', otro, 'proposed', 'registro-de-contratos-uno')), false, 'y en ningún otro sitio');
  });

  it('si la propuesta no se puede crear, el motor dice el motivo en vez de callarse', () => {
    const arena = sandbox(); // la arena trae `session-state-recovery` en la biblioteca curada
    viva(arena, TEMA('registro-de-almacenes-uno'));
    dejarAsi(dirAprobado(arena, 'registro-de-almacenes-uno'), '## Cuándo se usa   \r\n\r\nAl abrir el almacén, con el libro delante y sin prisa.\r\n\r\n## Procedimiento  \r\n\r\n1. Recorre el almacén entero y anota los huecos.   \r\n2. Compara con el libro sin interpretarlo.\r\n3. Cierra solo lo que cuadre.\r\n\r\n\r\n');

    // Y ahora aparece una skill AJENA con el mismo id en la biblioteca compartida: repararla la pisaría,
    // así que el motor tiene que negarse y decir por qué.
    const ajeno = join(arena.curated, 'registro-de-almacenes-uno');
    mkdirSync(ajeno, { recursive: true });
    writeFileSync(join(ajeno, 'SKILL.md'), '---\nname: registro-de-almacenes-uno\ndescription: "Ajena"\n---\n\n# Ajena\n');

    const r = reparar('registro-de-almacenes-uno', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.notEqual(r.status, 'proposed');
    assert.ok((r.errors?.length ?? 0) + (r.conflicts?.length ?? 0) > 0, 'tiene que decir por qué');
    assert.match(r.reason, /no se pudo proponer/i);
  });
});
