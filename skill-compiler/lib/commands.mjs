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
 *   1. Los comandos con argumentos (`/skill-aprobar <id>`), para quien ya sabe el id.
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
import { readFileSync } from 'node:fs';

import { AUTO_COMMAND, autoApproveFromEvents, parseAutoCommand } from './auto-approve.mjs';
import { approve, checkProposal, defaultRoot, listForProject, locate, pending, projectKey, reject } from './compiler.mjs';
import { scopeOf } from './definitions.mjs';
import { pendingRowsFor } from './pending-rows.mjs';

const ok = (text) => ({ kind: 'success', text });
const bad = (text) => ({ kind: 'error', text });

/** Los comandos son superficie humana: un fallo se cuenta como texto, nunca se lanza hacia el harness. */
const guarded = (run) => (invocation) => {
  try {
    return run(invocation);
  } catch (error) {
    return bad(`No se pudo completar: ${error.message}`);
  }
};

const bullet = (rows) => rows.map((row) => `  · ${row.id} — ${row.description ?? '(sin descripción)'}`).join('\n');

const NO_SCOPE = 'Sin ámbito: esta sesión no tiene un directorio de trabajo utilizable.';

/**
 * El estado de la lista, pegado al resultado de decidir: así el humano ve el efecto de lo que acaba de
 * hacer sin volver a ejecutar `/skill-propuestas`. Medido con el usuario delante: aprobó una skill, su
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
  if (wanted === '') return bad('Falta el id. Uso: /skill-ver <id>');

  const proposal = pending({ root, key }).find((row) => row.id === wanted);
  const active = listForProject(cwd, { root }).find((row) => row.id === wanted);
  const chose = proposal ?? active;
  if (chose === undefined) return bad(`No hay ninguna skill aprendida con id «${wanted}» en ${key}. Míralas con /skill-propuestas.`);

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
    ...(check.warnings.length > 0 ? ['', `Aprobarla con estos avisos exige decirlo: /skill-aprobar ${wanted} --force`] : []),
    '',
    readFileSync(chose.path, 'utf8'),
  ].join('\n'));
}

/** Activa una propuesta, y sólo si pasa la puerta. `force` acepta los avisos; nunca salta los fallos. */
export function approveProposal({ root = defaultRoot(), key, id, force = false, catalog } = {}) {
  if (key === null) return bad(NO_SCOPE);
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad('Falta el id. Uso: /skill-aprobar <id> [--force]');

  // Aprobar algo que ya está aprobado no es un fallo: es un acto que ya ocurrió. Decirlo con esas
  // palabras evita el «failed» que hacía pensar que la primera aprobación no había servido.
  const where = locate(wanted, key, { root });
  if (where === 'approved') {
    return ok([
      `Ya estaba activa: ${wanted} [${key}]`,
      'No se ha cambiado nada.',
      ...remaining(root, key),
    ].join('\n'));
  }
  if (where === 'rejected') {
    return bad([
      `«${wanted}» está apartada en ${key}, no pendiente de aprobación.`,
      'Su copia sigue en rejected/: recuperarla es un acto manual, y a propósito.',
    ].join('\n'));
  }
  if (where === null) return bad(`No hay ninguna propuesta «${wanted}» en ${key}. Míralas con /skill-propuestas.`);

  // La misma puerta que la CLI: sin ella, esta vía sería una vía de aprobación sin validación.
  const check = checkProposal(wanted, key, { root });
  if (!check.ok) {
    return bad([
      `Aprobación RECHAZADA: la propuesta ${wanted} no pasa la puerta.`,
      ...check.errors.map((e) => `  FALLO  ${e}`),
      'No se ha movido nada. Corrige la propuesta y repite.',
    ].join('\n'));
  }
  if (check.warnings.length > 0 && !force) {
    return bad([
      `La propuesta ${wanted} tiene avisos:`,
      ...check.warnings.map((w) => `  aviso  ${w}`),
      '',
      `Si los aceptas: /skill-aprobar ${wanted} --force`,
    ].join('\n'));
  }

  const moved = approve(wanted, key, { root });
  if (!moved.ok) return bad(`No se pudo aprobar ${wanted}: ${moved.reason}`);

  // El catálogo acaba de cambiar: sin este aviso, la skill no llega al agente hasta reiniciar.
  catalog?.notify();

  return ok([
    `Activa: ${wanted} [${key}]`,
    `  ${moved.path}`,
    ...(moved.superseded ? [`  versión anterior apartada en ${moved.superseded}`] : []),
    ...(check.warnings.length > 0 ? ['', 'Aprobada con avisos:', ...check.warnings.map((w) => `  · ${w}`)] : []),
    '',
    'Ya la sirve el catálogo de este proyecto: el agente la ve en su siguiente paso, sin reiniciar.',
    `Invocarla tú: /${wanted}`,
    ...remaining(root, key),
  ].join('\n'));
}

