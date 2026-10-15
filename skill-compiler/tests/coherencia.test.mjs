#!/usr/bin/env node
/**
 * Coherencia entre lo que hay, lo que se declara y lo que se documenta.
 *
 * ── El defecto que esto cierra ──────────────────────────────────────────────────────────────────
 *
 * Un comando que existe en el código y no aparece en la ayuda no existe para quien lo necesita; un comando
 * documentado que no está implementado es una promesa falsa; y una versión que no coincide con su entrada en
 * el changelog es una entrega que nadie puede fechar. Nada de eso lo caza un test de comportamiento, porque
 * el comportamiento es correcto: lo que falla es la **coherencia**.
 *
 *   node --test tests/coherencia.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(RAIZ, '..');
const leer = (...partes) => readFileSync(join(RAIZ, ...partes), 'utf8');

describe('la versión, la ayuda y la documentación dicen lo mismo que el código', () => {
  it('la versión del manifiesto tiene su entrada en el changelog del repositorio', () => {
    const version = JSON.parse(leer('package.json')).version;
    const changelog = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8');
    assert.match(version, /^\d+\.\d+\.\d+$/, `la versión «${version}» no es semántica`);
    assert.match(changelog, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'), `el CHANGELOG no tiene entrada para ${version}`);
    // Y la entrada no puede estar vacía: un titular sin contenido no documenta la entrega.
    const entrada = changelog.split(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'))[1].split('\n## [')[0];
    assert.ok(entrada.trim().length > 500, 'la entrada del changelog de la versión actual está vacía o es un titular');
  });

  it('cada comando implementado está en la ayuda, y cada comando de la ayuda existe', () => {
    const bin = leer('bin', 'skill-compiler.mjs');
    const ayuda = bin.split('*/')[0];
    const implementados = [...bin.matchAll(/^\s*case '([a-z]+)':/gm)].map((m) => m[1]);
    assert.ok(implementados.length >= 15, `se esperaban los comandos del CLI, y se leyeron ${implementados.length}`);
    for (const comando of implementados) {
      assert.match(ayuda, new RegExp(`skill-compiler\\.mjs ${comando}\\b`), `el comando «${comando}» está implementado y no aparece en la ayuda`);
    }
    const documentados = [...ayuda.matchAll(/skill-compiler\.mjs ([a-z]+)\b/g)].map((m) => m[1]);
    for (const comando of new Set(documentados)) {
      assert.ok(implementados.includes(comando), `la ayuda promete «${comando}», que no está implementado`);
    }
  });

  it('todos los documentos están en el índice del README', () => {
    const readme = leer('README.md');
    const docs = readdirSync(join(RAIZ, 'docs')).filter((n) => n.endsWith('.md'));
    assert.ok(docs.length >= 8, `se esperaban los documentos del plugin, y hay ${docs.length}`);
    for (const doc of docs) {
      assert.match(readme, new RegExp(`docs/${doc.replace(/[.\\-]/g, '\\$&')}`), `«docs/${doc}» no está en el índice del README`);
    }
  });

  it('los módulos del núcleo están en el mapa de ficheros, y el mapa no inventa módulos', () => {
    const desarrollo = leer('docs', 'DESARROLLO.md');
    const modulos = readdirSync(join(RAIZ, 'lib')).filter((n) => n.endsWith('.mjs'));
    assert.ok(modulos.length >= 10, `se esperaban los módulos del núcleo, y hay ${modulos.length}`);
    for (const modulo of modulos) {
      assert.ok(desarrollo.includes(`lib/${modulo}`), `«lib/${modulo}» no está en el mapa de ficheros de DESARROLLO.md`);
    }
    for (const citado of new Set([...desarrollo.matchAll(/`lib\/([\w.-]+\.mjs)`/g)].map((m) => m[1]))) {
      assert.ok(modulos.includes(citado), `DESARROLLO.md cita «lib/${citado}», que no existe`);
    }
  });

  it('las herramientas del modelo están declaradas en el README con su nombre exacto', () => {
    const readme = leer('README.md');
    const definitions = leer('lib', 'definitions.mjs');
    const herramientas = [...definitions.matchAll(/name: '(skill_[a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(herramientas.length >= 4, `se esperaban las herramientas del plugin, y se leyeron ${herramientas.length}`);
    for (const herramienta of new Set(herramientas)) {
      assert.ok(readme.includes(herramienta), `la herramienta «${herramienta}» no aparece en el README`);
    }
  });
});
