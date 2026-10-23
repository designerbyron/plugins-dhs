/**
 * Códigos estables de resultado.
 *
 * Son **contrato**, no presentación: el panel decide con ellos y no cambia entre idiomas. Cada uno declara los
 * parámetros que puede llevar, para que nadie invente una forma nueva sin tocar este fichero (y para que la prueba
 * de contrato lo note). `text` se compone aparte, desde el catálogo del idioma.
 *
 * Regla: un `code` desconocido por el panel es un fallo visible, nunca un éxito ni una excusa para analizar prosa.
 */

/** Parámetros admitidos por código. `[]` = ninguno. */
export const CODES = Object.freeze({
  // decisiones
  activated: ['id', 'key'],
  'already-active': ['id'],
  'updated-disabled': ['id', 'key'],
  published: ['id', 'key'],
  'set-aside': ['id'],
  enabled: ['id'],
  disabled: ['id'],
  retired: ['id'],
  rejected: ['id'],

  // preguntas
  'scope-ask': ['id', 'idList'],
  'language-ask': ['value', 'supported'],

  // negativas y avisos de la puerta
  'no-proposal': ['id', 'key'],
  'with-warnings': ['id', 'warnings'],
  'unsafe-id': ['id', 'motivo'],
  'no-scope': [],
  'topic-conflict': ['id', 'tema'],
  'id-conflict': ['id', 'donde'],

  // lote y estado
  'batch-partial': ['done', 'failed'],
  'batch-empty': [],
  'batch-nothing': [],
});

/** ¿Es un código declarado? */
export function esCodigo(code) {
  return typeof code === 'string' && Object.hasOwn(CODES, code);
}

/** Los parámetros que ese código admite, o `null` si no existe. */
export function parametrosDe(code) {
  return esCodigo(code) ? CODES[code] : null;
}
