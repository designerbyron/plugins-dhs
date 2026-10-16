/**
 * La propiedad del proceso de creación de skills, y los sistemas que conviven en el puesto.
 *
 * ── El problema que cierra este módulo ───────────────────────────────────────────────────────────
 *
 * Este plugin no es el único que escribe skills en esta máquina: conviven la biblioteca curada del
 * harness, los almacenes de otros agentes y editores (Hermes, Claude Code, Codex, Cursor…), y en la
 * biblioteca curada hay skills que **no** escribió este plugin. Hasta ahora el plugin asumía que el
 * puesto era suyo —un defecto de alcance, no de código— y nadie declaraba quién manda sobre qué.
 *
 * Aquí se declara, en un fichero del almacén (`ownership.json`), y se mide: qué sistemas hay, qué ve
 * cada uno y **dónde choca un id con otro**. Dos reglas que no se negocian:
 *
 *   1. **Nunca se escribe en el almacén de otro sistema.** Ni con `machine`, ni importando, ni
 *      «arreglando»: lo ajeno se lee, se cita y —como mucho— se copia hacia dentro con procedencia.
 *   2. **Nada se declara por omisión.** Sin respuesta del humano la propiedad queda `null`, y el
 *      plugin lo dice en vez de elegir por él: elegir «todo el PC» solo no es una decisión del motor.
 *
 * ── Las dos respuestas ──────────────────────────────────────────────────────────────────────────
 *
 * | `ownership` | Qué significa | Qué hace el plugin |
 * |---|---|---|
 * | `dsh-only` | sólo mientras se trabaja con DSH | escribe **sólo** en su almacén y en la biblioteca curada de DSH, y **rechaza** un id que ya viva fuera: no compite con los demás sistemas |
 * | `machine` | el proceso entero del PC | además **mira** los otros sistemas, avisa de cada choque de id y puede traer lo ajeno como propuesta con procedencia — sin sobrescribir jamás |
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

// Este módulo **no** importa de `compiler.mjs`: la raíz del almacén y la biblioteca curada las pasa quien
// llama (que es quien las conoce: `defaultRoot()` vive allí y sigue siendo la única fuente). Así no hay
// ciclo entre los dos ficheros y cada uno tiene una responsabilidad.

/** Las dos respuestas posibles. `null` = sin declarar, que es distinto de cualquiera de las dos. */
export const SOLO_DSH = 'dsh-only';
export const MAQUINA = 'machine';

/** El nombre con el que se declara cada una, para textos y validación. */
export const PROPIEDADES = Object.freeze({
  [SOLO_DSH]: 'Sólo se trabaja con DSH: el plugin escribe en su almacén y en la biblioteca curada, y rechaza los ids que ya vivan fuera de DSH.',
  [MAQUINA]: 'Todo el PC: el plugin se declara dueño del proceso, mira los demás sistemas, avisa de cada choque y no sobrescribe nada ajeno.',
});

/** Dónde vive la declaración. */
export function rutaDePropiedad(root) {
  return join(root, 'ownership.json');
}

/**
 * Lo declarado, tal cual. **No se inventa un valor por defecto**: sin fichero, la propiedad es `null` y
 * quien pregunte sabrá que nadie ha respondido — que es lo que pasa de verdad.
 */
export function leerPropiedad({ root } = {}) {
  const ruta = rutaDePropiedad(root);
  if (!existsSync(ruta)) return { ownership: null, declaredAt: null, declaredBy: null, motivo: 'nadie ha respondido' };
  try {
    const datos = JSON.parse(readFileSync(ruta, 'utf8'));
    const ownership = datos?.ownership === SOLO_DSH || datos?.ownership === MAQUINA ? datos.ownership : null;
    return {
      ownership,
      declaredAt: datos?.declaredAt ?? null,
      declaredBy: datos?.declaredBy ?? null,
      motivo: ownership === null ? 'la declaración no dice una de las dos respuestas válidas' : 'declarada',
    };
  } catch (error) {
    return { ownership: null, declaredAt: null, declaredBy: null, motivo: `la declaración no se pudo leer (${error.message})` };
  }
}

/**
 * Declara la propiedad. Se escribe con paso intermedio y `rename` para que una caída no deje media
 * declaración: un fichero cortado se leería como error y volvería a preguntar, que es aceptable, pero
 * media respuesta válida sería peor.
 */
