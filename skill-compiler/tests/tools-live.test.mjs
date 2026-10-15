#!/usr/bin/env node
/**
 * Las herramientas del modelo, **ejecutadas de verdad**.
 *
 * ── Por qué este fichero existe ─────────────────────────────────────────────────────────────────
 *
 * Comprobar que una herramienta compila no es comprobar que funcione: un `execute` puede compilar y
 * devolver cualquier cosa. Aquí se llama al `execute` real, con el compilador real del harness
 * (`defineTool`), y se mira **el efecto en el disco y la forma del resultado**:
 *
 *   - una propuesta válida deja la skill en `proposed/` con su `SKILL.md`;
 *   - una inválida no deja **nada**;
 *   - un parche de una skill viva sin `revision` se rechaza;
 *   - la salida no trae ni un campo fuera del esquema declarado (el contrato del harness rechaza el
 *     resultado entero si aparece uno: `additionalProperties: false`);
 *   - `skill_review` lee sin escribir: la huella del almacén no cambia.
 *
 * Y al final, el ciclo completo con las dos superficies: la herramienta del modelo propone, el motor
 * repara y promociona, y la skill queda activada y verde en la auditoría.
 *
 *   node --test tests/tools-live.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { approve, folderHash, projectKey, treeOf } from '../lib/compiler.mjs';
import { skillPropose, skillReview } from '../lib/definitions.mjs';
import { reparar } from '../lib/repair.mjs';
import { promover } from '../lib/promote.mjs';
import { auditarAlmacen } from '../lib/audit.mjs';
import { buenaRevision, cleanupSandboxes, fakeExec, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const props = (arena, id) => join(arena.root, 'projects', KEY, 'proposed', id);

/** La herramienta tal y como la recibe el modelo: compilada por el harness de verdad. */
const herramienta = (arena) => defineTool(skillPropose({ root: arena.root, curated: arena.curated }));

