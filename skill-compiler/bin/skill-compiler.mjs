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
 *   node bin/skill-compiler.mjs approve <id>              # activar en ESTE proyecto (exige que `check` pase)
 *   node bin/skill-compiler.mjs approve <id> --global     # activar para TODOS tus proyectos
 *   node bin/skill-compiler.mjs scope <id> --local|--global  # cambiar de ámbito una ya aprobada
 *   node bin/skill-compiler.mjs active                  # qué se está sirviendo de verdad en este directorio
 *   node bin/skill-compiler.mjs reject <id>               # apartar sin borrar
 *   node bin/skill-compiler.mjs disable <id>              # apagar: reversible, se conserva entera
 *   node bin/skill-compiler.mjs enable <id>               # volver a encender
 *   node bin/skill-compiler.mjs delete <id> [--yes]       # RETIRAR: mueve a un respaldo fechado (no borra)
 *   node bin/skill-compiler.mjs retired                   # qué está apagado y qué se retiró
 *   node bin/skill-compiler.mjs restore <id>              # recuperar del respaldo
 *   node bin/skill-compiler.mjs vendor <url> [--id X] [--note "..."]
 *                                                         # nuestra versión de una skill externa
 *   node bin/skill-compiler.mjs upstream <id>             # ¿se movió el origen?
 *   node bin/skill-compiler.mjs provenance <id>           # procedencia guardada, entera
 *   node bin/skill-compiler.mjs doctor                    # ¿están las dependencias en su sitio?
 *   node bin/skill-compiler.mjs audit [--json] [--estado X] [--todo]
 *                                                       # audita TODO el almacén (solo lectura)
 *   node bin/skill-compiler.mjs repair <id>               # PREPARA la corrección de una skill viva (no activa)
 *   node bin/skill-compiler.mjs promote <id> [--nivel 1,2] [--dry]
 *                                                       # activa una corrección con pruebas; sin --nivel no activa nada
 *   node bin/skill-compiler.mjs history [<id>]            # qué se promocionó, con qué pruebas y por qué
 *   node bin/skill-compiler.mjs review [--port N]         # página local para aprobar y rechazar
 *
 * Opciones: `--project-key <clave>` para actuar sobre otro proyecto, `--force` para aprobar aunque
 * `check` avise (nunca si `check` falla), `--yes` para confirmar una retirada.
 *
 * Exit: 0 correcto · 1 problema (check en rojo, aprobación rechazada, vendorizado bloqueado) · 2 uso.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ambito, approve, checkProposal, curatedLibraryRoot, defaultRoot, disable, enable, listForProject, locate,
  overview, pending, projectKey, reject, restore, retire, retired, retiredRoot,
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
  if (arg === '--yes') { flags.yes = true; continue; }
  // El ámbito: publicar para todos los proyectos es un gesto explícito, y volver a local, otro.
  if (arg === '--global') { flags.global = true; continue; }
  if (arg === '--local') { flags.local = true; continue; }
  if (arg === '--id') { flags.id = argv[++i]; continue; }
  if (arg === '--note') { flags.note = argv[++i]; continue; }
  if (arg === '--url') { flags.url = argv[++i]; continue; }
  if (arg === '--port') { flags.port = argv[++i]; continue; }
  // Las de `audit`: el informe entero en JSON, acotar por estado, o incluir también las que pasan.
  if (arg === '--json') { flags.json = true; continue; }
  if (arg === '--todo') { flags.todo = true; continue; }
  if (arg === '--estado') { flags.estado = argv[++i]; continue; }
  // Las de la promoción: qué niveles se autorizan, y ver las pruebas sin escribir nada.
  if (arg === '--nivel') { flags.nivel = argv[++i]; continue; }
  if (arg === '--dry') { flags.dry = true; continue; }
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

/**
 * Valida una propuesta guardada. Se importa de `lib/` —donde está probada— porque la misma puerta la
 * aplican la CLI, la página de revisión y los comandos del harness: una regla, una implementación.
 */
