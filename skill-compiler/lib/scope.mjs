/**
 * La propiedad del proceso de creación de skills, y los sistemas que conviven en el puesto.
 *
 * ── El problema que cierra este módulo ───────────────────────────────────────────────────────────
 *
 * Este plugin no es el único que escribe skills en esta máquina: conviven la biblioteca curada del
 * harness, los almacenes de otros agentes y editores (Hermes, Claude Code, Codex, Cursor…) y, en la
 * biblioteca curada, hay skills que **no** escribió este plugin. Hasta ahora el plugin asumía que el
 * puesto era suyo —un defecto de alcance, no de código— y nadie declaraba quién manda sobre qué.
 *
 * Aquí se declara, en un fichero del almacén (`ownership.json`), y se mide: qué sistemas hay, qué ve
 * cada uno y **dónde choca un id con otro**. Dos reglas que no se negocian:
 *
 *   1. **Nunca se escribe en el almacén de otro sistema.** Ni con `machine`, ni importando, ni
 *      «arreglando»: lo ajeno se lee, se cita y —como mucho— se copia hacia dentro con procedencia.
 *   2. **Nada se declara por omisión.** Sin respuesta del humano la propiedad queda distinta de las dos
 *      respuestas, y el plugin lo dice en vez de elegir por él: elegir «todo el PC» solo no es una
 *      decisión del motor.
 *
 * ── Los cuatro estados de la declaración, que no son dos ─────────────────────────────────────────
 *
 * | `estado` | Qué significa | Qué hace el plugin |
 * |---|---|---|
 * | `ausente` | no hay fichero: nadie ha respondido | aplica la política segura (no compite fuera de DSH) y **dice que falta** |
 * | `declarada` | respuesta válida (`dsh-only` o `machine`) | aplica la política declarada |
 * | `invalida` | el fichero existe y no dice una de las dos respuestas (JSON roto, valor fuera de contrato, campos desconocidos) | **no se presume**, y se declara el motivo |
 * | `ilegible` | el fichero existe y no se pudo leer (permisos, es un directorio…) | **no se presume**, y **no se confunde con ausente**: se declara el error |
 *
 * `invalida` e `ilegible` no son «sin declarar» por comodidad: son estados que hay que **arreglar**, y
 * por eso se distinguen. Una declaración ilegible leída como ausente haría creer que nadie ha respondido
 * cuando sí hay una respuesta que no se puede leer.
 *
 * ── El inventario, y lo que no se puede afirmar ──────────────────────────────────────────────────
 *
 * Un almacén puede estar **detectado y accesible**, **detectado e inaccesible** (permisos, no es una
 * carpeta, un enlace roto) o **no existir**, y las tres cosas se leían igual: cero skills. Eso convierte
 * «no hay choques» en una afirmación que nadie midió. Aquí la diferencia es un dato: `leerAlmacen`
 * devuelve por qué no pudo leer, el inventario marca `completo: false` cuando alguna fuente configurada
 * y existente no se pudo leer, y **sólo con el inventario completo se afirma que no hay choques**.
 */
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

import { t } from './i18n/index.mjs';

// Este módulo **no** importa de `compiler.mjs`: la raíz del almacén y la biblioteca curada las pasa quien
// llama (que es quien las conoce: `defaultRoot()` vive allí y sigue siendo la única fuente). Así no hay
// ciclo entre los dos ficheros y cada uno tiene una responsabilidad.

/** Las dos respuestas posibles. Sin declarar no es ninguna de las dos: es un estado propio. */
export const SOLO_DSH = 'dsh-only';
export const MAQUINA = 'machine';

/** Los estados de la declaración. `ausente` no es «sin declarar por comodidad»: es que no hay fichero. */
export const ESTADOS_PROPIEDAD = Object.freeze(['ausente', 'declarada', 'invalida', 'ilegible']);

/** Los únicos campos que el contrato admite. Un campo de más es un contrato distinto: no se presume. */
export const CAMPOS_PROPIEDAD = Object.freeze(['ownership', 'declaredAt', 'declaredBy']);

/**
 * El nombre con el que se declara cada una, para textos y validacion.
 *
 * Es **funcion y no constante**: una constante se evalua al importar y congelaria el idioma del arranque; el
 * idioma se resuelve en cada lectura, que es lo que permite cambiar de lengua sin reiniciar.
 */
export function propiedadEnTexto(owner) {
  if (owner === SOLO_DSH) return t('scope.propiedad.dsh-only');
  if (owner === MAQUINA) return t('scope.propiedad.machine');
  return '';
}

/** Dónde vive la declaración. */
export function rutaDePropiedad(root) {
  return join(root, 'ownership.json');
}

/** La huella de unos bytes o de un texto: lo que permite decir «esto es lo mismo que leí». */
export function huellaDe(datos) {
  return createHash('sha256').update(datos).digest('hex');
}

const corte = (huella) => (typeof huella === 'string' ? huella.slice(0, 12) : '(ninguna)');

/**
 * La respuesta declarada, con su estado real. **No se inventa un valor por defecto**: sin fichero la
 * propiedad es nula y quien pregunte sabrá que nadie ha respondido — que es lo que pasa de verdad.
 *
 * Devuelve también `huella`, que es la identidad de lo leído: quien vaya a actuar según la política la
 * guarda y la vuelve a comprobar antes de escribir, y así dos operaciones no se pisan la respuesta.
 */
