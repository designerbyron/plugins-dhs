/**
 * Idioma del plugin: una sola resolución, dos superficies (comando del harness y CLI).
 *
 * Precedencia **determinista**, sin adivinar el locale del sistema (en Windows suele ser `en-US` aunque el
 * operador trabaje en español, y sería una elección implícita disfrazada):
 *
 *   1. `DSH_LANG` — override de pruebas y automatización
 *   2. `config.json` del almacén — preferencia persistida, elegida por una persona
 *   3. `en` — base
 *
 * Un valor **explícito** inválido (`--language fr`) es un error y no escribe nada. Una variable de entorno
 * inválida no rompe nada: se usa `en` y `doctor` lo dice una vez. Una traducción que falte se resuelve al inglés;
 * **nunca** se pinta la clave cruda en una salida humana.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import en from './en.mjs';
import es from './es.mjs';
import { rowNameOf, slashNameOf } from '../operations.mjs';

export const LANGS = Object.freeze(['en', 'es']);
export const BASE = 'en';
export const DICTIONARIES = Object.freeze({ en, es });

/** Raíz del almacén: `$DSH_HOME/skill-compiler`, o la de siempre si no hay variable. */
export function storeRoot() {
  const home = process.env.DSH_HOME;
  return home !== undefined && home !== ''
    ? join(home, 'skill-compiler')
    : join(homedir(), '.dsh', 'skill-compiler');
}

export function configPath(root = storeRoot()) {
  return join(root, 'config.json');
}

/**
 * Normaliza una etiqueta de idioma: `es-ES`, `es_419`, `ES` → `es`; `en-US`, `en_GB` → `en`.
 * Devuelve `null` si no es uno de los idiomas admitidos: quien llama decide si eso es error o reserva.
 */
export function normalizeTag(tag) {
  if (typeof tag !== 'string') return null;
  const base = tag.trim().toLowerCase().replace('_', '-').split('-')[0];
  return LANGS.includes(base) ? base : null;
}

/**
 * Configuración del almacén, tolerante: un fichero roto **no** rompe el plugin.
 * `ok:false` significa «no se pudo leer», y el llamador lo dirá en `doctor`.
 */
export function readConfig(root = storeRoot()) {
  const path = configPath(root);
  if (!existsSync(path)) return { ok: true, datos: {}, path };
  try {
    const datos = JSON.parse(readFileSync(path, 'utf8'));
    if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) return { ok: false, datos: {}, path };
    return { ok: true, datos, path };
  } catch {
    return { ok: false, datos: {}, path };
  }
}

/**
 * Escribe sólo las claves que se le dan, conservando el resto (aditivo) y de forma **atómica**: `.tmp` + rename.
 * Nunca se reescribe el fichero completo con `{lang}`: un ajuste no debe borrar la configuración de otro.
 */
export function writeConfig(patch, root = storeRoot()) {
  const actual = readConfig(root);
  const siguiente = { ...actual.datos, ...patch };
  const path = configPath(root);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(siguiente, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
    return { ok: true, path, datos: siguiente };
  } catch (error) {
    return { ok: false, path, reason: error.message };
  }
}

let cache = null;

/** Olvida la resolución memorizada (pruebas, o tras fijar el idioma). */
export function resetLangCache() {
  cache = null;
}

/**
 * Idioma efectivo y **de dónde sale**. `source` es `env` | `config` | `default`.
 * `invalidEnv` / `invalidConfig` se devuelven para que `doctor` dé un diagnóstico único y no repetido.
 */
