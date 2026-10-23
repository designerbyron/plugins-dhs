/**
 * commands.mjs — la superficie humana de autorización, dentro del harness.
 *
 * ── Por qué comandos, y no una herramienta ni un botón ───────────────────────────────────────────
 *
 * La regla del plugin no cambia: **aprobar no es una herramienta del modelo**. Si lo fuera, el modelo
 * podría auto-aprobarse su propuesta y la revisión humana sería decorativa. Los comandos del harness son
 * la superficie que faltaba: los escribe una persona en el compositor, corren **contra el agente sin
 * crear mensaje del modelo**, el resultado se pinta en la interfaz y el run queda registrado en el log
 * de la sesión. Decidir sigue siendo humano; lo que cambia es que ya no hay que salir del harness.
 *
 * ── Dos formas de llegar a la misma decisión ─────────────────────────────────────────────────────
 *
 *   1. Los comandos con argumentos (`/skill-approve <id>`), para quien ya sabe el id.
 *   2. Las **filas de pendientes** (`lib/pending-rows.mjs`), que se anuncian en el menú `/` y se eligen
 *      con el ratón o las flechas. Un comando del host sin argumentos declarados se ejecuta en el acto
 *      al elegirlo, así que seleccionar en el menú **es** la decisión: sin recordar ninguna sintaxis.
 *
 * Las dos vías llaman a las mismas tres acciones de aquí abajo. Una regla, una implementación: en
 * particular la puerta previa a aprobar es la MISMA (`checkProposal`), así que ninguna forma de aprobar
 * puede quedar sin validación.
 *
 * ── Después de aprobar, el catálogo se avisa ─────────────────────────────────────────────────────
 *
 * El registro de skills del harness cachea catálogos y no tiene TTL: si nadie invalida, la skill
 * recién aprobada no llega al agente hasta reiniciar. Por eso cada mutación avisa a la señal de
 * catálogo (`catalog.notify()`), que es la que llama a la invalidación del registro. Ese aviso es lo
 * que hace cierta la promesa de «usable sin reiniciar».
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AUTO_COMMAND, autoApproveFromEvents, parseAutoCommand } from './auto-approve.mjs';
import {
  approve, checkProposal, curatedLibraryRoot, defaultRoot, disable, enable, listForProject, locate, move, pending, sugerenciaDeId,
  projectKey, reject, retire, retired,
} from './compiler.mjs';
import { anotarEntradaEnDiario, ficherosQueDifieren, huellaDeContenido, motivoDeIdInseguro } from './security.mjs';
import { medirAutoActualizacion } from './auto-update.mjs';
import { scopeOf } from './definitions.mjs';
import { pendingRowsFor } from './pending-rows.mjs';
import {
  MAQUINA, PROPIEDADES, SOLO_DSH, declararPropiedad, inventario, leerPropiedad, proyectosConocidos, textoDeSistemas,
  textoDelEstado,
} from './scope.mjs';

const ok = (text, extra = {}) => ({ kind: 'success', text, ...extra });
const bad = (text, extra = {}) => ({ kind: 'error', text, ...extra });

/** Los comandos son superficie humana: un fallo se cuenta como texto, nunca se lanza hacia el harness. */
const guarded = (run) => (invocation, ...rest) => {
  try {
    return run(invocation, ...rest);
  } catch (error) {
    return bad(`No se pudo completar: ${error.message}`);
  }
};

// Una pendiente que actualiza algo activo se anuncia como tal: el mismo id en dos listas, sin decirlo,
// se lee como que la aprobación anterior no sirvió de nada.
const bullet = (rows) => rows.map((row) => `  · ${row.id} — ${row.description ?? '(sin descripción)'}${row.updatesActive ? ' · actualización de la versión activa' : ''}${row.auto ? ` · ${row.auto}` : ''}`).join('\n');

const NO_SCOPE = 'Sin ámbito: esta sesión no tiene un directorio de trabajo utilizable.';

/**
 * El estado de la lista, pegado al resultado de decidir: así el humano ve el efecto de lo que acaba de
 * hacer sin volver a ejecutar `/skill-proposals`. Medido con el usuario delante: aprobó una skill, su
 * bloque de propuestas siguió enseñándola como pendiente y volvió a intentarlo.
 */
const remaining = (root, key) => {
  const waiting = pending({ root, key });
  return [
    '',
    `Pendientes de tu aprobación (${waiting.length}):`,
    waiting.length ? bullet(waiting) : '  · ninguna',
  ];
};

/** El ámbito sale del cwd de la sesión, igual que en las herramientas: el humano no lo declara. */
export function scopeOfAgent(agent) {
  const cwd = scopeOf({ agent });
  return { cwd, key: projectKey(cwd) };
}

// ── Las tres acciones ────────────────────────────────────────────────────────────────────────────
//
// Viven fuera de los handlers porque las usan dos superficies: el comando con argumentos y la fila del
// menú. Duplicarlas sería cómo una de las dos se queda sin la puerta en el próximo cambio.

/**
 * Lee una skill entera —la propuesta pendiente o la ya activa— y, si está pendiente, **su veredicto de
 * puerta**: los fallos que impiden aprobarla y los avisos que exigirán `--force`. Sin eso, decidir
 * sobre una propuesta sería decidir a ciegas.
 */