export function leerPropiedad({ root } = {}) {
  const ruta = rutaDePropiedad(root);
  let bruto = null;
  let error = null;
  try {
    bruto = readFileSync(ruta);
  } catch (fallo) {
    error = fallo;
  }
  if (error !== null) {
    // No existir y no poder leer son dos cosas distintas: una es una pregunta sin responder; la otra,
    // una pregunta cuya respuesta está ahí y no se alcanza.
    const sinFichero = error.code === 'ENOENT' || error.code === 'ENOTDIR';
    return {
      estado: sinFichero ? 'ausente' : 'ilegible',
      ownership: null,
      declaredAt: null,
      declaredBy: null,
      huella: null,
      camposDesconocidos: [],
      ruta,
      motivo: sinFichero ? 'nadie ha respondido' : `la declaración existe y no se pudo leer (${error.code ?? error.message})`,
    };
  }

  const huella = huellaDe(bruto);
  let datos = null;
  try {
    datos = JSON.parse(bruto.toString('utf8'));
  } catch (fallo) {
    return { estado: 'invalida', ownership: null, declaredAt: null, declaredBy: null, huella, camposDesconocidos: [], ruta, motivo: `la declaración no es JSON válido (${fallo.message})` };
  }
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) {
    return { estado: 'invalida', ownership: null, declaredAt: null, declaredBy: null, huella, camposDesconocidos: [], ruta, motivo: 'la declaración no es un objeto' };
  }

  const desconocidos = Object.keys(datos).filter((campo) => !CAMPOS_PROPIEDAD.includes(campo));
  if (desconocidos.length > 0) {
    // Un campo que este contrato no conoce puede cambiar el significado de los que sí conoce. Se rechaza
    // entera en vez de leerla a medias: una política aplicada a medias es peor que ninguna.
    return {
      estado: 'invalida', ownership: null, declaredAt: null, declaredBy: null, huella, camposDesconocidos: desconocidos, ruta,
      motivo: `la declaración trae campos que este contrato no conoce: ${desconocidos.join(', ')}`,
    };
  }
  if (datos.ownership !== SOLO_DSH && datos.ownership !== MAQUINA) {
    return {
      estado: 'invalida', ownership: null, declaredAt: null, declaredBy: null, huella, camposDesconocidos: [], ruta,
      motivo: `la declaración no dice «${SOLO_DSH}» ni «${MAQUINA}»`,
    };
  }
  return {
    estado: 'declarada',
    ownership: datos.ownership,
    declaredAt: typeof datos.declaredAt === 'string' ? datos.declaredAt : null,
    declaredBy: typeof datos.declaredBy === 'string' ? datos.declaredBy : null,
    huella,
    camposDesconocidos: [],
    ruta,
    motivo: 'declarada',
  };
}

/**
 * La política que se aplica **de verdad**: sólo `declarada` tiene una propia. Todo lo demás (`ausente`,
 * `invalida`, `ilegible`) se comporta igual —no competir fuera de DSH— pero se declara por su nombre:
 * arreglar un JSON roto no es responder a una pregunta.
 */
export function politicaAplicable(estado) {
  return estado.estado === 'declarada' ? estado.ownership : SOLO_DSH;
}

/**
 * Declara la propiedad. Se escribe con paso intermedio y `rename` para que una caída no deje media
 * declaración.
 *
 * `esperadaHuella` es la identidad de **lo que se leyó antes**: si el fichero cambió entre la lectura y
 * la escritura (otra sesión, el CLI, un editor), la escritura **no se hace** y se dice — así una decisión
 * tomada sobre una política vieja no pisa una respuesta nueva, ni al revés.
 */
export function declararPropiedad(ownership, { root, por = 'humano', now = new Date().toISOString(), esperadaHuella = undefined } = {}) {
  if (ownership !== SOLO_DSH && ownership !== MAQUINA) {
    return { ok: false, status: 'invalida', reason: `«${ownership}» no es una respuesta válida: se declara «${SOLO_DSH}» o «${MAQUINA}»` };
  }
  const previa = leerPropiedad({ root });
  if (esperadaHuella !== undefined && previa.huella !== esperadaHuella) {
    return {
      ok: false,
      status: 'concurrente',
      reason: `la propiedad cambió entre la lectura (huella ${corte(esperadaHuella)}) y esta escritura (${corte(previa.huella)}): vuelve a leerla y decide otra vez`,
    };
  }
  const ruta = rutaDePropiedad(root);
  const temporal = `${ruta}.tmp`;
  try {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(temporal, `${JSON.stringify({ ownership, declaredAt: now, declaredBy: por }, null, 2)}\n`, 'utf8');
    renameSync(temporal, ruta);
  } catch (error) {
    try { rmSync(temporal, { force: true }); } catch { /* el temporal que no se puede borrar queda declarado por el motivo */ }
    return { ok: false, status: 'fallo', reason: `no se pudo escribir la declaración (${error.code ?? error.message})` };
  }
  const despues = leerPropiedad({ root });
  if (despues.estado !== 'declarada' || despues.ownership !== ownership) {
    return { ok: false, status: 'fallo', reason: `la declaración no quedó como se escribió: estado ${despues.estado} (${despues.motivo})` };
  }
  return { ok: true, status: 'declarada', ownership, ruta, huella: despues.huella };
}

