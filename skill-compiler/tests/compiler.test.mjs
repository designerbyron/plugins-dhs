#!/usr/bin/env node
/**
 * Puerta del compilador de conocimiento.
 *
 * Todo se prueba contra una raíz y una biblioteca curada TEMPORALES: estas pruebas no leen ni escriben
 * la biblioteca real de la máquina, y no necesitan que el plugin esté instalado. Lo que se comprueba
 * aquí es la lógica que decide qué se propone, qué se rechaza y qué se sirve a cada proyecto.
 *
 *   node --test tests/
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  approve, checkOverlap, existingSkills, listForProject, overview, parseFrontmatter, pending,
  projectKey, propose, readSkill, reject, renderSkill, similarity, validateInput,
} from '../lib/compiler.mjs';
import { GOOD_BODY, cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

// ── identidad de proyecto ────────────────────────────────────────────────────────────────────────

describe('projectKey', () => {
  it('es estable y legible, y distingue dos proyectos con el mismo nombre', () => {
    const a = projectKey('C:\\xampp\\htdocs\\saas-corporative');
    const b = projectKey('C:\\xampp\\htdocs\\saas-corporative');
    const other = projectKey('D:\\work\\saas-corporative');
    assert.equal(a, b, 'la misma ruta da la misma clave');
    assert.notEqual(a, other, 'mismo nombre de carpeta en otra ruta NO colisiona');
    assert.match(a, /^saas-corporative-[0-9a-f]{8}$/);
  });

  it('devuelve null sin cwd utilizable', () => {
    assert.equal(projectKey(''), null);
    assert.equal(projectKey(undefined), null);
  });
});

// ── validación ───────────────────────────────────────────────────────────────────────────────────

describe('validateInput', () => {
  it('acepta una propuesta correcta', () => {
    const v = validateInput(goodInput());
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.deepEqual(v.errors, []);
  });

  it('rechaza ids que DSH no aceptaría', () => {
    for (const id of ['Con-Mayusculas', 'con_guion_bajo', '1empieza-por-numero', 'con espacio', '']) {
      assert.equal(validateInput(goodInput({ id })).ok, false, `debería rechazar "${id}"`);
    }
  });

  it('rechaza una descripción que el modelo no podría usar para elegir', () => {
    assert.equal(validateInput(goodInput({ description: 'corta' })).ok, false);
    assert.equal(validateInput(goodInput({ description: `linea\npartida` })).ok, false);
    assert.equal(validateInput(goodInput({ description: 'x'.repeat(400) })).ok, false);
  });

  it('rechaza un body de titular en vez de procedimiento', () => {
    assert.equal(validateInput(goodInput({ body: 'Haz cosas.' })).ok, false);
  });

  it('veta credenciales: una skill no lleva secretos nunca', () => {
    const cases = [
      'api_key = "sk-EXAMPLE00000000000000"',
      'password: EXAMPLE-not-a-real-secret',
      'Authorization: Bearer EXAMPLE0000000000',
      'token = eyJEXAMPLE0000000000000',
      ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
      'ghp_EXAMPLE000000000000000',
    ];
    for (const line of cases) {
      const v = validateInput(goodInput({ body: `${GOOD_BODY}\n\n${line}\n` }));
      assert.equal(v.ok, false, `debería vetar: ${line}`);
      assert.match(v.errors.join(' '), /credencial/);
    }
  });

  it('veta rutas personales de la máquina del autor', () => {
    for (const line of ['C:\\Users\\BYRON\\AppData\\Local\\hermes', '/home/byron/.config/x']) {
      const v = validateInput(goodInput({ body: `${GOOD_BODY}\n\n${line}\n` }));
      assert.equal(v.ok, false, `debería vetar: ${line}`);
      assert.match(v.errors.join(' '), /ruta personal/);
    }
  });

  it('avisa de rutas absolutas sin vetarlas, y no veta $DSH_HOME', () => {
    const warn = validateInput(goodInput({ body: `${GOOD_BODY}\n\nUsa C:\\xampp\\php\\php.exe para esto.\n` }));
    assert.equal(warn.ok, true);
    assert.equal(warn.warnings.length > 0, true);
    const clean = validateInput(goodInput({ body: `${GOOD_BODY}\n\nLee $DSH_HOME/skills/.system/lib/dsh-store.mjs\n` }));
    assert.deepEqual(clean.warnings, []);
  });
});

// ── composición del SKILL.md ─────────────────────────────────────────────────────────────────────

describe('renderSkill', () => {
  const rendered = renderSkill({
    id: 'measured-decision-check',
    description: 'Decide with measured evidence instead of impressions.',
    whenToUse: 'Cuando una decisión necesite un número medido.',
    body: GOOD_BODY,
    project: 'C:\\xampp\\htdocs\\saas-corporative',
    projectKey: 'saas-corporative-abc12345',
    evidence: ['docs/agent/DEEPSEEK_USAGE.md'],
    createdAt: '2026-10-12T00:00:00.000Z',
  });

  it('produce frontmatter que DSH acepta tal cual', () => {
    const { data, body } = parseFrontmatter(rendered);
    assert.equal(data.name, 'measured-decision-check');
    assert.match(data.name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    assert.equal(data.description, 'Decide with measured evidence instead of impressions.');
    assert.equal(data.whenToUse, 'Cuando una decisión necesite un número medido.');
    assert.equal(body.includes('## Procedure'), true, 'el cuerpo sobrevive al frontmatter');
  });

  it('lleva la procedencia y el ámbito de proyecto en metadata.dsh', () => {
    const { data } = parseFrontmatter(rendered);
    assert.equal(data.metadata.dsh.origin, 'skill-compiler');
    assert.equal(data.metadata.dsh.projectKey, 'saas-corporative-abc12345');
    assert.match(rendered, /evidence: \["docs\/agent\/DEEPSEEK_USAGE\.md"\]/);
  });

  it('no emite las claves de invocación heredadas que el proveedor rechaza', () => {
    assert.equal(/modelInvocable|userInvocable/.test(rendered), false);
    assert.equal(/disable-model-invocation/.test(rendered), false, 'aquí no se decide el silenciado');
  });

  it('aplana una descripción multilínea en la comilla, sin romper el YAML', () => {
    const r = renderSkill({ id: 'x-y', description: 'una   descripcion\ncon salto', body: GOOD_BODY, project: 'p', projectKey: 'k', createdAt: 't' });
    const line = r.split('\n').find((l) => l.startsWith('description:'));
    assert.equal(line, 'description: "una descripcion con salto"');
  });
});

// ── solapamiento ─────────────────────────────────────────────────────────────────────────────────

describe('checkOverlap', () => {
  it('mide parecido de tema y no de nombre exacto', () => {
    const a = { id: 'session-state-recovery', description: 'Rebuild state after a lost or closed session.' };
    const b = { id: 'session-recovery-state', description: 'Rebuilding the state of a closed session.' };
    assert.equal(similarity(a, b) >= 0.5, true, `parecido insuficiente: ${similarity(a, b)}`);
  });

  it('no confunde dos temas distintos', () => {
    const a = { id: 'session-state-recovery', description: 'Rebuild state after a lost or closed session.' };
    const b = { id: 'measured-decision-check', description: 'Decide with measured evidence instead of impressions.' };
    assert.equal(similarity(a, b) < 0.5, true, `falso positivo: ${similarity(a, b)}`);
  });

  it('da colisión dura por id ocupado', () => {
    const r = checkOverlap({ id: 'session-state-recovery', description: 'otra cosa completamente distinta aqui' },
      [{ id: 'session-state-recovery', description: 'x', where: 'biblioteca-curada' }]);
    assert.equal(r.ok, false);
    assert.equal(r.conflicts[0].reason, 'id-ocupado');
  });
});

// ── proponer ─────────────────────────────────────────────────────────────────────────────────────

describe('propose', () => {
  it('escribe la propuesta y no la activa', () => {
    const s = sandbox();
    const r = propose(goodInput(), { root: s.root, curated: s.curated, cwd: 'C:\\xampp\\htdocs\\saas-corporative' });
    assert.equal(r.status, 'proposed');
    assert.equal(existsSync(r.path), true);
    assert.equal(r.projectKey, projectKey('C:\\xampp\\htdocs\\saas-corporative'));
    assert.equal(listForProject('C:\\xampp\\htdocs\\saas-corporative', { root: s.root }).length, 0,
      'una propuesta no se sirve al modelo hasta que se aprueba');
  });

  it('es idempotente: reproponer el mismo id deja UNA carpeta y sin restos temporales', () => {
    const s = sandbox();
    const cwd = 'C:\\xampp\\htdocs\\saas-corporative';
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    const second = propose(goodInput({ body: `${GOOD_BODY}\n\n4. Un paso más.\n` }), { root: s.root, curated: s.curated, cwd });
    assert.equal(second.status, 'proposed', JSON.stringify(second.conflicts ?? []));

    const dir = join(s.root, 'projects', projectKey(cwd), 'proposed');
    const entries = readdirSync(dir);
    assert.deepEqual(entries, ['measured-decision-check'], `sobran restos: ${entries.join(', ')}`);
    assert.match(readFileSync(join(dir, 'measured-decision-check', 'SKILL.md'), 'utf8'), /Un paso más/);
  });

  it('una propuesta que mejora una skill ya aprobada lo dice, y aprobarla aparta la anterior', () => {
    const s = sandbox();
    const cwd = 'C:\\p';
    const key = projectKey(cwd);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    approve('measured-decision-check', key, { root: s.root });

    const second = propose(goodInput({ body: `${GOOD_BODY}\n\n4. Un paso más.\n` }), { root: s.root, curated: s.curated, cwd });
    assert.equal(second.status, 'proposed');
    assert.equal(second.updatesApproved, true, 'debe avisar de que reemplazará la aprobada');

    const again = approve('measured-decision-check', key, { root: s.root });
    assert.equal(again.ok, true);
    assert.equal(typeof again.superseded, 'string', 'la versión anterior debe quedar apartada, no borrada');
    assert.equal(existsSync(again.superseded), true);
    assert.match(readFileSync(again.path, 'utf8'), /Un paso más/);
  });

  it('no escribe nada cuando la entrada es inválida', () => {
    const s = sandbox();
    const r = propose(goodInput({ body: `${GOOD_BODY}\n\napi_key = "sk-EXAMPLE00000000000000"\n` }), { root: s.root, curated: s.curated, cwd: 'C:\\p' });
    assert.equal(r.status, 'invalid');
    assert.equal(existsSync(join(s.root, 'projects', projectKey('C:\\p'), 'proposed', 'measured-decision-check')), false);
  });

  it('rechaza por solapamiento con la biblioteca curada, y dice con cuál', () => {
    const s = sandbox();
    const r = propose(goodInput({
      id: 'session-recovery-state',
      description: 'Rebuilding the state of a lost or closed session.',
      whenToUse: 'Cuando una sesión se cerró y hay que reconstruir su estado.',
    }), { root: s.root, curated: s.curated, cwd: 'C:\\p' });
    assert.equal(r.status, 'conflict');
    assert.equal(r.conflicts.some((c) => c.id === 'session-state-recovery'), true, JSON.stringify(r.conflicts));
  });

  it('exige un cwd: sin proyecto no hay ámbito, y sin ámbito no hay propuesta', () => {
    const s = sandbox();
    assert.equal(propose(goodInput(), { root: s.root, curated: s.curated, cwd: '' }).status, 'no-project');
  });
});

// ── aislamiento por proyecto ─────────────────────────────────────────────────────────────────────

describe('aislamiento por proyecto', () => {
  it('una skill aprendida en A no se sirve en B ni en C', () => {
    const s = sandbox();
    const a = 'C:\\xampp\\htdocs\\saas-corporative';
    const b = 'D:\\work\\otro-cliente';
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: a });
    approve('measured-decision-check', projectKey(a), { root: s.root });

    assert.deepEqual(listForProject(a, { root: s.root }).map((x) => x.id), ['measured-decision-check']);
    assert.deepEqual(listForProject(b, { root: s.root }), [], 'no debe cargarse en otro proyecto');
    assert.deepEqual(listForProject('C:\\xampp\\htdocs\\tercero', { root: s.root }), []);
  });

  it('el mismo id puede existir en dos proyectos sin pisarse', () => {
    const s = sandbox();
    const a = 'C:\\proyecto-a';
    const b = 'C:\\proyecto-b';
    const ra = propose(goodInput(), { root: s.root, curated: s.curated, cwd: a });
    const rb = propose(goodInput(), { root: s.root, curated: s.curated, cwd: b });
    assert.equal(ra.status, 'proposed');
    assert.equal(rb.status, 'proposed', 'otro proyecto es otro ámbito, no una colisión');
    approve('measured-decision-check', projectKey(a), { root: s.root });
    approve('measured-decision-check', projectKey(b), { root: s.root });
    assert.equal(listForProject(a, { root: s.root }).length, 1);
    assert.equal(listForProject(b, { root: s.root }).length, 1);
  });

  it('un mismo tema en otro proyecto se informa, no se veta', () => {
    const s = sandbox();
    const a = 'C:\\proyecto-a';
    const b = 'C:\\proyecto-b';
    propose(goodInput({ id: 'measured-decision-check' }), { root: s.root, curated: s.curated, cwd: a });
    const other = propose(goodInput({ id: 'evidence-first-decision' }), { root: s.root, curated: s.curated, cwd: b });
    assert.equal(other.status, 'proposed', 'existe en A, pero B es otro ámbito');
    assert.equal(other.relatedElsewhere.length > 0, true, 'y aun así debe decirlo');
    assert.equal(other.relatedElsewhere[0].id, 'measured-decision-check');
  });
});

// ── aprobar y rechazar ───────────────────────────────────────────────────────────────────────────

describe('approve y reject', () => {
  it('aprobar activa la skill y no deja copia en proposed', () => {
    const s = sandbox();
    const cwd = 'C:\\p';
    const key = projectKey(cwd);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    assert.equal(pending({ root: s.root, key }).length, 1);
    const r = approve('measured-decision-check', key, { root: s.root });
    assert.equal(r.ok, true);
    assert.equal(pending({ root: s.root, key }).length, 0);
    assert.equal(existsSync(join(s.root, 'projects', key, 'proposed', 'measured-decision-check')), false);
  });

  it('no aprueba dos veces la misma skill', () => {
    const s = sandbox();
    const cwd = 'C:\\p';
    const key = projectKey(cwd);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    approve('measured-decision-check', key, { root: s.root });
    const again = approve('measured-decision-check', key, { root: s.root });
    assert.equal(again.ok, false);
    assert.match(again.reason, /no existe/);
  });

  it('rechazar la aparta sin borrarla y la saca de pendientes', () => {
    const s = sandbox();
    const cwd = 'C:\\p';
    const key = projectKey(cwd);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    assert.equal(reject('measured-decision-check', key, { root: s.root }).ok, true);
    assert.equal(pending({ root: s.root, key }).length, 0);
    assert.equal(existsSync(join(s.root, 'projects', key, 'rejected', 'measured-decision-check', 'SKILL.md')), true);
  });

  it('deja el estado legible para el informe', () => {
    const s = sandbox();
    const cwd = 'C:\\p';
    const key = projectKey(cwd);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    const o = overview({ root: s.root });
    assert.equal(o.length, 1);
    assert.equal(o[0].projectKey, key);
    assert.deepEqual(o[0].proposed.map((p) => p.id), ['measured-decision-check']);
    assert.deepEqual(o[0].approved, []);
  });
});

// ── lo que el proveedor entrega ──────────────────────────────────────────────────────────────────

describe('readSkill', () => {
  it('devuelve el cuerpo sin frontmatter y los metadatos de origen', () => {
    const s = sandbox();
    const cwd = 'C:\\p';
    const key = projectKey(cwd);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    approve('measured-decision-check', key, { root: s.root });
    const listed = listForProject(cwd, { root: s.root })[0];
    const skill = readSkill(listed.path);
    assert.equal(skill.name, 'measured-decision-check');
    assert.equal(skill.content.startsWith('# '), true, 'el documento lleva su encabezado de nivel 1');
    assert.equal(skill.content.includes('## When to Use'), true, 'y el procedimiento detrás');
    assert.equal(/^---/.test(skill.content), false, 'el frontmatter no viaja en el cuerpo');
    assert.equal(skill.metadata.dsh.origin, 'skill-compiler');
  });

  it('devuelve null si la skill perdió su descripción', () => {
    const s = sandbox();
    const file = join(s.root, 'projects', 'x', 'approved', 'y', 'SKILL.md');
    mkdirSync(join(s.root, 'projects', 'x', 'approved', 'y'), { recursive: true });
    writeFileSync(file, '---\nname: y\n---\n\n# y\n');
    assert.equal(readSkill(file), null);
    assert.equal(readSkill(join(s.root, 'no-existe', 'SKILL.md')), null);
  });
});

// ── inventario de lo existente ───────────────────────────────────────────────────────────────────

describe('existingSkills', () => {
  it('ve la biblioteca curada y lo aprendido, con su origen', () => {
    const s = sandbox();
    const cwd = 'C:\\p';
    const key = projectKey(cwd);
    propose(goodInput(), { root: s.root, curated: s.curated, cwd });
    const all = existingSkills({ root: s.root, curated: s.curated });
    assert.equal(all.some((x) => x.id === 'session-state-recovery' && x.where === 'biblioteca-curada'), true);
    assert.equal(all.some((x) => x.id === 'measured-decision-check' && x.where === `propuesto:${key}`), true);
  });

  it('no confunde el directorio de herramientas con una skill', () => {
    const s = sandbox();
    mkdirSync(join(s.curated, '.system'), { recursive: true });
    writeFileSync(join(s.curated, '.system', 'SKILL.md'), '---\nname: no-soy-una-skill\ndescription: "no deberia aparecer"\n---\n');
    const ids = existingSkills({ root: s.root, curated: s.curated }).map((x) => x.id);
    assert.equal(ids.includes('no-soy-una-skill'), false, '.system está fuera del alcance del inventario');
  });
});
