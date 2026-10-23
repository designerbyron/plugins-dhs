/**
 * operations.mjs - el mapa de las 16 operaciones de sesion, y el UNICO sitio donde vive un nombre de comando.
 *
 * -- Por que el mapa vive aqui y no en `localized-commands.mjs` ------------------------------------
 *
 * Porque lo necesitan dos capas que no pueden importarse entre si: el registro (que decide que nombres se ponen
 * y los intercambia) y el catalogo (`lib/i18n/index.mjs`, que compone los mensajes). Un mensaje que cita un
 * comando tiene que citar el nombre que EXISTE en el registro activo: en espanol no puede decir `/skill-approve`
 * si lo que hay es `/skill-aprobar`. Con los nombres en un solo mapa, el texto se escribe con una marca
 * (`{cmd:approve}`) y la frase sale bien en los dos idiomas sin que nadie copie la lista.
 *
 * Lo mismo vale para las FILAS del menu (`skill-approve-<id>`): son comandos registrados de verdad, asi que su
 * nombre tambien sale de aqui (`{row:approve}`), y cambian de idioma con el conjunto.
 *
 * Este modulo no importa nada: es data. Quien normaliza etiquetas y resuelve el idioma es `lib/i18n/index.mjs`.
 */

/** Los dos idiomas del plugin, en el orden en que se declaran. */
export const NOMBRE_LANGS = Object.freeze(['en', 'es']);
export const NOMBRE_BASE = 'en';

/** Un idioma de nombre: `es`, `es-ES`, `ES` -> `es`; cualquier otra cosa -> el base. */
export function nombreLang(lang) {
  const etiqueta = String(lang ?? '').trim().toLowerCase().replace('_', '-').split('-')[0];
  return NOMBRE_LANGS.includes(etiqueta) ? etiqueta : NOMBRE_BASE;
}

/**
 * El mapa: una entrada por operacion; `source` es la definicion de `lib/commands.mjs` de la que se hereda el
 * handler, y `descriptionKey` la clave del catalogo que da el texto en cada idioma.
 *
 * `hint` es la pista del menu: una cadena cuando vale en los dos idiomas, o `{ en, es }` cuando las palabras
 * del argumento son idioma (`skill-auto` acepta `on|off` y `activar|desactivar`, y lo que se anuncia tiene que
 * ser lo que el handler entiende). La pista del mapa es la que se sirve; la de la definicion base se compara
 * con ella en las pruebas, para que las dos no puedan separarse en silencio.
 *
 * Anadir una operacion aqui es todo lo que hace falta para que su nombre siga al idioma: no hay una segunda
 * lista de nombres en ningun otro sitio.
 */
