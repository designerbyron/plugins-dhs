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
 *   5. las 16 operaciones de sesión tienen UN nombre por idioma (el del otro idioma no se registra), ninguna
 *      se queda sin operación ni al revés, y no queda rastro del modelo de alias.
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
// Los huecos incluyen las marcas de nombre (`{cmd:approve}`, `{row:approve}`): son placeholders igual que los
// demas, y si una frase los tiene en un idioma y no en el otro, el texto no dice lo mismo.
const huecos = (texto) => [...String(texto).matchAll(/\{([\w:.]+)\}/g)].map((m) => m[1]).sort();

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
const sinHuecos = (v) => String(v).replace(/\{[\w:.]+\}/g, ' ');
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

// ── 5 · nombres: una operacion, un nombre por idioma ───────────────────────────────────────────────
//
// La regla vieja contaba 15 alias espanoles y exigia `aliasOf`/`deprecatedIn`. El modelo se retiro: ahora los
// nombres espanoles son **el nombre de su operacion en espanol**, no un alias del ingles, y el conjunto activo
// tiene una fila por operacion. Lo que se mide aqui es el mapa (`lib/operations.mjs`) contra las definiciones
// base (`lib/commands.mjs`), importando los dos modulos en vez de leer su texto: una tabla de nombres copiada a
// mano en el gate mide la memoria de quien la copio.
const OPERACIONES_ESPERADAS = 16;

