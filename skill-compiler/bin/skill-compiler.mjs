#!/usr/bin/env node
/**
 * skill-compiler — CLI humana del compilador de conocimiento.
 *
 * Aquí vive **aprobar**, y a propósito: aprobar no es una herramienta del modelo. Si lo fuera, el
 * propio modelo podría auto-aprobarse su propuesta y la revisión humana sería decorativa. El modelo
 * propone; esta CLI decide.
 *
 * Comparte implementación con el plugin (`lib/compiler.mjs`), así que las reglas no pueden divergir
 * entre lo que el modelo puede proponer y lo que tú puedes aprobar.
 *
 *   node bin/skill-compiler.mjs where                     # qué ámbito tiene este directorio
 *   node bin/skill-compiler.mjs list                      # qué hay propuesto y aprobado
 *   node bin/skill-compiler.mjs show <id>                 # leer una propuesta entera
 *   node bin/skill-compiler.mjs check [<id>]              # puerta: valida antes de aprobar
 *   node bin/skill-compiler.mjs approve <id>              # activar (exige que `check` pase)
 *   node bin/skill-compiler.mjs reject <id>               # apartar sin borrar
 *   node bin/skill-compiler.mjs vendor <url> [--id X] [--note "..."]
 *                                                         # nuestra versión de una skill externa
 *   node bin/skill-compiler.mjs upstream <id>             # ¿se movió el origen?
 *   node bin/skill-compiler.mjs provenance <id>           # procedencia guardada, entera
 *
 * Opciones: `--project-key <clave>` para actuar sobre otro proyecto, `--force` para aprobar aunque
 * `check` avise (nunca si `check` falla).
 *
 * Exit: 0 correcto · 1 problema (check en rojo, aprobación rechazada, vendorizado bloqueado) · 2 uso.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  approve, defaultRoot, listForProject, overview, parseFrontmatter, pending, projectKey, reject,
  validateInput,
} from '../lib/compiler.mjs';
import { readProvenance, upstreamStatus, vendor } from '../lib/vendor.mjs';

/**
 * La ruta de este propio CLI. Se deriva en tiempo de ejecución en vez de escribirse: el mensaje que la
 * enseña al usuario se quedaba obsoleto cada vez que el repositorio cambiaba de sitio, y una instrucción
 * de aprobación que no funciona es peor que no darla.
 */
const SELF = fileURLToPath(import.meta.url);

const argv = process.argv.slice(2);
const command = argv[0];
const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--project-key') { flags.projectKey = argv[++i]; continue; }
  if (arg === '--force') { flags.force = true; continue; }
  if (arg === '--id') { flags.id = argv[++i]; continue; }
  if (arg === '--note') { flags.note = argv[++i]; continue; }
  if (arg === '--url') { flags.url = argv[++i]; continue; }
  if (arg.startsWith('--')) { process.stderr.write(`Opción desconocida: ${arg}\n`); process.exit(2); }
  positional.push(arg);
}
const root = defaultRoot();

function usage(code) {
  process.stderr.write(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim() + '\n');
  process.exit(code);
}

/** El ámbito sale del cwd actual, o de `--project-key` cuando se trabaja sobre otro proyecto. */
function scope() {
  if (typeof flags.projectKey === 'string') return flags.projectKey;
  const key = projectKey(process.cwd());
  if (key === null) { process.stderr.write('No se pudo determinar el proyecto desde este directorio. Usa --project-key.\n'); process.exit(2); }
  return key;
}

/** Valida una propuesta guardada: sirve para detectar una edición a mano posterior a la propuesta. */
function checkSkill(id, key) {
  const file = join(root, 'projects', key, 'proposed', id, 'SKILL.md');
  if (!existsSync(file)) return { ok: false, errors: [`no existe una propuesta ${id} en ${key}`], warnings: [] };
  const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));
  const result = validateInput({
    id: data.name ?? id,
    description: data.description ?? '',
    whenToUse: data.whenToUse ?? '',
    body: body.trim(),
  });
  return { ...result, file };
}

function printCheck(id, key, result) {
  for (const e of result.errors) process.stderr.write(`FALLO  ${e}\n`);
  for (const w of result.warnings) process.stderr.write(`aviso  ${w}\n`);
  if (result.ok) process.stdout.write(`${id}: en verde${result.warnings.length ? ' (con avisos)' : ''}\n`);
}

