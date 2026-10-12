#!/usr/bin/env node
/**
 * ico-to-png.mjs — saca el PNG de un `.ico` para poder usarlo como icono de plugin.
 *
 * Por qué existe: el harness acepta SVG, PNG, JPEG y WebP para el icono de un plugin (`package.json`,
 * campo `icon`), y **no** acepta `.ico`. La mayoría de los `.ico` modernos de Windows llevan dentro
 * tramas PNG, así que la conversión no es una conversión: es **extraer** la trama, byte a byte, sin
 * recodificar y sin perder calidad.
 *
 * Si un `.ico` solo trae tramas BMP (los antiguos), esta herramienta lo dice y no inventa nada: hay que
 * convertirlas con una herramienta del sistema, y el PNG resultante sería una recodificación.
 *
 *   node tools/ico-to-png.mjs <entrada.ico> [salida.png] [--size 256]
 *
 * Exit: 0 extraído · 1 no se pudo (formato antiguo o fichero ilegible) · 2 uso.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const positional = [];
let wantSize = 256;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--size') { wantSize = Number(argv[++i]); continue; }
  positional.push(argv[i]);
}
const [input, output] = positional;
if (!input) {
  process.stderr.write('uso: node tools/ico-to-png.mjs <entrada.ico> [salida.png] [--size 256]\n');
  process.exit(2);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lee el directorio del ICO: cada entrada dice tamaño, longitud y desplazamiento de su trama. */
function readFrames(buffer) {
  if (buffer.length < 6) throw new Error('fichero demasiado corto para ser un .ico');
  const type = buffer.readUInt16LE(2);
  if (type !== 1) throw new Error(`no es un icono (tipo ${type}; 1 = icono, 2 = cursor)`);
  const count = buffer.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > buffer.length) throw new Error('directorio de tramas truncado');
    const width = buffer[entry] === 0 ? 256 : buffer[entry];
    const height = buffer[entry + 1] === 0 ? 256 : buffer[entry + 1];
    const bytes = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (offset + bytes > buffer.length) throw new Error(`la trama ${i} apunta fuera del fichero`);
    const data = buffer.subarray(offset, offset + bytes);
    frames.push({ index: i, width, height, bytes, data, isPng: data.subarray(0, 8).equals(PNG_MAGIC) });
  }
  return frames;
}

/** Dimensiones reales de un PNG, leídas de su cabecera IHDR (no se confía en lo que dice el ICO). */
function pngSize(data) {
  if (data.length < 24 || data.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

let frames;
try {
  frames = readFrames(readFileSync(input));
} catch (error) {
  process.stderr.write(`No se pudo leer ${input}: ${error.message}\n`);
  process.exit(1);
}

const pngs = frames.filter((f) => f.isPng);
process.stdout.write(`${basename(input)}: ${frames.length} trama(s)\n`);
for (const f of frames) process.stdout.write(`  ${String(f.width).padStart(3)}x${String(f.height).padEnd(3)}  ${String(f.bytes).padStart(6)} B  ${f.isPng ? 'PNG' : 'BMP'}\n`);

if (pngs.length === 0) {
  process.stderr.write('\nTodas las tramas son BMP: este .ico es del formato antiguo y no se puede extraer un PNG.\n');
  process.stderr.write('Convierte primero con una herramienta del sistema (por ejemplo System.Drawing en Windows)\n');
  process.stderr.write('y usa el PNG resultante como icono. Se declara como recodificación, no como extracción.\n');
  process.exit(1);
}

// La trama pedida; si no existe exactamente, la mayor que no pase del tamaño deseado, y si no, la mayor.
const exact = pngs.find((f) => f.width === wantSize && f.height === wantSize);
const under = pngs.filter((f) => f.width <= wantSize).sort((a, b) => b.width - a.width)[0];
const chosen = exact ?? under ?? pngs.sort((a, b) => b.width - a.width)[0];

const target = output ?? join(dirname(input), `${basename(input).replace(/\.ico$/i, '')}-${chosen.width}.png`);
writeFileSync(target, chosen.data);
const real = pngSize(chosen.data);
process.stdout.write(`\nextraída la trama ${chosen.width}x${chosen.height}${real ? ` (PNG real ${real.width}x${real.height})` : ''}\n`);
process.stdout.write(`escrito: ${target} (${chosen.data.length} B · sin recodificar)\n`);
process.stdout.write(chosen.data.length <= 256 * 1024
  ? 'cabe en el límite de 256 KiB que acepta el harness para el icono de un plugin\n'
  : 'AVISO: supera los 256 KiB que acepta el harness; usa una trama menor con --size\n');