/** Aparta una propuesta sin borrarla: queda en `rejected/`, recuperable. */
export function rejectProposal({ root = defaultRoot(), key, id, catalog } = {}) {
  if (key === null) return bad(NO_SCOPE);
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad('Falta el id. Uso: /skill-rechazar <id>');

  const where = locate(wanted, key, { root });
  if (where === 'rejected') {
    return ok([`Ya estaba apartada: ${wanted} [${key}]`, 'No se ha cambiado nada.', ...remaining(root, key)].join('\n'));
  }
  if (where === 'approved') {
    return bad([
      `«${wanted}» ya está activa en ${key}: rechazar sólo se aplica a las propuestas pendientes.`,
      'Lo aprendido y aprobado se aparta a mano, y a propósito: no hay un comando que lo deshaga sin querer.',
    ].join('\n'));
  }
  if (where === null) return bad(`No hay ninguna propuesta «${wanted}» en ${key}. Míralas con /skill-propuestas.`);

  const moved = reject(wanted, key, { root });
  if (!moved.ok) return bad(`No se pudo apartar ${wanted}: ${moved.reason}`);

  catalog?.notify();

  return ok([
    `Apartada: ${wanted} [${key}]`,
    `  ${moved.path.replace(/[\\/]SKILL\.md$/, '')}`,
    '',
    'No se ha borrado nada: sigue en el almacén por si quieres recuperarla.',
    ...remaining(root, key),
  ].join('\n'));
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
export function skillCommands({ root = defaultRoot(), catalog, onListed } = {}) {
  return [
    {
      name: 'skill-propuestas',
      description: 'Qué skills aprendidas esperan tu aprobación en este proyecto y cuáles están activas.',
      handler: guarded(({ agent }) => {
        const { cwd, key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);

        // Antes de listar, asegurar las filas: si el humano mira las pendientes, es que va a decidir.
        onListed?.();

        const waiting = pending({ root, key });
        const active = listForProject(cwd, { root });
        const auto = autoApproveFromEvents(agent?.session?.snapshotEvents?.() ?? []);
        const rows = pendingRowsFor({ root, cwd });

        return ok([
          `Aprendizaje de ${cwd} [${key}]`,
          '',
          `Pendientes de tu aprobación (${waiting.length}):`,
          waiting.length ? bullet(waiting) : '  · ninguna',
          ...rows.map((row) => `      /${row.name}`),
          ...(rows.length > 0 ? ['', 'Para decidir: escribe «/» y elige la fila, o teclea el comando entero. Son lo mismo.'] : []),
          '',
          `Aprobadas y activas (${active.length}):`,
          active.length ? bullet(active) : '  · ninguna',
          '',
          `Aprobación automática en esta sesión: ${auto ? 'ACTIVA' : 'desactivada'}`,
          auto ? '  (las propuestas que pasen la validación se activan solas; /skill-auto desactivar para pararlo)' : '  (actívala con /skill-auto activar)',
          '',
          'Con un id a mano: /skill-ver <id> · /skill-aprobar <id> [--force] · /skill-rechazar <id>',
        ].join('\n'));
      }),
    },

    {
      name: 'skill-ver',
      description: 'Lee una skill aprendida de este proyecto: la propuesta pendiente o la ya activa.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { cwd, key } = scopeOfAgent(agent);
        return viewProposal({ root, cwd, key, id: rawInput });
      }),
    },

    {
      name: 'skill-aprobar',
      description: 'Activa una skill propuesta de este proyecto, si pasa la puerta de validación. Aprobar es tuyo: el modelo no puede.',
      input: { hint: '<id> [--force]' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const input = String(rawInput ?? '').trim();
        const force = /(?:^|\s)--force$/.test(input);
        const id = input.replace(/(?:\s+--force)?$/, '').trim();
        return approveProposal({ root, key, id, force, catalog });
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
            'Desde ahora nada se activa sin tu decisión: las propuestas esperan en /skill-propuestas.',
          ].join('\n'));
      }),
    },

    {
      name: 'skill-rechazar',
      description: 'Aparta una skill propuesta de este proyecto sin borrarla: queda guardada en rejected/.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        return rejectProposal({ root, key, id: rawInput, catalog });
      }),
    },
  ];
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
      if (row.verb === 'ver') return viewProposal({ root, cwd, key, id: row.id });
      if (row.verb === 'aprobar') return approveProposal({ root, key, id: row.id, force: false, catalog });
      if (row.verb === 'rechazar') return rejectProposal({ root, key, id: row.id, catalog });
      return bad(`Fila desconocida: ${row.verb}`);
    }),
  }));
}