export function viewProposal({ root = defaultRoot(), cwd, key, id }) {
  if (key === null) return bad(NO_SCOPE);
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad('Falta el id. Uso: /skill-show <id>');

  const proposal = pending({ root, key }).find((row) => row.id === wanted);
  const active = listForProject(cwd, { root }).find((row) => row.id === wanted);
  const chose = proposal ?? active;
  if (chose === undefined) return noEstáElId(wanted, key, root, { que: 'skill aprendida' });

  if (proposal === undefined) {
    return ok([`Activa en este proyecto: ${wanted}`, `${chose.path}`, '', readFileSync(chose.path, 'utf8')].join('\n'));
  }

  const check = checkProposal(wanted, key, { root });
  return ok([
    `Propuesta pendiente de aprobación: ${wanted}`,
    `${chose.path}`,
    '',
    check.ok ? 'Puerta de validación: pasa.' : 'Puerta de validación: NO pasa todavía.',
    ...check.errors.map((e) => `  FALLO  ${e}`),
    ...check.warnings.map((w) => `  aviso  ${w}`),
    ...(check.warnings.length > 0 ? ['', `Aprobarla con estos avisos exige decirlo: /skill-approve ${wanted} --force`] : []),
    '',
    readFileSync(chose.path, 'utf8'),
  ].join('\n'));
}

/** Activa una propuesta, y sólo si pasa la puerta. `force` acepta los avisos; nunca salta los fallos. */
/**
 * Aprobar **varias** de una vez: la misma puerta, una a una, con resultado por elemento.
 *
 * No es una transacción y no lo finge: cada id se aprueba o falla por su cuenta, y el informe dice cuál fue
 * cuál. Existe porque el panel ejecutaba N órdenes del host y el host no las ejecutaba: con una sola orden —y
 * una sola entrada— el lote no depende de que el host entienda diez llamadas.
 *
 * @returns `ok` si se aprobaron todas; `bad` si alguna falló, con el detalle de todas (un lote con un fallo
 *   necesita que alguien lo mire, y un `success` lo escondería).
 */
