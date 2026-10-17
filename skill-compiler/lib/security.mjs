/**
 * La capa de seguridad del compilador.
 *
 * Qué protege, y de qué — leído del código y de los casos medidos, no de una lista de deseos:
 *
 *   1. **Los ids son rutas.** `projects/<clave>/<estado>/<id>/SKILL.md` se construye con el id que llega de
 *      la línea de comandos. Un id con `..`, una barra o un nombre reservado de Windows no es un id raro: es
 *      una ruta a otra parte del disco. Aquí se decide, en un solo sitio, qué id es un id.
 *   2. **Una skill es texto que el modelo va a leer como instrucciones.** Por eso el contenido se escanea:
 *      credenciales, órdenes dirigidas al agente (ignorar lo anterior, no avisar al humano, aprobar sin
 *      humano) y operaciones destructivas. Lo que es un **bloqueo** no se escribe; lo que es un **aviso** lo
 *      decide el humano con `--force`, y **nunca** lo decide la aprobación automática.
 *   3. **El árbol que se publica es el que se leyó.** Un enlace simbólico dentro de una skill es una puerta a
 *      otro sitio: se rechaza, y la huella del árbol se comprueba entre la validación y el movimiento.
 *   4. **El diario dice la verdad o se nota.** Cada entrada encadena la huella de la anterior: borrar o
 *      editar una entrada rompe la cadena, y la comprobación lo dice.
 *
 * Lo que esta capa NO hace, y conviene tenerlo escrito: no ejecuta nada (el plugin nunca evalúa el contenido
 * de una skill), no es un antivirus, y no protege de un humano que decide publicar algo con `--force` sobre
 * un aviso — eso es exactamente lo que `--force` significa.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ── 1 · El id ────────────────────────────────────────────────────────────────────────────────────────

/** La forma canónica: kebab-case ASCII, empieza por letra, sin puntos ni separadores. */
export const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Hasta aquí es un identificador; más allá es una frase con guiones. */
export const ID_MAX = 64;

/**
 * Nombres que Windows trata como dispositivos, con extensión o sin ella: `CON`, `CON.md`, `nul.txt`…
 * No se pueden crear como ficheros normales, y un `mkdir` sobre ellos tiene efectos que no se esperan.
 */
const RESERVADOS = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * Por qué ese id no es un id, o `null` si lo es.
 *
 * Devuelve el **motivo** y no un booleano: un «id inválido» a secas obliga a adivinar qué arreglar, y quien
 * lo escribe suele ser un humano o el modelo, que necesitan saber qué cambiar.
 */
export function motivoDeIdInseguro(id) {
  const valor = String(id ?? '');
  if (valor === '') return 'el id está vacío';
  if (valor !== valor.trim()) return 'el id lleva espacios al principio o al final';
  if (valor.length > ID_MAX) return `el id tiene ${valor.length} caracteres y el máximo es ${ID_MAX}: acórtalo, que además es la ruta`;
  if (/[\\/]/.test(valor)) return 'el id lleva un separador de ruta: un id no es una ruta';
  if (valor.includes('..')) return 'el id lleva «..»: un id no sale de su carpeta';
  if (valor.includes('\0')) return 'el id lleva un byte nulo';
  if (!ID_RE.test(valor)) return 'el id tiene que ser kebab-case ASCII: minúsculas, números y guiones simples, empezando por letra';
  const base = valor.split('.')[0].toLowerCase();
  if (RESERVADOS.has(base)) return `«${valor}» es un nombre reservado de Windows y no se puede usar como carpeta`;
  if (/[. ]$/.test(valor)) return 'el id termina en punto o espacio: Windows lo recorta y dos ids distintos acabarían en la misma carpeta';
  return null;
}

export function esIdSeguro(id) {
  return motivoDeIdInseguro(id) === null;
}

// ── 2 · El contenido ─────────────────────────────────────────────────────────────────────────────────

/**
 * Credenciales. Un bloqueo: una skill se sirve en cada sesión y el almacén no es una caja fuerte. Lo que
 * parece un secreto, se trata como un secreto.
 */
