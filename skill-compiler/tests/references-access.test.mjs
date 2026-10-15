#!/usr/bin/env node
/**
 * Fase 0 — ¿el modelo alcanza DE VERDAD los ficheros de `references/` de una skill?
 *
 * ── Qué se mide aquí, y por qué no basta con que los ficheros existan ─────────────────────────────
 *
 * El plan de la v2.0.0 manda el conocimiento pesado a `references/` y deja el cuerpo corto. Eso sólo
 * se sostiene si el camino completo funciona: el harness tiene que **entregarle al modelo** la ruta
 * base de la skill, y el modelo tiene que **recuperar** el contenido. Que el fichero esté en disco no
 * demuestra ninguna de las dos cosas.
 *
 * Por eso esta puerta monta el **registro real** de skills del harness (`@deepseek-ai/dsh-skill`) con
 * el **provider real** del plugin —el mismo montaje que `catalog-freshness.test.mjs`— y pasa la
 * definición cargada por el **renderizador real** del harness (`renderSkillContent`), que es
 * literalmente el bloque `<skill_content>` que el modelo recibe. Después usa ese bloque como lo haría
 * el modelo: resuelve las rutas relativas contra la base declarada y lee.
 *
 * Los modos de fallo que la Fase 0 tiene que dejar medidos: referencia inexistente, referencia que
 * **escapa** de la carpeta (contención), referencia que es un directorio y no un fichero, y acceso
 * denegado por ACL. Y en los cuatro, la skill **sigue sirviéndose**: un recurso roto no puede tumbar
 * el catálogo.
 *
 *   node --test tests/references-access.e2e.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { after, describe, it } from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import SkillRegistry, { renderSkillContent } from '@deepseek-ai/dsh-skill';

import { createCatalogSignal } from '../lib/catalog-signal.mjs';
import { approve, folderHash, listForProject, projectKey, propose } from '../lib/compiler.mjs';
import { skillProvider } from '../lib/definitions.mjs';
import { buenaRevision, cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const ID = 'measured-decision-check';
const KEY = () => projectKey(CWD);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** El montaje de producción: registro real + provider real del plugin. */
async function mount(root) {
  const ctx = new Context();
  ctx.plugin(SkillRegistry);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(typeof ctx.skills?.registerProvider, 'function', 'el registro real no se montó');
  const catalog = createCatalogSignal({ root, watch: false, debounceMs: 10 });
  ctx.skills.registerProvider((control) => {
    catalog.bind(control?.invalidate);
    return skillProvider({ root });
  });
  catalog.start();
  return ctx.skills;
}

/** Propone y aprueba una skill con referencias, y devuelve la ruta base que el harness declarará. */
function skillWithReferences({ extraFiles }) {
  const s = sandbox();
  const result = propose(goodInput(), { root: s.root, curated: s.curated, cwd: CWD, extraFiles });
  assert.equal(result.status, 'proposed');
  const moved = approve(ID, KEY(), { root: s.root });
  assert.equal(moved.ok, true, moved.reason);
  return s;
}

