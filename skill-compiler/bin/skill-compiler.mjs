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
 *   node bin/skill-compiler.mjs doctor                    # ¿están las dependencias en su sitio?
 *
 * Opciones: `--project-key <clave>` para actuar sobre otro proyecto, `--force` para aprobar aunque
 * `check` avise (nunca si `check` falla).
 *
 * Exit: 0 correcto · 1 problema (check en rojo, aprobación rechazada, vendorizado bloqueado) · 2 uso.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
/** La raíz del paquete, derivada de la ruta de este fichero: `bin/` está un nivel por debajo. */
const packageRoot = join(dirname(SELF), '..');

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

  case 'doctor': {
    // Existe por un fallo real: el plugin importaba un paquete del harness sin declararlo, funcionaba
    // en la máquina donde estaba suelto y fallaba al instalarse en un perfil con «failed to import».
    // Este comando dice exactamente qué falta y qué hacer, en vez de dejar que se descubra instalando.
    const fs = await import('node:fs');
    const { pathToFileURL } = await import('node:url');
    const pkgPath = join(packageRoot, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const declared = manifest.dependencies ?? {};
    const declaredNames = Object.keys(declared);
    let bad = 0;
    const line = (ok, text, remedy) => {
      if (!ok) bad++;
      process.stdout.write(`${ok ? 'ok    ' : 'FALLA '} ${text}\n`);
      if (!ok && remedy) process.stdout.write(`        remedio: ${remedy}\n`);
    };

    process.stdout.write(`\ndependencias declaradas: ${declaredNames.length}\n`);
    line(declaredNames.length > 0, 'el manifiesto declara sus dependencias',
      'un plugin que importe paquetes del harness tiene que declararlos: si no, se instala y falla al activarse');

    const missing = declaredNames.filter((name) => !fs.existsSync(join(packageRoot, 'node_modules', name)));
    line(missing.length === 0, `instaladas: ${declaredNames.length - missing.length}/${declaredNames.length}`,
      `npm install   (faltan: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''})`);

    // No basta con que la carpeta exista: lo que importa es que el módulo se pueda CARGAR.
    for (const name of ['@deepseek-ai/dsh-tools', 'zod']) {
      try {
        const loaded = await import(name);
        const version = JSON.parse(fs.readFileSync(join(packageRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
        line(true, `${name} se carga (${version}${declared[name] && declared[name] !== version ? `, declarada ${declared[name]}` : ''})`);
        if (name === '@deepseek-ai/dsh-tools' && typeof loaded.defineTool !== 'function') {
          line(false, 'dsh-tools no exporta defineTool', 'la versión declarada no es la del runtime del harness');
        }
        // Zod tiene que ser Zod: el registro de proyecciones valida con `schema.parse(...)`, y una
        // biblioteca de esquemas que se resuelve llamándola como función (schemastery) no sirve.
        if (name === 'zod' && typeof loaded.z?.object !== 'function') {
          line(false, 'zod no expone `z.object`', 'la biblioteca de esquemas no es la que espera el contrato del harness');
        }
      } catch (error) {
        line(false, `${name} NO se carga: ${error.code ?? error.message}`,
          'el paquete declara peers que también tienen que estar instalados; reinstala con «npm install» sin --legacy-peer-deps');
      }
    }

    // El paso que de verdad decide: compilar las definiciones como hace el arranque del plugin.
    try {
      const { defineTool } = await import('@deepseek-ai/dsh-tools');
      const defs = await import(pathToFileURL(join(packageRoot, 'lib', 'definitions.mjs')).href);
      for (const factory of ['skillPropose', 'skillVendor', 'skillReview', 'skillUpstreamCheck']) {
        try {
          const tool = defineTool(defs[factory]({ root }));
          line(true, `${tool.name} compila · parámetros: ${Object.keys(tool.parameters.properties ?? {}).join(', ') || '(ninguno)'}`);
        } catch (error) {
          line(false, `${factory} no compila: ${error.message}`, 'corrige el esquema en lib/definitions.mjs');
        }
      }
    } catch (error) {
      line(false, `no se pudieron comprobar las herramientas: ${error.message}`, 'npm install');
    }

    // ── La proyección, contra el registro REAL ────────────────────────────────────────────────────
    //
    // Esto faltaba, y su ausencia costó caro: el registro de proyecciones **no** valida los esquemas
    // que recibe, así que una unidad con esquemas que no validan se registra sin queja y revienta al
    // LEER sesiones (`Failed to load history: … def.wire.viewSchema.parse is not a function`). Un
    // adorno visual dejando el historial sin cargar. Aquí se comprueba el contrato y se proyecta de
    // verdad —snapshot y lectura en frío—, para que eso se vea antes de instalar y no después.
    try {
      const { learningProjection, projectionContractProblems } = await import(pathToFileURL(join(packageRoot, 'lib', 'projection.mjs')).href);
      const definition = learningProjection();
      const problems = projectionContractProblems(definition);
      line(problems.length === 0, `la proyección cumple el contrato del registro (clave ${definition.key})`,
        problems.join(' · ') || 'la unidad no se registraría: revisa lib/projection.mjs');

      const { Context } = await import('@deepseek-ai/cordis');
      const { default: SessionProjectionRegistry } = await import('@deepseek-ai/dsh-session-projection');
      const ctx = new Context();
      ctx.plugin(SessionProjectionRegistry);
      await new Promise((resolve) => setTimeout(resolve, 50));
      ctx.sessionProjections.register(definition);
      const session = { seq: 0, header: {}, inheritedEventCount: 0, snapshotEvents: () => [], eventAt: () => undefined };
      const live = ctx.sessionProjections.snapshot(session, [definition.key]);
      const cold = ctx.sessionProjections.restore({}, [], 0, {}, 0);
      const served = live.values[definition.key] ?? cold.snapshot.values[definition.key];
      line(served !== undefined, 'el registro real proyecta la unidad sin lanzar (snapshot y lectura en frío)',
        'es el camino que rompía el historial de sesiones: revisa lib/projection.mjs');
    } catch (error) {
      line(false, `la proyección falla al proyectar: ${error.message}`,
        'con esto la lectura de sesiones se rompe: revisa lib/projection.mjs y su dependencia zod');
    }

    process.stdout.write(bad === 0
      ? '\ntodo en su sitio: el plugin puede activarse\n'
      : `\n${bad} problema(s): con esto el plugin falla al activarse\n`);
    process.exit(bad === 0 ? 0 : 1);
  }

  default:
    usage(2);
}
