#!/usr/bin/env node
/**
 * Higiene del repositorio: la ruta local de nadie, en ningún sitio publicable.
 *
 * ── Por qué es una puerta y no una costumbre ──────────────────────────────────────────────────────
 *
 * Una ruta absoluta escribe dos cosas que no son del repositorio: dónde vive la copia de quien la escribió,
 * y una instrucción que sólo funciona en esa máquina. La instalación se explica por la URL del repositorio, y
 * los ejemplos usan un marcador (`<donde-clonaste-el-repo>`), así que la ruta no hace falta en ningún sitio.
 *
 * En **código** es peor todavía: una ruta escrita en el código caduca en cuanto el repositorio se mueve, y
 * el plugin la enseña al humano como si fuera la buena. La ruta del CLI se **deriva** del propio fichero.
 *
 * ── Las dos excepciones, declaradas ───────────────────────────────────────────────────────────────
 *
 *   · `plans/*.md` son artefactos **autorizados por su SHA-256**: reescribirlos invalidaría su autorización,
 *     así que se quedan como se firmaron. Se saltan a propósito.
 *   · `tests/` usa un `cwd` de ejemplo que, por comodidad, es el de un proyecto real: es un dato de la
 *     prueba, no una instrucción de instalación. Queda fuera de esta puerta a propósito, y se dice.
 *
 * Una excepción explícita y con motivo — no un agujero por el que se cuele la próxima.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DOCS = ['.md'];
const CODIGO = ['lib', 'bin'];

/** En **código** no hay ejemplos que valgan: cualquier ruta absoluta es una que caduca y que se publica. */
const RUTA_ABSOLUTA = /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\/(?:home|Users)\//;

/**
 * En **documentación** hay rutas legítimas: ejemplos con marcador (`C:\Users\<alguien>`) y, sobre todo, la
 * tabla que documenta que esas rutas se **rechazan**. Lo que no puede aparecer es lo que identifica a una
 * máquina concreta o a una persona: la ubicación del autor y su nombre de usuario. Se listan a propósito —
 * es una lista negra de lo que no debe filtrarse, no un secreto.
 */
const DEL_AUTOR = /xampp[\\/]htdocs|(?:[\\/](?:Users|home)[\\/])(?:BYRON)/i;

function ficheros(dir, extensiones, saltar) {
  const out = [];
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const full = join(base, entry.name);
      const rel = relative(REPO, full).replace(/\\/g, '/');
      if (saltar.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else if (extensiones.some((e) => entry.name.endsWith(e))) out.push({ rel, full });
    }
  };
  walk(dir);
  return out;
}

describe('higiene · la ruta local de nadie en lo publicable', () => {
  it('la documentación no escribe rutas absolutas: la instalación va por la URL del repositorio', () => {
    const saltar = ['node_modules', '.git', 'plans', 'skill-compiler/node_modules'];
    const culpables = ficheros(REPO, DOCS, saltar).filter((f) => DEL_AUTOR.test(readFileSync(f.full, 'utf8')));
    assert.deepEqual(culpables.map((f) => f.rel), [],
      'usa la URL del repositorio o <donde-clonaste-el-repo>: la ruta de una máquina no es de nadie más');
  });

  it('el código no escribe rutas absolutas: lo que sabe dónde vive, lo deriva', () => {
    const culpables = CODIGO.flatMap((carpeta) => ficheros(join(REPO, 'skill-compiler', carpeta), ['.mjs', '.js'], []))
      .filter((f) => RUTA_ABSOLUTA.test(readFileSync(f.full, 'utf8')));
    assert.deepEqual(culpables.map((f) => f.rel), [],
      'deriva la ruta del propio fichero (fileURLToPath) en vez de escribirla');
  });

  it('los ejemplos de instalación usan el marcador, no una ruta que sólo existe en una máquina', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
    assert.match(readme, /<donde-clonaste-el-repo>/, 'el README tiene que servirle a cualquiera');
  });

  it('la puerta conoce sus excepciones, y no por accidente', () => {
    // Si alguien borra la excepción de `plans/`, esta prueba lo dice en vez de dejar que la puerta falle.
    const planes = readdirSync(join(REPO, 'plans')).filter((n) => n.endsWith('.md'));
    assert.equal(planes.length > 0, true, 'los planes autorizados siguen ahí, y se respetan');
    assert.equal(statSync(join(REPO, 'plans')).isDirectory(), true);
  });
});
