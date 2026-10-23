#!/usr/bin/env node
/**
 * Puerta ASCII: el texto que controla el plugin no lleva acentos ni signos tipograficos.
 *
 * Se aplica por **linea base** y no como un interruptor: el repositorio tiene ~17.000 caracteres no ASCII
 * heredados (mensajes, comentarios y aserciones), y apagarlos todos de golpe dejaria la suite roja. La linea
 * base fija el maximo por fichero y **solo puede menguar**: cualquier caracter nuevo fuera de ASCII falla.
 *
 * Uso: `node tools/ascii-gate.mjs [--root <dir>] [--json]` · `--update` reescribe la linea base (acto manual).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const conArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const raiz = conArg('--root') ?? process.cwd();
const comoJson = args.includes('--json');
const actualizar = args.includes('--update');

/** Ficheros cuyo texto es del plugin. El contenido de usuario (SKILL.md) no entra aqui nunca. */
const FICHEROS = [
  'lib/audit.mjs', 'lib/auto-approve.mjs', 'lib/auto-update.mjs', 'lib/commands.mjs', 'lib/compiler.mjs',
  'lib/definitions.mjs', 'lib/lock.mjs', 'lib/localized-commands.mjs', 'lib/pending-rows.mjs', 'lib/presentation.mjs', 'lib/projection.mjs',
  'lib/promote.mjs', 'lib/repair.mjs', 'lib/scope.mjs', 'lib/security.mjs',
  'lib/i18n/codes.mjs', 'lib/i18n/en.mjs', 'lib/i18n/es.mjs', 'lib/i18n/index.mjs',
  'bin/skill-compiler.mjs', 'client.js', 'index.js',
];

const BASE = join(raiz, 'tools', 'ascii-baseline.json');
const cuenta = (texto) => (texto.match(/[^\x00-\x7F]/g) ?? []).length;

const medido = {};
for (const rel of FICHEROS) {
  const p = join(raiz, rel);
  if (!existsSync(p)) continue;
  medido[rel] = cuenta(readFileSync(p, 'utf8'));
}

if (actualizar) {
  writeFileSync(BASE, `${JSON.stringify({ generado: new Date().toISOString(), ficheros: medido }, null, 2)}\n`, 'utf8');
  const total = Object.values(medido).reduce((a, b) => a + b, 0);
  process.stdout.write(`ASCII: linea base escrita (${total} caracteres no ASCII en ${Object.keys(medido).length} ficheros)\n`);
  process.exit(0);
}

let base = { ficheros: {} };
try { base = JSON.parse(readFileSync(BASE, 'utf8')); } catch { /* sin linea base: todo cuenta como nuevo */ }

const fallos = [];
for (const [rel, n] of Object.entries(medido)) {
  const tope = base.ficheros?.[rel] ?? 0;
  if (n > tope) fallos.push({ regla: 'ascii-nuevo', donde: rel, detalle: `${n} caracteres no ASCII, tope ${tope}` });
}
const total = Object.values(medido).reduce((a, b) => a + b, 0);
const totalBase = Object.values(base.ficheros ?? {}).reduce((a, b) => a + b, 0);

if (comoJson) {
  process.stdout.write(`${JSON.stringify({ ok: fallos.length === 0, total, totalBase, fallos }, null, 2)}\n`);
} else if (fallos.length === 0) {
  process.stdout.write(`ASCII: en orden (${total} caracteres heredados, tope ${totalBase}; ninguno nuevo)\n`);
} else {
  for (const f of fallos) process.stdout.write(`FALLO ${f.regla} · ${f.donde} — ${f.detalle}\n`);
  process.stdout.write(`\nASCII: ${fallos.length} fichero(s) con texto nuevo fuera de ASCII\n`);
}
process.exit(fallos.length === 0 ? 0 : 1);