/** Un input que pasa la puerta, con tema propio para no chocar con el anti-solapamiento. */
const buenInput = (id) => ({
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

/**
 * Comprueba la forma (no el fondo) de un resultado contra el esquema declarado: `required` presentes, y
 * ninguna clave fuera de `properties`. Es exactamente lo que rechaza el harness cuando el esquema dice
 * `additionalProperties: false`, y es lo que dejó una propuesta convertida en error por un campo de más.
 */
function formaContraEsquema(salida, esquema, donde) {
  const propiedades = Object.keys(esquema?.properties ?? {});
  const requeridas = esquema?.required ?? [];
  assert.ok(propiedades.length > 0, `${donde}: el esquema declara propiedades`);
  for (const clave of Object.keys(salida)) {
    assert.ok(propiedades.includes(clave), `${donde}: la salida trae «${clave}», que NO está declarado en el esquema → el harness rechazaría el resultado entero`);
  }
  for (const clave of requeridas) {
    assert.ok(clave in salida, `${donde}: falta el campo obligatorio «${clave}»`);
  }
}

describe('skill_propose, ejecutada de verdad', () => {
  it('una propuesta válida llega al disco, y la salida encaja con su esquema', async () => {
    const arena = sandbox({ curated: false });
    const tool = herramienta(arena);
    // La herramienta compilada por el harness es **asíncrona**: es la superficie exacta que invoca el modelo.
    const salida = await tool.execute(buenInput('registro-de-material'), fakeExec(CWD));

    assert.equal(salida.status, 'proposed');
    assert.equal(salida.id, 'registro-de-material');
    assert.equal(existsSync(join(props(arena, 'registro-de-material'), 'SKILL.md')), true, 'el fichero tiene que estar en el disco');
    const texto = readFileSync(join(props(arena, 'registro-de-material'), 'SKILL.md'), 'utf8');
    assert.match(texto, /name: registro-de-material/);
    assert.match(texto, /origin: skill-compiler/, 'el frontmatter llega con su origen');
    formaContraEsquema(salida, tool.output?.schema, 'skill_propose');
  });

  it('una propuesta inválida no deja absolutamente nada', async () => {
    const arena = sandbox({ curated: false });
    const tool = herramienta(arena);
    const mala = { ...buenInput('descripcion-corta-aqui'), description: 'Corta.' };
    const salida = await tool.execute(mala, fakeExec(CWD));
    assert.notEqual(salida.status, 'proposed');
    assert.match((salida.errors ?? []).join(' '), /description demasiado corta/);
    assert.equal(existsSync(props(arena, 'descripcion-corta-aqui')), false, 'no puede quedar una propuesta a medias');
    const enDisco = existsSync(join(arena.root, 'projects', KEY, 'proposed'))
      ? readdirSync(join(arena.root, 'projects', KEY, 'proposed'))
      : [];
    assert.deepEqual(enDisco, [], 'ni la carpeta, ni temporales');
  });

  it('un parche de una skill viva exige revisión: con ella pasa, sin ella no', async () => {
    const arena = sandbox({ curated: false });
    const tool = herramienta(arena);
    assert.equal((await tool.execute(buenInput('registro-de-servicios'), fakeExec(CWD))).status, 'proposed');
    // Se aprueba por la vía real (el CLI usa la misma implementación).
    assert.equal(approve('registro-de-servicios', KEY, { root: arena.root, curated: arena.curated }).ok, true);

    const parche = async (over) => tool.execute({
      ...buenInput('registro-de-servicios'),
      body: `${buenInput('registro-de-servicios').body}\n4. Un paso más, que corrige lo anterior.`,
      ...over,
    }, fakeExec(CWD));

    const sin = await parche({});
    assert.notEqual(sin.status, 'proposed');
    assert.match((sin.errors ?? []).join(' '), /revision/);

    const con = await parche({ revision: buenaRevision() });
    assert.equal(con.status, 'proposed', JSON.stringify(con.errors));
    assert.ok(con.base, 'la propuesta identifica la versión base');
    formaContraEsquema(con, tool.output?.schema, 'skill_propose (parche)');
  });

  it('skill_review lee sin escribir: la huella del almacén no cambia', async () => {
    const arena = sandbox({ curated: false });
    await herramienta(arena).execute(buenInput('registro-de-albaranes'), fakeExec(CWD));
    const antes = folderHash(arena.root);
    const ficherosAntes = treeOf(arena.root);
    const review = defineTool(skillReview({ root: arena.root, curated: arena.curated }));
    const salida = await review.execute({}, fakeExec(CWD));
    assert.ok(salida && typeof salida === 'object', 'la revisión devuelve algo');
    assert.equal(folderHash(arena.root), antes, 'revisar no puede escribir');
    assert.deepEqual(treeOf(arena.root), ficherosAntes);
  });
});

describe('el ciclo completo, con las dos superficies', () => {
  it('el modelo propone, el motor repara y promociona, y la auditoría lo confirma', async () => {
    const arena = sandbox({ curated: false });
    // 1. El modelo propone, con la herramienta real.
    const tool = herramienta(arena);
    assert.equal((await tool.execute(buenInput('registro-de-flota'), fakeExec(CWD))).status, 'proposed');
    assert.equal(approve('registro-de-flota', KEY, { root: arena.root, curated: arena.curated }).ok, true);

    // 2. Se ensucia la skill viva (una edición a mano de las que pasan en la vida real).
    const dir = join(arena.root, 'projects', KEY, 'approved', 'registro-de-flota');
    const texto = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const cabecera = texto.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n#\s[^\n]*\r?\n/)[0];
    writeFileSync(join(dir, 'SKILL.md'), `${cabecera}## Cuándo se usa   \r\n\r\nCuando toca la flota, con las hojas delante.   \r\n\r\n## Procedimiento  \r\n\r\n1. Recorre la flota entera y anota el número que sale.   \r\n2. Compara con el registro previo y declara la diferencia.  \r\n3. Cierra solo las referencias que cuadren.  \r\n\r\n\r\n`);

    // 3. La marca está en el disco, y la auditoría lo mide con su propia vara: la skill sigue conforme
    //    (la forma canónica la vigila el motor de reparación, no la puerta de calidad).
    assert.equal(/[ \t]+\r?\n/.test(readFileSync(join(dir, 'SKILL.md'), 'utf8')), true, 'la edición a mano dejó su marca');
    const conFallo = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.ok(conFallo.skills.find((s) => s.id === 'registro-de-flota'), 'la skill está en el almacén');

    // 4. El motor lo detecta, prepara y promociona (nivel 1, autorizado aquí y sólo aquí).
    const preparada = reparar('registro-de-flota', KEY, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(preparada.status, 'proposed');
    assert.equal(preparada.reparaciones.some((r) => r.regla === 'un-normalizado'), true, 'la forma es lo que el motor arregla');
    const p = promover('registro-de-flota', KEY, { root: arena.root, curated: arena.curated, cwd: CWD, niveles: [1] });
    assert.equal(p.status, 'promoted', JSON.stringify(p.regresion?.pruebas));

    // 5. Y la auditoría confirma que la skill quedó limpia, con la anterior apartada.
    const despues = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const activada = despues.skills.find((s) => s.id === 'registro-de-flota' && s.estado === 'approved');
    assert.equal(activada.status, 'PASS', JSON.stringify(activada.findings));
    assert.equal(despues.skills.some((s) => s.estado === 'superseded'), true, 'la versión anterior sigue en el almacén');
  });
});
