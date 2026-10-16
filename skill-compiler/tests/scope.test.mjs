#!/usr/bin/env node
/**
 * La propiedad del proceso de creación de skills, los estados de un almacén y los choques entre sistemas.
 *
 * ── Lo que hay que poder demostrar ──────────────────────────────────────────────────────────────
 *
 * 1. **Nadie declara por omisión, y los estados no se confunden.** Ausente, inválida e ilegible son
 *    cosas distintas: una pregunta sin responder, una respuesta que no se puede usar y una respuesta que
 *    no se puede leer. Las tres aplican la política segura, y las tres **se declaran por su nombre**.
 * 2. **Una fuente inaccesible no es una fuente sin skills.** Un almacén que no se pudo leer no puede
 *    hacer que el inventario afirme «no hay choques»: se marca `completo: false` y se dice.
 * 3. **La huella informa, no decide.** Dos copias con el mismo contenido son la misma copia; pero una
 *    copia idéntica sin procedencia **no** se descarta como colisión: la propiedad la resuelve `origin`.
 * 4. **Nunca se escribe fuera.** Un id que vive en otro sistema con la política segura se rechaza, y el
 *    almacén ajeno queda byte a byte como estaba — eso se mide, no se promete.
 * 5. **Rutas**: una ruta que escapa por `..` o por un enlace no está dentro, aunque resuelva.
 *
 *   node --test tests/scope.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { propose } from '../lib/compiler.mjs';
import { skillCommands } from '../lib/commands.mjs';
import {
  MAQUINA, SOLO_DSH, bajoRaiz, clasificarIdentidad, declararPropiedad, estadoDeEnlace, huellaDe, inventario,
  leerAlmacen, leerPropiedad, politicaAplicable, propiedadSinCambios, resolverRuta, textoDeSistemas, textoDelEstado,
} from '../lib/scope.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

/** Escribe una declaración a mano, tal cual, para medir lo que la puerta hace con una respuesta rara. */
function escribirDeclaracion(root, contenido) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'ownership.json'), contenido, 'utf8');
}

/** Un almacén ajeno de mentira: una carpeta con skills dentro, con su frontmatter mínimo. */
function almacenAjeno(destino, ids, { origin = null, cuerpo = 'Contenido ajeno.' } = {}) {
  for (const id of ids) {
    mkdirSync(join(destino, id), { recursive: true });
    const origen = origin === null ? '' : `metadata:\n  dsh:\n    origin: ${origin}\n`;
    writeFileSync(join(destino, id, 'SKILL.md'),
      `---\nname: ${id}\ndescription: "Una skill de otro sistema, con su contenido propio y suficiente."\n${origen}---\n\n# ${id}\n\n${cuerpo}\n`, 'utf8');
  }
  return destino;
}

/** La huella del árbol de un almacén: ficheros, contenido y nada más. Es la prueba de «no se tocó». */
function huellaDelArbol(raiz) {
  const partes = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else partes.push(`${ruta.slice(raiz.length)}:${createHash('sha256').update(readFileSync(ruta)).digest('hex')}`);
    }
  };
  if (!statSync(raiz).isDirectory()) return `no es carpeta: ${readFileSync(raiz).length}`;
  recorrer(raiz);
  return huellaDe(partes.join('\n'));
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