export const LOCALIZED_OPERATIONS = Object.freeze([
  Object.freeze({
    id: 'proposals',
    definitionId: 'skill-compiler.proposals',
    source: 'skill-proposals',
    descriptionKey: 'cmd.proposals.description',
    names: Object.freeze({ en: 'skill-proposals', es: 'skill-propuestas' }),
  }),
  Object.freeze({
    id: 'pending',
    definitionId: 'skill-compiler.pending',
    source: 'skill-pending',
    descriptionKey: 'cmd.pending.description',
    names: Object.freeze({ en: 'skill-pending', es: 'skill-pendientes' }),
  }),
  Object.freeze({
    id: 'show',
    definitionId: 'skill-compiler.show',
    source: 'skill-show',
    descriptionKey: 'cmd.show.description',
    names: Object.freeze({ en: 'skill-show', es: 'skill-ver' }),
    hint: '<id>',
  }),
  Object.freeze({
    id: 'approve',
    definitionId: 'skill-compiler.approve',
    source: 'skill-approve',
    descriptionKey: 'cmd.approve.description',
    names: Object.freeze({ en: 'skill-approve', es: 'skill-aprobar' }),
    hint: '<id> [--global|--local] [--force]',
  }),
  Object.freeze({
    id: 'publish',
    definitionId: 'skill-compiler.publish',
    source: 'skill-publish',
    descriptionKey: 'cmd.publish.description',
    names: Object.freeze({ en: 'skill-publish', es: 'skill-globalizar' }),
    hint: '<id>',
  }),
  Object.freeze({
    id: 'scope',
    definitionId: 'skill-compiler.scope',
    source: 'skill-scope',
    descriptionKey: 'cmd.scope.description',
    names: Object.freeze({ en: 'skill-scope', es: 'skill-ambito' }),
    hint: '<id> --global | --local',
  }),
  Object.freeze({
    id: 'auto',
    definitionId: 'skill-compiler.auto',
    source: 'skill-auto',
    descriptionKey: 'cmd.auto.description',
    names: Object.freeze({ en: 'skill-auto', es: 'skill-auto' }),
    hint: Object.freeze({ en: 'on | off', es: 'activar | desactivar' }),
  }),
  Object.freeze({
    id: 'disable',
    definitionId: 'skill-compiler.disable',
    source: 'skill-disable',
    descriptionKey: 'cmd.disable.description',
    names: Object.freeze({ en: 'skill-disable', es: 'skill-deshabilitar' }),
    hint: '<id>',
  }),
  Object.freeze({
    id: 'enable',
    definitionId: 'skill-compiler.enable',
    source: 'skill-enable',
    descriptionKey: 'cmd.enable.description',
    names: Object.freeze({ en: 'skill-enable', es: 'skill-habilitar' }),
    hint: '<id>',
  }),
  Object.freeze({
    id: 'retire',
    definitionId: 'skill-compiler.retire',
    source: 'skill-retire',
    descriptionKey: 'cmd.retire.description',
    names: Object.freeze({ en: 'skill-retire', es: 'skill-eliminar' }),
    hint: '<id> [--yes]',
  }),
  Object.freeze({
    id: 'retired',
    definitionId: 'skill-compiler.retired',
    source: 'skill-retired',
    descriptionKey: 'cmd.retired.description',
    names: Object.freeze({ en: 'skill-retired', es: 'skill-retiradas' }),
  }),
  Object.freeze({
    id: 'ownership',
    definitionId: 'skill-compiler.ownership',
    source: 'skill-ownership',
    descriptionKey: 'cmd.ownership.description',
    names: Object.freeze({ en: 'skill-ownership', es: 'skill-propiedad' }),
    hint: 'dsh-only|machine',
  }),
  Object.freeze({
    id: 'ownership-dsh-only',
    definitionId: 'skill-compiler.ownership-dsh-only',
    source: 'skill-ownership-dsh-only',
    descriptionKey: 'cmd.ownership.dsh-only.description',
    names: Object.freeze({ en: 'skill-ownership-dsh-only', es: 'skill-propiedad-dsh-only' }),
  }),
  Object.freeze({
    id: 'ownership-machine',
    definitionId: 'skill-compiler.ownership-machine',
    source: 'skill-ownership-machine',
    descriptionKey: 'cmd.ownership.machine.description',
    names: Object.freeze({ en: 'skill-ownership-machine', es: 'skill-propiedad-machine' }),
  }),
  Object.freeze({
    id: 'systems',
    definitionId: 'skill-compiler.systems',
    source: 'skill-systems',
    descriptionKey: 'cmd.systems.description',
    names: Object.freeze({ en: 'skill-systems', es: 'skill-sistemas' }),
  }),
  Object.freeze({
    id: 'reject',
    definitionId: 'skill-compiler.reject',
    source: 'skill-reject',
    descriptionKey: 'cmd.reject.description',
    names: Object.freeze({ en: 'skill-reject', es: 'skill-rechazar' }),
    hint: '<id>',
  }),
]);

/** La operacion con ese id interno, o `null`. */
export function operationById(id) {
  const buscado = String(id ?? '');
  return LOCALIZED_OPERATIONS.find((op) => op.id === buscado) ?? null;
}

/** El nombre de la operacion en un idioma (`skill-aprobar`), o `null` si el id no es nuestro. */
export function nameOfOperation(id, lang) {
  const op = operationById(id);
  if (op === null) return null;
  return op.names[nombreLang(lang)] ?? op.names[NOMBRE_BASE];
}

/** El nombre con barra, que es como se cita un comando en un mensaje (`/skill-aprobar`), o `null`. */
export function slashNameOf(id, lang) {
  const nombre = nameOfOperation(id, lang);
  return nombre === null ? null : `/${nombre}`;
}

/** El prefijo de una fila del menu para esa operacion (`skill-aprobar-`), o `null`. */
export function rowPrefixOf(id, lang) {
  const nombre = nameOfOperation(id, lang);
  return nombre === null ? null : `${nombre}-`;
}

/** El nombre de fila tal como se cita en un mensaje: `skill-aprobar-<id>`, o `null`. */
export function rowNameOf(id, lang) {
  const prefijo = rowPrefixOf(id, lang);
  return prefijo === null ? null : `${prefijo}<id>`;
}

/** Los ids internos, en el orden declarado. */
export function operationIds() {
  return LOCALIZED_OPERATIONS.map((op) => op.id);
}