/** ¿La declaración sigue siendo la misma que se leyó? Se comprueba antes de cada escritura que dependa de ella. */
export function propiedadSinCambios(estado, { root } = {}) {
  const ahora = leerPropiedad({ root });
  if (ahora.huella === estado.huella) return { ok: true, estado: ahora };
  return {
    ok: false,
    estado: ahora,
    reason: `la propiedad cambió durante la operación: se leyó ${estado.estado}${estado.ownership ? ` «${estado.ownership}»` : ''} (huella ${corte(estado.huella)}) y ahora está ${ahora.estado}${ahora.ownership ? ` «${ahora.ownership}»` : ''} (huella ${corte(ahora.huella)})`,
  };
}

// ── Rutas: resolver, y no salirse ────────────────────────────────────────────────────────────────

/**
 * Resuelve una ruta a su forma canónica **sin seguir enlaces que no existan** y sin lanzar.
 *
 * `realpathSync` es la única forma de saber a dónde apunta de verdad un enlace, pero falla en una ruta
 * que no existe, y una ruta que no existe también hay que declararla. Por eso: si existe, canónica; si
 * no, forma normalizada absoluta, declarando que no se pudo confirmar.
 */
export function resolverRuta(ruta) {
  if (typeof ruta !== 'string' || ruta.trim() === '') return { ruta: null, existe: false, canonica: false, motivo: 'no hay ruta' };
  const absoluta = resolve(ruta);
  // Se resuelve **hasta donde exista**: si el último tramo no está, se canónica el ancestro que sí está y
  // se vuelve a colgar la cola. Sin esto, una ruta que no existe no se podía comparar con su raíz y un
  // enlace que salía del ámbito pasaba por dentro — que es justo el caso que hay que ver.
  //
  // `canonica` sigue significando «se resolvió **entera**»: con una cola sin existir es `false`, y la cola
  // se devuelve aparte (`sinResolver`) para que nadie confunda «resuelto hasta el ancestro» con «existe».
  let actual = absoluta;
  const cola = [];
  for (;;) {
    try {
      const canonica = realpathSync.native ? realpathSync.native(actual) : realpathSync(actual);
      return {
        ruta: cola.length > 0 ? join(canonica, ...cola) : canonica,
        existe: existsSync(absoluta),
        canonica: cola.length === 0,
        ancestroCanonico: canonica,
        sinResolver: [...cola],
      };
    } catch (error) {
      const padre = dirname(actual);
      if (padre === actual) return { ruta: normalize(absoluta), existe: existsSync(absoluta), canonica: false, ancestroCanonico: null, sinResolver: [...cola], motivo: error.code ?? error.message };
      cola.unshift(basename(actual));
      actual = padre;
    }
  }
}

/**
 * ¿`ruta` está dentro de `raiz`? Se compara ya resuelto, así que una ruta que escapa por `..` o por un
 * enlace apuntando fuera **no** pasa.
 *
 * El caso del enlace es el que importa: una ruta puede «resolver bien» y aun así salirse del ámbito, y
 * seguirla sería leer o escribir donde no toca. Aquí se compara la canónica contra la canónica.
 */
export function bajoRaiz(raiz, ruta) {
  const base = resolverRuta(raiz);
  const destino = resolverRuta(ruta);
  if (base.ruta === null || destino.ruta === null) return { dentro: false, raiz: base.ruta, ruta: destino.ruta, canonica: false, motivo: 'alguna de las dos rutas no es utilizable' };
  const rel = relative(base.ruta, destino.ruta);
  const dentro = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  return {
    dentro,
    raiz: base.ruta,
    ruta: destino.ruta,
    canonica: destino.canonica,
    motivo: dentro ? 'dentro del ámbito' : `fuera del ámbito autorizado (${destino.ruta})`,
  };
}

/** ¿Esta entrada es un enlace, y a dónde apunta? Un enlace roto no es «no existe»: es un enlace roto. */
export function estadoDeEnlace(ruta) {
  try {
    const info = lstatSync(resolve(ruta));
    if (!info.isSymbolicLink()) return { enlace: false, roto: false };
    let destino = null;
    let roto = false;
    try {
      destino = realpathSync(resolve(ruta));
    } catch {
      roto = true;
    }
    return { enlace: true, destino, roto };
  } catch (error) {
    return { enlace: false, roto: false, error: error.code ?? error.message };
  }
}

// ── Almacenes: leer, y decir qué no se pudo leer ─────────────────────────────────────────────────

/**
 * Los ids de un almacén con forma de carpeta de skills: un directorio con `SKILL.md` dentro.
 *
 * **No confunde «no pude leer» con «no hay nada»**: además de los ids devuelve el estado real de la ruta
 * (`accesible`, `parcial`, `inaccesible`, `inexistente`) y el motivo. Antes devolvía un conjunto vacío en
 * los cuatro casos, y con eso el inventario afirmaba «sin choques» sin haber mirado.
 */
