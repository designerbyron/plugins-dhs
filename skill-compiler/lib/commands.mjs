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
 * ── Una regla, una implementación ────────────────────────────────────────────────────────────────
 *
 * Toda decisión vive en `lib/compiler.mjs`, compartida con la CLI y la página de revisión. Aquí sólo se
 * compone el texto y se elige qué se llama; en particular, la puerta previa a aprobar es la MISMA
 * (`checkProposal`), así que ninguna vía de aprobación puede quedar sin puerta.
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
import { approve, checkProposal, defaultRoot, listForProject, pending, projectKey, reject } from './compiler.mjs';
import { scopeOf } from './definitions.mjs';

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

/**
 * Crea los comandos del plugin.
 *
 * @param root - raíz del almacén.
 * @param catalog - señal de catálogo; recibe el aviso tras cada mutación.
 * @returns las definiciones, en la forma que espera `ctx.commands.register(...)`.
 */
export function skillCommands({ root = defaultRoot(), catalog } = {}) {
  /** El ámbito sale del cwd de la sesión, igual que en las herramientas: el humano no lo declara. */
  const scope = (agent) => {
    const cwd = scopeOf({ agent });
    return { cwd, key: projectKey(cwd) };
  };

  const findProposal = (id, key) => pending({ root, key }).find((row) => row.id === id);
  const findApproved = (id, cwd) => listForProject(cwd, { root }).find((row) => row.id === id);

  /** Los eventos de la sesión: el modo de aprobación automática se pliega de ahí, no de un flag. */
  const eventsOf = (agent) => agent?.session?.snapshotEvents?.() ?? [];

  return [
    {
      name: 'skill-propuestas',
      description: 'Qué skills aprendidas esperan tu aprobación en este proyecto y cuáles están activas.',
      handler: guarded(({ agent }) => {
        const { cwd, key } = scope(agent);
        if (key === null) return bad('Sin ámbito: esta sesión no tiene un directorio de trabajo utilizable.');

        const waiting = pending({ root, key });
        const active = listForProject(cwd, { root });
        const auto = autoApproveFromEvents(eventsOf(agent));
        return ok([
          `Aprendizaje de ${cwd} [${key}]`,
          '',
          `Pendientes de tu aprobación (${waiting.length}):`,
          waiting.length ? bullet(waiting) : '  · ninguna',
          '',
          `Aprobadas y activas (${active.length}):`,
          active.length ? bullet(active) : '  · ninguna',
          '',
          `Aprobación automática en esta sesión: ${auto ? 'ACTIVA' : 'desactivada'}`,
          auto ? '  (las propuestas que pasen la validación se activan solas; /skill-auto desactivar para pararlo)' : '  (actívala con /skill-auto activar)',
          '',
          'Leer una entera:      /skill-ver <id>',
          'Activarla:            /skill-aprobar <id>',
          'Apartarla sin borrar: /skill-rechazar <id>',
        ].join('\n'));
      }),
    },

    {
      name: 'skill-ver',
      description: 'Lee una skill aprendida de este proyecto: la propuesta pendiente o la ya activa.',
      input: { hint: '<id>' },
      handler: guarded(({ agent, rawInput }) => {
        const { cwd, key } = scope(agent);
        const id = String(rawInput ?? '').trim();
        if (key === null) return bad('Sin ámbito: esta sesión no tiene un directorio de trabajo utilizable.');
        if (id === '') return bad('Falta el id. Uso: /skill-ver <id>');

        const proposal = findProposal(id, key);
        const active = findApproved(id, cwd);
        const chose = proposal ?? active;
        if (chose === undefined) return bad(`No hay ninguna skill aprendida con id «${id}» en ${key}. Míralas con /skill-propuestas.`);

        return ok([
          `${proposal ? 'Propuesta pendiente de aprobación' : 'Activa en este proyecto'}: ${id}`,
          `${chose.path}`,
          '',
          readFileSync(chose.path, 'utf8'),
        ].join('\n'));
      }),
    },

    {
      name: 'skill-aprobar',
      description: 'Activa una skill propuesta de este proyecto, si pasa la puerta de validación. Aprobar es tuyo: el modelo no puede.',
      input: { hint: '<id> [--force]' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scope(agent);
        if (key === null) return bad('Sin ámbito: esta sesión no tiene un directorio de trabajo utilizable.');

        const input = String(rawInput ?? '').trim();
        const force = /(?:^|\s)--force$/.test(input);
        const id = input.replace(/(?:\s+--force)?$/, '').trim();
        if (id === '') return bad('Falta el id. Uso: /skill-aprobar <id> [--force]');

        // La misma puerta que la CLI: sin ella, esta vía sería una vía de aprobación sin validación.
        const check = checkProposal(id, key, { root });
        if (!check.ok) {
          return bad([
            `Aprobación RECHAZADA: la propuesta ${id} no pasa la puerta.`,
            ...check.errors.map((e) => `  FALLO  ${e}`),
            'No se ha movido nada. Corrige la propuesta y repite.',
          ].join('\n'));
        }
        if (check.warnings.length > 0 && !force) {
          return bad([
            `La propuesta ${id} tiene avisos:`,
            ...check.warnings.map((w) => `  aviso  ${w}`),
            '',
            `Si los aceptas: /skill-aprobar ${id} --force`,
          ].join('\n'));
        }

        const moved = approve(id, key, { root });
        if (!moved.ok) return bad(`No se pudo aprobar ${id}: ${moved.reason}`);

        // El catálogo acaba de cambiar: sin este aviso, la skill no llega al agente hasta reiniciar.
        catalog?.notify();

        return ok([
          `Activa: ${id} [${key}]`,
          `  ${moved.path}`,
          ...(moved.superseded ? [`  versión anterior apartada en ${moved.superseded}`] : []),
          ...(check.warnings.length > 0 ? ['', 'Aprobada con avisos:', ...check.warnings.map((w) => `  · ${w}`)] : []),
          '',
          'Ya la sirve el catálogo de este proyecto: el agente la ve en su siguiente paso, sin reiniciar.',
          `Invocarla tú: /${id}`,
        ].join('\n'));
      }),
    },

    {
      name: AUTO_COMMAND,
      description: 'Activa o desactiva que las skills y los parches propuestos en ESTA sesión se aprueben solos. La validación y el registro se siguen aplicando: delegas la confirmación, no la puerta.',
      input: { hint: 'activar | desactivar' },
      handler: guarded(({ agent, rawInput }) => {
        const { key } = scope(agent);
        if (key === null) return bad('Sin ámbito: esta sesión no tiene un directorio de trabajo utilizable.');

        const decision = parseAutoCommand(rawInput);

        // Sin argumento: sólo informa. El estado se pliega del log de la sesión, que es donde vive.
        if (decision === null) {
          const active = autoApproveFromEvents(eventsOf(agent));
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
        const { key } = scope(agent);
        if (key === null) return bad('Sin ámbito: esta sesión no tiene un directorio de trabajo utilizable.');

        const id = String(rawInput ?? '').trim();
        if (id === '') return bad('Falta el id. Uso: /skill-rechazar <id>');

        const moved = reject(id, key, { root });
        if (!moved.ok) return bad(`No se pudo apartar ${id}: ${moved.reason}`);

        catalog?.notify();

        return ok([
          `Apartada: ${id} [${key}]`,
          `  ${moved.path.replace(/[\\/]SKILL\.md$/, '')}`,
          '',
          'No se ha borrado nada: sigue en el almacén por si quieres recuperarla.',
        ].join('\n'));
      }),
    },
  ];
}
