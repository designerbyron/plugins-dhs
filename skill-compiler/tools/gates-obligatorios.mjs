#!/usr/bin/env node
/**
 * Las puertas del repositorio, en UN punto obligatorio.
 *
 * Existian `tools/i18n-gate.mjs` y `tools/ascii-gate.mjs`, y las dos se podian saltar: eran comandos que habia
 * que recordar. Una puerta que depende de la memoria no es una puerta. Este ejecutor las corre **las dos**, en
 * serie, y devuelve distinto de cero si alguna falla; `npm test` (por `pretest`) y `npm run test:hermetic` (que
 * es la ruta de release) pasan por aqui antes de correr una sola prueba.
 *
 * Uso: `node tools/gates-obligatorios.mjs [--root <dir>] [--json]`
 *   --root  raiz del paquete (por defecto, la de este fichero). Sirve para medir una copia con un defecto
 *           sembrado sin tocar el arbol real.
 *   --json  salida maquina (`{ok, puertas:[{nombre, exit}]}`), para una prueba o un panel.
 *
 * Exit: 0 si las dos pasan · 1 si alguna falla o no se pudo ejecutar.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const conArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const raiz = resolve(conArg('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const comoJson = args.includes('--json');

/** Las puertas, en orden. El nombre es lo que se lee en el diagnostico. */
const PUERTAS = [
  { nombre: 'i18n', script: 'tools/i18n-gate.mjs' },
  { nombre: 'ascii', script: 'tools/ascii-gate.mjs' },
];

const resultados = [];
let salida = '';
for (const puerta of PUERTAS) {
  const r = spawnSync(process.execPath, [join(raiz, puerta.script), '--root', raiz], {
    cwd: raiz,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const texto = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  salida += texto;
  resultados.push({ nombre: puerta.nombre, exit: r.status, texto });
}

const enRojo = resultados.filter((r) => r.exit !== 0);

if (comoJson) {
  process.stdout.write(`${JSON.stringify({ ok: enRojo.length === 0, puertas: resultados.map(({ nombre, exit }) => ({ nombre, exit })) }, null, 2)}\n`);
} else {
  process.stdout.write(salida);
  if (enRojo.length === 0) {
    process.stdout.write('GATES: i18n y ascii en verde.\n');
  } else {
    for (const r of enRojo) {
      const motivo = r.exit === null ? 'no se pudo ejecutar' : `exit ${r.exit}`;
      process.stderr.write(`GATES: la puerta ${r.nombre} esta en rojo (${motivo}).\n`);
    }
    process.stderr.write('GATES: no se valida ni se publica con una puerta en rojo.\n');
  }
}

process.exit(enRojo.length === 0 ? 0 : 1);