describe('Fase 0 · el modelo alcanza las referencias de una skill', () => {
  it('el harness declara la ruta base y el contenido se recupera íntegro', async () => {
    const REL = 'references/detalle-de-la-trampa.md';
    const CONTENIDO = '## Detalle\n\nEl valor exacto es 24.000 y el orden importa.\n';
    const s = skillWithReferences({ extraFiles: { [REL]: CONTENIDO } });
    const skills = await mount(s.root);

    const def = await skills.get(ID, { cwd: CWD });
    assert.ok(def !== undefined, 'la skill aprobada tiene que cargarse');
    assert.equal(def.resourceBase?.kind, 'directory', `resourceBase: ${JSON.stringify(def.resourceBase)}`);
    const base = def.resourceBase.path;

    // 1) El bloque que el modelo recibe lleva la ruta base y la orden de resolver contra ella.
    const rendered = renderSkillContent(def);
    assert.match(rendered, /<skill_resources>/);
    assert.match(rendered, /<\/skill_resources>/);
    assert.match(rendered, new RegExp(`Base directory for this skill: ${escapeRe(base)}`));
    assert.match(rendered, /Resolve relative paths mentioned by this skill against the base directory/);
    assert.match(rendered, new RegExp(`<skill_content name="${ID}">`));

    // 2) La base declarada es la carpeta real de la skill aprobada.
    assert.equal(base, join(s.root, 'projects', KEY(), 'approved', ID));
    assert.equal(existsSync(base), true);

    // 3) El paso que da el modelo: resolver la ruta relativa contra la base y leer.
    const abs = resolve(base, REL);
    assert.equal(abs.startsWith(base + sep), true, `la ruta resuelta se sale de la base: ${abs}`);
    assert.equal(existsSync(abs), true);
    assert.equal(sha(readFileSync(abs, 'utf8')), sha(CONTENIDO), 'el contenido recuperado no es el aprobado');
  });

  it('los recursos entran en la huella: editarlos a mano cambia la huella de la skill', async () => {
    const REL = 'references/huella.md';
    const s = skillWithReferences({ extraFiles: { [REL]: 'contenido uno\n' } });
    const carpeta = join(s.root, 'projects', KEY(), 'approved', ID);
    const antes = folderHash(carpeta);
    writeFileSync(join(carpeta, REL), 'contenido dos, editado a mano\n');
    assert.notEqual(folderHash(carpeta), antes, 'la huella tiene que notar una edición en references/');
  });

  it('referencia inexistente: ENOENT medido, y la skill sigue sirviéndose', async () => {
    const s = skillWithReferences({ extraFiles: { 'references/existe.md': 'estoy aquí\n' } });
    const skills = await mount(s.root);
    const def = await skills.get(ID, { cwd: CWD });
    const falta = resolve(def.resourceBase.path, 'references/no-existe.md');
    assert.equal(existsSync(falta), false);
    const error = (() => { try { readFileSync(falta, 'utf8'); return null; } catch (e) { return e; } })();
    assert.equal(error?.code, 'ENOENT', `código medido: ${error?.code ?? 'ninguno'}`);

    // El recurso roto no puede llevarse el catálogo: la skill se sigue listando y cargando.
    const list = await skills.list({ cwd: CWD });
    assert.equal(list.some((row) => row.name === ID), true);
    assert.ok(await skills.get(ID, { cwd: CWD }));
    assert.deepEqual(listForProject(CWD, { root: s.root }).map((e) => e.id), [ID]);
  });

  it('una referencia que escapa de la carpeta no se resuelve dentro: la contención lo delata', async () => {
    const s = skillWithReferences({ extraFiles: { 'references/dentro.md': 'dentro\n' } });
    const skills = await mount(s.root);
    const def = await skills.get(ID, { cwd: CWD });
    const base = def.resourceBase.path;

    // Un fichero real, fuera de la carpeta de la skill (como lo estaría el resto del almacén).
    const fuera = join(s.root, 'projects', KEY(), 'approved', 'secreto-de-otra-skill.md');
    writeFileSync(fuera, 'no es de esta skill\n');
    const escapada = resolve(base, '../secreto-de-otra-skill.md');
    assert.equal(existsSync(escapada), true, 'el fichero existe fuera');
    assert.equal(escapada.startsWith(base + sep), false, 'y la contención tiene que verlo: escapa de la base');
  });

  it('referencia que es un directorio: EISDIR medido, no un catálogo caído', async () => {
    const s = skillWithReferences({ extraFiles: { 'references/carpeta/nota.md': 'anidada\n' } });
    const skills = await mount(s.root);
    const def = await skills.get(ID, { cwd: CWD });
    const esDir = resolve(def.resourceBase.path, 'references/carpeta');
    const error = (() => { try { readFileSync(esDir, 'utf8'); return null; } catch (e) { return e; } })();
    assert.equal(error?.code, 'EISDIR', `código medido: ${error?.code ?? 'ninguno'}`);
    assert.ok(await skills.get(ID, { cwd: CWD }));
  });

  it('nombres con acentos y espacios se recuperan igual', async () => {
    const REL = 'references/ñandú y espacios/nota útil.md';
    const CONTENIDO = 'acentos y espacios en el nombre\n';
    const s = skillWithReferences({ extraFiles: { [REL]: CONTENIDO } });
    const skills = await mount(s.root);
    const def = await skills.get(ID, { cwd: CWD });
    const abs = resolve(def.resourceBase.path, REL);
    assert.equal(sha(readFileSync(abs, 'utf8')), sha(CONTENIDO));
  });

  it('acceso denegado: se mide el código real, y si la cuenta no lo puede provocar se declara', async (t) => {
    const s = skillWithReferences({ extraFiles: { 'references/vedado.md': 'no deberías leer esto\n' } });
    const skills = await mount(s.root);
    const def = await skills.get(ID, { cwd: CWD });
    const vedado = resolve(def.resourceBase.path, 'references/vedado.md');
    const usuario = process.env.USERNAME ?? process.env.USER ?? '';
    let aplicado = false;
    try {
      execFileSync('icacls', [vedado, '/deny', `${usuario}:(R)`], { stdio: 'pipe' });
      aplicado = true;
    } catch { /* sin icacls, o sin permiso para cambiar la ACL: se declara, no se finge */ }
    if (!aplicado) {
      t.diagnostic('no se pudo aplicar una ACL de denegación en esta cuenta: el modo de acceso denegado queda SIN MEDIR');
      return;
    }
    try {
      const error = (() => { try { readFileSync(vedado, 'utf8'); return null; } catch (e) { return e; } })();
      t.diagnostic(`lectura con ACL denegada → ${error?.code ?? 'la lectura FUNCIONÓ (cuenta con privilegios)'}`);
      if (error === null) {
        t.diagnostic('la cuenta puede saltarse la denegación (administrador): el modo de acceso denegado queda SIN MEDIR aquí');
      } else {
        assert.match(error.code, /^(EACCES|EPERM)$/, `código inesperado: ${error.code}`);
      }
      // En cualquiera de los dos casos, la skill sigue sirviéndose: un recurso ilegible no la tumba.
      assert.ok(await skills.get(ID, { cwd: CWD }));
    } finally {
      try { execFileSync('icacls', [vedado, '/remove:d', usuario], { stdio: 'pipe' }); } catch { /* la arena se borra igual */ }
    }
  });

  it('al aprobar una actualización, la base declarada es la vigente y la anterior conserva sus referencias', async () => {
    const REL = 'references/vivo.md';
    const s = skillWithReferences({ extraFiles: { [REL]: 'versión uno\n' }, });
    const skills = await mount(s.root);
    const antes = (await skills.get(ID, { cwd: CWD })).resourceBase.path;
    assert.equal(antes.endsWith(join('approved', ID)), true, antes);
    assert.equal(sha(readFileSync(resolve(antes, REL), 'utf8')), sha('versión uno\n'));

    // Una actualización: mismo id, con su referencia nueva. La aprobación aparta la versión anterior.
    const segunda = propose({ ...goodInput(), body: `${goodInput().body}\n4. Un paso más que corrige lo anterior.\n`, revision: buenaRevision() },
      { root: s.root, curated: s.curated, cwd: CWD, extraFiles: { [REL]: 'versión dos, corregida\n' } });
    assert.equal(segunda.status, 'proposed');
    assert.equal(segunda.updatesApproved, true);
    const moved = approve(ID, KEY(), { root: s.root });
    assert.equal(moved.ok, true, moved.reason);
    assert.equal(typeof moved.superseded, 'string', 'la versión anterior tiene que quedar apartada');

    const despues = (await skills.get(ID, { cwd: CWD })).resourceBase.path;
    assert.equal(despues, antes, 'la vigente ocupa la misma carpeta aprobada');
    assert.equal(sha(readFileSync(resolve(despues, REL), 'utf8')), sha('versión dos, corregida\n'), 'lo que se sirve es la versión nueva');
    // Y lo anterior NO se pierde: sus referencias viajan con él a `superseded/`.
    assert.equal(sha(readFileSync(resolve(moved.superseded, REL), 'utf8')), sha('versión uno\n'));
  });

  it('una skill sin references/ se sirve igual: la base existe aunque no haya subcarpeta', async () => {
    const s = skillWithReferences({ extraFiles: {} });
    const skills = await mount(s.root);
    const def = await skills.get(ID, { cwd: CWD });
    const base = def.resourceBase.path;
    assert.equal(existsSync(base), true);
    assert.equal(existsSync(join(base, 'references')), false);
    assert.match(renderSkillContent(def), /Base directory for this skill:/);
  });
});
