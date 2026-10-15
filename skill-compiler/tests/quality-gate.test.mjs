#!/usr/bin/env node
/**
 * Puerta de calidad de una skill: lo que decide si entra al almacén, y por qué.
 *
 * ── Qué protege esta puerta ──────────────────────────────────────────────────────────────────────
 *
 * Una skill aprobada se sirve al modelo en cada sesión de su proyecto y **se paga**: el protocolo y las
 * descripciones en cada prompt, el cuerpo entero cada vez que se carga. Por eso la puerta no mide sólo
 * que la entrada sea válida (id, una línea, longitud mínima) sino que **sirva**: que su descripción
 * distinga, que tenga un disparador con el que el harness pueda seleccionarla, que esté estructurada,
 * que su tamaño tenga presupuesto y que el material pesado que promete exista de verdad y sea el mismo
 * que se aprobó.
 *
 * ── Cómo está escrita ────────────────────────────────────────────────────────────────────────────
 *
 * Límites **exactos** (59/60, 19/20, 7999/8000, 23999/24000): un mínimo se prueba en el valor de al
 * lado, o no se está probando el mínimo. Los casos negativos son de una sola causa, para que el motivo
 * del rechazo sea inequívoco. Y el último bloque mide lo que el gate pide demostrar: que una entrada
 * rechazada **no toca el conocimiento aprobado**.
 *
 *   node --test tests/quality-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  approve, checkProposal, checkReferences, declaredReferences, folderHash, normalizeRel,
  projectKey, propose, treeOf, validateInput,
} from '../lib/compiler.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = () => projectKey(CWD);

/** Un cuerpo de longitud EXACTA: sin esto, «límite» sería una impresión. */
function bodyExacto(largo, { secciones = 2 } = {}) {
  const cabecera = secciones === 2 ? '## Uno\n\n## Dos\n\n' : '## Uno\n\n';
  return cabecera + 'x'.repeat(Math.max(0, largo - cabecera.length));
}

const errores = (r) => r.errors.join(' | ');
const avisos = (r) => r.warnings.join(' | ');

// ── formato: los mínimos, en el valor de al lado ────────────────────────────────────────────────