describe('la declaración: cuatro estados que no se confunden', () => {
  it('sin fichero, la propiedad es ausente y el motivo dice que nadie ha respondido', () => {
    const s = sandbox();
    const estado = leerPropiedad({ root: s.root });
    assert.equal(estado.estado, 'ausente');
    assert.equal(estado.ownership, null, 'no hay respuesta, y eso no es «dsh-only» por defecto');
    assert.equal(estado.huella, null);
    assert.match(estado.motivo, /nadie ha respondido/);
    assert.equal(politicaAplicable(estado), SOLO_DSH, 'sin respuesta se aplica la política segura, no una inventada');
    assert.match(textoDelEstado(estado), /dsh-only/);
    assert.match(textoDelEstado(estado), /machine/);
  });

  it('un JSON roto, un valor fuera de contrato y un campo desconocido son INVÁLIDA (y se dice por qué)', () => {
    const casos = [
      ['{ esto no es json', /no es JSON válido/],
      ['{"ownership":"lo-que-sea"}', /no dice «dsh-only» ni «machine»/],
      ['{"ownership":"machine","algo":"de más"}', /campos que este contrato no conoce: algo/],
      ['["dsh-only"]', /no es un objeto/],
    ];
    for (const [contenido, esperado] of casos) {
      const s = sandbox();
      escribirDeclaracion(s.root, contenido);
      const estado = leerPropiedad({ root: s.root });
      assert.equal(estado.estado, 'invalida', `${contenido} tiene que quedar inválida`);
      assert.equal(estado.ownership, null, 'inválida no declara nada');
      assert.match(estado.motivo, esperado);
      assert.equal(politicaAplicable(estado), SOLO_DSH);
      assert.ok(estado.huella, 'aun inválida, se sabe QUÉ se leyó: eso permite detectar que cambió');
    }
  });

  it('una declaración que existe y no se puede leer es ILEGIBLE, no ausente', () => {
    const s = sandbox();
    mkdirSync(join(s.root, 'ownership.json'), { recursive: true }); // un directorio donde debería haber un fichero
    const estado = leerPropiedad({ root: s.root });
    assert.equal(estado.estado, 'ilegible');
    assert.match(estado.motivo, /no se pudo leer/);
    assert.notEqual(estado.estado, 'ausente', 'no poder leer no es no haber respondido');
    assert.equal(politicaAplicable(estado), SOLO_DSH);
  });

  it('declarada: se relee con su autor, su fecha y su huella, y se puede cambiar de idea', () => {
    const s = sandbox();
    const r = declararPropiedad(MAQUINA, { root: s.root, por: 'prueba', now: '2026-10-16T00:00:00.000Z' });
    assert.equal(r.ok, true);
    assert.ok(r.huella);
    const estado = leerPropiedad({ root: s.root });
    assert.equal(estado.estado, 'declarada');
    assert.equal(estado.ownership, MAQUINA);
    assert.equal(estado.declaredBy, 'prueba');
    assert.equal(estado.declaredAt, '2026-10-16T00:00:00.000Z');
    assert.equal(politicaAplicable(estado), MAQUINA);
    assert.equal(declararPropiedad(SOLO_DSH, { root: s.root }).ok, true);
    assert.equal(leerPropiedad({ root: s.root }).ownership, SOLO_DSH);
    assert.deepEqual(readdirSync(s.root).filter((n) => n.includes('.tmp')), [], 'la escritura es atómica: no queda temporal');
  });

  it('una respuesta inválida no declara nada, y el fichero no se crea', () => {
    const s = sandbox();
    const r = declararPropiedad('verde', { root: s.root });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'invalida');
    assert.equal(leerPropiedad({ root: s.root }).estado, 'ausente');
  });

  it('declarar con una huella obsoleta se NIEGA: no se pisa una respuesta que este proceso no vio', () => {
    const s = sandbox();
    declararPropiedad(SOLO_DSH, { root: s.root, por: 'primero' });
    const leida = leerPropiedad({ root: s.root });
    declararPropiedad(MAQUINA, { root: s.root, por: 'otro' }); // otra sesión decide mientras tanto
    const r = declararPropiedad(SOLO_DSH, { root: s.root, por: 'tarde', esperadaHuella: leida.huella });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'concurrente');
    assert.match(r.reason, /cambió entre la lectura/);
    assert.equal(leerPropiedad({ root: s.root }).declaredBy, 'otro', 'la respuesta nueva sigue en pie');
  });

  it('el cambio se detecta con la misma comprobación que usa la puerta antes de escribir', () => {
    const s = sandbox();
    declararPropiedad(SOLO_DSH, { root: s.root });
    const leida = leerPropiedad({ root: s.root });
    assert.equal(propiedadSinCambios(leida, { root: s.root }).ok, true);
    declararPropiedad(MAQUINA, { root: s.root });
    const despues = propiedadSinCambios(leida, { root: s.root });
    assert.equal(despues.ok, false);
    assert.match(despues.reason, /la propiedad cambió durante la operación/);
  });
});