try {
  const { LOCALIZED_OPERATIONS, createLocalizedSet } = await import(`file://${join(raiz, 'lib/localized-commands.mjs').replace(/\\/g, '/')}`);
  const { skillCommands } = await import(`file://${join(raiz, 'lib/commands.mjs').replace(/\\/g, '/')}`);

  // 5.1 el mapa declara las 16 operaciones, cada una con un nombre valido en cada idioma
  if (LOCALIZED_OPERATIONS.length !== OPERACIONES_ESPERADAS) {
    fallo('operaciones-cuenta', 'lib/operations.mjs',
      `se esperan ${OPERACIONES_ESPERADAS} operaciones en el mapa, hay ${LOCALIZED_OPERATIONS.length}`);
  }
  const GRAMATICA = /^[a-z][a-z0-9_-]*$/u;
  const ocupados = new Map();
  for (const op of LOCALIZED_OPERATIONS) {
    for (const lang of ['en', 'es']) {
      const nombre = op?.names?.[lang];
      if (typeof nombre !== 'string' || !GRAMATICA.test(nombre)) {
        fallo('nombre-gramatica', `lib/operations.mjs:${op?.id}`, lang === 'en' ? 'sin nombre ingles o fuera de la gramatica' : 'sin nombre espanol o fuera de la gramatica');
        continue;
      }
      const duenio = ocupados.get(nombre);
      if (duenio !== undefined && duenio !== op.id) {
        fallo('nombre-duplicado', `lib/operations.mjs:${op.id}`, `«${nombre}» ya lo ocupa la operacion «${duenio}» (una fila del menu no puede tener dos duenios)`);
      }
      ocupados.set(nombre, op.id);
    }
  }

  // 5.2 ninguna definicion base se queda sin operacion, y ninguna operacion sin definicion base
  const base = skillCommands({ root: join(raiz, '.i18n-gate-sin-almacen') });
  const nombresBase = base.map((c) => c.name).sort();
  const nombresMapa = LOCALIZED_OPERATIONS.map((op) => op?.names?.en).sort();
  for (const nombre of nombresBase) {
    if (!nombresMapa.includes(nombre)) fallo('operacion-huerfana', `lib/commands.mjs:${nombre}`, 'la definicion base no tiene entrada en el mapa localizado: su nombre no seguiria al idioma');
  }
  for (const nombre of nombresMapa) {
    if (!nombresBase.includes(nombre)) fallo('operacion-sin-base', `lib/operations.mjs:${nombre}`, 'el mapa declara una operacion sin definicion base: no tiene handler que heredar');
  }

  // 5.3 el conjunto activo: 16 filas por idioma, sin repetir, y el nombre del otro idioma NO esta dentro
  if (nombresBase.length === LOCALIZED_OPERATIONS.length && ocupados.size > 0) {
    const conjunto = createLocalizedSet({ definitions: base });
    for (const lang of ['en', 'es']) {
      const otro = lang === 'en' ? 'es' : 'en';
      const activos = conjunto.namesFor(lang);
      if (activos.length !== OPERACIONES_ESPERADAS) {
        fallo('filas-idioma', `lib/operations.mjs:${lang}`, `el idioma ${lang} registra ${activos.length} filas y se esperan ${OPERACIONES_ESPERADAS}`);
      }
      if (new Set(activos).size !== activos.length) {
        fallo('filas-idioma', `lib/operations.mjs:${lang}`, 'el conjunto del idioma repite un nombre');
      }
      for (const op of LOCALIZED_OPERATIONS) {
        const ajeno = op?.names?.[otro];
        // La excepcion es una operacion que NO se traduce (`skill-auto`): mismo nombre en los dos idiomas.
        if (activos.includes(ajeno) && ajeno !== op?.names?.[lang]) {
          fallo('nombre-ajeno', `lib/operations.mjs:${op.id}`, `en ${lang} se registra «${ajeno}», que es el nombre del otro idioma`);
        }
      }
    }
    // El unico nombre que no cambia de idioma es `skill-auto`; si otro deja de traducirse, se decide aqui.
    const sinTraducir = LOCALIZED_OPERATIONS.filter((op) => op?.names?.en === op?.names?.es).map((op) => op.id);
    if (sinTraducir.sort().join(',') !== 'auto') {
      fallo('nombre-sin-traducir', 'lib/operations.mjs', `solo «auto» comparte nombre en los dos idiomas; hoy: ${sinTraducir.join(', ') || 'ninguna'}`);
    }
  }

  // 5.4b Los NOMBRES de comando no se copian en el catalogo: se citan con una marca (`{cmd:x}`, `{row:x}`).
  //
  // Un texto que escribe `/skill-aprobar` a mano es una segunda copia del mapa, y el dia que un nombre cambie
  // el mensaje ofrecera un comando que no existe: es lo que ya pasaba con las filas —citadas en ingles dentro
  // del catalogo espanol— y con `/skill-pending` en la ayuda de los dos idiomas.
  const marcas = [];
  for (const [idioma, dicc] of [['en', en], ['es', es]]) {
    for (const [clave, valor] of Object.entries(dicc)) {
      if (typeof valor !== 'string') continue;
      // Una cita es un nombre de comando precedido de nada alfanumerico: `node bin/skill-compiler.mjs` es una
      // ruta, no un comando, y el nombre del plugin (`skill-compiler`) tampoco es una operacion.
      const citados = [...valor.matchAll(/(?<![A-Za-z0-9_.])\/skill-(?![a-z]*compiler\b)[a-z][a-z0-9-]*|(?<![A-Za-z0-9_.])skill-[a-z][a-z0-9_-]*-<id>/g)].map((m) => m[0]);
      for (const cita of citados) marcas.push(`${idioma}:${clave} cita «${cita}»`);
      // Una marca que no corresponda a una operacion se quedaria visible en el texto: se denuncia aqui.
      for (const [, marca] of valor.matchAll(/\{(?:cmd|row):([a-z0-9-]+)\}/g)) {
        if (!LOCALIZED_OPERATIONS.some((op) => op?.id === marca)) marcas.push(`${idioma}:${clave} usa una marca sin operacion: «${marca}»`);
      }
    }
  }
  if (marcas.length > 0) {
    fallo('nombre-copiado', 'lib/i18n/', `los nombres de comando se citan con una marca, no a mano: ${marcas.slice(0, 6).join('; ')}`);
  }

  // 5.4c Las FILAS del menu tambien son comandos: su nombre sale del mapa, y el del otro idioma no se anuncia.
  //
  // Una fila se ofrece en el menu `/` y se ejecuta al elegirla, asi que un nombre que no corresponda al registro
  // activo es una instruccion falsa. Se comprueba la composicion —prefijo localizado del verbo— y que el
  // prefijo del otro idioma no coincida nunca.
  try {
    const { ROW_VERBS } = await import(`file://${join(raiz, 'lib/pending-rows.mjs').replace(/\\/g, '/')}`);
    const { rowPrefixOf, slashNameOf } = await import(`file://${join(raiz, 'lib/operations.mjs').replace(/\\/g, '/')}`);
    const verbos = ROW_VERBS.map((v) => v.operation);
    if (verbos.length === 0) fallo('filas-verbos', 'lib/pending-rows.mjs', 'no declara ningun verbo');
    for (const operacion of verbos) {
      const enFila = rowPrefixOf(operacion, 'en');
      const esFila = rowPrefixOf(operacion, 'es');
      if (enFila === null || esFila === null) {
        fallo('filas-verbos', `lib/pending-rows.mjs:${operacion}`, 'su verbo no es una operacion del mapa');
        continue;
      }
      if (enFila === esFila && operacion !== 'auto') {
        fallo('fila-sin-traducir', `lib/pending-rows.mjs:${operacion}`, `la fila se anuncia igual en los dos idiomas («${enFila}»)`);
      }
      if (!nombresBase.includes(slashNameOf(operacion, 'en').slice(1))) {
        fallo('fila-huerfana', `lib/pending-rows.mjs:${operacion}`, 'la fila cita un verbo que no es un comando registrado');
      }
    }
  } catch (error) {
    fallo('filas', 'lib/pending-rows.mjs', `no se pudo revisar: ${error.message}`);
  }

  // 5.4 no queda rastro del modelo de alias: ni el metadato, ni la tabla, ni la clave de su aviso
  const conAlias = [];
  for (const rel of ['lib/commands.mjs', 'lib/presentation.mjs', 'lib/localized-commands.mjs', 'lib/operations.mjs', 'index.js', 'client.js', 'lib/i18n/es.mjs', 'lib/i18n/en.mjs']) {
    const texto = lee(rel);
    for (const marca of ['aliasOf', 'deprecatedIn', 'ALIAS_ESPERADOS', 'RETIRADA_DE_ALIAS', 'cmd.alias.']) {
      if (texto.includes(marca)) conAlias.push(`${rel}: ${marca}`);
    }
  }
  if (conAlias.length > 0) fallo('alias-retirado', 'lib/', `el modelo de alias esta retirado y sigue citado en ${conAlias.join('; ')}`);
} catch (error) {
  fallo('comandos', 'lib/operations.mjs', `no se pudo revisar: ${error.message}`);
}

// ── salida ─────────────────────────────────────────────────────────────────────────────────────────
if (comoJson) {
  process.stdout.write(`${JSON.stringify({ ok: fallos.length === 0, fallos }, null, 2)}\n`);
} else if (fallos.length === 0) {
  process.stdout.write(`I18N: en orden (${claves(en).length} claves por idioma · ${claves(es).length} · ${OPERACIONES_ESPERADAS} operaciones x 2 nombres, 1 activo por idioma)
`);
} else {
  for (const f of fallos) process.stdout.write(`FALLO ${f.regla} · ${f.donde} — ${f.detalle}\n`);
  process.stdout.write(`\nI18N: ${fallos.length} problema(s) en ${relative(raiz, raiz) || '.'}\n`);
}
process.exit(fallos.length === 0 ? 0 : 1);
