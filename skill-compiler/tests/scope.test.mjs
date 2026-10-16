#!/usr/bin/env node
/**
 * La propiedad del proceso de creación de skills, y los sistemas que conviven en el puesto.
 *
 * ── Lo que hay que poder demostrar ──────────────────────────────────────────────────────────────
 *
 * 1. **Nadie declara por omisión.** Sin respuesta del humano la propiedad es `null`, y se dice que falta:
 *    elegir «todo el PC» solo no es una decisión del motor.
 * 2. **Se mide lo que hay**: cada sistema con sus ids, y los ids que viven en más de un sitio —salvo la
 *    copia que nosotros publicamos en la biblioteca curada, que es la publicación, no una colisión—.
 * 3. **La propiedad decide qué pasa con un id ajeno**: `dsh-only` lo rechaza, `machine` lo avisa con su
 *    sitio y deja seguir, y sin declarar se avisa de que falta la respuesta. Un id libre no genera ruido.
 *
 *   node --test tests/scope.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { propose, projectKey } from '../lib/compiler.mjs';
import { skillCommands } from '../lib/commands.mjs';
import {
  MAQUINA, SOLO_DSH, declararPropiedad, inventario, leerPropiedad,
} from '../lib/scope.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

/** Un almacén ajeno de mentira: una carpeta con una skill dentro, con su frontmatter mínimo. */
function almacenAjeno(destino, ids, { origin = null } = {}) {
  for (const id of ids) {
    mkdirSync(join(destino, id), { recursive: true });
    const origen = origin === null ? '' : `metadata:\n  dsh:\n    origin: ${origin}\n`;
    writeFileSync(join(destino, id, 'SKILL.md'),
      `---\nname: ${id}\ndescription: "Una skill de otro sistema, con su contenido propio y suficiente."\n${origen}---\n\n# ${id}\n\nContenido ajeno.\n`, 'utf8');
  }
  return destino;
}

/** Declara un almacén ajeno por entorno durante una prueba, y lo retira al salir. */
function conAlmacenDeclarado(ruta, fn) {
  const previo = process.env.SKILL_COMPILER_SISTEMAS;
  process.env.SKILL_COMPILER_SISTEMAS = ruta;
  try {
    return fn();
  } finally {
    if (previo === undefined) delete process.env.SKILL_COMPILER_SISTEMAS;
    else process.env.SKILL_COMPILER_SISTEMAS = previo;
  }
}

describe('la propiedad: nadie la declara por omisión', () => {
  it('sin declaración, la propiedad es nula y el motivo lo dice', () => {
    const s = sandbox();
    const estado = leerPropiedad({ root: s.root });
    assert.equal(estado.ownership, null, 'sin fichero no hay respuesta, y eso no es «dsh-only» por defecto');
    assert.match(estado.motivo, /nadie ha respondido/, 'el motivo dice que falta la respuesta, sin inventarse una');
  });

  it('se declara, se relee con su autor y su fecha, y una respuesta inválida se rechaza sin escribir', () => {
    const s = sandbox();
    const malo = declararPropiedad('lo-que-sea', { root: s.root });
    assert.equal(malo.ok, false);
    assert.match(malo.reason, /no es una respuesta válida/);
    assert.equal(leerPropiedad({ root: s.root }).ownership, null, 'una respuesta inválida no puede declarar nada');

    const bien = declararPropiedad(MAQUINA, { root: s.root, por: 'prueba', now: '2026-10-16T00:00:00.000Z' });
    assert.equal(bien.ok, true);
    const estado = leerPropiedad({ root: s.root });
    assert.equal(estado.ownership, MAQUINA);
    assert.equal(estado.declaredBy, 'prueba');
    assert.equal(estado.declaredAt, '2026-10-16T00:00:00.000Z');

    assert.equal(declararPropiedad(SOLO_DSH, { root: s.root }).ok, true);
    assert.equal(leerPropiedad({ root: s.root }).ownership, SOLO_DSH, 'se puede cambiar de idea');
  });

  it('una declaración ilegible no se finge: vuelve a preguntar', () => {
    const s = sandbox();
    mkdirSync(s.root, { recursive: true });
    writeFileSync(join(s.root, 'ownership.json'), '{ esto no es json', 'utf8');
    const estado = leerPropiedad({ root: s.root });
    assert.equal(estado.ownership, null);
    assert.match(estado.motivo, /no se pudo leer/);
  });
});