describe('puerta de calidad · formato', () => {
  it('la descripción se mide en el carácter de al lado, y es una sola línea', () => {
    const de = (n) => validateInput({ ...goodInput(), description: 'D'.repeat(n) });
    assert.equal(de(59).ok, false, '59 caracteres tiene que rechazarse');
    assert.match(errores(de(59)), /description demasiado corta \(mínimo 60/);
    assert.equal(de(60).ok, true, '60 es el mínimo y tiene que pasar');
    assert.equal(de(300).ok, true);
    assert.equal(de(301).ok, false);
    assert.match(errores(de(301)), /description demasiado larga \(máximo 300/);
    assert.equal(validateInput({ ...goodInput(), description: `${'D'.repeat(70)}\ncon salto` }).ok, false);
  });

  it('whenToUse es obligatorio y se mide igual', () => {
    const de = (w) => validateInput(w === undefined ? { ...goodInput(), whenToUse: undefined } : { ...goodInput(), whenToUse: w });
    assert.equal(de(undefined).ok, false, 'sin whenToUse no hay skill seleccionable');
    assert.match(errores(de(undefined)), /whenToUse es obligatorio/);
    assert.equal(de('W'.repeat(19)).ok, false);
    assert.equal(de('W'.repeat(20)).ok, true, '20 es el mínimo y tiene que pasar');
    assert.equal(de(`${'W'.repeat(30)}\ncon salto`).ok, false);
  });

  it('el cuerpo: mínimo 200, presupuesto 8.000 (aviso) y techo 24.000 (error)', () => {
    assert.equal(bodyExacto(200).length, 200, 'la propia prueba mide lo que dice medir');
    assert.equal(validateInput({ ...goodInput(), body: bodyExacto(199) }).ok, false);
    assert.match(errores(validateInput({ ...goodInput(), body: bodyExacto(199) })), /body demasiado corto/);

    const en8000 = validateInput({ ...goodInput(), body: bodyExacto(8000) });
    assert.equal(en8000.ok, true);
    assert.equal(/se carga entero/.test(avisos(en8000)), false, 'en el presupuesto no se avisa');

    const pasado = validateInput({ ...goodInput(), body: bodyExacto(8001) });
    assert.equal(pasado.ok, true, '8001 avisa, no rechaza');
    assert.match(avisos(pasado), /8001 caracteres/);

    const enTecho = validateInput({ ...goodInput(), body: bodyExacto(24000) });
    assert.equal(/demasiado largo/.test(errores(enTecho)), false, 'en el techo todavía no es error');

    const sobreTecho = validateInput({ ...goodInput(), body: bodyExacto(24001) });
    assert.equal(sobreTecho.ok, false, '24001 es error bloqueante');
    assert.match(errores(sobreTecho), /demasiado largo \(24001 > 24000/);
    assert.match(errores(sobreTecho), /references\//, 'y dice por dónde se arregla');
  });

  it('la estructura: dos secciones; una sola se admite sólo en un cuerpo corto', () => {
    const sinSecciones = validateInput({ ...goodInput(), body: `x${'y'.repeat(300)}` });
    assert.equal(sinSecciones.ok, false);
    assert.match(errores(sinSecciones), /no tiene ninguna sección/);

    const unaCorta = validateInput({ ...goodInput(), body: bodyExacto(400, { secciones: 1 }) });
    assert.equal(unaCorta.ok, true, 'un cuerpo corto con una sección se admite');
    assert.match(avisos(unaCorta), /una sola sección/);

    const unaLarga = validateInput({ ...goodInput(), body: bodyExacto(1501, { secciones: 1 }) });
    assert.equal(unaLarga.ok, false, 'pasado el umbral, una sola sección ya no localiza nada');
    assert.match(errores(unaLarga), /hacen falta al menos 2/);

    assert.equal(validateInput({ ...goodInput(), body: bodyExacto(1501) }).ok, true);
  });
});

// ── referencias: el vínculo, no la existencia ───────────────────────────────────────────────────

describe('puerta de calidad · referencias', () => {
  const cuerpoCon = (ruta, relleno = 300) => `## Uso\n\nEl detalle vive en ${ruta} y punto.\n\n## Cierre\n\n${'x'.repeat(relleno)}`;

  it('lee las rutas que el cuerpo declara, sin duplicados y en el orden en que aparecen', () => {
    assert.deepEqual(declaredReferences('ver `references/a.md` y `references/b.md` y `references/a.md`'),
      ['references/a.md', 'references/b.md']);
    assert.deepEqual(declaredReferences('nada que declarar'), []);
    // Un enlace reescrito al espacio del origen no es un vínculo nuestro: no se confunde.
    assert.deepEqual(declaredReferences('el original está en `upstream/references/a.md`'), []);
    assert.deepEqual(declaredReferences('`references\\sub\\archivo.md`'), ['references/sub/archivo.md'], 'las barras se normalizan');
  });

  it('una ruta declarada sin fichero es error, y el motivo dice qué hacer', () => {
    const r = validateInput({ ...goodInput(), body: cuerpoCon('`references/contratos.md`') });
    assert.equal(r.ok, false);
    assert.match(errores(r), /declara «references\/contratos\.md» y ese fichero no está/);
    assert.match(errores(r), /aporta su contenido en «references»/);
  });

  it('aportar el material la deja pasar, y el resultado trae su huella', () => {
    const s = sandbox();
    const contenido = '## Contrato\n\nEl valor exacto es 24.000 y el orden importa.\n';
    const r = propose({ ...goodInput(), body: cuerpoCon('`references/contratos.md`') },
      { root: s.root, curated: s.curated, cwd: CWD, references: [{ path: 'references/contratos.md', content: contenido }] });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors));
    assert.deepEqual(r.references.map((x) => x.path), ['references/contratos.md']);
    assert.equal(r.references[0].bytes, Buffer.byteLength(contenido));
    assert.equal(r.references[0].sha256.length, 16);
    // Escrito de verdad, con el contenido exacto, y registrado en meta.json.
    const carpeta = join(s.root, 'projects', KEY(), 'proposed', 'measured-decision-check');
    assert.equal(readFileSync(join(carpeta, 'references/contratos.md'), 'utf8'), contenido);
    const meta = JSON.parse(readFileSync(join(carpeta, 'meta.json'), 'utf8'));
    assert.deepEqual(meta.references, r.references);
    assert.deepEqual(meta.links, ['references/contratos.md']);
    assert.deepEqual(r.files, ['SKILL.md', 'meta.json', 'references/contratos.md']);
  });

  it('las rutas que se aportan tienen que ser relativas, dentro de references/ y con contenido', () => {
    const casos = [
      [{ path: 'contratos.md', content: 'x' }, /tiene que ser una ruta relativa que empiece por «references\/»/],
      [{ path: 'references/', content: 'x' }, /tiene que ser una ruta relativa que empiece por «references\/»/],
      [{ path: 'references/a/../b.md', content: 'x' }, /sale de la carpeta de la skill/],
      [{ path: '../references/a.md', content: 'x' }, /tiene que ser una ruta relativa/],
      [{ path: 'references/carpeta/', content: 'x' }, /es una carpeta, no un fichero/],
      [{ path: 'references/vacia.md', content: '   ' }, /va vacía/],
      [{ path: 'C:\\otra\\ruta.md', content: 'x' }, /tiene que ser una ruta relativa/],
      [{ path: '', content: 'x' }, /tiene que ser una ruta relativa/],
      [{ content: 'x' }, /tiene que ser una ruta relativa/],
    ];
    for (const [item, esperado] of casos) {
      const r = checkReferences({ proposed: [item] });
      assert.equal(r.errors.length > 0, true, `tendría que rechazarse: ${JSON.stringify(item)}`);
      assert.match(r.errors[0], esperado, `motivo inesperado para ${JSON.stringify(item)}: ${r.errors[0]}`);
    }
    const dup = checkReferences({ proposed: [{ path: 'references/a.md', content: 'uno' }, { path: 'references/a.md', content: 'dos' }] });
    assert.match(dup.errors[0], /está repetida/);
  });

  it('una ruta que escapa de la carpeta, desde el cuerpo, se veta', () => {
    const r = validateInput({ ...goodInput(), body: cuerpoCon('`references/../../otra-skill/SKILL.md`') });
    assert.equal(r.ok, false);
    assert.match(errores(r), /sale de la carpeta de la skill/);
  });

  it('una ruta declarada que en la carpeta es un directorio se veta', () => {
    const r = validateInput({ ...goodInput(), body: cuerpoCon('`references/carpeta`') },
      { dirs: ['references', 'references/carpeta'] });
    assert.equal(r.ok, false);
    assert.match(errores(r), /es un directorio y no un fichero/);
  });

  it('una ruta declarada que ya está en la carpeta vale sin volver a aportarla', () => {
    const r = validateInput({ ...goodInput(), body: cuerpoCon('`references/ya-esta.md`') },
      { present: ['references/ya-esta.md'] });
    assert.equal(r.ok, true, errores(r));
  });

  it('Unicode y espacios en el nombre: se escriben, se leen y cuentan igual', () => {
    const s = sandbox();
    const ruta = 'references/ñandú y espacios/nota útil.md';
    const contenido = 'acentos, espacios y una ruta larga\n';
    const r = propose({ ...goodInput(), body: cuerpoCon(`\`${ruta}\``) },
      { root: s.root, curated: s.curated, cwd: CWD, references: [{ path: ruta, content: contenido }] });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors));
    const carpeta = join(s.root, 'projects', KEY(), 'proposed', 'measured-decision-check');
    assert.equal(readFileSync(join(carpeta, ...ruta.split('/')), 'utf8'), contenido);
    assert.equal(checkProposal('measured-decision-check', KEY(), { root: s.root }).ok, true);
  });

  it('normalizeRel deja una sola forma de escribir una ruta', () => {
    assert.equal(normalizeRel('references\\a\\b.md'), 'references/a/b.md');
    assert.equal(normalizeRel('./references/a.md'), 'references/a.md');
    assert.equal(normalizeRel('references//a.md'), 'references/a.md');
  });
});

