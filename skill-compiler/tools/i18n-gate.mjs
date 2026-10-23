#!/usr/bin/env node
/**
 * Puerta de internacionalización.
 *
 * No busca acentos: comprueba los **contratos** que sostienen el ES/EN y que, cuando se rompen, no se notan
 * hasta que alguien ve una clave cruda o un resultado mal clasificado:
 *
 *   1. catálogos con las mismas claves, mismas placeholders y ningún valor vacío;
 *   2. texto de un idioma colado en el otro (la heurística que habría cazado `bulk_ids_hint`);
 *   3. cada código emitido tiene texto en los dos idiomas;
 *   4. el diccionario del panel tiene las mismas claves que el catalogo base y ningún valor crudo;
 *   5. los comandos de sesión tienen nombre inglés y los alias se declaran con `aliasOf`/`deprecatedIn`,
 *      sin duplicar el nombre de un canónico.
 *
 * Uso: `node tools/i18n-gate.mjs [--root <dir>] [--json]`. Sale 0 si todo pasa; 1 con diagnóstico si no.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const raiz = rootArg >= 0 ? args[rootArg + 1] : join(process.cwd());
const comoJson = args.includes('--json');

const fallos = [];
const fallo = (regla, donde, detalle) => fallos.push({ regla, donde, detalle });

const lee = (rel) => readFileSync(join(raiz, rel), 'utf8');
const claves = (obj) => Object.keys(obj).sort();
const huecos = (texto) => [...String(texto).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// ── 1..3 · catálogos ────────────────────────────────────────────────────────────────────────────────
let en = {};
let es = {};
try {
  en = (await import(`file://${join(raiz, 'lib/i18n/en.mjs').replace(/\\/g, '/')}`)).default;
  es = (await import(`file://${join(raiz, 'lib/i18n/es.mjs').replace(/\\/g, '/')}`)).default;
} catch (error) {
  fallo('catalogos', 'lib/i18n/', `no se pudieron cargar: ${error.message}`);
}

if (Object.keys(en).length > 0) {
  for (const clave of claves(en)) {
    if (typeof es[clave] !== 'string' || es[clave].trim() === '') fallo('paridad', `es:${clave}`, 'falta o está vacía');
    else if (huecos(es[clave]).join(',') !== huecos(en[clave]).join(',')) {
      fallo('placeholders', `es:${clave}`, `«${huecos(es[clave]).join(',')}» ≠ «${huecos(en[clave]).join(',')}»`);
    }
  }
  for (const clave of claves(es)) if (en[clave] === undefined) fallo('paridad', `en:${clave}`, 'sobra respecto a es');
  for (const [clave, valor] of Object.entries(en)) {
    if (typeof valor !== 'string' || valor.trim() === '') fallo('vacio', `en:${clave}`, 'valor vacío');
  }
}

// El texto cruzado se mide sin placeholders: se llaman igual en los dos idiomas y no son idioma.
const sinHuecos = (v) => String(v).replace(/\{\w+\}/g, ' ');
const ESPANOL = /\b(de|del|la|el|los|las|una|que|para|con|sin|por|como|cuando|desde|hasta|cada|más|pero|aunque|sólo|también|aquí|idioma|fuente|guardado|usa|está|hay)\b/i;
const INGLES = /\b(the|and|with|from|this|that|use|language|source|saved|when|each|only|also|here|nothing|where|should)\b/i;
for (const [clave, valor] of Object.entries(en)) {
  if (ESPANOL.test(sinHuecos(valor))) fallo('idioma-cruzado', `en:${clave}`, `texto español en el catálogo inglés: «${valor}»`);
}
for (const [clave, valor] of Object.entries(es)) {
  if (INGLES.test(sinHuecos(valor))) fallo('idioma-cruzado', `es:${clave}`, `texto inglés en el catálogo español: «${valor}»`);
}

// ── 3 · códigos ─────────────────────────────────────────────────────────────────────────────────────
try {
  const { CODES } = await import(`file://${join(raiz, 'lib/i18n/codes.mjs').replace(/\\/g, '/')}`);
  for (const code of Object.keys(CODES)) {
    if (typeof en[`code.${code}`] !== 'string') fallo('codigo-sin-texto', `en:code.${code}`, 'código sin traducción inglesa');
    if (typeof es[`code.${code}`] !== 'string') fallo('codigo-sin-texto', `es:code.${code}`, 'código sin traducción española');
  }
  for (const clave of Object.keys(en)) {
    const m = /^code\.(.+)$/.exec(clave);
    if (m !== null && CODES[m[1]] === undefined) fallo('texto-huerfano', `en:${clave}`, 'texto de un código que no existe en CODES');
  }
} catch (error) {
  fallo('codigos', 'lib/i18n/codes.mjs', `no se pudo cargar: ${error.message}`);
}

// ── 4 · diccionario del panel ───────────────────────────────────────────────────────────────────────
try {
  const cliente = lee('client.js');
  const inicio = cliente.indexOf('const DICTIONARIES = {');
  const fin = cliente.indexOf('const FALLBACK =');
  const trozo = inicio >= 0 && fin > inicio ? cliente.slice(inicio, fin) : '';
  const bloque = (idioma) => {
    const i = trozo.indexOf(`${idioma}: {`);
    if (i < 0) return '';
    let n = 0;
    const desde = i + `${idioma}: {`.length;
    for (let j = desde; j < trozo.length; j += 1) {
      if (trozo[j] === '{') n += 1;
      else if (trozo[j] === '}') {
        if (n === 0) return trozo.slice(desde, j);
        n -= 1;
      }
    }
    return trozo.slice(desde);
  };
  const clavesDe = (t) => [...t.matchAll(/^\s{8}([a-zA-Z_][\w]*):/gm)].map((m) => m[1]).sort();
  const kEs = clavesDe(bloque('es'));
  const kEn = clavesDe(bloque('en'));
  for (const k of kEs) if (!kEn.includes(k)) fallo('panel-paridad', `en:${k}`, 'clave del panel que falta en inglés');
  for (const k of kEn) if (!kEs.includes(k)) fallo('panel-paridad', `es:${k}`, 'clave del panel que falta en español');
  const valores = (t) => [...t.matchAll(/^\s{8}([a-zA-Z_][\w]*):\s*'((?:[^'\\]|\\.)*)'/gm)].map((m) => [m[1], m[2]]);
  for (const [k, v] of valores(bloque('en'))) if (ESPANOL.test(sinHuecos(v))) fallo('panel-idioma-cruzado', `en:${k}`, v);
  for (const [k, v] of valores(bloque('es'))) if (INGLES.test(sinHuecos(v))) fallo('panel-idioma-cruzado', `es:${k}`, v);
  if (!/const FALLBACK = DICTIONARIES\.en;/.test(cliente)) fallo('panel-reserva', 'client.js', 'la reserva debe ser el idioma base (en)');
} catch (error) {
  fallo('panel', 'client.js', `no se pudo revisar: ${error.message}`);
}

// ── 5 · nombres y alias ────────────────────────────────────────────────────────────────────────────
try {
  const comandos = lee('lib/commands.mjs');
  const nombres = [...comandos.matchAll(/^\s{6}name: '([^']+)',$/gm)].map((m) => m[1]);
  // Dos comandos se registran con nombre plantilla (`skill-ownership-${SOLO_DSH}`); se resuelven aquí porque
  // el gate mira el texto, no ejecuta el módulo.
  if (/name: `skill-ownership-\$\{SOLO_DSH\}`/.test(comandos)) nombres.push('skill-ownership-dsh-only');
  if (/name: `skill-ownership-\$\{MAQUINA\}`/.test(comandos)) nombres.push('skill-ownership-machine');
  const españoles = /^skill-(propuestas|pendientes|ver|aprobar|globalizar|ambito|deshabilitar|habilitar|eliminar|retiradas|sistemas|rechazar)$|^skill-propiedad(-dsh-only|-machine)?$/;
  for (const nombre of nombres) {
    if (españoles.test(nombre)) fallo('nombre-espanol', `lib/commands.mjs:${nombre}`, 'comando canónico con nombre español');
    if (!/^skill-[a-z][a-z0-9-]*$/.test(nombre)) fallo('nombre-gramatica', `lib/commands.mjs:${nombre}`, 'nombre fuera de la gramática');
  }
  const alias = [...comandos.matchAll(/'([^']+)': '([^']+)',/g)].filter(([, a]) => españoles.test(a));
  if (alias.length !== 15) fallo('alias-cuenta', 'lib/commands.mjs', `se esperan 15 alias, hay ${alias.length}`);
  for (const [, viejo, nuevo] of alias) {
    if (!nombres.includes(nuevo)) fallo('alias-destino', `lib/commands.mjs:${viejo}`, `su canónico «${nuevo}» no existe`);
    if (nombres.includes(`'${viejo}'`)) fallo('alias-duplicado', `lib/commands.mjs:${viejo}`, 'el alias se registra como comando propio');
  }
  // El metadato tiene que decir lo MISMO que la retirada declarada. Estaba clavado en '4.0.0' mientras la
  // descripcion del mismo objeto decia «se retira en 5.0.0»: la puerta daba por bueno un dato que se
  // contradecia con la frase, y la incoherencia viajo hasta la puerta de release. Ahora se lee la constante y
  // se exige que el metadato sea ella, o su literal exacto.
  const retirada = /export const RETIRADA_DE_ALIAS = '(\d+\.\d+\.\d+)'/.exec(comandos)?.[1];
  const declarado = /deprecatedIn: ([^,\n]+),/.exec(comandos)?.[1]?.trim();
  const coherente = declarado === 'RETIRADA_DE_ALIAS' || (retirada !== undefined && declarado === `'${retirada}'`);
  if (!/aliasOf: nuevo/.test(comandos) || !coherente) {
    fallo('alias-metadatos', 'lib/commands.mjs',
      `los alias no declaran aliasOf/deprecatedIn coherentes con la retirada (RETIRADA_DE_ALIAS=${retirada ?? 'ausente'}, deprecatedIn=${declarado ?? 'ausente'})`);
  }
} catch (error) {
  fallo('comandos', 'lib/commands.mjs', `no se pudo revisar: ${error.message}`);
}

// ── salida ─────────────────────────────────────────────────────────────────────────────────────────
if (comoJson) {
  process.stdout.write(`${JSON.stringify({ ok: fallos.length === 0, fallos }, null, 2)}\n`);
} else if (fallos.length === 0) {
  process.stdout.write(`I18N: en orden (${claves(en).length} claves por idioma · ${claves(es).length} · 15 alias)\n`);
} else {
  for (const f of fallos) process.stdout.write(`FALLO ${f.regla} · ${f.donde} — ${f.detalle}\n`);
  process.stdout.write(`\nI18N: ${fallos.length} problema(s) en ${relative(raiz, raiz) || '.'}\n`);
}
process.exit(fallos.length === 0 ? 0 : 1);