function checkSkill(id, key) {
  return checkProposal(id, key, { root });
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
    // Aprobar algo ya aprobado no es un fallo: es un acto que ya ocurrió. Medido con el usuario delante:
    // volvió a aprobar al ver la skill todavía en la lista, y aquí leería «no existe una propuesta».
    const ambitoPedido = flags.global === true ? 'global' : 'project';
    if (ambitoPedido === 'global' && ['global', 'published'].includes(locate(id, key, { root }))) {
      process.stdout.write(`Ya estaba publicada: ${id} en la biblioteca de usuario\n  No se ha cambiado nada.\n`);
      break;
    }
    if (ambitoPedido === 'project' && locate(id, key, { root }) === 'approved') {
      process.stdout.write(`Ya estaba activa: ${id} en ${key}\n  No se ha cambiado nada.\n`);
      break;
    }
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
    const moved = approve(id, key, { root, scope: ambitoPedido });
    if (!moved.ok) { process.stderr.write(`No se pudo aprobar: ${moved.reason}\n`); process.exit(1); }
    if (ambitoPedido === 'global') {
      process.stdout.write(`Aprobada ${id} para TODOS tus proyectos\n  ${moved.path}\n`);
      if (moved.superseded) process.stdout.write(`  versión anterior apartada en ${moved.superseded}\n`);
      process.stdout.write('Se sirve en toda sesión de esta máquina, y el modelo la verá sin reiniciar si el catálogo se refresca.\n');
      process.stdout.write(`Para dejarla sólo en este proyecto: scope ${id} --local\n`);
    } else {
      process.stdout.write(`Aprobada ${id} en ${key}\n  ${moved.path}\n`);
      if (moved.superseded) process.stdout.write(`  versión anterior apartada en ${moved.superseded}\n`);
      process.stdout.write('Se sirve al modelo solo en este proyecto.\n');
      process.stdout.write(`Para que la vean todos tus proyectos: approve ${id} --global\n`);
    }
    break;
  }

  // ── el ámbito, en las dos direcciones ────────────────────────────────────────────────────────────
  // Una aprobación con el ámbito equivocado se corrige sin volver a proponer nada: la decisión tiene vuelta.
  case 'scope': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const to = flags.local === true ? 'project' : flags.global === true ? 'global' : null;
    const moved = ambito(id, key, { to, root });
    if (!moved.ok) { process.stderr.write(`No se pudo cambiar el ámbito: ${moved.reason}\n`); process.exit(1); }
    process.stdout.write(`Ahora ${id} vive en ${moved.scope === 'global' ? 'la biblioteca de usuario (todos tus proyectos)' : `el proyecto ${key}`}\n  ${moved.path}\n  huella: ${moved.sha256}\n`);
    break;
  }

  // ── apagar, retirar y volver ────────────────────────────────────────────────────────────────────
  // El único gesto irreversible es `delete`, y por eso **no borra**: mueve a un respaldo fechado y dice
  // cuál es la vuelta. Sin `--yes` no toca nada.
  case 'disable': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    if (locate(id, key, { root }) === 'disabled') {
      process.stdout.write(`Ya estaba apagada: ${id} en ${key}\n  No se ha cambiado nada.\n`);
      break;
    }
    const moved = disable(id, key, { root, scope: flags.global === true ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`No se pudo apagar: ${moved.reason}\n`); process.exit(1); }
    const donde = flags.global === true ? 'la biblioteca de usuario' : `el proyecto ${key}`;
    process.stdout.write(`Apagada ${id} en ${donde}\n  deja de servirse al modelo, y se conserva entera: vuelve con \`enable ${id}${flags.global === true ? ' --global' : ''}\`\n`);
    break;
  }

  case 'enable': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const moved = enable(id, key, { root, scope: flags.global === true ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`No se pudo encender: ${moved.reason}\n`); process.exit(1); }
    process.stdout.write(`Encendida ${id} en ${flags.global === true ? 'la biblioteca de usuario' : `el proyecto ${key}`}\n`);
    break;
  }

  case 'delete': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const esGlobal = flags.global === true;
    const destino = join(retiredRoot(), esGlobal ? 'global' : key, id);
    if (flags.yes !== true) {
      process.stdout.write(`Se va a RETIRAR ${id} de ${esGlobal ? 'la biblioteca de usuario' : `el proyecto ${key}`}:\n  respaldo: ${destino}\n`);
      process.stdout.write('Nada se borra: la carpeta se mueve, con su huella, y vuelve con `restore`.\n');
      process.stdout.write('Repite con --yes para hacerlo.\n');
      process.exit(1);
    }
    const moved = retire(id, key, { root, scope: esGlobal ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`No se pudo retirar: ${moved.reason}\n`); process.exit(1); }
    process.stdout.write(`Retirada ${id} de ${esGlobal ? 'la biblioteca de usuario' : `el proyecto ${key}`}\n  respaldo: ${moved.backup}\n  huella:   ${moved.hash}\n  vuelve con: ${moved.revierte}\n`);
    break;
  }

  case 'retired': {
    const key = scope();
    const lista = retired(key, { root });
    if (lista.length === 0) { process.stdout.write(`Nada apagado ni retirado en ${key}\n`); break; }
    for (const skill of lista) {
      const estado = skill.state === 'disabled' ? 'apagada ' : skill.state === 'superseded' ? 'apartada' : 'retirada';
      const donde = skill.scope === 'global' ? 'global' : 'proyecto';
      process.stdout.write(`  ${estado}  ${skill.id}  [${donde}]${skill.retiredAt ? `  (${skill.retiredAt})` : ''}\n`);
    }
    break;
  }

  case 'restore': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const moved = restore(id, key, { root, scope: flags.global === true ? 'global' : 'project' });
    if (!moved.ok) { process.stderr.write(`No se pudo restaurar: ${moved.reason}\n`); process.exit(1); }
    process.stdout.write(`Restaurada ${id} en ${flags.global === true ? 'la biblioteca de usuario' : `el proyecto ${key}`}\n  ${moved.path}\n  huella: ${moved.hash}\n`);
    break;
  }

  case 'reject': {
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const where = locate(id, key, { root });
    if (where === 'rejected') {
      process.stdout.write(`Ya estaba apartada: ${id} en ${key}\n  No se ha cambiado nada.\n`);
      break;
    }
    if (where === 'approved') {
      process.stderr.write(`«${id}» ya está activa en ${key}: reject solo se aplica a las propuestas pendientes.\n`);
      process.exit(1);
    }
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

    // ── Los comandos humanos, y las puertas del harness ──────────────────────────────────────────
    try {
      const { skillCommands } = await import(pathToFileURL(join(packageRoot, 'lib', 'commands.mjs')).href);
      const declared = skillCommands({ root });
      const names = declared.map((c) => c.name);
      const malformed = declared.filter((c) => !/^[a-z][a-z0-9_-]*$/.test(c.name) || !c.description?.trim() || typeof c.handler !== 'function');
      line(malformed.length === 0 && names.includes('skill-aprobar') && names.includes('skill-auto'),
        `los comandos humanos se declaran (${names.join(', ')})`,
        'un descriptor inválido no se registra en el harness y la superficie desaparece en silencio');
    } catch (error) {
      line(false, `no se pudieron comprobar los comandos: ${error.message}`, 'revisa lib/commands.mjs');
    }

    // ── Las filas de pendientes: la superficie que convierte aprobar en elegir ────────────────────
    //
    // Medido con el usuario delante: veía la lista de pendientes y no encontraba cómo elegir una, porque
    // el compositor no ofrece una lista pulsable para los argumentos de un comando. Las filas son
    // comandos sin argumentos que el menú `/` ofrece; si su composición se rompe, autorizar vuelve a ser
    // una sintaxis que hay que recordar.
    try {
      const { pendingRowsFor } = await import(pathToFileURL(join(packageRoot, 'lib', 'pending-rows.mjs')).href);
      const { pending: pendingOf, projectKey: keyOf } = await import(pathToFileURL(join(packageRoot, 'lib', 'compiler.mjs')).href);
      const cwd = process.cwd();
      const key = typeof flags.projectKey === 'string' ? flags.projectKey : keyOf(cwd);
      const waiting = key === null ? [] : pendingOf({ root, key });
      const rows = key === null || typeof flags.projectKey === 'string' ? null : pendingRowsFor({ root, cwd });
      const malformed = (rows ?? []).filter((row) => !/^[a-z][a-z0-9_-]*$/.test(row.name) || row.description.trim().length === 0);
      line(malformed.length === 0, rows === null
        ? `filas de pendientes: ${waiting.length} pendientes en ${key ?? '(sin ámbito)'} (no se componen filas sin el cwd del proyecto)`
        : `filas de pendientes: ${waiting.length} pendientes → ${rows.length} filas del menú, con nombre válido`,
        'una fila con un nombre fuera de la gramática no se registra, y desaparece del menú sin avisar');
      if (rows !== null) {
        line(rows.length === waiting.length * 3, 'cada pendiente ofrece sus tres verbos (leer · activar · apartar)',
          'revisa ROW_VERBS en lib/pending-rows.mjs');
      }
    } catch (error) {
      line(false, `no se pudieron componer las filas de pendientes: ${error.message}`, 'revisa lib/pending-rows.mjs');
    }

    // Compilar las herramientas y proyectar la unidad cubre dos caminos; el resto de los contratos con el
    // harness viven en pruebas que ya se ejecutan solas. Aquí se EJECUTAN, en vez de reimplementarlas: un
    // diagnóstico que duplica la puerta acaba diciendo algo distinto que la puerta.
    try {
      const { spawnSync } = await import('node:child_process');
      const gates = [
        'tests/output-contract.test.mjs',      // el valor de cada herramienta contra el esquema que el harness valida
        'tests/projection-contract.test.mjs',  // el registro de proyecciones real
        'tests/catalog-freshness.test.mjs',    // la frescura del catálogo, sin reiniciar
        'tests/auto-approve.test.mjs',         // el modo de aprobación automática por sesión
        'tests/commands.test.mjs',             // los comandos humanos, camino por camino
        'tests/pending-rows.test.mjs',         // las filas que el menú ofrece por cada pendiente
      ];
      const run = spawnSync(process.execPath, ['--test', ...gates], { cwd: packageRoot, encoding: 'utf8' });
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
      const failed = run.status !== 0 || /failing tests/.test(output);
      line(!failed, 'las puertas de contrato con el harness pasan (salida, proyección, catálogo, modo automático, comandos, filas del menú)',
        'ejecuta «npm test» y mira la primera prueba en rojo: dice qué contrato se rompió y con qué dato');
    } catch (error) {
      line(false, `no se pudieron ejecutar las puertas del harness: ${error.message}`, 'npm install');
    }

    process.stdout.write(bad === 0
      ? '\ntodo en su sitio: el plugin puede activarse\n'
      : `\n${bad} problema(s): con esto el plugin falla al activarse\n`);
    process.exit(bad === 0 ? 0 : 1);
  }

  case 'audit': {
    // Auditoría integral, en SOLO LECTURA: mira el almacén entero con la misma puerta que decide una
    // aprobación y dice qué incumple cada skill, con qué valor, contra qué umbral y por dónde se arregla.
    // No repara nada: señalar es lo que se le pide. Es el primer paso para decidir qué se corrige.
    const { auditarAlmacen, resumenDeAuditoria } = await import('../lib/audit.mjs');
    const estados = flags.estado !== undefined ? String(flags.estado).split(',').map((e) => e.trim()) : null;
    const informe = auditarAlmacen({ root, curated: curatedLibraryRoot(), estados });

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(informe, null, 2)}\n`);
      process.exit(informe.totals.error + informe.totals.unreadable > 0 ? 1 : 0);
    }

    const salida = [`\nauditoría del almacén — solo lectura`, '', resumenDeAuditoria(informe), ''];

    if (informe.byRule.length > 0) {
      salida.push('por regla (primero lo que más arregla):');
      for (const regla of informe.byRule) {
        salida.push(`  [${regla.severity}] ${regla.rule} × ${regla.count} · ${regla.skills.length} skill(s)`);
        salida.push(`         corrige: ${regla.fix}`);
      }
      salida.push('');
    }

    if (informe.contenedores.length > 0) {
      salida.push('en el contenedor:');
      for (const c of informe.contenedores) salida.push(`  [${c.severity}] ${c.message}`);
      salida.push('');
    }

    // El detalle: por defecto lo que NO pasa, que es lo que hay que mirar. `--todo` incluye las que pasan.
    const conHallazgo = informe.skills.filter((s) => flags.todo || s.status !== 'PASS');
    if (conHallazgo.length > 0) {
      salida.push(`detalle (${conHallazgo.length} de ${informe.totals.total}):`);
      for (const skill of conHallazgo) {
        const m = skill.medidas;
        salida.push(`\n  ${skill.status.padEnd(10)} ${skill.key}  [${skill.estadoLegible}]`);
        salida.push(`             descripción ${m ? m.description : '?'} · disparador ${m ? m.whenToUse : '?'} · cuerpo ${m ? m.body : '?'} · secciones ${m ? m.secciones : '?'}`);
        for (const f of skill.findings) {
          if (!flags.todo && f.severity === 'info') continue;
          const detalle = f.threshold !== null ? ` (observado ${JSON.stringify(f.observed)}, umbral ${JSON.stringify(f.threshold)})` : ` (observado ${JSON.stringify(f.observed)})`;
          salida.push(`    · [${f.severity}] ${f.rule}${detalle}`);
          salida.push(`      ${f.message}`);
          salida.push(`      corrige: ${f.fix}`);
        }
      }
      salida.push('');
    }

    salida.push(informe.totals.error + informe.totals.unreadable > 0
      ? `${informe.totals.error + informe.totals.unreadable} skill(s) con error: esto es un diagnóstico, no una reparación — nada se ha modificado`
      : 'ninguna skill con error');
    process.stdout.write(`${salida.join('\n')}\n`);
    process.exit(informe.totals.error + informe.totals.unreadable > 0 ? 1 : 0);
  }

  case 'repair': {
    // Prepara la corrección de una skill viva a partir de lo que la auditoría encontró. **No activa nada**:
    // deja la propuesta lista (o dice por qué no se puede) para que la revise una persona o la promocione
    // el motor si su nivel está autorizado.
    const { reparar } = await import('../lib/repair.mjs');
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const r = reparar(id, key, { root, curated: curatedLibraryRoot(), cwd: process.cwd() });
    if (r.status === 'missing') { process.stderr.write(`${r.reason}\n`); process.exit(1); }
    const lineas = [];
    lineas.push(`\nreparar ${id} — proyecto ${key}`);
    if (r.status === 'nothing-to-do') {
      lineas.push(`  nada que reparar: ${r.reason}`, '');
      process.stdout.write(`${lineas.join('\n')}\n`);
      break;
    }
    lineas.push(`  base: ${r.base.state} (huella ${String(r.base.hash).slice(0, 12)})`);
    lineas.push(`  nivel de la corrección: ${r.nivel}${r.nivel === 1 ? ' (mecánica)' : r.nivel === 2 ? ' (semántica acotada)' : ''}`);
    if (r.reparaciones?.length) {
      lineas.push('  reparaciones:');
      for (const rep of r.reparaciones) lineas.push(`    · [n${rep.nivel}] ${rep.regla}: ${rep.describe}`);
    }
    if (r.movidas?.length) lineas.push(`  material movido: ${r.movidas.map((m) => `${m.titulo} -> ${m.ruta}`).join(', ')}`);
    if (r.status === 'blocked') {
      lineas.push('  BLOQUEADA — no se ha creado ninguna propuesta:');
      for (const b of r.bloqueos) lineas.push(`    · ${b.rule}: ${b.motivo}`);
      lineas.push(`    ${r.reason}`);
    } else if (r.status !== 'proposed') {
      lineas.push(`  NO SE HA CREADO NINGUNA PROPUESTA (${r.status}):`);
      for (const e of r.errors ?? []) lineas.push(`    · ${e}`);
      for (const x of r.conflicts ?? []) lineas.push(`    · choca con ${x.id} (${x.reason})`);
      if (r.reason) lineas.push(`    ${r.reason}`);
      lineas.push('    Nada se ha modificado.');
    } else {
      lineas.push(`  diff: +${r.diff?.lineas?.anadidas?.length ?? 0}/-${r.diff?.lineas?.eliminadas?.length ?? 0} línea(s) · forma: ${r.forma.bytesAntes} -> ${r.forma.bytesDespues} bytes (${r.forma.transformaciones.join(', ') || 'sin cambios de forma'})`);
      const check = checkProposal(id, key, { root, curated: curatedLibraryRoot() });
      lineas.push(`  puerta de la propuesta: ${check.ok ? 'en verde' : `ROJA — ${check.errors[0]}`}`);
      lineas.push('', `  siguiente: node bin/skill-compiler.mjs promote ${id} --nivel ${r.nivel}   (activar, con pruebas)`);
      lineas.push(`             node bin/skill-compiler.mjs show ${id}                        (leerla entera)`);
    }
    if (r.sinReparacion?.length) {
      lineas.push('', '  no reparable por el motor:');
      for (const s of r.sinReparacion) lineas.push(`    · ${s.rule}: ${s.motivo ?? 'sin catálogo'}`);
    }
    process.stdout.write(`${lineas.join('\n')}\n`);
    break;
  }

  case 'promote': {
    // Aplica y activa una corrección YA preparada. Por defecto **no activa nada solo**: hay que decir qué
    // niveles están autorizados, y el 3 no se autoriza nunca por aquí.
    const { promover } = await import('../lib/promote.mjs');
    const id = positional[0];
    if (!id) usage(2);
    const key = scope();
    const niveles = flags.nivel !== undefined
      ? String(flags.nivel).split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n))
      : [];
    if (niveles.includes(3)) {
      process.stderr.write('el nivel 3 no se promociona automáticamente: esos cambios (seguridad, permisos, secretos, aislamiento, facturación) los aprueba una persona con `approve`. Quita el 3 de --nivel.\n');
      process.exit(2);
    }
    if (flags.dry) {
      // Sólo las pruebas: la información de la decisión, sin escribir nada.
      const { pruebasDeRegresion } = await import('../lib/promote.mjs');
      const { readFileSync: leer, existsSync: hay } = await import('node:fs');
      const { join: unir } = await import('node:path');
      const metaFile = unir(root, 'projects', key, 'proposed', id, 'meta.json');
      if (!hay(metaFile)) { process.stderr.write(`no hay ninguna propuesta ${id} en ${key}\n`); process.exit(1); }
      const meta = JSON.parse(leer(metaFile, 'utf8'));
      const r = pruebasDeRegresion(id, key, meta, { root, curated: curatedLibraryRoot() });
      process.stdout.write([`\npruebas de regresión de ${id} — sin escribir nada`, ...r.pruebas.map((p) => `  ${p.ok ? 'ok  ' : 'FALLA'} ${p.nombre.padEnd(22)} ${p.detalle}`), `\n  resultado: ${r.ok ? 'pasa' : 'NO pasa'}`, ''].join('\n'));
      process.exit(r.ok ? 0 : 1);
    }
    const r = promover(id, key, { root, curated: curatedLibraryRoot(), cwd: process.cwd(), niveles });
    const texto = [`\npromover ${id} — proyecto ${key}`, `  nivel de la corrección: ${r.nivel ?? '?'}`];
    if (r.regresion) for (const p of r.regresion.pruebas) texto.push(`  ${p.ok ? 'ok  ' : 'FALLA'} ${p.nombre.padEnd(22)} ${p.detalle}`);
    texto.push('');
    if (r.status === 'promoted') {
      texto.push(`  PROMOVIDA: ${String(r.hashAnterior).slice(0, 12)} -> ${String(r.hashResultante).slice(0, 12)}`);
      texto.push(`  la versión anterior queda apartada y entera en ${r.superseded ?? '(sin versión anterior)'}`);
    } else if (r.status === 'reverted') {
      texto.push(`  REVERTIDA (${r.reason})`);
      texto.push(`  la versión anterior está de vuelta, con su huella ${String(r.hashRestaurado).slice(0, 12)}`);
    } else if (r.status === 'pending') {
      texto.push(`  sin activar: ${r.reason}`);
      if (r.nivel <= 2) texto.push(`  para activarla: node bin/skill-compiler.mjs promote ${id} --nivel ${r.nivel}`);
      else texto.push(`  esta corrección exige aprobación humana: node bin/skill-compiler.mjs approve ${id}`);
    } else {
      texto.push(`  ${r.status.toUpperCase()}: ${r.reason}`);
    }
    if (r.status !== 'promoted' && r.status !== 'reverted') texto.push('  nada se ha modificado');
    texto.push('');
    process.stdout.write(texto.join('\n'));
    process.exit(r.status === 'promoted' || r.status === 'pending' || r.status === 'reverted' ? 0 : 1);
  }

  case 'history': {
    const { historial, ciclos } = await import('../lib/promote.mjs');
    const key = scope();
    const filas = historial(key, { root, id: positional[0] ?? null });
    if (filas.length === 0) { process.stdout.write(`\nSin promociones registradas en ${key}.\n`); break; }
    const texto = [`\nhistorial de correcciones — ${key}`];
    for (const f of filas) {
      texto.push(`  ${f.at}  ${(f.decision ?? '?').padEnd(24)} ${f.id}  nivel ${f.nivel}`);
      texto.push(`      reglas: ${f.reglas.join(', ') || '(sin reglas)'} · pruebas: ${f.pruebas.join(' ')}`);
      if (f.anterior || f.resultado) texto.push(`      ${String(f.anterior).slice(0, 12)} -> ${String(f.resultado ?? '(sin resultado)').slice(0, 12)}`);
      if (f.why) texto.push(`      motivo: ${f.why}`);
    }
    const repetidas = ciclos({ key, root });
    if (repetidas.length > 0) {
      texto.push('', '  POSIBLES CICLOS (la misma corrección, una y otra vez):');
      for (const c of repetidas) texto.push(`    · ${c.id} (${c.reglas}): ${c.promociones} promociones, la última ${c.ultima}`);
    }
    texto.push('');
    process.stdout.write(texto.join('\n'));
    break;
  }

  case 'review': {
    // La superficie de decisión para quien no quiere recordar la sintaxis de un comando. Se arranca a
    // mano, escucha solo en 127.0.0.1 y exige el token que se imprime aquí: ver lib/review.mjs.
    const key = scope();
    const port = flags.port !== undefined ? Number(flags.port) : 0;
    const { createReviewServer } = await import('../lib/review.mjs');
    const review = createReviewServer({
      root,
      key,
      check: checkSkill,
      // Se ata la raíz del almacén aquí: la página nunca debe poder actuar sobre otro almacén.
      approve: (id, projectKey) => approve(id, projectKey, { root }),
      reject: (id, projectKey) => reject(id, projectKey, { root }),
      port,
    });
    const actual = await review.listen();
    process.stdout.write([
      `Revisión de skills — proyecto ${key}`,
      '',
      `  ${review.urlFor(actual)}`,
      '',
      'Ábrela en el navegador. Escucha solo en 127.0.0.1 y el token es de un solo uso:',
      'sin él, la página no responde ni dice que existe.',
      'Ctrl+C para cerrarla.',
      '',
    ].join('\n'));
    break;
  }

  default:
    usage(2);
}
