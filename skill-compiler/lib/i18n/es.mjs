/**
 * Catálogo español — traducción completa del inglés base.
 *
 * Mismas claves y mismos *placeholders* que `en.mjs`: lo comprueba `tests/i18n-paridad.test.mjs`.
 */
export default Object.freeze({
  // ajustes de idioma
  'lang.status': 'idioma: {lang} (fuente: {source})',
  'lang.set': 'idioma fijado en {lang} — guardado en {path}',
  'lang.usage': 'uso: lang [en|es]',
  'lang.unsupported': 'idioma no admitido «{value}»: usa {supported}',
  'lang.env-invalid': 'DSH_LANG=«{value}» no es un idioma: se usa en',
  'lang.config-invalid': 'config.json declara «{value}», que no es un idioma: se usa en',

  // resultados de comando (contrato del panel)
  'code.activated': 'Activa: {id} [{key}]',
  'code.already-active': 'Ya estaba activa: {id}',
  'code.updated-disabled': 'Actualizada (sigue apagada): {id} [{key}]',
  'code.published': 'Publicada para todos tus proyectos: {id} [{key}]',
  'code.set-aside': 'Apartada: {id}',
  'code.enabled': 'Encendida: {id}',
  'code.disabled': 'Apagada: {id}',
  'code.retired': 'Retirada: {id}',
  'code.rejected': 'Rechazada: {id}',
  'code.scope-ask': '¿Dónde quieres que viva: sólo en este proyecto o para todos tus proyectos?',
  'code.language-ask': 'Idioma no admitido «{value}»: usa {supported}',
  'code.no-proposal': 'No hay ninguna propuesta «{id}» en {key}.',
  'code.with-warnings': 'La propuesta {id} tiene avisos: {warnings}',
  'code.unsafe-id': 'Id inseguro «{id}»: {motivo}',
  'code.no-scope': 'Sin ámbito: ejecútalo desde el directorio del proyecto.',
  'code.topic-conflict': 'Tema ya cubierto: {tema} ({id})',
  'code.id-conflict': 'El id «{id}» ya está ocupado en {donde}',
  'code.batch-partial': 'Parcial: {done} hechas, {failed} fallidas',
  'code.batch-empty': 'No hay nada marcado',
  'code.batch-nothing': 'Nada pendiente',

  // doctor
  'doctor.language': 'idioma: {lang} (fuente: {source})',
});