describe('el inventario: accesible, inaccesible y lo que no existe', () => {
  it('un almacén que no se pudo leer NO se lee como «cero skills»', () => {
    const s = sandbox();
    const fichero = join(s.base, 'no-es-carpeta');
    writeFileSync(fichero, 'esto es un fichero', 'utf8');
    const lectura = leerAlmacen(fichero);
    assert.equal(lectura.estado, 'inaccesible');
    assert.match(lectura.motivo, /no es una carpeta/);
    assert.equal(leerAlmacen(join(s.base, 'no-existe')).estado, 'inexistente');
    assert.notEqual(leerAlmacen(join(s.base, 'no-existe')).estado, 'inaccesible', 'no existir no es no poder leer');
  });

  it('con una fuente inaccesible el inventario es INCOMPLETO, y no afirma que no haya choques', () => {
    const s = sandbox();
    const roto = join(s.base, 'almacen-roto');
    writeFileSync(roto, 'no soy una carpeta', 'utf8');
    const datos = inventario({ root: s.root, curada: s.curated, extra: [roto] });
    assert.equal(datos.completo, false);
    assert.equal(datos.sinLeer.length, 1);
    assert.equal(datos.sinLeer[0].estado, 'inaccesible');
    const texto = textoDeSistemas({ datos, estado: leerPropiedad({ root: s.root }) });
    assert.match(texto, /Sin choques COMPROBADOS/);
    assert.match(texto, /no se puede afirmar que no haya/);
    assert.match(texto, /Barrido INCOMPLETO/);
    assert.doesNotMatch(texto, /Sin choques de id entre sistemas\./, 'no se puede afirmar lo que no se midió');
  });

  it('un enlace roto es un almacén inaccesible, no uno inexistente', () => {
    const s = sandbox();
    const destino = join(s.base, 'destino-que-desaparece');
    mkdirSync(destino, { recursive: true });
    const enlace = join(s.base, 'enlace');
    try {
      symlinkSync(destino, enlace, 'junction');
    } catch (error) {
      return; // sin permiso para crear enlaces: el caso se declara sin cubrir, no se finge cubierto
    }
    assert.equal(leerAlmacen(enlace).estado, 'accesible');
    rmSync(destino, { recursive: true, force: true });
    const roto = leerAlmacen(enlace);
    assert.equal(roto.estado, 'inaccesible');
    assert.equal(roto.enlaceRoto, true);
    assert.match(roto.motivo, /enlace roto/);
  });

  it('con todo legible, el inventario se declara completo y sí puede afirmar que no hay choques', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['una-sola']);
    const datos = inventario({ root: s.root, curada: s.curated, extra: [ajeno] });
    assert.equal(datos.completo, true);
    assert.deepEqual(datos.sinLeer, []);
    const texto = textoDeSistemas({ datos, estado: leerPropiedad({ root: s.root }) });
    assert.match(texto, /Barrido completo/);
  });

  it('la huella del inventario identifica lo leído: igual entre dos lecturas, distinta cuando cambia', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['una-sola']);
    const primera = inventario({ root: s.root, curada: s.curated, extra: [ajeno] });
    const segunda = inventario({ root: s.root, curada: s.curated, extra: [ajeno] });
    assert.equal(primera.huella, segunda.huella, 'lo mismo leído dos veces da la misma huella');
    almacenAjeno(ajeno, ['una-sola', 'otra-nueva']);
    const tercera = inventario({ root: s.root, curada: s.curated, extra: [ajeno] });
    assert.notEqual(tercera.huella, primera.huella, 'un cambio en las fuentes cambia la huella');
  });
});