describe('los sistemas del puesto y sus choques', () => {
  it('inventaría lo que existe y localiza el id que vive en dos sitios', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'otro-sistema'), ['medida-compartida', 'solo-ajena']);
    // Lo nuestro vive donde vive de verdad: el almacén del plugin, un id por proyecto y estado.
    almacenAjeno(join(s.root, 'projects', 'p-12345678', 'approved'), ['medida-compartida']);

    const datos = inventario({ root: s.root, curada: s.curated, extra: [ajeno] });
    const sitios = datos.colisiones['medida-compartida'];
    assert.ok(sitios, 'el mismo id en el almacén del plugin y en otro sistema tiene que salir');
    assert.equal(sitios.length, 2, JSON.stringify(sitios));
    assert.equal(datos.colisiones['solo-ajena'], undefined, 'un id que sólo vive fuera no es un choque');
    assert.ok(datos.sistemas.some((sistema) => sistema.nuestro === true && sistema.ids.includes('medida-compartida')),
      'nuestro almacén se declara nuestro, con sus ids');
  });

  it('la copia que nosotros publicamos en la biblioteca curada no es una colisión: es la publicación', () => {
    const s = sandbox();
    // Nuestra publicación: el id viaja a la curada (con nuestro `origin`) y queda la constancia en published/.
    almacenAjeno(s.curated, ['publicada-nuestra'], { origin: 'skill-compiler' });
    almacenAjeno(join(s.root, 'projects', 'p-12345678', 'published'), ['publicada-nuestra']);

    const datos = inventario({ root: s.root, curada: s.curated });
    assert.equal(datos.colisiones['publicada-nuestra'], undefined, 'una sola copia efectiva no puede leerse como choque');
  });

  it('una skill curada que NO escribimos nosotros se distingue de las nuestras', () => {
    const s = sandbox();
    almacenAjeno(s.curated, ['ajena-de-verdad']);                       // sin `origin`: la escribió otro
    almacenAjeno(join(s.root, 'projects', 'p-12345678', 'approved'), ['ajena-de-verdad']);

    const datos = inventario({ root: s.root, curada: s.curated });
    assert.ok(datos.colisiones['ajena-de-verdad'], 'si la curada no lleva nuestro origin, sí es un choque: lo escribió otro');
  });

  it('un almacén declarado dos veces se cuenta una sola vez', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'otro-sistema'), ['una-sola-vez']);
    const datos = inventario({ root: s.root, curada: s.curated, extra: [ajeno, ajeno] });
    const declarados = datos.sistemas.filter((sistema) => sistema.ids.includes('una-sola-vez'));
    assert.equal(declarados.length, 1, 'la misma carpeta declarada dos veces es el mismo sistema');
  });
});

