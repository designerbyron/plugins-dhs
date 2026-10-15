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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AUTO_COMMAND, autoApproveFromEvents, parseAutoCommand } from './auto-approve.mjs';
import {
  approve, checkProposal, defaultRoot, disable, enable, listForProject, locate, pending, projectKey,
  reject, retire, retired,
} from './compiler.mjs';
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
export function approveProposal({ root = defaultRoot(), key, id, force = false, scope = 'project', catalog } = {}) {
  if (key === null) return bad(NO_SCOPE);
  const wanted = String(id ?? '').trim();
  if (wanted === '') return bad('Falta el id. Uso: /skill-aprobar <id> [--force]');

  // Aprobar algo que ya está aprobado no es un fallo: es un acto que ya ocurrió. Decirlo con esas
  // palabras evita el «failed» que hacía pensar que la primera aprobación no había servido.
  const where = locate(wanted, key, { root });
  if (scope === 'global' && (where === 'global' || where === 'published')) {
    return ok([
      `Ya estaba publicada: ${wanted} en la biblioteca de usuario`,
      'No se ha cambiado nada.',
      ...remaining(root, key),
    ].join('\n'));
  }
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

  const moved = approve(wanted, key, { root, scope });
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
          ...(rows.length > 0 ? ['', 'Para decidir: escribe «/» y elige la fila, o teclea el comando entero. Son lo mismo.'] : []),
          '',
          `Aprobadas y activas (${active.length}):`,
          active.length ? bullet(active) : '  · ninguna',
          '',
          `Apagadas (${fueraDeServicio.length}) — no se sirven al modelo, se conservan enteras:`,
          fueraDeServicio.length ? bullet(fueraDeServicio) : '  · ninguna',
          ...(fueraDeServicio.length > 0 ? [`  Para devolver una: /skill-habilitar <id>, o elige su fila en el menú «/». Para retirarla del todo: /skill-eliminar <id> --yes`] : []),
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
      description: 'Activa una skill propuesta, si pasa la puerta de validación: en este proyecto, o para todos los tuyos si lo dices. Sin decir dónde, pregunta. Aprobar es tuyo: el modelo no puede.',
      input: { hint: '<id> [--global|--local] [--force]' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const input = String(rawInput ?? '').trim();
        const force = /(?:^|\s)--force$/.test(input);
        const global = /(?:^|\s)--global(?:\s|$)/.test(input);
        const local = /(?:^|\s)--local(?:\s|$)/.test(input);
        const id = input.replace(/(?:\s+--(?:force|global|local))+$/, '').trim();

        // Sin ámbito dicho, se pregunta —con las dos opciones y su nombre de fila— en vez de decidir por el
        // humano. «Local» no es un defecto que se esconde: es una de las dos respuestas.
        if (!global && !local && locate(id, key, { root }) === 'proposed') {
          return ok([
            `¿Dónde quieres que viva «${id}»?`,
            '',
            `  · En ESTE proyecto (${key}): /skill-aprobar ${id} --local`,
            '      la sirve el plugin sólo en las sesiones de este proyecto.',
            `  · Para TODOS tus proyectos: /skill-aprobar ${id} --global`,
            '      se publica en la biblioteca de usuario y la sirve el harness en cualquier sesión.',
            '',
            'También valen sus filas del menú «/»: «skill-aprobar-<id>» y «skill-globalizar-<id>».',
            'Con «--force» si la propuesta viene con avisos.',
          ].join('\n'));
        }

        const scope = global ? 'global' : 'project';
        const result = approveProposal({ root, key, id, force, scope, catalog });
        if (result?.kind !== 'ok') return result;
        const nota = scope === 'global'
          ? `Se sirve en toda sesión de esta máquina (biblioteca de usuario). Para dejarla sólo en este proyecto: /skill-ambito ${id} --local`
          : `Se sirve al modelo sólo en este proyecto. Para que la vean todos: /skill-aprobar ${id} --global`;
        return ok([result.text, '', nota].join('\n'));
      }),
    },

    {
      name: 'skill-globalizar',
      description: 'Activa una skill propuesta para TODOS tus proyectos: la publica en la biblioteca de usuario, que el harness sirve en cualquier sesión.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const id = String(rawInput ?? '').trim();
        const result = approveProposal({ root, key, id, force: true, scope: 'global', catalog });
        if (result?.kind !== 'ok') return result;
        return ok([result.text, '', `Para dejarla sólo en este proyecto: /skill-ambito ${id} --local`].join('\n'));
      }),
    },

    {
      name: 'skill-ambito',
      description: 'Cambia dónde vive una skill ya aprobada: en este proyecto o en la biblioteca de usuario, en las dos direcciones.',
      input: { hint: '<id> --global | --local' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        const input = String(rawInput ?? '').trim();
        const to = /(?:^|\s)--global(?:\s|$)/.test(input) ? 'global' : /(?:^|\s)--local(?:\s|$)/.test(input) ? 'project' : null;
        const id = input.replace(/(?:\s+--(?:global|local))+$/, '').trim();
        if (id === '') return bad('Falta el id. Uso: /skill-ambito <id> --global|--local');
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
            ? `Volver a este proyecto: /skill-ambito ${id} --local`
            : `Publicarla para todos: /skill-ambito ${id} --global`,
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
            'Desde ahora nada se activa sin tu decisión: las propuestas esperan en /skill-propuestas.',
          ].join('\n'));
      }),
    },

    // ── El ciclo de vida, desde la sesión ───────────────────────────────────────────────────────────
    // Apagar es reversible y no se confunde con retirar. Retirar es el único gesto irreversible del
    // plugin, así que **exige un `--yes` explícito** y dice antes dónde queda el respaldo: un clic, o una
    // línea, no pueden borrar el trabajo de nadie.
    {
      name: 'skill-deshabilitar',
      description: 'Apaga una skill activa de este proyecto: deja de servirse al modelo y se conserva entera. Reversible.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const id = String(rawInput ?? '').trim();
        if (id === '') return bad('Dime cuál: /skill-deshabilitar <id>. Las activas están en /skill-propuestas.');
        if (!existsSync(join(root, 'projects', key, 'approved', id))) {
          const donde = locate(id, key, { root });
          return bad(donde === null
            ? `No hay ninguna skill activa con el id ${id} en ${key}.`
            : `«${id}» no está activa en ${key}: está en ${donde}.`);
        }
        const moved = disableSkill(id, key, { root });
        if (!moved.ok) return bad(`No se pudo apagar: ${moved.reason}`);
        return ok(`${id} apagada en ${key}.\n  deja de servirse al modelo, y se conserva entera: /skill-habilitar ${id} la devuelve.`);
      }),
    },

    {
      name: 'skill-habilitar',
      description: 'Vuelve a encender una skill que estaba apagada en este proyecto.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const id = String(rawInput ?? '').trim();
        if (id === '') return bad('Dime cuál: /skill-habilitar <id>. Lo apagado está en /skill-retiradas.');
        const moved = enableSkill(id, key, { root });
        if (!moved.ok) return bad(`No se pudo encender: ${moved.reason}`);
        return ok(`${id} vuelve a estar activa en ${key}: se sirve al modelo sólo en este proyecto.`);
      }),
    },

    {
      name: 'skill-eliminar',
      description: 'Retira una skill de este proyecto: se mueve a un respaldo fechado, nunca se borra. Exige --yes.',
      input: { hint: '<id> [--yes]' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scopeOfAgent(agent);
        if (key === null) return bad(NO_SCOPE);
        const input = String(rawInput ?? '').trim();
        const yes = /(?:^|\s)--yes$/.test(input);
        const id = input.replace(/(?:\s+--yes)?$/, '').trim();
        if (id === '') return bad('Dime cuál: /skill-eliminar <id> [--yes].');
        if (!yes) {
          return ok(`Se va a RETIRAR «${id}» del proyecto ${key}.\n  Nada se borra: la carpeta se mueve a un respaldo con fecha, y vuelve con \`restore\` desde el terminal.\n  Repite así para hacerlo: /skill-eliminar ${id} --yes`);
        }
        const moved = retireSkill(id, key, { root });
        if (!moved.ok) return bad(`No se pudo retirar: ${moved.reason}`);
        return ok(`Retirada «${id}» de ${key}.\n  respaldo: ${moved.backup}\n  huella:   ${moved.hash}\n  vuelve con: restore ${id} (CLI)\n`);
      }),
    },

    {
      name: 'skill-retiradas',
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
          'Con un id a mano: /skill-habilitar <id> lo devuelve · /skill-eliminar <id> --yes lo retira del todo.',
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
      if (row.verb === 'globalizar') return approveProposal({ root, key, id: row.id, force: false, scope: 'global', catalog });
      if (row.verb === 'rechazar') return rejectProposal({ root, key, id: row.id, catalog });
      return bad(`Fila desconocida: ${row.verb}`);
    }),
  }));
}