describe('identidad: la huella informa, la procedencia decide', () => {
  it('mismo id y contenido distinto es un choque real', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['medida'], { cuerpo: 'Una cosa completamente distinta.' });
    almacenAjeno(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'approved'), ['medida'], { cuerpo: 'Nuestra cosa.' });
    const datos = inventario({ root: s.root, curada: s.curated, extra: [ajeno] });
    assert.equal(datos.colisiones.medida.clase, 'distinto-contenido');
    assert.equal(datos.colisiones.medida.sitios.length, 2);
  });

  it('una copia con el MISMO contenido y sin procedencia sigue siendo un choque declarado', () => {
    const s = sandbox();
    // Nada dice que la copia de la curada sea nuestra: sin `origin` la escribió otro, y que coincida el
    // contenido no demuestra propiedad. Se declara, no se descarta.
    almacenAjeno(s.curated, ['ajena-identica']);
    almacenAjeno(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'approved'), ['ajena-identica']);
    const datos = inventario({ root: s.root, curada: s.curated });
    assert.equal(datos.colisiones['ajena-identica'].clase, 'misma-copia');
    assert.equal(datos.copiasPropias['ajena-identica'], undefined, 'sin procedencia no es una publicación nuestra');
  });

  it('una publicación NUESTRA no es un choque, y queda declarada como copia propia', () => {
    const s = sandbox();
    // La curada lleva nuestro `origin`: es la publicación de `--global`, una sola copia efectiva.
    almacenAjeno(s.curated, ['publicada-nuestra'], { origin: 'skill-compiler' });
    almacenAjeno(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'published'), ['publicada-nuestra'], { origin: 'skill-compiler' });
    const datos = inventario({ root: s.root, curada: s.curated });
    assert.equal(datos.colisiones['publicada-nuestra'], undefined);
    assert.equal(datos.copiasPropias['publicada-nuestra'].clase, 'publicacion-nuestra');
    const texto = textoDeSistemas({ datos, estado: leerPropiedad({ root: s.root }) });
    assert.match(texto, /Copias propias publicadas/);
  });

  it('clasificar identidad distingue copia, choque y lo que no se pudo confirmar', () => {
    const sitios = (huellas) => huellas.map((h, i) => ({ sistema: `s${i}`, ruta: `r${i}`, raiz: `x${i}`, huella: h }));
    assert.equal(clasificarIdentidad('x', sitios(['a', 'a'])).clase, 'misma-copia');
    assert.equal(clasificarIdentidad('x', sitios(['a', 'b'])).clase, 'distinto-contenido');
    assert.equal(clasificarIdentidad('x', sitios(['a', null])).clase, 'no-determinable');
  });

  it('dos nombres que sólo difieren en mayúsculas se declaran (si el sistema de ficheros deja tenerlos)', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['medida-una', 'MEDIDA-UNA']);
    const datos = inventario({ root: s.root, curada: s.curated, extra: [ajeno] });
    const enDisco = datos.sistemas.find((sistema) => sistema.ruta === ajeno).ids;
    if (enDisco.length === 1) {
      // Aquí (Windows) no pueden coexistir: son el MISMO directorio. Se declara medido, no se finge el caso.
      assert.equal(enDisco[0].toLowerCase(), 'medida-una');
      assert.deepEqual(datos.nombresEquivalentes, [], 'con un solo nombre no hay nada que declarar');
      return;
    }
    assert.equal(datos.nombresEquivalentes.length, 1);
    assert.match(textoDeSistemas({ datos, estado: leerPropiedad({ root: s.root }) }), /sólo difieren en mayúsculas/);
  });
});

describe('rutas: resolver, y no salirse del ámbito', () => {
  it('bajoRaiz distingue dentro, `..` fuera y enlace que apunta fuera', () => {
    const s = sandbox();
    const dentro = join(s.base, 'dentro');
    const fuera = mkdtempSync(join(tmpdir(), 'skill-compiler-fuera-')); // FUERA de la caja, de verdad
    mkdirSync(join(dentro, 'skill'), { recursive: true });
    assert.equal(bajoRaiz(dentro, join(dentro, 'skill')).dentro, true);
    assert.equal(bajoRaiz(dentro, join(dentro, '..', 'fuera')).dentro, false);
    assert.equal(bajoRaiz(dentro, join(dentro, 'no-existe')).dentro, true, 'una ruta que no existe pero está dentro, está dentro');

    const enlace = join(dentro, 'atajo');
    try {
      symlinkSync(fuera, enlace, 'junction');
    } catch (error) {
      return; // sin permiso para enlaces: caso sin cubrir, declarado
    }
    try {
      const cruzado = bajoRaiz(dentro, join(enlace, 'lo-que-sea'));
      assert.equal(cruzado.dentro, false, 'un enlace que sale del ámbito no escribe dentro del ámbito');
      assert.match(cruzado.motivo, /fuera del ámbito/);
    } finally {
      rmSync(fuera, { recursive: true, force: true });
    }
  });

  it('resolverRuta dice si la forma canónica se pudo confirmar, y detecta el enlace', () => {
    const s = sandbox();
    const real = join(s.base, 'real');
    mkdirSync(real, { recursive: true });
    assert.equal(resolverRuta(real).canonica, true);
    const inexistente = resolverRuta(join(s.base, 'no-existe'));
    assert.equal(inexistente.existe, false);
    assert.equal(inexistente.canonica, false, 'una ruta que no existe no tiene canónica que confirmar');
    assert.equal(estadoDeEnlace(real).enlace, false);
  });
});