export function resolveLang({ env = process.env.DSH_LANG, root = storeRoot(), fresh = false } = {}) {
  if (!fresh && cache !== null && cache.root === root && cache.env === env) return cache.info;
  const config = readConfig(root);
  const desdeConfig = typeof config.datos.lang === 'string' ? config.datos.lang : undefined;
  const normalConfig = desdeConfig === undefined ? null : normalizeTag(desdeConfig);
  const desdeEnv = typeof env === 'string' && env.trim() !== '' ? env.trim() : undefined;
  const normalEnv = desdeEnv === undefined ? null : normalizeTag(desdeEnv);

  let info;
  if (normalEnv !== null) {
    info = { lang: normalEnv, source: 'env', invalidEnv: undefined, invalidConfig: undefined };
  } else if (normalConfig !== null) {
    info = { lang: normalConfig, source: 'config', invalidEnv: desdeEnv, invalidConfig: undefined };
  } else {
    info = { lang: BASE, source: 'default', invalidEnv: desdeEnv, invalidConfig: desdeConfig };
  }
  if (!config.ok) info = { ...info, configUnreadable: true };
  cache = { root, env, info };
  return info;
}

/**
 * Fija el idioma. Un valor no admitido **no escribe nada** y devuelve el motivo: es una opción explícita, y una
 * opción explícita equivocada se corrige, no se ignora.
 */
export function setLang(tag, { root = storeRoot() } = {}) {
  const normal = normalizeTag(tag);
  if (normal === null) return { ok: false, reason: 'unsupported', value: String(tag ?? ''), supported: [...LANGS] };
  const escrito = writeConfig({ lang: normal }, root);
  if (!escrito.ok) return { ok: false, reason: 'write', detail: escrito.reason };
  resetLangCache();
  return { ok: true, lang: normal, path: escrito.path };
}

/**
 * Traduce una clave. Los parámetros se interpolan como `{nombre}`; un parámetro ausente se deja visible —es un
 * defecto del código, y la prueba de paridad lo impide llegar a producción— en vez de imprimir `undefined`.
 *
 * Dos marcas no son parametros sino **nombres de comando**, y se resuelven contra el mapa (`operations.mjs`)
 * para el idioma de la frase: `{cmd:approve}` da `/skill-approve` o `/skill-aprobar`, y `{row:approve}` da
 * `skill-approve-<id>` o `skill-aprobar-<id>`. Asi un mensaje no puede citar un nombre que no existe en el
 * registro activo, y el catalogo no guarda una segunda copia de los nombres. Una marca que no corresponda a
 * ninguna operacion se deja visible: es un defecto del catalogo, y la puerta de i18n lo mide.
 */
export function t(key, params = {}, { lang } = {}) {
  const idioma = lang ?? resolveLang().lang;
  const dicc = DICTIONARIES[idioma] ?? DICTIONARIES[BASE];
  const texto = dicc[key] ?? DICTIONARIES[BASE][key];
  if (typeof texto !== 'string') return String(key);
  return texto.replace(/\{([\w:.]+)\}/g, (marca, nombre) => {
    if (nombre.startsWith('cmd:')) return slashNameOf(nombre.slice(4), idioma) ?? marca;
    if (nombre.startsWith('row:')) return rowNameOf(nombre.slice(4), idioma) ?? marca;
    return params[nombre] === undefined ? marca : String(params[nombre]);
  });
}

/**
 * Compone una clave con el catalogo; si esa clave no existe, devuelve el **texto crudo** que ya viajaba.
 *
 * Es el unico punto donde se decide esa reserva, para que ninguna superficie pinte una clave cruda ni invente
 * una conclusion: `{code, params}` + texto es la forma en que un hallazgo o un resultado lleva las dos cosas.
 */
export function textoDeCodigo(code, params = {}, crudo = '', { lang } = {}) {
  if (typeof code !== 'string' || code === '') return String(crudo ?? '');
  const texto = t(code, params, { lang });
  return texto === code ? String(crudo ?? '') : texto;
}

/** ¿Está el catálogo de un idioma completo respecto al base? Para `doctor` y para la prueba de paridad. */
export function clavesFaltantes(lang) {
  const dicc = DICTIONARIES[lang];
  if (dicc === undefined) return [...Object.keys(DICTIONARIES[BASE])];
  return Object.keys(DICTIONARIES[BASE]).filter((k) => typeof dicc[k] !== 'string' || dicc[k].trim() === '');
}
