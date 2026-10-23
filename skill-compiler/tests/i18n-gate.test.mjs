/**
 * La puerta de i18n: verde sobre el repositorio, y **roja** ante una violación real.
 *
 * Una puerta que sólo pasa no es una puerta. La prueba negativa copia las piezas a una carpeta temporal, rompe
 * una cosa concreta y exige que la puerta falle nombrando la regla y el fichero. Nada de esto toca el árbol.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

const RAIZ = process.cwd();
const GATE = join(RAIZ, 'tools', 'i18n-gate.mjs');
const temporales = [];

after(() => { for (const d of temporales) rmSync(d, { recursive: true, force: true }); });

function copia() {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-gate-'));
  temporales.push(dir);
  cpSync(join(RAIZ, 'lib'), join(dir, 'lib'), { recursive: true });
  cpSync(join(RAIZ, 'client.js'), join(dir, 'client.js'));
  cpSync(join(RAIZ, 'index.js'), join(dir, 'index.js'));
  return dir;
}

const corre = (raiz) => spawnSync(process.execPath, [GATE, '--root', raiz], { encoding: 'utf8' });

describe('i18n gate · el repositorio pasa', () => {
  it('en orden, y dice cuántas claves y cuántas operaciones ha visto', () => {
    const r = corre(RAIZ);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /I18N: en orden/);
    // El recuento es el del modelo nuevo: 16 operaciones x 2 nombres, 1 activo por idioma.
    assert.match(r.stdout, /16 operaciones x 2 nombres, 1 activo por idioma/);
    assert.doesNotMatch(r.stdout, /alias/);
  });
});

describe('i18n gate · detecta violaciones reales', () => {
  it('una clave que sólo existe en un idioma rompe la paridad', () => {
    const dir = copia();
    const es = join(dir, 'lib', 'i18n', 'es.mjs');
    const texto = readFileSync(es, 'utf8').replace(/\n\s*'code\.activated':[^\n]*\n/, '\n');
    writeFileSync(es, texto, 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1, 'debería fallar');
    assert.match(r.stdout, /FALLO paridad · es:code\.activated/);
  });

  it('texto español dentro del catálogo inglés, y al revés', () => {
    const dir = copia();
    const en = join(dir, 'lib', 'i18n', 'en.mjs');
    writeFileSync(en, readFileSync(en, 'utf8').replace("'code.activated': 'Active: {id} [{key}]'", "'code.activated': 'Activa para el proyecto: {id}'"), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FALLO idioma-cruzado · en:code\.activated/);
  });

  it('un código sin texto en un idioma se denuncia', () => {
    const dir = copia();
    const codes = join(dir, 'lib', 'i18n', 'codes.mjs');
    writeFileSync(codes, readFileSync(codes, 'utf8').replace("  rejected: ['id'],", "  rejected: ['id'],\n  inventado: ['id'],").replace("'already-published'", "'already-published'"), 'utf8');
    // y su texto sólo en inglés
    const en = join(dir, 'lib', 'i18n', 'en.mjs');
    writeFileSync(en, readFileSync(en, 'utf8').replace("  // doctor", "  'code.inventado': 'Invented: {id}',\n\n  // doctor"), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FALLO codigo-sin-texto · es:code\.inventado/);
  });

  it('dos operaciones con el MISMO nombre en un idioma se denuncian', () => {
    const dir = copia();
    const mapa = join(dir, 'lib', 'localized-commands.mjs');
    writeFileSync(mapa, readFileSync(mapa, 'utf8')
      .replace("names: Object.freeze({ en: 'skill-reject', es: 'skill-rechazar' })", "names: Object.freeze({ en: 'skill-reject', es: 'skill-aprobar' })"), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FALLO nombre-duplicado · lib\/localized-commands\.mjs:reject/);
  });

  it('una definicion base sin operacion (o al reves) se denuncia: su nombre no seguiria al idioma', () => {
    const dir = copia();
    const cmds = join(dir, 'lib', 'commands.mjs');
    writeFileSync(cmds, readFileSync(cmds, 'utf8').replace("      name: 'skill-reject',", "      name: 'skill-rechazar',"), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FALLO operacion-huerfana · lib\/commands\.mjs:skill-rechazar/);
    assert.match(r.stdout, /FALLO operacion-sin-base · lib\/localized-commands\.mjs:skill-reject/);
  });

  it('quitar una operacion del mapa se denuncia por recuento', () => {
    const dir = copia();
    const mapa = join(dir, 'lib', 'localized-commands.mjs');
    const texto = readFileSync(mapa, 'utf8');
    const inicio = texto.indexOf("  Object.freeze({\n    id: 'reject',");
    const fin = texto.indexOf('  }),', inicio);
    if (inicio < 0 || fin < 0) throw new Error('no se encontro la entrada reject');
    writeFileSync(mapa, texto.slice(0, inicio) + texto.slice(fin + 6), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FALLO operaciones-cuenta · lib\/localized-commands\.mjs/);
  });

  it('el modelo de alias retirado no puede reaparecer en el codigo', () => {
    const dir = copia();
    const cmds = join(dir, 'lib', 'commands.mjs');
    const marca = "      description: t('cmd.reject.description'),";
    const texto = readFileSync(cmds, 'utf8');
    if (texto.split(marca).length - 1 !== 1) throw new Error('ancla reject ambigua');
    writeFileSync(cmds, texto.replace(marca, marca + String.fromCharCode(10) + "      deprecatedIn: '5.0.0',"), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FALLO alias-retirado · lib\//);
  });

  it('un diccionario del panel sin paridad se denuncia', () => {
    const dir = copia();
    const cli = join(dir, 'client.js');
    writeFileSync(cli, readFileSync(cli, 'utf8').replace("bulk_ids_hint: 'No rows in this session", "bulk_ids_hint_en: 'No rows in this session"), 'utf8');
    const r = corre(dir);
    assert.equal(r.status, 1, `la puerta no falló.\n${r.stdout}`);
    assert.match(r.stdout, /FALLO panel-paridad · (es|en):bulk_ids_hint/);
  });
});