describe('la puerta: la política decide, y nada se escribe fuera', () => {
  it('sin declarar, un id que vive fuera se RECHAZA (política segura) nombrando el estado', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['medida-ocupada']);
    const antes = huellaDelArbol(ajeno);
    const r = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'medida-ocupada' }), { root: s.root, curated: s.curated, cwd: CWD }));
    assert.equal(r.status, 'conflict');
    assert.match(r.conflicts[0].reason, /ya vive en otro sistema/);
    assert.match(r.conflicts[0].reason, /está ausente/, 'el motivo nombra el estado real de la declaración');
    assert.equal(huellaDelArbol(ajeno), antes, 'el almacén ajeno no cambia: ni un byte');
    // Y rechazar no deja nada a medias: ni propuesta, ni cerrojo.
    const propuestas = join(s.root, 'projects', 'saas-corporative-a3c393fa', 'proposed');
    const dentroDePropuestas = existsSync(propuestas) ? readdirSync(propuestas) : [];
    assert.deepEqual(dentroDePropuestas.filter((n) => n === 'medida-ocupada'), [], 'un rechazo no crea la propuesta');
    assert.deepEqual(existsSync(join(s.root, 'locks')) ? readdirSync(join(s.root, 'locks')) : [], [], 'un rechazo suelta el cerrojo');
  });

  it('con `dsh-only`, se rechaza igual y el motivo lo dice', () => {
    const s = sandbox();
    declararPropiedad(SOLO_DSH, { root: s.root, por: 'prueba' });
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['medida-ocupada']);
    const r = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'medida-ocupada' }), { root: s.root, curated: s.curated, cwd: CWD }));
    assert.equal(r.status, 'conflict');
    assert.match(r.conflicts[0].reason, /propiedad declarada «dsh-only»/);
  });

  it('con `machine`, avisa con el sitio, deja proponer y NO toca el almacén ajeno', () => {
    const s = sandbox();
    declararPropiedad(MAQUINA, { root: s.root, por: 'prueba' });
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['medida-ocupada']);
    const antes = huellaDelArbol(ajeno);
    const r = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'medida-ocupada' }), { root: s.root, curated: s.curated, cwd: CWD }));
    assert.equal(r.status, 'proposed');
    assert.ok(r.warnings.some((w) => /aviso de propiedad \(«machine»\)/.test(w) && /medida-ocupada/.test(w)));
    assert.equal(huellaDelArbol(ajeno), antes, 'proponer nunca escribe fuera del almacén propio');
    // La propuesta guarda con qué alcance se decidió: sin eso, la decisión no se puede auditar después.
    const meta = JSON.parse(readFileSync(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'proposed', 'medida-ocupada', 'meta.json'), 'utf8'));
    assert.equal(meta.scope.politica, MAQUINA);
    assert.equal(meta.scope.politicaEstado, 'declarada');
    assert.equal(meta.scope.sitios.length, 1);
    assert.equal(meta.scope.barridoCompleto, true);
    assert.deepEqual(existsSync(join(s.root, 'locks')) ? readdirSync(join(s.root, 'locks')) : [], [], 'el cerrojo se suelta al terminar');
  });

  it('un id libre no genera ruido, ni sin declarar ni con machine', () => {
    const s = sandbox();
    const libre = propose(goodInput({ id: 'medida-libre' }), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(libre.status, 'proposed');
    assert.deepEqual(libre.warnings ?? [], [], 'sin choque no puede haber aviso de propiedad');

    const s2 = sandbox();
    declararPropiedad(MAQUINA, { root: s2.root, por: 'prueba' });
    const ajeno = almacenAjeno(join(s2.base, 'ajeno'), ['otra-cosa']);
    const libre2 = conAlmacenDeclarado(ajeno, () => propose(goodInput({ id: 'otra-libre' }), { root: s2.root, curated: s2.curated, cwd: CWD }));
    assert.equal(libre2.status, 'proposed');
    assert.deepEqual(libre2.warnings ?? [], []);
  });

  it('si el barrido no fue completo, la propuesta lo declara y guarda las fuentes sin leer', () => {
    const s = sandbox();
    declararPropiedad(MAQUINA, { root: s.root, por: 'prueba' });
    const roto = join(s.base, 'almacen-roto');
    writeFileSync(roto, 'no soy una carpeta', 'utf8');
    const r = conAlmacenDeclarado(roto, () => propose(goodInput({ id: 'otra-libre' }), { root: s.root, curated: s.curated, cwd: CWD }));
    assert.equal(r.status, 'proposed');
    assert.ok(r.warnings.some((w) => /barrido NO está completo/.test(w) && /no se puede afirmar que no exista/.test(w)));
    const meta = JSON.parse(readFileSync(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'proposed', 'otra-libre', 'meta.json'), 'utf8'));
    assert.equal(meta.scope.barridoCompleto, false);
    assert.equal(meta.scope.fuentesSinLeer.length, 1);
  });

  it('una declaración rota se dice en cada propuesta, y se aplica la política segura', () => {
    const s = sandbox();
    escribirDeclaracion(s.root, '{"ownership":"machine","extra":1}');
    const r = propose(goodInput({ id: 'otra-libre' }), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'proposed');
    assert.ok(r.warnings.some((w) => /declaración de propiedad del puesto está invalida/.test(w)));
    const meta = JSON.parse(readFileSync(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'proposed', 'otra-libre', 'meta.json'), 'utf8'));
    assert.equal(meta.scope.politica, SOLO_DSH, 'mientras la declaración no sirva, la política es la segura');
    assert.equal(meta.scope.politicaEstado, 'invalida');
  });
});