describe('la puerta: la propiedad decide qué pasa con un id que ya vive fuera', () => {
  it('sin declarar avisa de que falta la respuesta, y deja proponer', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'otro-sistema'), ['medida-ocupada']);
    const r = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'medida-ocupada' }), { root: s.root, curated: s.curated, cwd: CWD }));
    assert.equal(r.status, 'proposed', 'bloquear trabajo por una respuesta que nadie pidió sería peor que avisar');
    assert.ok(r.warnings.some((w) => /propiedad del proceso.*no está declarada/.test(w)), 'tiene que decir que falta la respuesta');
  });

  it('con `dsh-only`, un id que ya vive fuera se rechaza con su sitio', () => {
    const s = sandbox();
    declararPropiedad(SOLO_DSH, { root: s.root, por: 'prueba' });
    const ajeno = almacenAjeno(join(s.base, 'otro-sistema'), ['medida-ocupada']);
    const r = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'medida-ocupada' }), { root: s.root, curated: s.curated, cwd: CWD }));
    assert.equal(r.status, 'conflict');
    assert.match(r.conflicts[0].reason, /ya vive en otro sistema/);
    assert.match(r.conflicts[0].reason, /dsh-only/);
  });

  it('con `machine`, avisa con el sitio y deja proponer nuestra copia', () => {
    const s = sandbox();
    declararPropiedad(MAQUINA, { root: s.root, por: 'prueba' });
    const ajeno = almacenAjeno(join(s.base, 'otro-sistema'), ['medida-ocupada']);
    const r = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'medida-ocupada' }), { root: s.root, curated: s.curated, cwd: CWD }));
    assert.equal(r.status, 'proposed');
    assert.ok(r.warnings.some((w) => /aviso de propiedad .*machine/.test(w) && /medida-ocupada/.test(w)));
  });

  it('un id libre no genera ruido, ni sin declarar ni con machine', () => {
    const s = sandbox();
    const libre = propose(goodInput({ id: 'medida-libre' }), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(libre.status, 'proposed');
    assert.deepEqual(libre.warnings ?? [], [], 'sin choque no puede haber aviso de propiedad');

    declararPropiedad(MAQUINA, { root: s.root, por: 'prueba' });
    const s2 = sandbox();
    const ajeno = almacenAjeno(join(s2.base, 'otro-sistema'), ['otra-cosa']);
    const libre2 = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'medida-libre' }), { root: s2.root, curated: s2.curated, cwd: CWD }));
    assert.equal(libre2.status, 'proposed');
    assert.deepEqual(libre2.warnings ?? [], []);
  });
});

describe('los comandos de la propiedad', () => {
  const comandos = (root) => {
    const list = skillCommands({ root });
    return { list, byName: Object.fromEntries(list.map((c) => [c.name, c])) };
  };

  it('/skill-propiedad sin argumento pregunta; con argumento declara', () => {
    const s = sandbox();
    const { byName } = comandos(s.root);

    const pregunta = byName['skill-propiedad'].handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: '' });
    assert.equal(pregunta.kind, 'success');
    assert.match(pregunta.text, /dsh-only/);
    assert.match(pregunta.text, /machine/);
    assert.match(pregunta.text, /sin declarar/);

    const declarado = byName['skill-propiedad'].handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: MAQUINA });
    assert.equal(declarado.kind, 'success');
    assert.equal(leerPropiedad({ root: s.root }).ownership, MAQUINA);
    assert.equal(byName['skill-propiedad'].handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: '' }).text.includes('sin declarar'), false);

    const invalido = byName['skill-propiedad'].handler({ agent: { session: { header: { cwd: CWD } } }, rawInput: 'verde' });
    assert.equal(invalido.kind, 'error');
  });

  it('las dos filas de un clic declaran su respuesta', () => {
    const s = sandbox();
    const { byName } = comandos(s.root);
    assert.equal(byName[`skill-propiedad-${SOLO_DSH}`].handler({}).kind, 'success');
    assert.equal(leerPropiedad({ root: s.root }).ownership, SOLO_DSH);
    assert.equal(byName[`skill-propiedad-${MAQUINA}`].handler({}).kind, 'success');
    assert.equal(leerPropiedad({ root: s.root }).ownership, MAQUINA);
  });

  it('/skill-sistemas lista los sistemas y los choques', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'otro-sistema'), ['medida-ocupada']);
    almacenAjeno(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'approved'), ['medida-ocupada']);
    const { byName } = comandos(s.root);
    const r = conAlmacenDeclarado(ajeno, () => byName['skill-sistemas'].handler({}));
    assert.equal(r.kind, 'success');
    assert.match(r.text, /Sistemas de skills del puesto/);
    assert.match(r.text, /medida-ocupada/, 'el id en dos sitios tiene que salir con su sitio');
    assert.match(r.text, /Propiedad declarada: SIN DECLARAR/);
  });
});
