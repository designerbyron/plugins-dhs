#!/usr/bin/env node
/**
 * check-hermetic.mjs — puerta de hermetismo de la suite.
 *
 * La suite ya redirige `DSH_HOME` a una caja de arena, pero eso es una defensa, no una prueba. Esta
 * comprobación **mide**: toma una huella del store real antes de correr las pruebas y otra después, y
 * falla si algo cambió. Existe porque el error ya se cometió una vez: dos pruebas con `root: undefined`
 * cayeron al store real y escribieron dos fixtures, y ninguna prueba se puso roja.
 *
 *   node tests/check-hermetic.mjs
 *
 * Exit: 0 el store real no cambió · 1 cambió · 2 no se pudo medir.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultRoot } from '../lib/compiler.mjs';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = defaultRoot();

/** Huella de un árbol: rutas relativas + tamaño. No mira el contenido para no confundir un reescrito idéntico. */
function fingerprint(dir) {
  if (!existsSync(dir)) return '(no existe)';
  const entries = [];
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries.push(`${full.slice(dir.length + 1)}:${statSync(full).size}`);
    }
  })(dir);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

const before = fingerprint(STORE);
process.stdout.write(`store real: ${STORE}\nhuella antes:  ${before}\n\n`);

const run = spawnSync(process.execPath, ['--test'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
if (run.error) { process.stderr.write(`No se pudo ejecutar la suite: ${run.error.message}\n`); process.exit(2); }

const after = fingerprint(STORE);
process.stdout.write(`\nhuella después: ${after}\n`);

if (before !== after) {
  process.stderr.write('\nFALLO: la suite tocó el store REAL. Algo en las pruebas está usando `defaultRoot()`.\n');
  process.stderr.write('Arréglalo en el código de la prueba, no borrando lo que escribió.\n');
  process.exit(1);
}
if (run.status !== 0) { process.stderr.write('\nLa suite falló por su cuenta (ver arriba).\n'); process.exit(run.status ?? 1); }

process.stdout.write('HERMÉTICO: la suite no tocó nada fuera de su caja de arena.\n');
process.exit(0);
