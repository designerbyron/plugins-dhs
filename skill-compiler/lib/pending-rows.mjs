/**
 * pending-rows.mjs — una fila por skill pendiente en el menú `/` del compositor.
 *
 * ── Por qué existe este módulo ───────────────────────────────────────────────────────────────────
 *
 * Los comandos de `lib/commands.mjs` resuelven *cómo* se aprueba, pero dejan al humano escribir la
 * sintaxis: `/skill-aprobar <id>`. Medido con el usuario delante: vio la lista de pendientes y no
 * encontró **cómo seleccionar y aprobar**; el compositor del harness no ofrece una lista pulsable
 * para los argumentos de un comando del host. Un flujo de autorización que exige recordar y teclear
 * una sintaxis no es un flujo: es una nota al pie.
 *
 * El harness sí tiene una superficie de selección: el menú de `/`. Y su contrato la hace utilizable
 * desde un plugin —un comando del host **sin** argumentos declarados se ejecuta en el acto al
 * elegirlo en el menú (`host bare → detached execute`), el registro devuelve el disposer exacto, y
 * cada alta o retirada emite `commands/change` para que el menú del cliente se refresque—. Así que
 * lo robusto no es inventar una interfaz (imposible sin cadena de compilación de cliente), sino
 * **una fila por pendiente**: elegir en el menú es todo el gesto, sin argumentos y sin sintaxis.
 *
 * ── Una fila, una decisión ───────────────────────────────────────────────────────────────────────
 *
 * Tres verbos por pendiente, los mismos que ya existían: leer entera, activar, apartar sin borrar.
 * El nombre lleva el id de la skill (`skill-approve-<id>`) para que sea inequívoco cuando haya varias
 * pendientes, y la descripción lleva el proyecto, para que la fila se lea sola en el menú.
 *
 * ── Lo que este módulo NO decide ─────────────────────────────────────────────────────────────────
 *
 * Nada de lo que pasa al elegir: sólo compone nombres y textos. El ámbito no se declara aquí —entra
 * por el `cwd` de la sesión— y la puerta de validación vive donde siempre, en `lib/compiler.mjs`. Las
 * filas son una forma de llegar; la regla sigue siendo la misma.
 */
import { join } from 'node:path';

import { pending, projectKey, scanTree } from './compiler.mjs';

/** La gramática del registro de comandos del harness, copiada del contrato: `/^[a-z][a-z0-9_-]*$/u`. */
export const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u;

/**
 * Los tres verbos, en el orden en que se usan (leer → decidir). `command` compone el nombre y
 * `describe` la descripción que se lee en el menú.
 */
export const ROW_VERBS = Object.freeze([
  Object.freeze({
    verb: 'show',
    describe: (id, project) => `Lee entera «${id}», pendiente en ${project}.`,
  }),
  Object.freeze({
    verb: 'approve',
    describe: (id, project) => `Activa «${id}» en ${project}, si pasa la puerta de validación. Aprobar es tuyo: el modelo no puede.`,
  }),
  Object.freeze({
    verb: 'publish',
    describe: (id, project) => `Activa «${id}» para TODOS tus proyectos: la publica en la biblioteca de usuario. Lo aprendido en ${project} es tuyo, no del proyecto.`,
  }),
  Object.freeze({
    verb: 'reject',
    describe: (id, project) => `Aparta «${id}» de ${project} sin borrarla: queda en rejected/.`,
  }),
]);

/**
 * El último tramo del `cwd`, que es como el humano llama a su proyecto. El `key` es la identidad
 * estable; esto es sólo la etiqueta que se lee.
 */