export function leerAlmacen(ruta) {
  const vacio = (estado, motivo) => ({ ids: new Set(), estado, motivo, enlace: false, enlaceRoto: false, ilegibles: [] });
  if (typeof ruta !== 'string' || ruta.trim() === '') return vacio('inexistente', 'no hay ruta que leer');

  const enlace = estadoDeEnlace(ruta);
  if (!existsSync(ruta)) {
    if (enlace.enlace) return { ...vacio('inaccesible', `enlace roto (${enlace.destino ?? 'sin destino legible'})`), enlace: true, enlaceRoto: true };
    return vacio('inexistente', 'la ruta no existe');
  }
  let info = null;
  try {
    info = statSync(ruta);
  } catch (error) {
    return { ...vacio('inaccesible', `no se pudo consultar la ruta (${error.code ?? error.message})`), enlace: enlace.enlace === true };
  }
  if (!info.isDirectory()) return { ...vacio('inaccesible', 'la ruta existe y no es una carpeta'), enlace: enlace.enlace === true };

  let entradas = [];
  try {
    entradas = readdirSync(ruta, { withFileTypes: true });
  } catch (error) {
    return { ...vacio('inaccesible', `no se pudo listar la carpeta (${error.code ?? error.message})`), enlace: enlace.enlace === true };
  }

  const ids = new Set();
  const ilegibles = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory() && !entrada.isSymbolicLink()) continue;
    const dentro = join(ruta, entrada.name);
    try {
      if (!statSync(dentro).isDirectory()) continue;
      if (!existsSync(join(dentro, 'SKILL.md'))) continue;
      ids.add(entrada.name);
    } catch (error) {
      // Una entrada que no se puede leer es un almacén **incompleto**, no un id que no está.
      ilegibles.push({ id: entrada.name, motivo: error.code ?? error.message });
    }
  }
  return {
    ids,
    estado: ilegibles.length > 0 ? 'parcial' : 'accesible',
    motivo: ilegibles.length > 0 ? `${ilegibles.length} entrada(s) sin poder leer` : 'leído entero',
    enlace: enlace.enlace === true,
    enlaceRoto: enlace.roto === true,
    ilegibles,
  };
}

/** Los ids sueltos, para quien sólo necesita el conjunto. Con el estado, la que manda es `leerAlmacen`. */
export function idsEn(ruta) {
  return leerAlmacen(ruta).ids;
}

/** La huella del contenido de una skill: lo que permite decir si dos copias del mismo id son la misma. */
export function huellaDeSkill(ruta) {
  const fichero = join(ruta, 'SKILL.md');
  try {
    return { huella: huellaDe(readFileSync(fichero)), bytes: statSync(fichero).size, legible: true };
  } catch (error) {
    return { huella: null, bytes: null, legible: false, motivo: error.code ?? error.message };
  }
}

/**
 * Los ids del almacén del plugin: vive uno por proyecto y por estado, así que no se enumeran como una
 * carpeta de skills —y una versión apartada lleva la fecha en el nombre, que no es parte del id—.
 *
 * Devuelve también de dónde salió cada uno (`porId`), que es lo que permite calcular su huella sin
 * adivinar la ruta.
 */
export function idsDelAlmacen(root) {
  const base = join(root, 'projects');
  const ids = new Set();
  const porId = new Map();
  if (!existsSync(base)) return { ids, porId, estado: 'inexistente', motivo: 'la ruta no existe', ilegibles: [] };
  let proyectos = [];
  try {
    proyectos = readdirSync(base, { withFileTypes: true }).filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name);
  } catch (error) {
    return { ids, porId, estado: 'inaccesible', motivo: `no se pudo listar la carpeta (${error.code ?? error.message})`, ilegibles: [] };
  }
  const ilegibles = [];
  for (const proyecto of proyectos) {
    for (const estado of ['proposed', 'approved', 'disabled', 'published', 'rejected', 'superseded']) {
      const carpeta = join(base, proyecto, estado);
      if (!existsSync(carpeta)) continue;
      let entradas = [];
      try {
        entradas = readdirSync(carpeta, { withFileTypes: true });
      } catch (error) {
        ilegibles.push({ carpeta, motivo: error.code ?? error.message });
        continue;
      }
      for (const entrada of entradas) {
        if (!entrada.isDirectory()) continue;
        const apartada = /^(.*)-\d{4}-\d{2}-\d{2}T[\d:.Z-]*$/.exec(entrada.name);
        const id = apartada === null ? entrada.name : apartada[1];
        ids.add(id);
        if (!porId.has(id)) porId.set(id, []);
        porId.get(id).push({ ruta: join(carpeta, entrada.name), proyecto, estado, apartada: apartada !== null });
      }
    }
  }
  return { ids, porId, estado: ilegibles.length > 0 ? 'parcial' : 'accesible', motivo: ilegibles.length > 0 ? `${ilegibles.length} carpeta(s) sin poder leer` : 'leído entero', ilegibles };
}

/**
 * ¿Este id de la biblioteca curada lo escribió este plugin?
 *
 * Se lee su `origin`; la curada es un directorio compartido y ahí escriben otras herramientas. Sin
 * `origin: skill-compiler` el id es **ajeno** y no se toca — regla que ya aplica el anti-solapamiento al
 * publicar, y que aquí se necesita para saber qué se puede importar y qué sólo citar.
 */
export function esNuestraLaCurada(id, { curada }) {
  if (typeof curada !== 'string' || curada === '') return false;
  const fichero = join(curada, id, 'SKILL.md');
  if (!existsSync(fichero)) return false;
  try {
    const texto = readFileSync(fichero, 'utf8');
    return /^\s{4}origin:\s*skill-compiler\s*$/m.test(texto) || /^origin:\s*skill-compiler\s*$/m.test(texto);
  } catch {
    return false; // ilegible: no se puede demostrar que sea nuestra, así que no lo es
  }
}

/**
 * Almacenes ajenos declarados por el entorno, separados por el delimitador del sistema.
 *
 * Existe porque el puesto de cada uno es suyo: hay agentes y editores que este módulo no puede adivinar
 * —uno recién instalado, o uno con la carpeta en otro disco—. Lo que se declara aquí se **mira**; no se
 * escribe nunca.
 */