switch (command) {
  case 'where': {
    const key = projectKey(process.cwd());
    process.stdout.write(`${process.cwd()}\n  proyecto: ${key ?? '(sin ámbito)'}\n  datos:    ${root}\n`);
    break;
  }

  case 'list': {
    const rows = overview({ root });
    if (rows.length === 0) { process.stdout.write(`Sin skills aprendidas todavía (${root}).\n`); break; }
    for (const row of rows) {
      process.stdout.write(`\n${row.projectKey}\n`);
      process.stdout.write(`  propuestas : ${row.proposed.length ? row.proposed.map((p) => p.id).join(', ') : '—'}\n`);
      process.stdout.write(`  aprobadas  : ${row.approved.length ? row.approved.map((p) => p.id).join(', ') : '—'}\n`);
      process.stdout.write(`  rechazadas : ${row.rejected.length ? row.rejected.join(', ') : '—'}\n`);
    }
    break;
  }

  case 'show': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const file = join(root, 'projects', key, 'proposed', id, 'SKILL.md');
    if (!existsSync(file)) { process.stderr.write(`No hay propuesta ${id} en ${key}.\n`); process.exit(1); }
    process.stdout.write(readFileSync(file, 'utf8'));
    break;
  }

  case 'check': {
    const key = scope();
    const only = positional[0];
    const ids = only ? [only] : pending({ root, key }).map((p) => p.id);
    if (ids.length === 0) { process.stdout.write(`Nada pendiente en ${key}.\n`); break; }
    let failures = 0;
    for (const id of ids) {
      const result = checkSkill(id, key);
      printCheck(id, key, result);
      if (!result.ok) failures++;
    }
    process.exit(failures === 0 ? 0 : 1);
    break;
  }

  case 'approve': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const result = checkSkill(id, key);
    if (!result.ok) {
      process.stderr.write(`Aprobación RECHAZADA: la propuesta no pasa la puerta.\n`);
      printCheck(id, key, result);
      process.exit(1);
    }
    if (result.warnings.length && flags.force !== true) {
      process.stderr.write('La propuesta tiene avisos. Revísalos y repite con --force si los aceptas.\n');
      printCheck(id, key, result);
      process.exit(1);
    }
    const moved = approve(id, key, { root });
    if (!moved.ok) { process.stderr.write(`No se pudo aprobar: ${moved.reason}\n`); process.exit(1); }
    process.stdout.write(`Aprobada ${id} en ${key}\n  ${moved.path}\n`);
    if (moved.superseded) process.stdout.write(`  versión anterior apartada en ${moved.superseded}\n`);
    process.stdout.write('Se sirve al modelo solo en este proyecto.\n');
    break;
  }

  case 'reject': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const moved = reject(id, key, { root });
    if (!moved.ok) { process.stderr.write(`No se pudo rechazar: ${moved.reason}\n`); process.exit(1); }
    process.stdout.write(`Rechazada ${id} (apartada en ${moved.path.replace(/[\\/]SKILL\.md$/, '')}).\n`);
    break;
  }

  case 'active': {
    const key = scope();
    const found = listForProject(process.cwd(), { root });
    process.stdout.write(`${key}: ${found.length ? found.map((s) => s.id).join(', ') : 'ninguna skill activa'}\n`);
    break;
  }

  case 'vendor': {
    const url = positional[0] ?? flags.url;
    if (!url) usage(2);
    const result = await vendor({ url, id: flags.id, localNote: flags.note }, { root, cwd: process.cwd() });
    if (result.status === 'proposed') {
      process.stdout.write([
        `Nuestra versión creada: ${result.id}`,
        `Origen: ${result.provenance.source.url}${result.upstream.ref ? ` (${result.upstream.ref})` : ''}`,
        `SHA-256 del original: ${result.upstream.sha256}`,
        `  guardado verbatim en ${join(root, 'projects', result.projectKey, 'proposed', result.id, 'upstream')}`,
        `Procedencia: ${join(root, 'projects', result.projectKey, 'proposed', result.id, 'provenance.json')}`,
        '',
        'NO está activa. Revísala y apruébala:',
        `  node "${SELF}" approve ${result.id}`,
        ...(result.warnings.length ? ['', 'Avisos:', ...result.warnings.map((w) => `  · ${w}`)] : []),
      ].join('\n') + '\n');
      break;
    }
    if (result.status === 'needs-choice') {
      process.stderr.write(`Ese enlace apunta a una carpeta con varias skills. Elige una:\n  ${result.dirs.join('\n  ')}\n`);
      process.exit(1);
    }
    if (result.status === 'blocked') {
      process.stderr.write('VENDORIZADO BLOQUEADO: no se escribió nada.\n');
      process.stderr.write(`  motivo: ${result.errors[0]}\n`);
      for (const f of result.findings ?? []) process.stderr.write(`  · ${f.file}:${f.line} — ${f.label}\n`);
      process.stderr.write('No hay opción para saltarse esto desde aquí: revisa el origen y vendoriza una versión saneada.\n');
      process.exit(1);
    }
    process.stderr.write(`Vendorizado no realizado (${result.status}): ${(result.errors ?? []).join(' ')}\n`);
    if (result.conflicts?.length) for (const c of result.conflicts) process.stderr.write(`  · choca con ${c.id} (${c.reason})\n`);
    process.exit(1);
  }

  case 'upstream': {
    const id = positional[0];
    if (!id) usage(2);
    const status = await upstreamStatus(id, scope(), { root });
    if (status.status !== 'checked') { process.stderr.write(`No se pudo comprobar ${id}: ${(status.errors ?? []).join(' ')}\n`); process.exit(1); }
    process.stdout.write([
      status.changed ? `El origen CAMBIÓ desde que se tomó (${status.fetchedAt?.slice(0, 10)}).` : 'El origen no ha cambiado.',
      `  ${status.url}${status.ref ? ` (${status.ref})` : ''}`,
      `  guardado ${status.storedSha256?.slice(0, 16)}… · ahora ${status.upstreamSha256?.slice(0, 16)}…`,
      status.changed ? '  Nuestra versión no se ha tocado: está adaptada a propósito.' : '',
    ].filter(Boolean).join('\n') + '\n');
    break;
  }

  case 'provenance': {
    const id = positional[0];
    if (!id) usage(2);
    const record = readProvenance(id, scope(), { root });
    if (!record) { process.stderr.write(`${id} no tiene procedencia de origen (no es una skill vendorizada).\n`); process.exit(1); }
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    break;
  }

  default:
    usage(2);
}
