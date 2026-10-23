/**
 * Catálogo inglés — **idioma base**.
 *
 * Es la referencia de paridad: toda clave que exista aquí debe existir en `es.mjs`, con los mismos *placeholders*.
 * Si falta una traducción en otro idioma, se usa ésta; nunca se pinta la clave cruda en una salida humana.
 */
export default Object.freeze({
  // ajustes de idioma
  'lang.status': 'language: {lang} (source: {source})',
  'lang.set': 'language set to {lang} — saved in {path}',
  'lang.usage': 'usage: lang [en|es]',
  'lang.unsupported': 'unsupported language «{value}»: use {supported}',
  'lang.env-invalid': 'DSH_LANG=«{value}» is not a language: using en',
  'lang.config-invalid': 'config.json declares «{value}», which is not a language: using en',

  // resultados de comando (contrato del panel)
  'code.activated': 'Active: {id} [{key}]',
  'code.already-active': 'Already active: {id}',
  'code.updated-disabled': 'Updated (still off): {id} [{key}]',
  'code.published': 'Published for all your projects: {id} [{key}]',
  'code.set-aside': 'Set aside: {id}',
  'code.enabled': 'Switched on: {id}',
  'code.disabled': 'Switched off: {id}',
  'code.retired': 'Retired: {id}',
  'code.rejected': 'Rejected: {id}',
  'code.scope-ask': 'Where should it live: only in this project, or for all your projects?',
  'code.language-ask': 'Unsupported language «{value}»: use {supported}',
  'code.no-proposal': 'There is no proposal «{id}» in {key}.',
  'code.with-warnings': 'Proposal {id} has warnings: {warnings}',
  'code.unsafe-id': 'Unsafe id «{id}»: {motivo}',
  'code.no-scope': 'No project scope: run it from the project directory.',
  'code.topic-conflict': 'Topic already covered: {tema} ({id})',
  'code.id-conflict': 'The id «{id}» is already used in {donde}',
  'code.batch-partial': 'Partially done: {done} done, {failed} failed',
  'code.batch-empty': 'Nothing was selected',
  'code.batch-nothing': 'Nothing pending',

  'code.already-published': 'Already published: {id} (user library)',
  'code.already-set-aside': 'Already set aside: {id}',
  'code.scope-changed': 'Scope changed: {id} now lives in {scope}',
  'code.gate-failed': 'Approval REJECTED: proposal {id} does not pass the gate.',
  'code.invalid-flag': '{flag} only makes sense with a disabled skill: «{id}» is not.',
  'code.internal-error': 'Could not complete: {message}',
  'code.pending-list': 'Pending: {ids}',

  // doctor
  'doctor.language': 'language: {lang} (source: {source})',
});