export function aprobarLote({ root, key, ids = [], scope = 'project', force = false, catalog } = {}) {
  if (key === null) return bad(NO_SCOPE);
  const limpios = [...new Set(ids.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (limpios.length === 0) return bad('No hay ids que aprobar.');
  const resultados = [];
  for (const id of limpios) {
    const r = approveProposal({ root, key, id, force, scope, catalog: null });
    resultados.push({ id, ok: r.kind === 'success', primera: String(r.text ?? '').split('\n')[0] });
  }
  const bien = resultados.filter((r) => r.ok).length;
  const mal = resultados.length - bien;
  if (bien > 0) catalog?.notify();
  const texto = [
    `Lote de ${resultados.length}: ${bien} aprobada(s) · ${mal} con fallo`,
    `Ámbito: ${scope === 'global' ? 'biblioteca de usuario (todos los proyectos)' : `este proyecto (${key})`}`,
    '',
    ...resultados.map((r) => `${r.ok ? 'ok   ' : 'FALLO'} ${r.id} — ${r.primera}`),
    ...(mal > 0 ? ['', 'Los que fallaron no se movieron; su motivo está en su línea.'] : []),
  ].join('\n');
  return bien === resultados.length ? ok(texto) : bad(texto);
}

/**
 * El id no está: se dice la verdad y, si huele a letra cambiada, se ofrece el que sí está.
 *
 * Un «no hay ninguna propuesta» que calla cuando el id correcto está a una letra es un callejón: el humano
 * tiene que volver a mirar la lista y teclear otra vez. Medido con `dhs-nexus-protocol` (quería
 * `dsh-nexus-protocol`): el fallo era real —no había nada con ese id— pero la respuesta no ayudaba.
 */
/**
 * El id que llega de la línea de comandos, antes de mirar el disco.
 *
 * Un id es una carpeta: con `..` o una barra no es un id raro, es una ruta a otra parte. Se dice con esas
 * palabras —y no «no hay ninguna propuesta», que sería verdad y no enseñaría nada—.
 */
function idNoUtilizable(wanted) {
  const motivo = motivoDeIdInseguro(wanted);
  return motivo === null
    ? null
    : bad([`«${wanted}» no es un id utilizable: ${motivo}.`, 'Los ids son kebab-case ASCII, sin puntos ni separadores.'].join('\n'));
}

function noEstáElId(wanted, key, root, { que = 'propuesta' } = {}) {
  const cerca = sugerenciaDeId(wanted, key, { root });
  return bad([
    `No hay ninguna ${que} «${wanted}» en ${key}.`,
    ...(cerca
      ? [`¿Querías decir «${cerca}»? Con ese id sí hay algo: repite el comando con él.`, 'Y para verlo todo: /skill-proposals.']
      : ['Míralas con /skill-proposals.']),
  ].join('\n'));
}

/** El diario del proyecto: una sola ruta, para que tres caminos no inventen tres. */
const diarioDelProyecto = (root, key) => join(root, 'projects', key, 'journal.jsonl');

export function approveProposal({ root = defaultRoot(), key, id, force = false, scope = 'project', catalog, preservarEstado = false } = {}) {
  if (key === null) return bad(NO_SCOPE);
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad('Falta el id. Uso: /skill-approve <id> [--force]');
  const noEsId = idNoUtilizable(wanted);
  if (noEsId !== null) return noEsId;

  // Aprobar algo que ya está aprobado no es un fallo: es un acto que ya ocurrió. Decirlo con esas
  // palabras evita el «failed» que hacía pensar que la primera aprobación no había servido.
  const where = locate(wanted, key, { root });
  if (scope === 'global' && (where === 'global' || where === 'published')) {
    return ok([
      `Ya estaba publicada: ${wanted} en la biblioteca de usuario`,
      'No se ha cambiado nada.',
      ...remaining(root, key),
    ].join('\n'), { code: 'already-published', params: { id: wanted } });
  }
  if (where === 'approved') {
    return ok([
      `Ya estaba activa: ${wanted} [${key}]`,
      'No se ha cambiado nada.',
      ...remaining(root, key),
    ].join('\n'), { code: 'already-active', params: { id: wanted } });
  }
  if (where === 'rejected') {
    return bad([
      `«${wanted}» está apartada en ${key}, no pendiente de aprobación.`,
      'Su copia sigue en rejected/: recuperarla es un acto manual, y a propósito.',
    ].join('\n'));
  }
  if (where === null) return noEstáElId(wanted, key, root);

  // La misma puerta que la CLI: sin ella, esta vía sería una vía de aprobación sin validación.
  const check = checkProposal(wanted, key, { root });
  if (!check.ok) {
    return bad([
      `Aprobación RECHAZADA: la propuesta ${wanted} no pasa la puerta.`,
      ...check.errors.map((e) => `  FALLO  ${e}`),
      'No se ha movido nada. Corrige la propuesta y repite.',
    ].join('\n'), { code: 'gate-failed', params: { id: wanted, errors: check.errors } });
  }
  if (check.warnings.length > 0 && !force) {
    return bad([
      `La propuesta ${wanted} tiene avisos:`,
      ...check.warnings.map((w) => `  aviso  ${w}`),
      '',
      `Si los aceptas: /skill-approve ${wanted} --force`,
    ].join('\n'), { code: 'with-warnings', params: { id: wanted, warnings: check.warnings } });
  }

  // Lo que se validó es lo que se mueve. Se mide la huella del **contenido** —`SKILL.md` y su material, sin
  // `meta.json`, que el movimiento reescribe a propósito— y se pasa a `approve`, que la verifica ANTES de
  // renombrar: si alguien cambió la propuesta en medio, no se mueve nada y se dice qué fichero difiere.
  const huellaAntes = huellaDeContenido(check.dir);
  // Corregir una skill apagada **sin encenderla**: el estado se lee del origen, no se pide a mano, así que no
  // hay forma de «activarla sin querer» al repararla.
  // El estado **vivo** de la skill (aprobada o apagada); `locate` mira también lo propuesto y aquí lo que
  // importa es dónde se sirve —o se dejaría de servir—.
  const estadoOrigen = ['approved', 'disabled'].find((estado) => existsSync(join(root, 'projects', key, estado, wanted))) ?? locate(wanted, key, { root });
  if (preservarEstado && estadoOrigen !== 'disabled') {
    return bad(`--preserve-state sólo tiene sentido con una skill apagada: «${wanted}» está en ${estadoOrigen ?? 'ningún estado vivo'}.`, { code: 'invalid-flag', params: { flag: '--preserve-state', id: wanted } });
  }
  const moved = approve(wanted, key, { root, scope, esperada: huellaAntes, ...(preservarEstado ? { estado: 'disabled' } : {}) });
  if (!moved.ok) return bad(`No se pudo aprobar ${wanted}: ${moved.reason}`);

  // El catálogo acaba de cambiar: sin este aviso, la skill no llega al agente hasta reiniciar.
  catalog?.notify();

  // La aprobación queda registrada **con sus huellas**: qué contenido se aprobó y cuál quedó activo. Sin esta
  // entrada, «se aprobó» es una afirmación sin respaldo —y las aprobaciones eran justo lo único que no
  // anotaba el diario, mientras las promociones sí.
  anotarEntradaEnDiario(diarioDelProyecto(root, key), {
    id: wanted,
    key,
    decision: scope === 'global' ? 'publicada' : (preservarEstado ? 'actualizada-apagada' : 'aprobada'),
    ambito: scope,
    por: 'humano',
    canal: 'comando',
    hashAnterior: huellaAntes,
    hashResultante: huellaDeContenido(join(moved.path, '..')),
    superseded: moved.superseded ?? null,
    avisos: check.warnings,
  });

  // Belt and braces: si el contenido activado no es el validado, no se queda activo con un aviso — se
  // devuelve a `proposed`, se dice qué fichero difiere y la aprobación se declara fallida.
  const destino = join(moved.path, '..');
  const huellaDespues = huellaDeContenido(destino);
  if (huellaDespues !== huellaAntes) {
    const ficheros = (() => { try { return ficherosQueDifieren(check.dir, destino); } catch { return []; } })();
    const vuelta = move(root, key, wanted, 'approved', 'proposed');
    return bad([
      `NO se aprobó ${wanted}: el contenido activado no es el que validaste (${huellaAntes.slice(0, 12)} → ${huellaDespues.slice(0, 12)}).`,
      ...(ficheros.length ? [`  difiere: ${ficheros.join(', ')}`] : []),
      vuelta.ok ? '  Se devolvió a propuestas: no queda activa. Vuelve a validarla con /skill-show y decide otra vez.' : `  No se pudo devolver a propuestas (${vuelta.reason}): revísala a mano antes de usarla.`,
      '  La versión anterior, si la había, sigue apartada en superseded/ y se recupera a mano.',
    ].join('\n'));
  }

  return ok([
    preservarEstado ? `Actualizada (sigue apagada): ${wanted} [${key}]` : `Activa: ${wanted} [${key}]`,
    `  ${moved.path}`,
    ...(moved.superseded ? [`  versión anterior apartada en ${moved.superseded}`] : []),
    ...(check.warnings.length > 0 ? ['', 'Aprobada con avisos:', ...check.warnings.map((w) => `  · ${w}`)] : []),
    '',
    preservarEstado
      ? 'Sigue apagada: no se sirve al modelo. Se enciende con /skill-enable cuando lo decidas.'
      : 'Ya la sirve el catálogo de este proyecto: el agente la ve en su siguiente paso, sin reiniciar.',
    `Invocarla tú: /${wanted}`,
    ...remaining(root, key),
  ].join('\n'), scope === 'global'
    ? { code: 'published', params: { id: wanted, key } }
    : preservarEstado
      ? { code: 'updated-disabled', params: { id: wanted, key } }
      : { code: 'activated', params: { id: wanted, key } });
}

/** Aparta una propuesta sin borrarla: queda en `rejected/`, recuperable. */
export function rejectProposal({ root = defaultRoot(), key, id, catalog } = {}) {
  if (key === null) return bad(NO_SCOPE);
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad('Falta el id. Uso: /skill-reject <id>');
  const noEsId = idNoUtilizable(wanted);
  if (noEsId !== null) return noEsId;

  const where = locate(wanted, key, { root });
  if (where === 'rejected') {
    return ok([`Ya estaba apartada: ${wanted} [${key}]`, 'No se ha cambiado nada.', ...remaining(root, key)].join('\n'),
      { code: 'already-set-aside', params: { id: wanted } });
  }
  if (where === 'approved') {
    return bad([
      `«${wanted}» ya está activa en ${key}: rechazar sólo se aplica a las propuestas pendientes.`,
      'Lo aprendido y aprobado se aparta a mano, y a propósito: no hay un comando que lo deshaga sin querer.',
    ].join('\n'));
  }
  if (where === null) return noEstáElId(wanted, key, root);

  const moved = reject(wanted, key, { root });
  if (!moved.ok) return bad(`No se pudo apartar ${wanted}: ${moved.reason}`);

  catalog?.notify();

  anotarEntradaEnDiario(diarioDelProyecto(root, key), {
    id: wanted, key, decision: 'apartada', ambito: 'project', por: 'humano', canal: 'comando',
    hashAnterior: null, hashResultante: null, superseded: moved.path ?? null,
  });

  return ok([
    `Apartada: ${wanted} [${key}]`,
    `  ${moved.path.replace(/[\\/]SKILL\.md$/, '')}`,
    '',
    'No se ha borrado nada: sigue en el almacén por si quieres recuperarla.',
    ...remaining(root, key),
  ].join('\n'), { code: 'set-aside', params: { id: wanted } });
}

/**
 * Crea los comandos del plugin.
 *
 * @param root - raíz del almacén.
 * @param catalog - señal de catálogo; recibe el aviso tras cada mutación.
 * @param onListed - se llama al listar las pendientes: es el momento en el que el humano va a decidir, y
 *   por tanto el momento de tener sus filas anunciadas en el menú.
 * @returns las definiciones, en la forma que espera `ctx.commands.register(...)`.
 */
export function skillCommands({ root = defaultRoot(), catalog, onListed, onMount } = {}) {
  /**
   * Envuelve una acción que **mueve** una skill para que avise al catálogo cuando de verdad movió algo.
   *
   * El registro de skills cachea los catálogos sin TTL, así que quien muta el almacén es quien tiene que
   * avisar. Aprobar y rechazar lo hacían; apagar, encender y retirar no — y el resultado era una skill
   * apagada que el agente seguía teniendo delante. Aquí el aviso no depende de que alguien se acuerde:
   * las cinco acciones pasan por el mismo envoltorio, y la suite comprueba que todas avisan.
   */
  const moveAction = (action) => (...args) => {
    const result = action(...args);
    if (result?.ok === true) catalog?.notify();
    return result;
  };
  const disableSkill = moveAction(disable);
  const enableSkill = moveAction(enable);
  const retireSkill = moveAction(retire);

  /**
   * El listado que ve el humano: qué espera su aprobación, qué está activo y qué está apagado. Vive en una
   * función porque lo usan **dos** comandos —`/skill-proposals` y `/skill-approve` sin id—: pedir a un
   * humano que recuerde un identificador para decidir es la nota al pie que este plugin viene evitando
   * desde su primera versión.
   */
  const listar = ({ agent, montaje = { ok: true } } = {}) => {
        const { cwd, key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);

        // Antes de listar, asegurar las filas: si el humano mira las pendientes, es que va a decidir.
        onListed?.();

        const waiting = pending({ root, key });
        // Una actualización se puede medir aquí mismo: el humano quiere saber, antes de marcar, si esa
        // corrección es de las que puede activar una máquina. Se mide con el MISMO medidor que decide
        // (no una etiqueta aparte), y sólo para las que son actualizaciones: una skill nueva nunca lo es.
        const MAX_MEDIDAS = 6;
        for (const fila of waiting) {
          if (!fila.updatesActive) continue;
          if (waiting.indexOf(fila) >= MAX_MEDIDAS) { fila.auto = 'no medido en esta lista (hay más de ' + MAX_MEDIDAS + ' actualizaciones)'; continue; }
          try {
            const v = medirAutoActualizacion(fila.id, key, { root, curated: curatedLibraryRoot(), cwd });
            fila.auto = v.apto ? `auto-actualizable (${v.medidas.length} medidas en verde)` : `exige humano: ${v.fallan.slice(0, 2).join(', ')}`;
          } catch (error) {
            fila.auto = `no se pudo medir: ${error.message}`;
          }
        }
        const active = listForProject(cwd, { root });
        // Lo apagado no se sirve, pero el humano tiene que verlo: sin esto, la única prueba de que apagó
        // algo es el resultado de aquel comando, y no hay forma de saber qué queda por devolver.
        const fueraDeServicio = retired(key, { root }).filter((skill) => skill.state === 'disabled');
        const auto = autoApproveFromEvents(agent?.session?.snapshotEvents?.() ?? []);
        const rows = pendingRowsFor({ root, cwd });

        return ok([
          `Aprendizaje de ${cwd} [${key}]`,
          '',
          `Pendientes de tu aprobación (${waiting.length}):`,
          waiting.length ? bullet(waiting) : '  · ninguna',
          ...rows.map((row) => `      /${row.name}`),
          // La orden exacta, siempre: con filas o sin ellas. Depender del menú para decidir era depender de
          // un servicio que este anfitrión no compone en el contexto del agente (tres caminos medidos). Una
          // línea pegable decide todas y no pide recordar nada.
          ...(waiting.length > 0
            ? [
              '',
              `Una orden para todas: /skill-approve ${waiting.map((fila) => fila.id).join(',')} --local`,
              'Una a una: /skill-approve <id> --local · para todos tus proyectos: --global · aceptando avisos: --force',
            ]
            : []),
          ...(rows.length > 0 ? ['', 'Sin teclear: escribe «/» y elige la fila; es la misma orden.'] : []),
          '',
          `Aprobadas y activas (${active.length}):`,
          active.length ? bullet(active) : '  · ninguna',
          '',
          `Apagadas (${fueraDeServicio.length}) — no se sirven al modelo, se conservan enteras:`,
          fueraDeServicio.length ? bullet(fueraDeServicio) : '  · ninguna',
          ...(fueraDeServicio.length > 0 ? [`  Para devolver una: /skill-enable <id>, o elige su fila en el menú «/». Para retirarla del todo: /skill-retire <id> --yes`] : []),
          '',
          `Aprobación automática en esta sesión: ${auto ? 'ACTIVA' : 'desactivada'}`,
          auto ? '  (las propuestas que pasen la validación se activan solas; /skill-auto desactivar para pararlo)' : '  (actívala con /skill-auto activar)',
          '',
          // Sin pendientes no hay nada que anunciar: el aviso sólo aparece cuando de verdad hay una fila
          // que el menú podría ofrecer y no ofrece. Con la lista vacía era ruido en cada consulta.
          ...(montaje.ok || waiting.length === 0 ? [] : [
            `Aviso: este anfitrión no anuncia filas por propuesta en el menú «/» (${montaje.motivo}).`,
            '  No hay nada que corregir por tu parte: la orden de arriba las decide todas, y el panel de esta tarjeta también.',
          ]),
          'Con un id a mano: /skill-show <id> · /skill-approve <id> [--force] · /skill-reject <id>',
        ].join('\n'));
  };

  /**
   * El estado de la propiedad. El texto lo compone `lib/scope.mjs` para las tres superficies —comando,
   * CLI y `doctor`—: una sola redacción, y los cuatro estados se leen distinto porque son distintos.
   */
  const textoDePropiedad = () => textoDelEstado(leerPropiedad({ root }));

  /** Declara la propiedad y devuelve el resultado en la forma que espera un comando. */
  const declararLaPropiedad = (ownership) => {
    const antes = leerPropiedad({ root });
    const r = declararPropiedad(ownership, { root, por: 'humano', esperadaHuella: antes.huella ?? undefined });
    if (!r.ok) return bad(r.reason);
    return ok([
      `Declarada la propiedad: «${ownership}».`,
      `  ${PROPIEDADES[ownership]}`,
      '',
      ownership === MAQUINA
        ? 'Desde ahora, proponer un id que ya vive en otro sistema se AVISA con su sitio, y nunca se sobrescribe lo ajeno.'
        : 'Desde ahora, proponer un id que ya vive en otro sistema se RECHAZA con su sitio.',
    ].join('\n'));
  };

  /** El inventario del puesto, con el mismo texto que imprime el CLI (`systems`). */
  const textoDelInventario = () => textoDeSistemas({
    datos: inventario({ root, curada: curatedLibraryRoot(), proyectos: proyectosConocidos({ root }) }),
    estado: leerPropiedad({ root }),
  });

  const definiciones = [
    {
      name: 'skill-proposals',
      description: 'Qué skills aprendidas esperan tu aprobación en este proyecto y cuáles están activas.',
      handler: guarded(({ agent }, montaje) => listar({ agent, montaje })),
    },

    {
      // Sólo los ids, en una línea estable: es la fuente que consulta la tarjeta para saber si lo que
      // muestra sigue pendiente. Sin esto, una tarjeta vieja ofrece decidir algo que el almacén ya no tiene
      // y la orden falla con «no hay ninguna propuesta» —un fallo que el humano no puede arreglar—.
      name: 'skill-pending',
      description: 'Los ids que esperan decisión, en una línea: lo que la tarjeta consulta antes de decidir.',
      handler: guarded(({ agent }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const waiting = pending({ root, key });
        // Los avisos viajan con los ids para que la tarjeta pueda **preguntar antes** de mandar la orden: si
        // no, la primera orden se niega y el anfitrión pinta un «failed» que el humano no ha provocado.
        const lineas = [`pendientes: ${waiting.length}`, `ids: ${waiting.map((fila) => fila.id).join(',')}`];
        const porId = new Map();
        for (const fila of waiting) {
          let avisos = [];
          try {
            const meta = JSON.parse(readFileSync(join(dirname(fila.path), 'meta.json'), 'utf8'));
            avisos = Array.isArray(meta?.warnings) ? meta.warnings.map(String) : [];
          } catch { avisos = []; }
          porId.set(fila.id, avisos);
        }
        if (porId.size > 0) {
          lineas.push(`avisos: ${[...porId].map(([id, a]) => `${id}=${a.length}`).join(',')}`);
          for (const [id, avisos] of porId) for (const aviso of avisos) lineas.push(`aviso: ${id} · ${aviso}`);
        }
        return ok(lineas.join('\n'), {
          code: 'pending-list',
          params: { ids: waiting.map((fila) => fila.id) },
        });
      }),
    },

    {
      name: 'skill-show',
      description: 'Lee una skill aprendida de este proyecto: la propuesta pendiente o la ya activa.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { cwd, key } = scopeOfAgent(agent);
        return viewProposal({ root, cwd, key, id: rawInput });
      }),
    },

    {
      name: 'skill-approve',
      description: 'Activa una skill propuesta, si pasa la puerta de validación: en este proyecto, o para todos los tuyos si lo dices. Sin decir dónde, pregunta. Aprobar es tuyo: el modelo no puede.',
      input: { hint: '<id> [--global|--local] [--force]' },
      handler: guarded(({ agent, rawInput }, montaje) => {
        const { key } = scopeOfAgent(agent);
        const input = String(rawInput ?? '').trim();
        // Sin id no es un error de sintaxis: es «enséñame qué hay». Además arma las filas de la sesión.
        if (input === '') return listar({ agent, montaje });
        const force = /(?:^|\s)--force$/.test(input);
        const global = /(?:^|\s)--global(?:\s|$)/.test(input);
        const local = /(?:^|\s)--local(?:\s|$)/.test(input);
        const id = input.replace(/(?:\s+--(?:force|global|local))+$/, '').trim();
        // Varios ids —«a,b,c» o «a b c»— son un LOTE: misma puerta, una a una, resultado por elemento.
        const ids = id.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
        if (ids.length > 1) {
          if (!global && !local) {
            return ok([
              `¿Dónde quieres que vivan estas ${ids.length}?`,
              '',
              `  · En ESTE proyecto (${key}): /skill-approve ${ids.join(',')} --local`,
              `  · Para TODOS tus proyectos: /skill-approve ${ids.join(',')} --global`,
              '',
              'Es un lote: cada una pasa por la misma puerta y el informe dice cuál falló.',
            ].join('\n'));
          }
          return aprobarLote({ root, key, ids, scope: global ? 'global' : 'project', force, catalog });
        }

        // Sin ámbito dicho, se pregunta —con las dos opciones y su nombre de fila— en vez de decidir por el
        // humano. «Local» no es un defecto que se esconde: es una de las dos respuestas.
        if (!global && !local && locate(id, key, { root }) === 'proposed') {
          return ok([
            `¿Dónde quieres que viva «${id}»?`,
            '',
            `  · En ESTE proyecto (${key}): /skill-approve ${id} --local`,
            '      la sirve el plugin sólo en las sesiones de este proyecto.',
            `  · Para TODOS tus proyectos: /skill-approve ${id} --global`,
            '      se publica en la biblioteca de usuario y la sirve el harness en cualquier sesión.',
            '',
            'También valen sus filas del menú «/»: «skill-approve-<id>» y «skill-publish-<id>».',
            'Con «--force» si la propuesta viene con avisos.',
          ].join('\n'), { code: 'scope-ask', params: { id } });
        }

        const scope = global ? 'global' : 'project';
        const result = approveProposal({ root, key, id, force, scope, catalog });
        if (result?.kind !== 'ok') return result;
        const nota = scope === 'global'
          ? `Se sirve en toda sesión de esta máquina (biblioteca de usuario). Para dejarla sólo en este proyecto: /skill-scope ${id} --local`
          : `Se sirve al modelo sólo en este proyecto. Para que la vean todos: /skill-approve ${id} --global`;
        return ok([result.text, '', nota].join('\n'));
      }),
    },

    {
      name: 'skill-publish',
      description: 'Activa una skill propuesta para TODOS tus proyectos: la publica en la biblioteca de usuario, que el harness sirve en cualquier sesión.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const bruto = String(rawInput ?? '').trim();
        // `force: true` incondicional era una puerta trasera: publicar para todos se saltaba los avisos sin
        // que nadie lo dijera. Ahora se pide explícito, como en la aprobación local.
        const force = /(?:^|\s)--force$/.test(bruto);
        const id = bruto.replace(/(?:\s+--force)+$/, '').trim();
        const result = approveProposal({ root, key, id, force, scope: 'global', catalog });
        if (result?.kind !== 'ok') return result;
        return ok([result.text, '', `Para dejarla sólo en este proyecto: /skill-scope ${id} --local`].join('\n'));
      }),
    },

    {
      name: 'skill-scope',
      description: 'Cambia dónde vive una skill ya aprobada: en este proyecto o en la biblioteca de usuario, en las dos direcciones.',
      input: { hint: '<id> --global | --local' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const input = String(rawInput ?? '').trim();
        const to = /(?:^|\s)--global(?:\s|$)/.test(input) ? 'global' : /(?:^|\s)--local(?:\s|$)/.test(input) ? 'project' : null;
        const id = input.replace(/(?:\s+--(?:global|local))+$/, '').trim();
        if (id === '') return bad('Falta el id. Uso: /skill-scope <id> --global|--local');
        const moved = ambito(id, key, { root, to });
        if (!moved.ok) return bad(`No se pudo cambiar el ámbito: ${moved.reason}`);
        catalog?.notify();
        return ok([
          moved.scope === 'global'
            ? `Ahora «${id}» vive en la biblioteca de usuario: la ven TODOS tus proyectos.`
            : `Ahora «${id}» vive en este proyecto (${key}).`,
          `  ${moved.path}`,
          `  huella: ${moved.sha256}`,
          moved.scope === 'global'
            ? `Volver a este proyecto: /skill-scope ${id} --local`
            : `Publicarla para todos: /skill-scope ${id} --global`,
        ].join('\n'));
      }),
    },

    {
      name: AUTO_COMMAND,
      description: 'Activa o desactiva que las skills y los parches propuestos en ESTA sesión se aprueben solos. La validación y el registro se siguen aplicando: delegas la confirmación, no la puerta.',
      input: { hint: 'activar | desactivar' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);

        const decision = parseAutoCommand(rawInput);

        // Sin argumento: sólo informa. El estado se pliega del log de la sesión, que es donde vive.
        if (decision === null) {
          const active = autoApproveFromEvents(agent?.session?.snapshotEvents?.() ?? []);
          return ok([
            `Aprobación automática en esta sesión: ${active ? 'ACTIVA' : 'desactivada'}`,
            '',
            active
              ? 'Las propuestas (nuevas o parches) que pasen la validación se activan solas, sin esperar tu confirmación.'
              : 'Nada se activa sin tu decisión.',
            'La validación previa se aplica siempre: el modo no aprueba nada que no pase la puerta, ni un conflicto, ni un envío bloqueado.',
            'Queda registrado en el log de esta sesión.',
            '',
            active ? 'Para pararlo: /skill-auto desactivar' : 'Para activarlo: /skill-auto activar',
          ].join('\n'));
        }

        return ok(decision
          ? [
            'Aprobación automática ACTIVA en esta sesión.',
            '',
            'Desde ahora, cada skill o parche que se proponga y pase la validación se activa solo, y queda disponible en el acto.',
            'Lo que NO cambia: la validación previa, el anti-solapamiento, el bloqueo de orígenes con contenido peligroso, y el registro — tu activación y todo lo aprobado quedan en el log de la sesión.',
            'Se puede parar cuando quieras: /skill-auto desactivar',
          ].join('\n')
          : [
            'Aprobación automática desactivada.',
            '',
            'Desde ahora nada se activa sin tu decisión: las propuestas esperan en /skill-proposals.',
          ].join('\n'));
      }),
    },

    // ── El ciclo de vida, desde la sesión ───────────────────────────────────────────────────────────
    // Apagar es reversible y no se confunde con retirar. Retirar es el único gesto irreversible del
    // plugin, así que **exige un `--yes` explícito** y dice antes dónde queda el respaldo: un clic, o una
    // línea, no pueden borrar el trabajo de nadie.
    {
      name: 'skill-disable',
      description: 'Apaga una skill activa de este proyecto: deja de servirse al modelo y se conserva entera. Reversible.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const id = String(rawInput ?? '').trim();
        if (id === '') return bad('Dime cuál: /skill-disable <id>. Las activas están en /skill-proposals.');
        if (!existsSync(join(root, 'projects', key, 'approved', id))) {
          const donde = locate(id, key, { root });
          return bad(donde === null
            ? `No hay ninguna skill activa con el id ${id} en ${key}.`
            : `«${id}» no está activa en ${key}: está en ${donde}.`);
        }
        const moved = disableSkill(id, key, { root });
        if (!moved.ok) return bad(`No se pudo apagar: ${moved.reason}`);
        return ok(`${id} apagada en ${key}.\n  deja de servir al modelo, y se conserva entera: /skill-enable ${id} la devuelve.`, { code: 'disabled', params: { id } });
      }),
    },

    {
      name: 'skill-enable',
      description: 'Vuelve a encender una skill que estaba apagada en este proyecto.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const id = String(rawInput ?? '').trim();
        if (id === '') return bad('Dime cuál: /skill-enable <id>. Lo apagado está en /skill-retired.');
        const moved = enableSkill(id, key, { root });
        if (!moved.ok) return bad(`No se pudo encender: ${moved.reason}`);
        return ok(`${id} vuelve a estar activa en ${key}: se sirve al modelo sólo en este proyecto.`, { code: 'enabled', params: { id } });
      }),
    },

    {
      name: 'skill-retire',
      description: 'Retira una skill de este proyecto: se mueve a un respaldo fechado, nunca se borra. Exige --yes.',
      input: { hint: '<id> [--yes]' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const input = String(rawInput ?? '').trim();
        const yes = /(?:^|\s)--yes$/.test(input);
        const id = input.replace(/(?:\s+--yes)?$/, '').trim();
        if (id === '') return bad('Dime cuál: /skill-retire <id> [--yes].');
        if (!yes) {
          return ok(`Se va a RETIRAR «${id}» del proyecto ${key}.\n  Nada se borra: la carpeta se mueve a un respaldo con fecha, y vuelve con \`restore\` desde el terminal.\n  Repite así para hacerlo: /skill-retire ${id} --yes`);
        }
        const moved = retireSkill(id, key, { root });
        if (!moved.ok) return bad(`No se pudo retirar: ${moved.reason}`);
        return ok(`Retirada «${id}» de ${key}.\n  respaldo: ${moved.backup}\n  huella:   ${moved.hash}\n  vuelve con: restore ${id} (CLI)\n`, { code: 'retired', params: { id } });
      }),
    },

    {
      name: 'skill-retired',
      description: 'Qué está apagado en este proyecto y qué se retiró ya, con su fecha.',
      handler: guarded(({ agent }) => {
        const { cwd, key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const lista = retired(key, { root });
        if (lista.length === 0) return ok(`Nada apagado ni retirado en ${cwd} [${key}].`);
        return ok([
          `Fuera de servicio en ${cwd} [${key}]:`,
          '',
          ...lista.map((skill) => `  · ${skill.id} — ${skill.state === 'disabled' ? 'apagada (reversible)' : `retirada el ${skill.retiredAt} (en el respaldo)`}`),
          '',
          'Con un id a mano: /skill-enable <id> lo devuelve · /skill-retire <id> --yes lo retira del todo.',
        ].join('\n'));
      }),
    },

    {
      name: 'skill-ownership',
      description: 'Quién manda en el proceso de creación de skills de este puesto: sólo DSH o todo el PC. Sin argumento, dice lo declarado.',
      input: { hint: `${SOLO_DSH}|${MAQUINA}` },
      handler: guarded(({ rawInput }) => {
        const input = String(rawInput ?? '').trim();
        return input === '' ? ok(textoDePropiedad()) : declararLaPropiedad(input);
      }),
    },

    {
      name: `skill-ownership-${SOLO_DSH}`,
      description: 'Declara que este plugin escribe skills SÓLO mientras se trabaja con DSH: no compite con los demás sistemas del puesto.',
      handler: guarded(() => declararLaPropiedad(SOLO_DSH)),
    },

    {
      name: `skill-ownership-${MAQUINA}`,
      description: 'Declara que este plugin se hace cargo del proceso de creación de skills en TODO el PC: mira los demás sistemas, avisa de cada choque de id y no sobrescribe lo ajeno.',
      handler: guarded(() => declararLaPropiedad(MAQUINA)),
    },

    {
      name: 'skill-systems',
      description: 'Los sistemas de skills de este puesto, sus almacenes, su estado real y los identificadores que viven en más de uno.',
      handler: guarded(() => ok(textoDelInventario())),
    },

    {
      name: 'skill-reject',
      description: 'Aparta una skill propuesta de este proyecto sin borrarla: queda guardada en rejected/.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        return rejectProposal({ root, key, id: rawInput, catalog });
      }),
    },
  ];

  // ── El humano es el otro camino que conoce al agente ────────────────────────────────────────────
  //
  // Si el provider no llegó a montar las filas de esta sesión, ejecutar un comando es la ocasión de
  // intentarlo otra vez —y de saber si no se pudo—: sin esto, la sesión se quedaba sin superficie de
  // decisión y el único aviso era «no hay filas que decidir en el catálogo de esta sesión».
  // Los nombres españoles siguen funcionando **hasta 5.0.0** como alias del canónico: mismo handler, mismos
  // argumentos, misma puerta y mismos efectos. El alias se declara con metadatos (`aliasOf`, `deprecatedIn`),
  // no por el texto: así el menú puede ocultarlo por dato y `doctor` puede contarlos.
  const ALIASES = {
    'skill-propuestas': 'skill-proposals',
    'skill-pendientes': 'skill-pending',
    'skill-ver': 'skill-show',
    'skill-aprobar': 'skill-approve',
    'skill-globalizar': 'skill-publish',
    'skill-ambito': 'skill-scope',
    'skill-deshabilitar': 'skill-disable',
    'skill-habilitar': 'skill-enable',
    'skill-eliminar': 'skill-retire',
    'skill-retiradas': 'skill-retired',
    'skill-propiedad': 'skill-ownership',
    'skill-propiedad-dsh-only': 'skill-ownership-dsh-only',
    'skill-propiedad-machine': 'skill-ownership-machine',
    'skill-sistemas': 'skill-systems',
    'skill-rechazar': 'skill-reject',
  };
  const porNombre = new Map(definiciones.map((c) => [c.name, c]));
  for (const [viejo, nuevo] of Object.entries(ALIASES)) {
    const canonico = porNombre.get(nuevo);
    if (canonico === undefined) continue;
    definiciones.push({
      ...canonico,
      name: viejo,
      aliasOf: nuevo,
      deprecatedIn: '4.0.0',
      description: `Alias obsoleto de /${nuevo}: se retira en 5.0.0. ${canonico.description}`,
    });
  }

  const montar = (invocation) => {
    try {
      return onMount?.(invocation?.agent) ?? { ok: true };
    } catch (error) {
      return { ok: false, motivo: error.message };
    }
  };
  return definiciones.map((command) => ({
    ...command,
    handler: (invocation) => command.handler(invocation, montar(invocation)),
  }));
}