export function declararPropiedad(ownership, { root, por = 'humano', now = new Date().toISOString() } = {}) {
  if (ownership !== SOLO_DSH && ownership !== MAQUINA) {
    return { ok: false, reason: `«${ownership}» no es una respuesta válida: se declara «${SOLO_DSH}» o «${MAQUINA}»` };
  }
  const ruta = rutaDePropiedad(root);
  try {
    mkdirSync(dirname(ruta), { recursive: true });
    const temporal = `${ruta}.tmp`;
    writeFileSync(temporal, `${JSON.stringify({ ownership, declaredAt: now, declaredBy: por }, null, 2)}\n`, 'utf8');
    renameSync(temporal, ruta);
    return { ok: true, ownership, ruta };
  } catch (error) {
    return { ok: false, reason: `no se pudo escribir la declaración (${error.message})` };
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

/** Los ids de un almacén con forma de carpeta de skills: un directorio con `SKILL.md` dentro. */
export function idsEn(ruta) {
  if (typeof ruta !== 'string' || !existsSync(ruta)) return new Set();
  const ids = new Set();
  let entradas = [];
  try {
    entradas = readdirSync(ruta, { withFileTypes: true });
  } catch {
    return ids; // una carpeta denegada no puede tumbar el inventario: se declara fuera, no se finge
  }
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    if (existsSync(join(ruta, entrada.name, 'SKILL.md'))) ids.add(entrada.name);
  }
  return ids;
}

/**
 * Los ids del almacén del plugin: vive uno por proyecto y por estado, así que no se enumeran como una
 * carpeta de skills —y una versión apartada lleva la fecha en el nombre, que no es parte del id—.
 */
export function idsDelAlmacen(root) {
  const base = join(root, 'projects');
  const ids = new Set();
  if (!existsSync(base)) return ids;
  let proyectos = [];
  try {
    proyectos = readdirSync(base, { withFileTypes: true }).filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name);
  } catch {
    return ids;
  }
  for (const proyecto of proyectos) {
    for (const estado of ['proposed', 'approved', 'disabled', 'published', 'rejected', 'superseded']) {
      const carpeta = join(base, proyecto, estado);
      if (!existsSync(carpeta)) continue;
      let entradas = [];
      try {
        entradas = readdirSync(carpeta, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entrada of entradas) {
        if (!entrada.isDirectory()) continue;
        const apartada = /^(.*)-\d{4}-\d{2}-\d{2}T[\d:.Z-]*$/.exec(entrada.name);
        ids.add(apartada === null ? entrada.name : apartada[1]);
      }
    }
  }
  return ids;
}

/**
 * ¿Este id de la biblioteca curada lo escribió este plugin?
 *
 * Se lee su `origin`; la curada es un directorio compartido y ahí escriben otras herramientas. Sin
 * `origin: skill-compiler` el id es **ajeno** y no se toca — regla que ya aplica el anti-solapamiento al
 * publicar, y que aquí se necesita para saber qué se puede importar y qué sólo citar.
 */
export function esNuestraLaCurada(id, { curada }) {
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
 * Los sistemas de skills conocidos en el puesto.
 *
 * Se derivan de rutas reales —nunca se inventan— y cada uno declara si existe. Los «nuestros» son el
 * almacén del plugin y la biblioteca curada de DSH; los demás son de otros agentes. El humano puede
 * añadir más con `config.sistemas` (una lista de rutas), porque el puesto de cada uno es suyo.
 */
export function sistemasConocidos({ root, curada, home = homedir(), extra = [] } = {}) {
  const sistemas = [
    { nombre: 'skill-compiler (almacén del plugin)', ruta: join(root, 'projects'), nuestro: true, clase: 'almacen' },
    { nombre: 'DSH · biblioteca curada', ruta: curada, nuestro: false, clase: 'curada', mixta: true },
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
    .map((sistema) => ({ ...sistema, existe: existsSync(sistema.ruta) }))
    .filter((sistema) => {
      const clave = resolve(sistema.ruta).toLowerCase();
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}

/** Las carpetas `skills/` de los perfiles de Hermes, que son varios y no se adivinan: se listan. */
function perfilesDeHermes(ruta) {
  if (!existsSync(ruta)) return [];
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
 * El inventario del puesto: cada sistema con sus ids, y **los ids que viven en más de un sitio**.
 *
 * Esto es lo que faltaba para no chocar: dos sistemas pueden tener el mismo id con contenido distinto, y
 * hasta ahora nadie lo miraba. Un id repetido no siempre es un error —una copia nuestra publicada vive en
 * la curada a propósito—, así que se informa con la distinción: nuestro (lo escribimos nosotros) o ajeno.
 */
export function inventario({ root, curada, home = homedir(), extra = [] } = {}) {
  const base = sistemasConocidos({ root, curada, home, extra });
  const sistemas = [];
  for (const sistema of base) {
    if (sistema.porPerfil) {
      for (const perfil of perfilesDeHermes(sistema.ruta)) {
        sistemas.push({ ...sistema, ...perfil, porPerfil: false, existe: true, ids: idsEn(perfil.ruta) });
      }
      continue;
    }
    sistemas.push({ ...sistema, ids: sistema.clase === 'almacen' ? idsDelAlmacen(root) : idsEn(sistema.ruta) });
  }
  const donde = new Map();
  for (const sistema of sistemas) {
    for (const id of sistema.ids) {
      const clave = id;
      if (!donde.has(clave)) donde.set(clave, []);
      donde.get(clave).push({ sistema: sistema.nombre, ruta: sistema.ruta, nuestro: sistema.nuestro === true, curada: sistema.clase === 'curada' });
    }
  }
  const colisiones = {};
  for (const [id, sitios] of donde) {
    // Una copia en la curada que escribimos nosotros no es una colisión: es la publicación (una sola
    // copia efectiva, la que publica `--global`). Lo que se señala es lo demás: el mismo id en sistemas
    // distintos, que es donde nacen dos verdades sobre lo mismo.
    const relevantes = sitios.filter((s) => !(s.curada && esNuestraLaCurada(id, { curada: s.ruta })));
    if (relevantes.length > 1) colisiones[id] = relevantes;
  }
  return {
    sistemas: sistemas.map((s) => ({ nombre: s.nombre, ruta: s.ruta, nuestro: s.nuestro === true, clase: s.clase, existe: s.existe, ids: [...s.ids].sort() })),
    colisiones,
    totales: {
      sistemas: sistemas.length,
      existentes: sistemas.filter((s) => s.existe).length,
      ids: donde.size,
      colisiones: Object.keys(colisiones).length,
    },
  };
}

/**
 * Dónde más vive este id, mirando los sistemas conocidos. Lo que decide la puerta: un id que ya existe
 * fuera se avisa (o se rechaza, según la propiedad declarada) en vez de crear la segunda copia en
 * silencio, que es como nacen dos verdades sobre lo mismo.
 */
export function dondeMasViveEseId(id, { root, curada, home = homedir(), extra = [], proyectos = [] } = {}) {
  const sitios = [];
  for (const sistema of sistemasConocidos({ root, curada, home, extra })) {
    if (sistema.porPerfil) {
      for (const perfil of perfilesDeHermes(sistema.ruta)) {
        if (idsEn(perfil.ruta).has(id)) sitios.push({ sistema: perfil.nombre, ruta: perfil.ruta, nuestro: false });
      }
      continue;
    }
    // Nuestro almacén no es «otro sistema»: su solape lo mide el anti-solapamiento de siempre, con su
    // ámbito. Y la copia de la curada que escribimos nosotros es la publicación, no una competencia.
    if (sistema.nuestro === true) continue;
    if (sistema.clase === 'curada' && esNuestraLaCurada(id, { curada: sistema.ruta })) continue;
    if (idsEn(sistema.ruta).has(id)) sitios.push({ sistema: sistema.nombre, ruta: sistema.ruta, nuestro: false });
  }
  for (const proyecto of proyectos) {
    for (const carpeta of [join(proyecto, '.dsh', 'skills'), join(proyecto, '.claude', 'skills')]) {
      if (idsEn(carpeta).has(id)) sitios.push({ sistema: `proyecto ${proyecto}`, ruta: carpeta, nuestro: false });
    }
  }
  return sitios;
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

/** El texto de la pregunta, para que se lea igual en el comando, en el menú y en la documentación. */
export function textoDeLaPregunta() {
  return [
    'Este plugin aprende skills y las escribe en SU almacén. En este puesto hay más sistemas que escriben skills',
    '(la biblioteca curada del harness, y los almacenes de otros agentes o editores). Nadie ha declarado quién manda.',
    '',
    `  · ${SOLO_DSH}  — sólo se trabaja con DSH: escribe en su almacén y en la biblioteca curada de DSH, y rechaza los ids que ya vivan fuera.`,
    `  · ${MAQUINA}  — todo el PC: el plugin se declara dueño del proceso, MIRA los demás sistemas, avisa de cada choque de id`,
    '                  y puede traer lo ajeno como propuesta con procedencia. Nunca sobrescribe nada que no sea suyo.',
    '',
    `Respuesta: /skill-propiedad ${SOLO_DSH}  ·  /skill-propiedad ${MAQUINA}`,
  ].join('\n');
}