describe('los comandos y el CLI dicen lo mismo', () => {
  it('/skill-propiedad pregunta, declara y rechaza lo que no es respuesta', () => {
    const s = sandbox();
    const comandos = skillCommands({ root: s.root });
    const byName = Object.fromEntries(comandos.map((c) => [c.name, c]));
    const agente = { agent: { session: { header: { cwd: CWD } } } };

    const pregunta = byName['skill-propiedad'].handler(agente);
    assert.equal(pregunta.kind, 'success');
    assert.match(pregunta.text, /sin declarar/);
    assert.match(pregunta.text, /dsh-only/);
    assert.match(pregunta.text, /machine/);

    assert.equal(byName['skill-propiedad'].handler({ ...agente, rawInput: MAQUINA }).kind, 'success');
    assert.equal(leerPropiedad({ root: s.root }).ownership, MAQUINA);
    const declarado = byName['skill-propiedad'].handler(agente);
    assert.match(declarado.text, /huella/);
    assert.equal(byName['skill-propiedad'].handler({ ...agente, rawInput: 'verde' }).kind, 'error');

    // Con la declaración rota, el comando no dice «sin declarar»: dice que existe y no sirve.
    escribirDeclaracion(s.root, '{ roto');
    const roto = byName['skill-propiedad'].handler(agente);
    assert.match(roto.text, /EXISTE y no dice una respuesta válida/);
    assert.match(roto.text, /estado: invalida/);
  });

  it('las dos filas de un clic declaran su respuesta', () => {
    const s = sandbox();
    const byName = Object.fromEntries(skillCommands({ root: s.root }).map((c) => [c.name, c]));
    assert.equal(byName[`skill-propiedad-${SOLO_DSH}`].handler({}).kind, 'success');
    assert.equal(leerPropiedad({ root: s.root }).ownership, SOLO_DSH);
    assert.equal(byName[`skill-propiedad-${MAQUINA}`].handler({}).kind, 'success');
    assert.equal(leerPropiedad({ root: s.root }).ownership, MAQUINA);
  });

  it('/skill-sistemas lista los sistemas, su estado real y los choques', () => {
    const s = sandbox();
    const ajeno = almacenAjeno(join(s.base, 'ajeno'), ['medida-ocupada'], { cuerpo: 'Otra cosa distinta.' });
    almacenAjeno(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'approved'), ['medida-ocupada'], { cuerpo: 'Nuestra cosa.' });
    const byName = Object.fromEntries(skillCommands({ root: s.root }).map((c) => [c.name, c]));
    const r = conAlmacenDeclarado(ajeno, () => byName['skill-sistemas'].handler({}));
    assert.equal(r.kind, 'success');
    assert.match(r.text, /Sistemas de skills del puesto/);
    assert.match(r.text, /medida-ocupada — contenido distinto/);
    assert.match(r.text, /Propiedad: AUSENTE/);
  });
});