/**
 * Las filas de pendientes como comandos: una por verbo y pendiente, **sin argumentos**, para que
 * elegirlas en el menú `/` sea la decisión completa.
 *
 * El ámbito se comprueba al ejecutar, no al anunciar: las filas viven en un registro global y la sesión
 * que las elige es la que manda. Una fila de otro proyecto falla con el motivo, en vez de aprobar en el
 * proyecto equivocado.
 *
 * @param rows - lo que devolvió `pendingRowsFor` o `pendingRowsForAll`.
 */
export function targetCommands({ root = defaultRoot(), catalog, rows = [] } = {}) {
  return rows.map((row) => ({
    name: row.name,
    description: row.description,
    handler: guarded(({ agent }) => {
      const { cwd, key } = scopeOfAgent(agent);
      if (key === null) return bad(NO_SCOPE);
      if (key !== row.key) {
        return bad([
          `«${row.id}» está pendiente en ${row.project}, no en esta sesión.`,
          `Esta sesión trabaja en ${cwd}.`,
          'Ábrela desde el proyecto que le corresponde: el ámbito no se elige a mano.',
        ].join('\n'));
      }
      if (row.verb === 'show') return viewProposal({ root, cwd, key, id: row.id });
      if (row.verb === 'approve') return approveProposal({ root, key, id: row.id, force: false, catalog });
      if (row.verb === 'publish') return approveProposal({ root, key, id: row.id, force: false, scope: 'global', catalog });
      if (row.verb === 'reject') return rejectProposal({ root, key, id: row.id, catalog });
      return bad(`Fila desconocida: ${row.verb}`);
    }),
  }));
}