const CREDENCIALES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada PEM'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave de acceso de AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'token de GitHub'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, 'token de Slack'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/, 'clave de API de Google'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'JWT'],
  [/\b(password|passwd|secret|api[_-]?key|token|credential)\b\s*[:=]\s*["']?[^\s"']{8,}/i, 'asignación de credencial'],
  [/\b(authorization|proxy-authorization)\s*:\s*(bearer|basic|token|digest)\s+\S+/i, 'cabecera de autorización'],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, 'cabecera Bearer con token'],
];

/**
 * Órdenes dirigidas al agente. Esto es el ataque que importa en un compilador de skills: el texto de una
 * skill se sirve como instrucciones, así que una propuesta puede intentar reescribir el comportamiento del
 * modelo —aprobarse sola, no avisar al humano, sacar datos— y sobrevivir a la sesión en la que nació.
 */
const ORDENES_AL_AGENTE = [
  [/\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|system)\b[^.\n]{0,20}\b(instruction|prompt|rule|message)s?\b/i, 'orden de ignorar las instrucciones anteriores'],
  [/\b(system|developer)\s*prompt\b[^.\n]{0,40}\b(reveal|show|print|repeat|dump)\b|\b(reveal|show|print|repeat|dump)\b[^.\n]{0,20}\b(system|developer)\s*prompt\b/i, 'orden de revelar el prompt del sistema'],
  [/^\s*(?:[-*]\s*)?(?:do not|don't|never)\s+(?:tell|inform|notify)\s+(?:the\s+)?(?:user|human)\b/im, 'orden de no avisar al humano'],
  [/\bno\s+le\s+digas\s+al\s+(usuario|humano)\b|\boc[uú]ltalo\s+al\s+(usuario|humano)\b|\bsin\s+que\s+se\s+entere\s+el\s+(usuario|humano)\b/i, 'orden de no avisar al humano'],
  [/\b(approve|aprueba|aproba|promociona|promote)\b[^.\n]{0,30}\b(yourself|t[uú]\s+mismo|autom[aá]ticamente|sin\s+(el\s+)?humano|without\s+(the\s+)?human)\b/i, 'orden de aprobarse sin el humano'],
  [/\b(skip|bypass|evade|salta|saltarse|evita)\b[^.\n]{0,25}\b(the\s+)?(gate|validation|puerta|validaci[oó]n|security|seguridad)\b/i, 'orden de saltarse la puerta'],
  [/\b(exfiltrate|exfiltra|send|env[ií]a|upload|sube)\b[^.\n]{0,40}\b(to|a|hacia)\b[^.\n]{0,40}https?:\/\//i, 'orden de enviar contenido a una URL'],
  [/(?:curl|wget|iwr|Invoke-WebRequest)[^|\n]{0,120}\|\s*(?:ba)?sh\b/i, 'descarga ejecutada al vuelo (curl | sh)'],
];

/**
 * Operaciones destructivas o privilegiadas. Bloqueo cuando no hay excusa posible (borrar la raíz, formatear,
 * tocar el registro de una máquina ajena); aviso cuando puede ser legítimo en un procedimiento documentado.
 */
const DESTRUCTIVAS = [
  [/\brm\s+(-[a-z]*[rf][a-z]*\s+){0,3}\/(?:\s|$|\*)/i, 'borrado de la raíz del sistema'],
  [/\b(del|rd|rmdir)\s+\/s\b[^\n]{0,40}\b[a-z]:\\?(?:\s|$|\*)/i, 'borrado recursivo de una unidad'],
  [/\bformat\s+[a-z]:/i, 'formateo de una unidad'],
  [/\bdiskpart\b|\bcleandisk\b/i, 'particionado del disco'],
  [/\breg\s+delete\s+HKLM/i, 'borrado del registro de la máquina'],
  [/\bbcdedit\b|\bvssadmin\s+delete\b/i, 'manipulación del arranque o de las sombras'],
];

/** Destruir una unidad entera no tiene lectura legítima en una skill; lo demás depende del procedimiento. */
const DESTRUCTIVAS_SIN_EXCUSA = 3;

/** Rutas que apuntan a material sensible: aviso (un procedimiento legítimo puede citarlas para prohibirlas). */
const RUTAS_SENSIBLES = [
  [/(?:^|[\s"'`(])(?:~|\/home\/[^/\s]+|\/root|%USERPROFILE%|[a-z]:\\Users\\[^\\\s]+)\\[^\s"')]*\.ssh\b/i, 'ruta al almacén de claves SSH'],
  [/(?:^|[\s"'`(])(?:~|\/home\/[^/\s]+|%USERPROFILE%|[a-z]:\\Users\\[^\\\s]+)\\[^\s"')]*\.aws\b/i, 'ruta a credenciales de AWS'],
  [/\b(id_rsa|id_ed25519|\.netrc|\.git-credentials|cookies\.sqlite|\bLogin Data\b|\bkey4\.db\b)/i, 'nombre de un fichero de credenciales o de cookies'],
  [/(?:^|[\s"'`(])\/etc\/(?:passwd|shadow)\b/i, 'ruta a credenciales del sistema'],
  [/\bSAM\b[^\n]{0,20}\bSYSTEM\b|\bconfig\\SAM\b/i, 'colmenas del registro con credenciales'],
];

const recortar = (texto, max = 120) => {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
};

/** Dónde apareció: la etiqueta del fichero y la línea, para que arreglarlo sea ir a esa línea. */
function conLinea(etiqueta, texto) {
  const lineas = String(texto ?? '').split('\n');
  return lineas.map((linea, i) => ({ etiqueta, numero: i + 1, linea }));
}

/**
 * Escanea un contenido que va a convertirse en una skill.
 *
 * @returns `{ bloqueos, avisos }` — cada hallazgo dice **regla**, **dónde** y **qué hacer**. Un bloqueo no se
 *   puede forzar; un aviso sí, y sólo un humano.
 */
export function escanear({ id = '', description = '', whenToUse = '', tags = [], body = '', ficheros = {} } = {}) {
  const bloqueos = [];
  const avisos = [];

  // El id no es contenido: si es inseguro, no hay nada que escanear con sentido.
  const idInseguro = motivoDeIdInseguro(id);
  if (idInseguro) {
    bloqueos.push({ rule: 'security-id', observed: recortar(id), message: `el id no es utilizable: ${idInseguro}`, fix: 'Elige un id kebab-case ASCII, sin puntos, de hasta 64 caracteres' });
  }

  const superficies = [
    ...conLinea('SKILL.md (frontmatter)', [description, whenToUse, ...(Array.isArray(tags) ? tags : [])].join('\n')),
    ...conLinea('SKILL.md', body),
    ...Object.entries(ficheros ?? {}).flatMap(([nombre, contenido]) => conLinea(nombre, typeof contenido === 'string' ? contenido : '')),
  ];

  const mirar = (lista, clase) => {
    for (const { etiqueta, numero, linea } of superficies) {
      for (const [re, motivo] of lista) {
        if (!re.test(linea)) continue;
        const donde = `${etiqueta}:${numero} · ${recortar(linea, 90)}`;
        const credencial = clase === 'credencial';
        const hallazgo = {
          rule: credencial ? 'secret' : (clase === 'aviso' ? 'security-warn' : 'security-block'),
          observed: donde,
          message: credencial
            ? `parece contener una credencial (${motivo}): una skill no lleva secretos nunca — ${recortar(linea, 80)}`
            : `${motivo} — ${recortar(linea, 90)}`,
          fix: credencial
            ? 'Quita la credencial y sustitúyela por una referencia al almacén de secretos'
            : clase === 'aviso'
              ? 'Revisa si de verdad hace falta; si es legítimo, un humano lo aprueba con --force y queda su decisión'
              : 'Quita el contenido: una skill no lleva órdenes dirigidas al agente ni operaciones destructivas, y esto no se aprueba ni con --force',
        };
        (clase === 'aviso' ? avisos : bloqueos).push(hallazgo);
      }
    }
  };

  mirar(CREDENCIALES, 'credencial');
  mirar(ORDENES_AL_AGENTE, 'bloqueo');
  mirar(DESTRUCTIVAS.slice(0, DESTRUCTIVAS_SIN_EXCUSA), 'bloqueo');
  mirar(DESTRUCTIVAS.slice(DESTRUCTIVAS_SIN_EXCUSA), 'aviso');
  mirar(RUTAS_SENSIBLES, 'aviso');

  return { bloqueos, avisos };
}

// ── 3 · El árbol que se va a mover ──────────────────────────────────────────────────────────────────

/**
 * Revisa un árbol de skill: que todo sea un fichero normal dentro de la carpeta.
 *
 * Un enlace simbólico aquí es grave en las dos direcciones: al leer, se publicaría contenido de fuera como si
 * fuera de la skill; al escribir, se escribiría fuera del almacén. No hay caso legítimo, así que se rechaza.
 */
export function revisarArbol(dir, { maxFicheros = 200 } = {}) {
  const problemas = [];
  const recorrer = (ruta, rel = '') => {
    let entradas;
    try {
      entradas = readdirSync(ruta, { withFileTypes: true });
    } catch (error) {
      problemas.push({ rule: 'security-tree', observed: rel || '(raíz)', message: `no se pudo leer: ${error.code ?? error.message}`, fix: 'Revisa permisos antes de aprobar' });
      return;
    }
    for (const entrada of entradas) {
      const hijo = join(ruta, entrada.name);
      const relativo = rel === '' ? entrada.name : `${rel}/${entrada.name}`;
      let info;
      try {
        info = lstatSync(hijo);
      } catch {
        problemas.push({ rule: 'security-tree', observed: relativo, message: 'no se pudo inspeccionar', fix: 'Revisa permisos antes de aprobar' });
        continue;
      }
      if (info.isSymbolicLink()) {
        problemas.push({ rule: 'security-tree', observed: relativo, message: 'es un enlace simbólico: una skill no sale de su carpeta', fix: 'Sustitúyelo por el fichero de verdad' });
        continue;
      }
      if (info.isDirectory()) {
        recorrer(hijo, relativo);
        continue;
      }
      if (!info.isFile()) {
        problemas.push({ rule: 'security-tree', observed: relativo, message: 'no es un fichero normal (dispositivo, tubería…)', fix: 'Quita ese elemento del árbol' });
      }
    }
  };
  recorrer(dir);
  if (problemas.length === 0) {
    const cuenta = contar(dir);
    if (cuenta > maxFicheros) {
      problemas.push({ rule: 'security-tree', observed: `${cuenta} ficheros`, message: `el árbol tiene ${cuenta} ficheros y el máximo es ${maxFicheros}`, fix: 'Una skill con doscientos ficheros no es una skill: divide o poda' });
    }
  }
  return { ok: problemas.length === 0, problemas };
}

function contar(dir, acc = { n: 0 }) {
  let entradas = [];
  try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { return acc.n; }
  for (const entrada of entradas) {
    if (entrada.isDirectory()) contar(join(dir, entrada.name), acc);
    else acc.n += 1;
  }
  return acc.n;
}

/** Huella estable de un árbol: rutas ordenadas y sha256 del contenido. Sirve para «lo que se leyó es lo que se mueve». */
export function huellaDeArbol(dir) {
  const partes = [];
  const recorrer = (ruta, rel = '') => {
    let entradas = [];
    try { entradas = readdirSync(ruta, { withFileTypes: true }); } catch { return; }
    for (const entrada of entradas.map((e) => e.name).sort()) {
      const hijo = join(ruta, entrada);
      const relativo = rel === '' ? entrada : `${rel}/${entrada}`;
      let info;
      try { info = lstatSync(hijo); } catch { continue; }
      if (info.isSymbolicLink()) { partes.push(`L ${relativo}`); continue; }
      if (info.isDirectory()) { partes.push(`D ${relativo}`); recorrer(hijo, relativo); continue; }
      try { partes.push(`F ${relativo} ${createHash('sha256').update(readFileSync(hijo)).digest('hex')}`); } catch { partes.push(`X ${relativo}`); }
    }
  };
  recorrer(dir);
  return createHash('sha256').update(partes.join('\n')).digest('hex');
}

// ── 4 · El diario, verificable ──────────────────────────────────────────────────────────────────────

/**
 * La huella de una entrada del diario.
 *
 * Se calcula sobre la entrada **sin** su campo `huella` —el eslabón `huellaAnterior` sí entra—, en JSON con
 * claves ordenadas: así la misma entrada da siempre la misma huella, y editar cualquier campo la cambia.
 */
export function huellaDeEntrada(entrada) {
  // Se cubre **todo** menos la huella: también `huellaAnterior`. Si el eslabón quedara fuera del hash,
  // reescribirlo para recosquear una cadena editada saldría gratis.
  const { huella, ...cuerpo } = entrada ?? {};
  const orden = Object.fromEntries(Object.keys(cuerpo).sort().map((k) => [k, cuerpo[k]]));
  return createHash('sha256').update(JSON.stringify(orden)).digest('hex');
}

/** La huella de la última entrada de una lista (`'0'.repeat(64)` si está vacía: el génesis). */
export function huellaDeLaCola(entradas = []) {
  return entradas.length === 0 ? '0'.repeat(64) : String(entradas[entradas.length - 1]?.huella ?? '');
}

const GENESIS = '0'.repeat(64);

/**
 * Verifica la cadena.
 *
 * Tres cosas distintas se distinguen a propósito, porque significan cosas distintas: una entrada cuyo cuerpo
 * no casa con su huella (alguien la editó), una entrada cuyo `huellaAnterior` no casa con la anterior
 * (alguien borró o insertó), y una entrada sin huella (escrita por una versión anterior a esta capa). Lo
 * tercero no es una rotura: es historia anterior, y se declara como tal.
 */
export function verificarCadena(entradas = []) {
  const roturas = [];
  let anterior = GENESIS;
  let sinHuella = 0;
  entradas.forEach((entrada, i) => {
    const numero = i + 1;
    if (typeof entrada?.huella !== 'string' || entrada.huella === '') { sinHuella += 1; anterior = null; return; }
    if (anterior !== null && entrada.huellaAnterior !== anterior) {
      roturas.push({ numero, rule: 'journal-chain', message: `la entrada ${numero} encadena con «${String(entrada.huellaAnterior).slice(0, 12)}…» y la anterior termina en «${String(anterior).slice(0, 12)}…»: falta o sobra algo` });
    }
    const calculada = huellaDeEntrada(entrada);
    if (calculada !== entrada.huella) {
      roturas.push({ numero, rule: 'journal-tamper', message: `la entrada ${numero} no coincide con su huella: fue editada después de escribirse` });
    }
    anterior = entrada.huella;
  });
  return { ok: roturas.length === 0, roturas, entradas: entradas.length, sinHuella };
}

/** Lee un diario `jsonl` tolerando líneas rotas (una línea ilegible no invalida las demás: se cuenta). */
export function leerDiario(fichero) {
  let texto = '';
  try { texto = readFileSync(fichero, 'utf8'); } catch { return { entradas: [], ilegibles: 0, existe: false }; }
  const entradas = [];
  let ilegibles = 0;
  for (const linea of texto.split('\n')) {
    const limpia = linea.trim();
    if (limpia === '') continue;
    try { entradas.push(JSON.parse(limpia)); } catch { ilegibles += 1; }
  }
  return { entradas, ilegibles, existe: true };
}

/** El texto de un árbol como una ruta relativa, para mensajes. */
export function rutaRelativa(desde, hasta) {
  return relative(desde, hasta).split(sep).join('/');
}