// ── la puerta que se aplica al aprobar: el disco, no la petición ────────────────────────────────

describe('puerta de calidad · al aprobar', () => {
  const conReferencia = () => {
    const s = sandbox();
    const contenido = '## Contrato\n\nEl valor exacto es 24.000.\n';
    const r = propose({ ...goodInput(), body: `## Uso\n\nVer \`references/contratos.md\`.\n\n## Cierre\n\n${'x'.repeat(200)}` },
      { root: s.root, curated: s.curated, cwd: CWD, references: [{ path: 'references/contratos.md', content: contenido }] });
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors));
    return { s, contenido };
  };

  it('aprobar comprueba la integridad: una edición a mano del material se caza', () => {
    const { s } = conReferencia();
    const ok = checkProposal('measured-decision-check', KEY(), { root: s.root });
    assert.equal(ok.ok, true, errores(ok));

    writeFileSync(join(s.root, 'projects', KEY(), 'proposed', 'measured-decision-check', 'references', 'contratos.md'), 'otra cosa\n');
    const roto = checkProposal('measured-decision-check', KEY(), { root: s.root });
    assert.equal(roto.ok, false);
    assert.match(errores(roto), /cambió después de proponerse \(huella distinta\)/);
    const moved = approve('measured-decision-check', KEY(), { root: s.root });
    assert.equal(moved.ok, true, 'el movimiento no es la puerta: la CLI y los comandos la aplican antes');
  });

  it('y si el material desapareció, también, nombrando la ruta', () => {
    const { s } = conReferencia();
    const carpeta = join(s.root, 'projects', KEY(), 'proposed', 'measured-decision-check');
    rmSync(join(carpeta, 'references', 'contratos.md'));
    const r = checkProposal('measured-decision-check', KEY(), { root: s.root });
    assert.equal(r.ok, false);
    // Se caza por las dos vías: el vínculo roto del cuerpo y la constancia del registro.
    assert.match(errores(r), /references\/contratos\.md/);
  });

  it('un vínculo roto metido a mano en el SKILL.md se caza al aprobar', () => {
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    const file = join(s.root, 'projects', KEY(), 'proposed', 'measured-decision-check', 'SKILL.md');
    const editado = readFileSync(file, 'utf8').replace('## Procedure', 'El detalle está en `references/fantasma.md`.\n\n## Procedure');
    writeFileSync(file, editado);
    const r = checkProposal('measured-decision-check', KEY(), { root: s.root });
    assert.equal(r.ok, false);
    assert.match(errores(r), /declara «references\/fantasma\.md» y ese fichero no está/);
  });
});