export function almacenesDelEntorno({ env = process.env, extra = [] } = {}) {
  const bruto = String(env.SKILL_COMPILER_SISTEMAS ?? '');
  return [...bruto.split(delimiter), ...extra].map((ruta) => String(ruta).trim()).filter(Boolean);
}

/**
 * Los sistemas de skills conocidos en el puesto.
 *
 * Se derivan de rutas reales —nunca se inventan— y cada uno declara dónde está, si existe, si es un
 * enlace y cuál es la forma canónica de su ruta. Los «nuestros» son el almacén del plugin y la
 * biblioteca curada de DSH; los demás son de otros agentes. El humano puede añadir más con
 * `SKILL_COMPILER_SISTEMAS`, porque el puesto de cada uno es suyo.
 */
export function sistemasConocidos({ root, curada, home = homedir(), extra = [] } = {}) {
  const sistemas = [
    { nombre: 'skill-compiler (almacén del plugin)', ruta: join(root, 'projects'), nuestro: true, clase: 'almacen' },
    { nombre: 'DSH · biblioteca curada', ruta: curada ?? null, nuestro: false, clase: 'curada', mixta: true },
    { nombre: 'Hermes · perfil por defecto', ruta: join(home, 'AppData', 'Local', 'hermes', 'skills'), nuestro: false, clase: 'ajeno' },
    { nombre: 'Hermes · perfiles', ruta: join(home, 'AppData', 'Local', 'hermes', 'profiles'), nuestro: false, clase: 'ajeno', porPerfil: true },
    { nombre: 'Claude Code · usuario', ruta: join(home, '.claude', 'skills'), nuestro: false, clase: 'ajeno' },
    { nombre: 'Codex · usuario', ruta: join(home, '.codex', 'skills'), nuestro: false, clase: 'ajeno' },
    { nombre: 'Cursor · usuario', ruta: join(home, '.cursor', 'skills'), nuestro: false, clase: 'ajeno' },
  ];
  for (const ruta of almacenesDelEntorno({ extra })) {
    sistemas.push({ nombre: `declarado (entorno/config): ${ruta}`, ruta, nuestro: false, clase: 'ajeno' });
  }
  // Un almacén declarado dos veces es el mismo almacén: se queda la primera declaración. Sin esto, la
  // misma carpeta aparecía como dos sistemas y sus ids contaban doble —un choque inventado por el lector—.
  const vistos = new Set();
  return sistemas
    .map((sistema) => {
      const resuelta = resolverRuta(sistema.ruta ?? '');
      const enlace = estadoDeEnlace(sistema.ruta ?? '');
      return {
        ...sistema,
        existe: sistema.ruta === null ? false : existsSync(sistema.ruta),
        canonica: resuelta.ruta,
        canonicaConfirmada: resuelta.canonica === true,
        enlace: enlace.enlace === true,
        enlaceRoto: enlace.roto === true,
      };
    })
    .filter((sistema) => {
      const clave = String(sistema.ruta ?? '').toLowerCase();
      if (clave === '') return true; // sin ruta no hay nada que deduplicar
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}

/** Las carpetas `skills/` de los perfiles de Hermes, que son varios y no se adivinan: se listan. */
function perfilesDeHermes(ruta) {
  if (typeof ruta !== 'string' || !existsSync(ruta)) return [];
  try {
    return readdirSync(ruta, { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory())
      .map((entrada) => ({ nombre: `Hermes · perfil ${entrada.name}`, ruta: join(ruta, entrada.name, 'skills') }))
      .filter((perfil) => existsSync(perfil.ruta));
  } catch {
    return [];
  }
}

/**
 * Quién es quién cuando dos copias comparten id.
 *
 * Dos skills con el mismo id no son automáticamente el mismo asunto: pueden ser la misma copia, o dos
 * cosas distintas con el mismo nombre — que es el caso que crea dos verdades. Se distinguen por la
 * evidencia disponible, y cuando no la hay se dice:
 *
 *   · `misma-copia` — mismo **contenido** (huella idéntica). Es la misma copia materialmente; que sea
 *     nuestra lo decide la procedencia, no el parecido.
 *   · `distinto-contenido` — mismo id, contenido distinto: **choque real**.
 *   · `no-determinable` — alguna copia no se pudo leer: ni choque ni copia, se declara.
 *
 * La huella informa, no decide: una copia idéntica puede venir de un tercero, así que la propiedad se
 * resuelve con la procedencia (`origin`), no con el parecido. Y una publicación **nuestra** se descarta
 * antes de llegar aquí —por su `origin`—, que es lo que evita el falso conflicto.
 */
export function clasificarIdentidad(id, sitios) {
  if (sitios.length < 2) return { clase: 'unica', id, sitios };
  const ilegibles = sitios.filter((sitio) => sitio.huella === null || sitio.huella === undefined);
  if (ilegibles.length > 0) return { clase: 'no-determinable', id, motivo: `${ilegibles.length} copia(s) sin poder leer`, sitios };
  const huellas = new Set(sitios.map((sitio) => sitio.huella));
  if (huellas.size === 1) return { clase: 'misma-copia', id, sitios };
  return { clase: 'distinto-contenido', id, huellas: [...huellas], sitios };
}

/** Cada sistema, ya resuelto: con su almacén leído, su estado y sus ids. */
function expandir({ root, curada, home = homedir(), extra = [] }) {
  const sistemas = [];
  for (const sistema of sistemasConocidos({ root, curada, home, extra })) {
    if (sistema.porPerfil) {
      for (const perfil of perfilesDeHermes(sistema.ruta)) {
        const lectura = leerAlmacen(perfil.ruta);
        sistemas.push({ ...sistema, ...perfil, porPerfil: false, existe: true, ids: lectura.ids, lectura, porId: null });
      }
      continue;
    }
    if (sistema.clase === 'almacen') {
      const almacen = idsDelAlmacen(root);
      sistemas.push({ ...sistema, ids: almacen.ids, porId: almacen.porId, lectura: { ids: almacen.ids, estado: almacen.estado, motivo: almacen.motivo, ilegibles: almacen.ilegibles } });
      continue;
    }
    const lectura = leerAlmacen(sistema.ruta);
    sistemas.push({ ...sistema, ids: lectura.ids, lectura, porId: null });
  }
  return sistemas;
}

/**
 * El inventario del puesto: cada sistema con sus ids, y **los ids que viven en más de un sitio**.
 *
 * Devuelve además `completo`, que es lo que hace honesta la frase «no hay choques»: con una fuente
 * configurada y existente que no se pudo leer, un choque puede estar ahí sin que nadie lo vea. En ese
 * caso las colisiones **comprobadas** se informan igual, y lo que se declara es que hay fuentes sin
 * comprobar.
 *
 * `huella` identifica el inventario leído (sistemas, estados, ids ordenados): es lo que permite decir
 * después «este inventario es el mismo que usé» o «cambió». No es una instantánea atómica —son lecturas
 * seguidas— y por eso no se llama así: se declara como la huella de lo leído.
 */
export function inventario({ root, curada, home = homedir(), extra = [] } = {}) {
  const sistemas = expandir({ root, curada, home, extra });
  const donde = new Map();
  for (const sistema of sistemas) {
    for (const id of sistema.ids) {
      if (!donde.has(id)) donde.set(id, []);
      const copias = sistema.porId?.get(id) ?? null;
      const copia = copias?.find((entrada) => entrada.estado !== 'superseded') ?? copias?.[0] ?? null;
      const ruta = copia?.ruta ?? (sistema.ruta === null ? null : join(sistema.ruta, id));
      const medida = ruta === null ? { huella: null, legible: false } : huellaDeSkill(ruta);
      donde.get(id).push({
        sistema: sistema.nombre,
        ruta,
        raiz: sistema.ruta,
        nuestro: sistema.nuestro === true,
        curada: sistema.clase === 'curada',
        estado: copia?.estado ?? null,
        huella: medida.huella,
        legible: medida.legible !== false,
      });
    }
  }

  const colisiones = {};
  const copiasPropias = {};
  for (const [id, sitios] of donde) {
    // Una copia en la curada que lleva NUESTRO `origin` no es una colisión: es la publicación de
    // `--global`, una sola copia efectiva. Lo que se señala es lo demás — el mismo id en sistemas
    // distintos, que es donde nacen dos verdades sobre lo mismo.
    //
    // Y que dos copias tengan el **mismo contenido** no las convierte en «nuestra publicación»: la huella
    // informa, la procedencia decide. Una copia idéntica que nadie firma sigue siendo un choque declarado:
    // descartarla por parecerse sería dar por buena una propiedad que no se ha demostrado.
    const nuestras = sitios.filter((sitio) => sitio.curada && esNuestraLaCurada(id, { curada: sitio.raiz }));
    const relevantes = sitios.filter((sitio) => !nuestras.includes(sitio));
    if (nuestras.length > 0) {
      copiasPropias[id] = {
        clase: 'publicacion-nuestra',
        id,
        sitios: [...nuestras, ...relevantes],
        motivo: `la copia de la curada lleva nuestro origen: es la publicación, no una colisión (${nuestras.length} copia(s) publicada(s))`,
      };
    }
    if (relevantes.length < 2) continue;
    colisiones[id] = clasificarIdentidad(id, relevantes);
  }

  // Dos nombres que sólo se diferencian en mayúsculas son el MISMO fichero en Windows y distintos en
  // Linux: se declara, porque una skill escrita con otra caja es una sorpresa en el otro sistema.
  const nombresEquivalentes = [];
  for (const sistema of sistemas) {
    const porMinusculas = new Map();
    for (const id of sistema.ids) {
      const clave = id.toLowerCase();
      if (porMinusculas.has(clave) && porMinusculas.get(clave) !== id) nombresEquivalentes.push({ sistema: sistema.nombre, ids: [porMinusculas.get(clave), id] });
      else if (!porMinusculas.has(clave)) porMinusculas.set(clave, id);
    }
  }

  const sinLeer = sistemas.filter((sistema) => sistema.existe && sistema.lectura.estado !== 'accesible' && sistema.lectura.estado !== 'inexistente');
  const huella = huellaDe(JSON.stringify({
    sistemas: sistemas.map((s) => [s.nombre, s.canonica, s.existe, s.lectura.estado, [...s.ids].sort()]).sort(),
    colisiones: Object.keys(colisiones).sort(),
  }));

  return {
    sistemas: sistemas.map((sistema) => ({
      nombre: sistema.nombre,
      ruta: sistema.ruta,
      canonica: sistema.canonica,
      nuestro: sistema.nuestro === true,
      clase: sistema.clase,
      existe: sistema.existe,
      enlace: sistema.enlace,
      enlaceRoto: sistema.enlaceRoto,
      estado: sistema.lectura.estado,
      motivo: sistema.lectura.motivo,
      ids: [...sistema.ids].sort(),
    })),
    colisiones,
    copiasPropias,
    nombresEquivalentes,
    completo: sinLeer.length === 0,
    sinLeer: sinLeer.map((sistema) => ({ nombre: sistema.nombre, ruta: sistema.ruta, estado: sistema.lectura.estado, motivo: sistema.lectura.motivo })),
    huella,
    totales: {
      sistemas: sistemas.length,
      existentes: sistemas.filter((sistema) => sistema.existe).length,
      accesibles: sistemas.filter((sistema) => sistema.lectura.estado === 'accesible').length,
      sinLeer: sinLeer.length,
      ids: donde.size,
      colisiones: Object.keys(colisiones).length,
      copiasPropias: Object.keys(copiasPropias).length,
    },
  };
}

/**
 * Dónde más vive este id, mirando los sistemas conocidos. Lo que decide la puerta: un id que ya existe
 * fuera se avisa (o se rechaza, según la propiedad declarada) en vez de crear la segunda copia en
 * silencio, que es como nacen dos verdades sobre lo mismo.
 *
 * Devuelve también `completo`: si alguna fuente no se pudo leer, «no vive en ningún sitio» es una frase
 * que no se puede afirmar, y se dice así.
 */
export function dondeMasViveEseId(id, { root, curada, home = homedir(), extra = [], proyectos = [] } = {}) {
  const sitios = [];
  const sinLeer = [];
  const anota = (sistema, lectura) => {
    if (lectura.estado === 'inaccesible' || lectura.estado === 'parcial') {
      sinLeer.push({ sistema: sistema.nombre, ruta: sistema.ruta, estado: lectura.estado, motivo: lectura.motivo });
    }
  };
  for (const sistema of sistemasConocidos({ root, curada, home, extra })) {
    if (sistema.porPerfil) {
      for (const perfil of perfilesDeHermes(sistema.ruta)) {
        const lectura = leerAlmacen(perfil.ruta);
        anota({ nombre: perfil.nombre, ruta: perfil.ruta }, lectura);
        if (lectura.ids.has(id)) sitios.push({ sistema: perfil.nombre, ruta: join(perfil.ruta, id), raiz: perfil.ruta, nuestro: false, huella: huellaDeSkill(join(perfil.ruta, id)).huella });
      }
      continue;
    }
    // Nuestro almacén no es «otro sistema»: su solape lo mide el anti-solapamiento de siempre, con su
    // ámbito. Y la copia de la curada que escribimos nosotros es la publicación, no una competencia.
    if (sistema.nuestro === true) continue;
    const lectura = leerAlmacen(sistema.ruta);
    anota(sistema, lectura);
    if (!lectura.ids.has(id)) continue;
    if (sistema.clase === 'curada' && esNuestraLaCurada(id, { curada: sistema.ruta })) continue;
    sitios.push({ sistema: sistema.nombre, ruta: join(sistema.ruta, id), raiz: sistema.ruta, nuestro: false, huella: huellaDeSkill(join(sistema.ruta, id)).huella });
  }
  for (const proyecto of proyectos) {
    for (const carpeta of [join(proyecto, '.dsh', 'skills'), join(proyecto, '.claude', 'skills')]) {
      const lectura = leerAlmacen(carpeta);
      anota({ nombre: `proyecto ${proyecto}`, ruta: carpeta }, lectura);
      if (lectura.ids.has(id)) sitios.push({ sistema: `proyecto ${proyecto}`, ruta: join(carpeta, id), raiz: carpeta, nuestro: false, huella: huellaDeSkill(join(carpeta, id)).huella });
    }
  }
  return { sitios, sinLeer, completo: sinLeer.length === 0 };
}

/** Los directorios de proyecto que este plugin conoce, leídos de los `meta.json` de su propio almacén. */
export function proyectosConocidos({ root } = {}) {
  const base = join(root, 'projects');
  if (!existsSync(base)) return [];
  const proyectos = new Set();
  try {
    for (const entrada of readdirSync(base, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue;
      for (const estado of ['approved', 'proposed', 'disabled', 'published']) {
        const carpeta = join(base, entrada.name, estado);
        if (!existsSync(carpeta)) continue;
        for (const skill of readdirSync(carpeta, { withFileTypes: true })) {
          if (!skill.isDirectory()) continue;
          try {
            const meta = JSON.parse(readFileSync(join(carpeta, skill.name, 'meta.json'), 'utf8'));
            const proyecto = meta?.project ?? (meta?.dsh?.project ?? null);
            if (typeof proyecto === 'string' && proyecto.trim() !== '') proyectos.add(proyecto);
          } catch {
            /* un meta ilegible no aporta proyectos, y no puede tumbar el inventario */
          }
        }
      }
    }
  } catch {
    return [];
  }
  return [...proyectos].sort();
}

/** El texto de la pregunta, para que se lea igual en el comando, en el menu y en la documentacion. */
export function textoDeLaPregunta() {
  return [
    t('scope.question.intro'),
    t('scope.question.intro-2'),
    '',
    t('scope.question.dsh-only', { nombre: SOLO_DSH }),
    t('scope.question.machine', { nombre: MAQUINA }),
    t('scope.question.machine-2'),
    '',
    t('scope.question.answer', { dshOnly: SOLO_DSH, machine: MAQUINA }),
  ].join('\n');
}

/**
 * El estado de la declaracion, en texto: una respuesta, la pregunta, o el motivo por el que la respuesta
 * que hay no se puede usar. Los tres casos se leen distinto porque son distintos.
 */
export function textoDelEstado(estado) {
  if (estado.estado === 'declarada') {
    return [
      t('scope.state.declared-title', { ownership: estado.ownership }),
      `  ${propiedadEnTexto(estado.ownership)}`,
      t('scope.state.declared-by', {
        autor: estado.declaredBy ?? t('scope.state.no-author'),
        fecha: estado.declaredAt ?? t('scope.state.no-date'),
      }),
      t('scope.state.trace', { huella: corte(estado.huella), ruta: estado.ruta }),
    ].join('\n');
  }
  if (estado.estado === 'ausente') {
    return [textoDeLaPregunta(), '', t('scope.state.undeclared', { motivo: estado.motivo })].join('\n');
  }
  const problema = estado.estado === 'invalida'
    ? t('scope.state.invalid-title')
    : t('scope.state.unreadable-title');
  return [
    problema,
    t('scope.state.line', { estado: estado.estado, motivo: estado.motivo }),
    t('scope.state.file', { ruta: estado.ruta }),
    t('scope.state.no-policy'),
    estado.estado === 'invalida'
      ? t('scope.state.fix-invalid', { dshOnly: SOLO_DSH, machine: MAQUINA })
      : t('scope.state.fix-unreadable'),
  ].join('\n');
}

/**
 * El inventario, en texto, para todas las superficies: `/skill-sistemas` y `systems` imprimen **lo
 * mismo**, y esa es la única forma de que no diverjan. Dice el estado de cada fuente sin confundir
 * «no existe» con «no se pudo leer», y **no afirma que no hay choques cuando no pudo mirarlo todo**.
 */
export function textoDeSistemas({ datos, estado }) {
  const lineas = [t('scope.systems.header', {
    existentes: datos.totales.existentes,
    sistemas: datos.totales.sistemas,
    accesibles: datos.totales.accesibles,
  })];
  for (const sistema of datos.sistemas) {
    const marca = sistema.existe ? '-' : t('scope.systems.missing');
    const cola = sistema.estado === 'accesible'
      ? ''
      : t('scope.systems.row-detail', { estado: sistema.estado, motivo: sistema.motivo });
    const enlace = sistema.enlace ? (sistema.enlaceRoto ? t('scope.systems.link-broken') : t('scope.systems.link')) : '';
    lineas.push(t('scope.systems.row', {
      marca,
      enlace,
      nombre: sistema.nombre,
      n: sistema.ids.length,
      nuestro: sistema.nuestro ? t('scope.systems.ours') : '',
      cola,
    }));
    lineas.push(`      ${sistema.ruta ?? t('scope.systems.no-path')}`);
  }

  lineas.push('');
  lineas.push(estado.estado === 'declarada'
    ? t('scope.systems.ownership-declared', {
      ownership: estado.ownership,
      autor: estado.declaredBy ?? t('scope.state.no-author'),
      fecha: estado.declaredAt ?? t('scope.state.no-date'),
      huella: corte(estado.huella),
    })
    : t('scope.systems.ownership-state', { estado: estado.estado.toUpperCase(), motivo: estado.motivo }));
  if (estado.estado !== 'declarada') {
    lineas.push(t('scope.systems.answer', { dshOnly: SOLO_DSH, machine: MAQUINA }));
  }

  const choques = Object.entries(datos.colisiones);
  if (choques.length > 0) {
    lineas.push('', t('scope.systems.collisions-header', { n: choques.length }));
    for (const [id, identidad] of choques) {
      const clases = {
        'distinto-contenido': t('scope.systems.class-different'),
        'misma-copia': t('scope.systems.class-same-copy'),
        'no-determinable': t('scope.systems.class-undetermined'),
      };
      lineas.push(t('scope.systems.collision-row', {
        id,
        clase: clases[identidad.clase] ?? identidad.clase,
        copias: identidad.sitios.length,
      }));
      for (const sitio of identidad.sitios) {
        const huella = sitio.huella
          ? t('scope.systems.site-hash', { huella: String(sitio.huella).slice(0, 12) })
          : t('scope.systems.site-no-hash');
        lineas.push(`      ${sitio.sistema}${sitio.nuestro ? t('scope.systems.ours') : ''}${huella}`);
      }
    }
  } else if (datos.completo) {
    lineas.push('', t('scope.systems.no-collisions'));
  } else {
    lineas.push('', t('scope.systems.unproven'));
  }

  const propias = Object.keys(datos.copiasPropias);
  if (propias.length > 0) {
    lineas.push('', t('scope.systems.own-copies-header', { n: propias.length }));
    lineas.push(`  ${propias.join(', ')}`);
  }

  if (datos.nombresEquivalentes.length > 0) {
    lineas.push('', t('scope.systems.equivalent-header'));
    for (const par of datos.nombresEquivalentes) {
      lineas.push(t('scope.systems.equivalent-row', { ids: par.ids.join(' / '), sistema: par.sistema }));
    }
  }

  if (!datos.completo) {
    lineas.push('', t('scope.systems.incomplete-header', { n: datos.sinLeer.length }));
    for (const fuente of datos.sinLeer) {
      lineas.push(t('scope.systems.incomplete-row', {
        nombre: fuente.nombre,
        estado: fuente.estado,
        motivo: fuente.motivo,
      }));
    }
  }

  if (datos.totales.colisiones === 0 && datos.completo) {
    lineas.push('', t('scope.systems.complete', {
      fuentes: datos.totales.existentes,
      ids: datos.totales.ids,
    }));
  }
  return lineas.join('\n');
}