export function projectName(cwd, key) {
  const parts = String(cwd ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : String(key ?? '');
}

/**
 * El id de una skill como tramo de nombre de comando.
 *
 * Los ids de este plugin ya cumplen la gramática (`ID_RE`), pero la biblioteca es un directorio: un id
 * se puede editar a mano. Esto no lo adivina: lo normaliza, y devuelve `null` cuando no hay forma de
 * expresarlo, para que quien llama omita la fila en vez de registrar un nombre que el harness rechaza.
 */
export function commandSlug(id) {
  const slug = String(id ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // La gramática exige empezar por letra, pero el nombre final empieza por `skill-`: el prefijo lo
  // garantiza. Un tramo que quede vacío sí es irrecuperable.
  return slug === '' ? null : slug;
}

/** Un nombre único dentro del conjunto; sólo se usa si dos proyectos anuncian la misma pendiente. */
function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  let name = `${base}-2`;
  let n = 2;
  while (taken.has(name)) {
    n += 1;
    name = `${base}-${n}`;
  }
  return name;
}

/**
 * Las filas que anuncian las pendientes de UN proyecto.
 *
 * @param root - raíz del almacén.
 * @param cwd - directorio de trabajo de la sesión; es el único origen válido del ámbito.
 * @param taken - nombres ya usados por otras filas del mismo registro (se comparte entre proyectos:
 *   el registro de comandos es global y un nombre repetido lanza al registrar).
 * @returns `[{ name, description, verb, id, key, project }]`, en el orden leer → activar → apartar.
 */
export function pendingRowsFor({ root, cwd, taken = new Set() } = {}) {
  const key = projectKey(cwd);
  if (key === null) return [];
  const project = projectName(cwd, key);
  const rows = [];
  const propuestas = pending({ root, key });
  // Cuántas van en cada lote: una fila que dice «va en el lote X» sin decir con cuántas más deja al humano
  // sin saber si le falta algo por decidir. Se cuenta una vez, aquí, y no por fila.
  const tamano = new Map();
  for (const proposal of propuestas) {
    if (proposal.group) tamano.set(proposal.group.id, (tamano.get(proposal.group.id) ?? 0) + 1);
  }
  for (const proposal of propuestas) {
    const slug = commandSlug(proposal.id);
    if (slug === null) continue;
    // Si actualiza algo activo, la fila lo dice: es la diferencia entre «aprueba esto nuevo» y «sustituye
    // lo que ya estás usando», y el humano decide distinto en cada caso.
    const actualiza = proposal.updatesActive === true;
    // El lote se dice **en la descripción de la fila**: es lo que hace que en el menú se vea que estas
    // propuestas van juntas, sin añadir un clic nuevo que escriba en varias skills a la vez.
    const lote = proposal.group
      ? ` · va en el lote «${proposal.group.id}» (${tamano.get(proposal.group.id)} propuesta(s) juntas: ${proposal.group.motivo})`
      : '';
    for (const { verb, describe } of ROW_VERBS) {
      const name = uniqueName(`skill-${verb}-${slug}`, taken);
      // Última guarda antes de devolver algo que se va a registrar: un nombre fuera de la gramática no
      // se registra y la fila desaparecería en silencio; aquí se cae con el motivo.
      if (!COMMAND_NAME.test(name)) continue;
      taken.add(name);
      rows.push({
        name,
        description: `${describe(proposal.id, project)}${actualiza ? ' Actualiza una skill que ya está activa: si pasa la puerta, la sustituye y la anterior queda apartada.' : ''}${lote}`,
        verb,
        id: proposal.id,
        key,
        project,
        group: proposal.group?.id ?? null,
      });
    }
  }
  return rows;
}

/**
 * Las filas de varios proyectos a la vez, sin repetir nombres: es lo que se registra de verdad cuando
 * el proceso ya sirvió a más de una sesión.
 *
 * @param cwds - los directorios de trabajo conocidos, en el orden en que se conocieron.
 * @returns las filas concatenadas, cada una con su `key` para que el handler pueda comprobar el ámbito.
 */
/**
 * Verbos de una skill **apagada**. Son pocas por definición —lo que el humano acaba de apagar— así que
 * caben en el menú sin llenarlo, y es justo donde se decide volver a encenderla o retirarla del todo.
 */
const RETIRED_VERBS = [
  { verb: 'enable', describe: (id, proyecto) => `Vuelve a encender «${id}» en ${proyecto}: se conserva entera y no hubo que reinstalarla.` },
  { verb: 'retire', describe: (id, proyecto) => `Retira «${id}» de ${proyecto}: se mueve a un respaldo fechado, nunca se borra, y vuelve con \`restore\`.` },
];

/** Las filas de lo apagado de un proyecto, con la misma gramática que las de lo pendiente. */
export function retiredRowsFor({ root, cwd, taken = new Set() } = {}) {
  const key = projectKey(cwd);
  if (key === null) return [];
  const proyecto = projectName(cwd, key);
  const rows = [];
  for (const apagada of scanTree(join(root, 'projects', key, 'disabled'), 'apagada')) {
    const slug = commandSlug(apagada.id);
    if (slug === null) continue;
    for (const { verb, describe } of RETIRED_VERBS) {
      const name = uniqueName(`skill-${verb}-${slug}`, taken);
      if (!COMMAND_NAME.test(name)) continue;
      taken.add(name);
      rows.push({ id: apagada.id, verb, name, description: describe(apagada.id, proyecto) });
    }
  }
  return rows;
}

export function pendingRowsForAll({ root, cwds = [] } = {}) {
  const taken = new Set();
  const rows = [];
  for (const cwd of cwds) rows.push(...pendingRowsFor({ root, cwd, taken }));
  return rows;
}