// ── el gate: lo rechazado no toca lo aprobado ───────────────────────────────────────────────────

describe('puerta de calidad · nada rechazado toca lo aprobado', () => {
  it('una propuesta inválida no escribe nada, ni con el id de una skill ya aprobada', () => {
    const s = sandbox();
    assert.equal(propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD }).status, 'proposed');
    assert.equal(approve('measured-decision-check', KEY(), { root: s.root }).ok, true);
    const carpeta = join(s.root, 'projects', KEY(), 'approved', 'measured-decision-check');
    const antes = folderHash(carpeta);
    const metaAntes = readFileSync(join(carpeta, 'meta.json'), 'utf8');

    // Ahora, un parche que no pasa la puerta: descripción corta, material que no existe y una ruta que escapa.
    const r = propose({
      ...goodInput(),
      description: 'corta',
      body: `## Uso\n\nVer \`references/no-existe.md\` y \`references/../../fuera.md\`.\n\n## Cierre\n\n${'x'.repeat(200)}`,
    }, {
      root: s.root, curated: s.curated, cwd: CWD,
      references: [{ path: 'references/otro.md', content: '' }],
    });
    assert.equal(r.status, 'invalid');
    assert.equal(r.id, undefined, 'no se atribuye una propuesta que no existe');
    assert.equal(/demasiado corta/.test(errores(r)), true);
    assert.equal(/no está/.test(errores(r)), true);
    assert.equal(/sale de la carpeta/.test(errores(r)), true);
    assert.equal(/va vacía/.test(errores(r)), true);

    // Lo aprobado sigue igual: misma huella, mismo meta, y ninguna carpeta a medias.
    assert.equal(folderHash(carpeta), antes, 'la skill aprobada no cambió');
    assert.equal(readFileSync(join(carpeta, 'meta.json'), 'utf8'), metaAntes);
    assert.equal(existsSync(join(s.root, 'projects', KEY(), 'proposed', 'measured-decision-check')), false);
    const sobras = treeOf(join(s.root, 'projects', KEY())).files.filter((f) => f.includes('.tmp-'));
    assert.deepEqual(sobras, [], 'ni una carpeta temporal olvidada');
  });

  it('el error se puede leer: dice el campo, el número medido y la vía de arreglo', () => {
    const r = validateInput({ ...goodInput(), description: 'D'.repeat(20), body: bodyExacto(24001) });
    assert.equal(r.ok, false);
    for (const e of r.errors) assert.equal(typeof e, 'string');
    const texto = errores(r);
    assert.match(texto, /mínimo 60 caracteres/);
    assert.match(texto, /24001 > 24000/);
    // Reproducible: dos veces el mismo error, palabra por palabra.
    assert.equal(errores(validateInput({ ...goodInput(), description: 'D'.repeat(20), body: bodyExacto(24001) })), texto);
  });

  it('un error de acceso al escribir se dice y no rompe nada', () => {
    const s = sandbox();
    // `proposed` no es una carpeta sino un fichero: el destino no se puede crear y la publicación falla.
    // Es el mismo camino que un permiso denegado o un disco lleno, sin depender de la cuenta que corre.
    const raizProyecto = join(s.root, 'projects', KEY());
    mkdirSync(raizProyecto, { recursive: true });
    writeFileSync(join(raizProyecto, 'proposed'), 'un fichero donde debería ir la carpeta\n');
    const r = propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
    assert.equal(r.status, 'invalid');
    assert.match(errores(r), /no se pudo escribir la skill/);
    // Nada a medias: ni carpeta temporal, ni carpeta de skill, y el fichero que estorbaba sigue ahí.
    const arbol = treeOf(s.root);
    assert.deepEqual(arbol.files.filter((f) => f.includes('.tmp-')), []);
    assert.equal(readFileSync(join(raizProyecto, 'proposed'), 'utf8'), 'un fichero donde debería ir la carpeta\n');
  });

  it('una ACL de denegación se mide, y si la cuenta no la puede provocar se declara', (t) => {
    const s = sandbox();
    const destino = join(s.root, 'projects', KEY(), 'proposed');
    mkdirSync(destino, { recursive: true });
    const usuario = process.env.USERNAME ?? process.env.USER ?? '';
    let aplicado = false;
    try {
      execFileSync('icacls', [destino, '/deny', `${usuario}:(W,AD)`], { stdio: 'pipe' });
      aplicado = true;
    } catch { /* sin icacls o sin permiso: se declara, no se finge */ }
    if (!aplicado) {
      t.diagnostic('no se pudo aplicar una ACL de denegación en esta cuenta: el error de acceso por permisos queda SIN MEDIR');
      return;
    }
    try {
      const r = propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD });
      t.diagnostic(`escritura con ACL denegada → ${r.status}: ${r.errors?.[0] ?? '(se escribió: la cuenta puede saltarse la denegación)'}`);
      if (r.status === 'proposed') {
        t.diagnostic('la cuenta puede saltarse la denegación (administrador): queda SIN MEDIR aquí');
      } else {
        assert.equal(r.status, 'invalid');
        assert.match(errores(r), /no se pudo escribir la skill/);
      }
    } finally {
      try { execFileSync('icacls', [destino, '/remove:d', usuario], { stdio: 'pipe' }); } catch { /* la arena se borra igual */ }
    }
  });
});
