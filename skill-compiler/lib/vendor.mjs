/**
 * vendor.mjs — vendorizar una skill externa como **nuestra versión** de este proyecto.
 *
 * La necesidad: pegar el enlace de un repositorio y quedarse con una skill que funcione aquí, sin
 * instalar nada del upstream y sin perder el hilo con el origen.
 *
 * Lo que esto NO es, y es la decisión que gobierna todo el módulo: **no es un instalador**. No clona,
 * no ejecuta, no copia código, y no activa nada. Descarga texto, lo guarda verbatim como prueba, y
 * produce una versión adaptada que pasa por la misma puerta humana que cualquier otra propuesta.
 *
 * Tres reglas de confianza, porque el contenido de un repositorio ajeno se convierte en guía que el
 * modelo lee:
 *
 *   1. **El original se guarda, no se interpreta.** Copia verbatim en `upstream/`, con su SHA-256. Sin
 *      ella no se puede demostrar qué se tomó ni detectar que el origen cambió después.
 *   2. **Secretos e inyección BLOQUEAN, no avisan.** Un aviso se ignora; y guardar verbatim un fichero
 *      con una credencial filtrada crearía otra copia de esa credencial. Ante eso no se escribe nada.
 *   3. **Solo markdown.** Ni binarios, ni scripts, ni ejecutables del upstream: se listan como omitidos.
 *      Que una skill pueda llevar scripts no significa que este camino deba traerlos de internet.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { defaultRoot, parseFrontmatter, projectKey, propose } from './compiler.mjs';
import { textoDeCodigo } from './i18n/index.mjs';

/**
 * Un mensaje humano de este modulo: su texto -el DATO, tal y como se escribio- y su representacion (`code` +
 * `params`). Las dos cosas viajan juntas porque el texto es lo que ya leen la CLI, el modelo y las pruebas, y el
 * codigo es lo que permite decirlo en el idioma de la sesion sin inventar una segunda redaccion.
 *
 * El texto NO se traduce aqui: se traduce al pintarlo (CLI y pagina), con `textoDeCodigo`.
 */
const mensaje = (code, params, text) => ({ code, params: params ?? {}, text });
const textosDe = (lista) => lista.map((m) => m.text);
const codigosDe = (lista) => lista.map((m) => ({ code: m.code, params: m.params ?? {} }));

/** La etiqueta de un hallazgo, en el idioma de la sesion: `shape.*` con reserva al dato crudo. */
export function etiquetaDeHallazgo(hallazgo, opciones = {}) {
  return textoDeCodigo(
    typeof hallazgo?.labelCode === 'string' ? `shape.${hallazgo.labelCode}` : null,
    {},
    hallazgo?.label,
    opciones,
  );
}

/** Un SKILL.md de más de esto no es una skill: es otra cosa. */
export const MAX_BYTES = 512 * 1024;
export const DEFAULT_TIMEOUT_MS = 15000;
/** Cuántas referencias markdown del upstream se traen, como máximo. */
export const MAX_REFERENCES = 10;

// ── análisis del enlace ──────────────────────────────────────────────────────────────────────────

/**
 * Traduce un enlace a un plan de descarga. Solo `https`: el contenido va a convertirse en guía que el
 * modelo lee, y un `http` permitiría que un tercero lo cambie por el camino.
 *
 * Un fallo devuelve el texto (`reason`) y su codigo (`reasonCode` + `reasonParams`): el texto es el dato que ya
 * leian los consumidores y el codigo es lo que la CLI compone en el idioma de la sesion.
 */
export function parseSource(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl ?? '').trim());
  } catch {
    return { ok: false, reason: 'no es una URL válida', reasonCode: 'vendor.url.invalid', reasonParams: {} };
  }
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: `solo se aceptan enlaces https (llegó ${url.protocol})`,
      reasonCode: 'vendor.url.https-only',
      reasonParams: { protocol: url.protocol },
    };
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ref, ...rest] = parts;
    if (!owner || !repo || !ref || rest.length === 0) return { ok: false, reason: 'enlace raw de GitHub incompleto', reasonCode: 'vendor.url.raw-incomplete', reasonParams: {} };
    return { ok: true, kind: 'file', owner, repo, ref, path: rest.join('/'), rawUrl: url.href, source: url.href };
  }

  if (host === 'github.com') {
    const [owner, repo, mode, ref, ...rest] = parts;
    if (!owner || !repo) return { ok: false, reason: 'enlace de GitHub sin repositorio', reasonCode: 'vendor.url.no-repo', reasonParams: {} };
    if (mode === 'blob' && ref) {
      return { ok: true, kind: 'file', owner, repo, ref, path: rest.join('/'), rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join('/')}`, source: url.href };
    }
    if (mode === 'tree' && ref) {
      return { ok: true, kind: 'dir', owner, repo, ref, path: rest.join('/'), apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents/${rest.join('/')}?ref=${encodeURIComponent(ref)}`, source: url.href };
    }
    if (mode === undefined) {
      return { ok: true, kind: 'dir', owner, repo, ref: null, path: '', apiUrl: `https://api.github.com/repos/${owner}/${repo}/contents/`, source: url.href };
    }
    return {
      ok: false,
      reason: `enlace de GitHub no reconocido (¿«${mode}»?). Usa blob/, tree/ o la raíz del repositorio`,
      reasonCode: 'vendor.url.mode-unknown',
      reasonParams: { mode },
    };
  }

  if (host === 'api.github.com') {
    const match = /^\/repos\/([^/]+)\/([^/]+)\/contents\/?(.*)$/.exec(url.pathname);
    if (!match) return { ok: false, reason: 'enlace de la API de GitHub no reconocido', reasonCode: 'vendor.url.api-unrecognized', reasonParams: {} };
    const [, owner, repo, rest] = match;
    return { ok: true, kind: 'dir', owner, repo, ref: url.searchParams.get('ref'), path: decodeURIComponent(rest), apiUrl: url.href, source: url.href };
  }

  if (/\.(md|markdown)$/i.test(url.pathname)) {
    return { ok: true, kind: 'file', rawUrl: url.href, path: parts[parts.length - 1], source: url.href };
  }

  return {
    ok: false,
    reason: 'no sé leer este enlace: acepto un fichero .md, un blob/tree de GitHub o la raíz de un repositorio',
    reasonCode: 'vendor.url.unreadable',
    reasonParams: {},
  };
}

// ── descarga ─────────────────────────────────────────────────────────────────────────────────────

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function getText(url, { fetchImpl, signal, timeoutMs }) {
  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout de ${timeoutMs} ms`)), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await doFetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/plain, application/json;q=0.9, */*;q=0.1', 'user-agent': 'skill-compiler (DSH)' },
    });
    if (!response.ok) {
      const rate = response.status === 403 || response.status === 429;
      return {
        ok: false,
        reason: `HTTP ${response.status}${rate ? ' (¿límite de peticiones de GitHub? sin autenticar son 60/hora)' : ''}`,
        reasonCode: rate ? 'vendor.fetch.rate' : 'vendor.fetch.http',
        reasonParams: { status: response.status },
      };
    }
    const length = Number(response.headers?.get?.('content-length') ?? 0);
    if (length > MAX_BYTES) {
      return { ok: false, reason: `demasiado grande (${length} B > ${MAX_BYTES} B)`, reasonCode: 'vendor.fetch.too-big', reasonParams: { bytes: length, max: MAX_BYTES } };
    }
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_BYTES) {
      return { ok: false, reason: `demasiado grande (${bytes} B > ${MAX_BYTES} B)`, reasonCode: 'vendor.fetch.too-big', reasonParams: { bytes, max: MAX_BYTES } };
    }
    return { ok: true, text };
  } catch (error) {
    const texto = error?.message ?? String(error);
    return { ok: false, reason: texto, reasonCode: 'vendor.fetch.error', reasonParams: { message: texto } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/**
 * Trae las fuentes del enlace: el `SKILL.md` principal y, hasta `MAX_REFERENCES`, sus `references/*.md`.
 * Si el enlace apunta a una carpeta que contiene varias skills, devuelve `needs-choice` con los nombres
 * en vez de traerse el repositorio entero: elegir es del humano, no de la herramienta.
 */
export async function fetchSource(source, { fetchImpl, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  /** Lo que se devuelve cuando algo del origen no se pudo traer: el texto y su codigo, juntos. */
  const fallo = (status, motivo, url, extra = {}) => ({
    ok: false,
    status,
    reason: motivo?.text ?? motivo?.reason ?? '',
    reasonCode: motivo?.code ?? motivo?.reasonCode ?? null,
    reasonParams: motivo?.params ?? motivo?.reasonParams ?? {},
    url,
    ...extra,
  });

  if (source.kind === 'file') {
    const got = await getText(source.rawUrl, { fetchImpl, signal, timeoutMs });
    if (!got.ok) return fallo('fetch-failed', got, source.rawUrl);
    const name = source.path ? basename(source.path) : 'SKILL.md';
    return {
      ok: true,
      kind: 'skill',
      ref: source.ref ?? null,
      files: [{ path: name, text: got.text, bytes: Buffer.byteLength(got.text, 'utf8'), sha256: sha(got.text) }],
      skipped: [],
      primarySha256: sha(got.text),
    };
  }

  // Carpeta: primero se pregunta qué hay dentro.
  const listing = await getText(source.apiUrl, { fetchImpl, signal, timeoutMs });
  if (!listing.ok) return fallo('fetch-failed', listing, source.apiUrl);

  let entries;
  try {
    entries = JSON.parse(listing.text);
  } catch {
    return fallo('fetch-failed', mensaje('vendor.fetch.listing-not-json', {}, 'la respuesta del listado no es JSON (¿el enlace apunta a un fichero?)'), source.apiUrl);
  }
  if (!Array.isArray(entries)) {
    return fallo('fetch-failed', mensaje('vendor.fetch.not-a-folder', {}, 'ese enlace apunta a un fichero, no a una carpeta'), source.apiUrl);
  }

  const files = entries.filter((e) => e.type === 'file');
  const dirs = entries.filter((e) => e.type === 'dir').map((e) => e.name);
  const main = files.find((e) => /^skill\.md$/i.test(e.name));

  if (!main) {
    const elegir = dirs.length > 0
      ? mensaje('vendor.fetch.pick-subfolder', { dirs: dirs.slice(0, 12).join(', ') }, `apunta a una de estas subcarpetas: ${dirs.slice(0, 12).join(', ')}`)
      : mensaje('vendor.fetch.no-usable-subfolders', {}, 'esa carpeta no tiene subcarpetas utilizables');
    return {
      ok: false,
      status: 'needs-choice',
      dirs,
      reason: 'esa carpeta no contiene un SKILL.md directamente',
      reasonCode: 'vendor.fetch.no-skill-md',
      reasonParams: {},
      hint: elegir.text,
      hintCode: elegir.code,
      hintParams: elegir.params,
    };
  }

  const ref = source.ref ?? null;
  const primary = await getText(main.download_url ?? `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${ref ?? 'HEAD'}/${source.path ? source.path + '/' : ''}${main.name}`, { fetchImpl, signal, timeoutMs });
  if (!primary.ok) return fallo('fetch-failed', primary, main.download_url);

  const collected = [{ path: main.name, text: primary.text, bytes: Buffer.byteLength(primary.text, 'utf8'), sha256: sha(primary.text) }];
  // Lo que se deja fuera se declara, ficheros Y carpetas: `scripts/` es justo lo que NO se vendoriza.
  const skipped = [
    ...files.filter((e) => e !== main).map((e) => e.name),
    ...dirs.filter((name) => name !== 'references').map((name) => `${name}/`),
  ];

  // Referencias markdown, acotadas: lo demás se declara omitido.
  const refDir = dirs.includes('references')
    ? await getText(`https://api.github.com/repos/${source.owner}/${source.repo}/contents/${source.path ? source.path + '/' : ''}references${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, { fetchImpl, signal, timeoutMs })
    : { ok: false };
  if (refDir.ok) {
    try {
      const refEntries = JSON.parse(refDir.text).filter((e) => e.type === 'file' && /\.(md|markdown)$/i.test(e.name)).slice(0, MAX_REFERENCES);
      for (const entry of refEntries) {
        const got = await getText(entry.download_url, { fetchImpl, signal, timeoutMs });
        if (got.ok) collected.push({ path: `references/${entry.name}`, text: got.text, bytes: Buffer.byteLength(got.text, 'utf8'), sha256: sha(got.text) });
        else skipped.push(`references/${entry.name}`);
      }
    } catch { skipped.push('references/ (listado ilegible)'); }
  }

  return { ok: true, kind: 'skill', ref, files: collected, skipped, primarySha256: collected[0].sha256 };
}

// ── análisis del contenido ajeno ─────────────────────────────────────────────────────────────────

/**
 * Órdenes incrustadas: contenido ajeno que intenta gobernar al agente que lo lee.
 *
 * Cada forma lleva `[regex, etiqueta, codigo]`: la etiqueta es el DATO que ya viajaba en el hallazgo (`label`) y
 * el codigo elige la frase del catalogo (`shape.*`), para que la CLI lo diga en el idioma de la sesion.
 */
const INJECTION_SHAPES = [
  [/\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i, 'orden de ignorar las instrucciones anteriores', 'ignore-previous'],
  [/\b(disregard|forget)\s+(all\s+)?(previous|prior|the)\s+(instructions?|rules?)/i, 'orden de descartar las reglas', 'discard-rules'],
  [/\b(do\s+not|don'?t)\s+(tell|inform|mention|reveal|report)\b[^.\n]{0,30}\b(user|operator|human)\b/i, 'orden de ocultar algo al usuario', 'hide-from-user'],
  [/\byou\s+(must|should)\s+not\s+(tell|inform|mention|reveal)\b/i, 'orden de no informar', 'do-not-inform'],
  [/\b(exfiltrat\w*|leak|upload|send)\b[^\n]{0,40}(\.env|credential|secret|token|api[_-]?key|ssh)/i, 'petición de exfiltración', 'exfiltration'],
  [/\bcurl\b[^\n]{0,80}\|\s*(ba|z)?sh\b/i, 'tubería a un intérprete de shell', 'curl-pipe-shell'],
  [/\brm\s+-rf\s+[~/]/i, 'borrado destructivo', 'destructive-delete'],
  [/\bsudo\b/i, 'escalada de privilegios', 'privilege-escalation'],
  [/\b(print|show|dump|echo)\b[^\n]{0,40}\b(env|environment)\b[^\n]{0,20}\b(secret|token|key)/i, 'petición de volcar el entorno', 'dump-environment'],
];
/** Caracteres invisibles: vector de contrabando de texto. */
const HIDDEN_UNICODE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
/** Mismas formas que vetamos en una propuesta propia; aquí además impiden guardar el original. */
const SECRET_SHAPES = [
  [/sk-[A-Za-z0-9]{16,}/, 'clave con forma sk-', 'sk-key'],
  [/ghp_[A-Za-z0-9]{20,}/, 'token de GitHub', 'github-token'],
  [/eyJ[A-Za-z0-9_-]{10,}/, 'JWT', 'jwt'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada PEM', 'pem-private-key'],
  [/\b(password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*\S{6,}/i, 'asignación de credencial', 'credential-assignment'],
  [/\bBearer\s+\S{12,}/, 'cabecera Bearer', 'bearer-header'],
];
const PERSONAL_PATH_SHAPES = [
  [/[A-Za-z]:\\Users\\[^\\\s"']+/i, 'ruta de perfil de Windows', 'windows-profile'],
  [/\/(?:home|Users)\/[^/\s"']+\//, 'ruta de perfil POSIX', 'posix-profile'],
];

/**
 * Lo que se le escapa a un `redact` normal: los caracteres invisibles, que hay que NOMBRAR porque al
 * imprimirlos no se ven. Sin esto, el aviso sería invisible igual que el problema.
 */
function safeSnippet(line) {
  return line
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '⟦oculto⟧')
    .replace(/\b(sk-[A-Za-z0-9]{6,}|ghp_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{6,}|Bearer\s+\S{6,})/g, '[REDACTADO]')
    .replace(/\b(password|passwd|secret|api[_-]?key|token)\b(\s*[:=]\s*)\S{6,}/gi, '$1$2[REDACTADO]')
    .slice(0, 200);
}

/** Analiza el contenido descargado. `block` impide escribir nada; `findings` explica por qué. */
export function scanUpstream(files) {
  const secrets = [];
  const injection = [];
  const personalPaths = [];
  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const anota = (lista, [re, label, labelCode]) => {
        if (re.test(line)) lista.push({ file: file.path, line: index + 1, label, labelCode, snippet: safeSnippet(line) });
      };
      for (const forma of SECRET_SHAPES) anota(secrets, forma);
      for (const forma of INJECTION_SHAPES) anota(injection, forma);
      for (const forma of PERSONAL_PATH_SHAPES) anota(personalPaths, forma);
      if (HIDDEN_UNICODE.test(line)) {
        injection.push({
          file: file.path,
          line: index + 1,
          label: 'caracteres invisibles (contrabando de texto)',
          labelCode: 'invisible-chars',
          snippet: safeSnippet(line),
        });
      }
    });
  }
  return {
    secrets,
    injection,
    personalPaths,
    blocked: secrets.length > 0 || injection.length > 0,
    // El motivo es DATO (lo que ya leia el consumidor) y `blockReasonCode` su representacion en el catalogo.
    blockReason: secrets.length ? 'contiene lo que parece una credencial' : injection.length ? 'contiene órdenes dirigidas al agente o texto invisible' : null,
    blockReasonCode: secrets.length ? 'vendor.block.secrets' : injection.length ? 'vendor.block.injection' : null,
  };
}

// ── adaptación a nuestra versión ─────────────────────────────────────────────────────────────────

const kebab = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

/** Corta una descripción larga en un límite legible: es lo que el modelo lee para elegir. */
function clampDescription(text) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (one.length <= 300) return one;
  const cut = one.slice(0, 297);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '));
  return `${(at > 120 ? cut.slice(0, at) : cut).trim()}…`;
}

/**
 * Construye nuestra versión: frontmatter del contrato DSH, cuerpo del upstream adaptado, y la lista de
 * lo que se cambió. Nunca ejecuta: solo texto.
 */
export function adaptUpstream(primary, { source, files, skipped = [], now, id, description, whenToUse, localNote = '' } = {}) {
  const { data, body } = parseFrontmatter(primary.text);
  // Cada aviso es `{ code, params, text }`: el texto es el DATO (lo que ya se leia) y el codigo permite decirlo
  // en el idioma de la sesion al pintarlo (`vendor.warn.*`). `vendor()` publica el texto; los codigos viajan en
  // `provenance.json`, que es donde se audita de donde salio cada adaptacion.
  const warnings = [];

  const upstreamName = kebab(data.name ?? source.path ?? basename(source.rawUrl ?? ''));
  const finalId = kebab(id ?? upstreamName);
  if (finalId.length < 3) warnings.push(mensaje('vendor.warn.short-id', {}, 'el id deducido del origen es demasiado corto: pásalo explícitamente'));

  let finalDescription = clampDescription(description ?? data.description ?? '');
  if (!finalDescription) {
    const firstParagraph = body.split(/\n{2,}/).map((p) => p.replace(/^#+.*$/m, '').trim()).find((p) => p.length > 20) ?? '';
    finalDescription = clampDescription(firstParagraph);
    if (finalDescription) warnings.push(mensaje('vendor.warn.derived-description', {}, 'el origen no traía descripción: se dedujo del primer párrafo. Revísala, es lo que el modelo lee para elegir.'));
  }
  if (description === undefined && data.description && String(data.description).length > 300) {
    warnings.push(mensaje('vendor.warn.description-truncated', {}, 'la descripción del origen superaba los 300 caracteres y se recortó'));
  }

  // El `whenToUse` es obligatorio en el contrato de nuestro compilador, y un origen externo puede no
  // traerlo. Se **deriva** de la descripción —que es la frase que dice qué hace y cuándo— y se avisa,
  // igual que con la descripción deducida: inventar un disparador en silencio sería peor que su ausencia,
  // y vetar el origen por un campo que el formato ajeno no usa sería romper una capacidad por rigidez.
  let finalWhenToUse = String(whenToUse ?? data.whenToUse ?? '').replace(/\s+/g, ' ').trim();
  if (finalWhenToUse.length < 20) {
    const derivado = finalDescription.length >= 20 ? finalDescription : '';
    if (derivado) {
      finalWhenToUse = derivado;
      warnings.push(mensaje('vendor.warn.derived-when-to-use', {}, 'el origen no traía whenToUse: se dedujo de la descripción. Revísalo, es el campo con el que se elige la skill.'));
    } else {
      finalWhenToUse = 'Cuando el trabajo encaje con lo que describe esta skill.';
      warnings.push(mensaje('vendor.warn.generic-when-to-use', {}, 'el origen no traía ni descripción ni whenToUse: se puso un disparador genérico. Reescríbelo antes de aprobarla.'));
    }
  }

  // El título de nivel 1 lo compone `renderSkill` a partir de la descripción: dos serían dos.
  let adapted = body.replace(/^\s*#\s+.*\r?\n/, '').trimStart();

  // Las referencias se guardan bajo `upstream/`, así que los enlaces relativos se reescriben para que
  // sigan resolviendo y para que se vea de un vistazo qué es nuestro y qué es del origen. El lookbehind
  // evita reescribir dos veces una ruta ya adaptada y no depende del carácter que preceda (comillas
  // invertidas incluidas, que es como se escribe una ruta en markdown).
  let rewrites = 0;
  adapted = adapted.replace(/(?<!upstream\/)references\//g, () => { rewrites++; return 'upstream/references/'; });
  if (rewrites) warnings.push(mensaje('vendor.warn.references-rewritten', { n: rewrites }, `referencias relativas reescritas a \`upstream/references/\`: ${rewrites}`));

  if (skipped.length) {
    const lista = `${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? '…' : ''}`;
    warnings.push(mensaje('vendor.warn.skipped', { list: lista }, `omitidos del origen (solo se vendoriza markdown): ${lista}`));
  }

  return {
    id: finalId,
    description: finalDescription,
    whenToUse: finalWhenToUse,
    body: adapted,
    warnings,
    upstreamName,
    upstreamDeclaredName: data.name ?? null,
    localNote,
  };
}

// ── la operación completa ────────────────────────────────────────────────────────────────────────

/**
 * Vendoriza: descarga, analiza, adapta y **propone**. No activa nada.
 *
 * No hay parámetro para saltarse un bloqueo, y es deliberado: el modelo no debe poder desactivar la
 * puerta que existe para vigilar contenido ajeno. Saltarla es un acto humano por CLI.
 */
export async function vendor(input, { root = defaultRoot(), cwd, fetchImpl, signal, timeoutMs = DEFAULT_TIMEOUT_MS, now = new Date().toISOString(), curated } = {}) {
  const source = parseSource(input?.url);
  if (!source.ok) {
    const motivo = mensaje(source.reasonCode, source.reasonParams, source.reason);
    return { status: 'bad-url', errors: textosDe([motivo]), errorCodes: codigosDe([motivo]), reasons: [motivo] };
  }
  if (projectKey(cwd) === null) {
    const motivo = mensaje('vendor.no-project', {}, 'sin cwd no hay proyecto, y sin proyecto no hay versión local que crear');
    return { status: 'no-project', errors: textosDe([motivo]), errorCodes: codigosDe([motivo]), reasons: [motivo] };
  }

  const fetched = await fetchSource(source, { fetchImpl, signal, timeoutMs });
  if (!fetched.ok) {
    // El motivo y, si lo hay, la pista de que hacer: dos mensajes, cada uno con su codigo.
    const motivos = [
      mensaje(fetched.reasonCode, fetched.reasonParams, fetched.reason),
      ...(fetched.hint ? [mensaje(fetched.hintCode, fetched.hintParams, fetched.hint)] : []),
    ];
    return { status: fetched.status, errors: textosDe(motivos), errorCodes: codigosDe(motivos), reasons: motivos, dirs: fetched.dirs ?? [] };
  }

  const scan = scanUpstream(fetched.files);
  if (scan.blocked) {
    const motivo = mensaje(scan.blockReasonCode, {}, scan.blockReason);
    return {
      status: 'blocked',
      errors: textosDe([motivo]),
      errorCodes: codigosDe([motivo]),
      reasons: [motivo],
      scan: { secrets: scan.secrets.length, injection: scan.injection.length, personalPaths: scan.personalPaths.length },
      findings: [...scan.secrets, ...scan.injection].slice(0, 12),
      upstream: { url: source.source, ref: fetched.ref, sha256: fetched.primarySha256 },
    };
  }

  const adapted = adaptUpstream(fetched.files[0], {
    source, files: fetched.files, skipped: fetched.skipped, now,
    id: input.id, description: input.description, whenToUse: input.whenToUse, localNote: input.localNote,
  });

  const upstream = { url: source.source, ref: fetched.ref, sha256: fetched.primarySha256, fetchedAt: now, files: fetched.files.length };
  const provenance = {
    what: 'Versión local de una skill externa. El original se guarda verbatim; esta copia está adaptada.',
    source: { url: source.source, kind: source.kind, owner: source.owner ?? null, repo: source.repo ?? null, ref: fetched.ref, path: source.path ?? null },
    fetchedAt: now,
    upstream: { primary: fetched.files[0].path, sha256: fetched.primarySha256, bytes: fetched.files[0].bytes, files: fetched.files.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })) },
    skipped: fetched.skipped,
    scan: { secrets: 0, injection: 0, personalPaths: scan.personalPaths.length },
    adaptation: {
      originalName: adapted.upstreamDeclaredName,
      localId: adapted.id,
      descriptionRewritten: adapted.upstreamDeclaredName === null ? 'deducida' : 'del origen',
      localNote: adapted.localNote || null,
      // Los avisos se guardan con su codigo: el registro de la adaptacion dice QUE se aviso, no solo como se dijo.
      warnings: adapted.warnings,
    },
    license: input.license ?? null,
    licenseNote: input.license ? null : 'el origen no declara licencia: comprueba los términos antes de reutilizarlo',
  };

  const result = propose(
    {
      id: adapted.id,
      description: adapted.description,
      whenToUse: adapted.whenToUse,
      body: adapted.body,
      tags: input.tags,
      project: input.project,
      upstream,
      localNote: adapted.localNote,
    },
    {
      root, cwd, now, ...(curated === undefined ? {} : { curated }),
      extraFiles: {
        'provenance.json': `${JSON.stringify(provenance, null, 2)}\n`,
        [`upstream/${fetched.files[0].path}`]: fetched.files[0].text,
        ...Object.fromEntries(fetched.files.slice(1).map((f) => [`upstream/${f.path}`, f.text])),
      },
      metaExtra: { kind: 'vendored', upstream, scan: provenance.scan, skipped: fetched.skipped },
    },
  );

  return {
    ...result,
    // `warnings` sigue siendo la lista de textos que ya leian la CLI y el modelo; `warningCodes` lleva, al lado y
    // en el mismo orden, la representacion de cada aviso (`null` en los que vienen del motor, que no la traen).
    warnings: [...(result.warnings ?? []), ...textosDe(adapted.warnings)],
    warningCodes: [
      ...(result.warnings ?? []).map(() => null),
      ...adapted.warnings.map((w) => ({ code: w.code, params: w.params ?? {} })),
    ],
    provenance,
    upstream,
  };
}

// ── ¿se movió el origen? ─────────────────────────────────────────────────────────────────────────

/** Procedencia guardada de una skill vendorizada, en el estado donde esté. */
export function readProvenance(id, key, { root = defaultRoot() } = {}) {
  for (const state of ['proposed', 'approved', 'rejected', 'superseded']) {
    const file = join(root, 'projects', key, state, id, 'provenance.json');
    if (existsSync(file)) {
      try { return { ...JSON.parse(readFileSync(file, 'utf8')), state, file }; } catch { return null; }
    }
  }
  return null;
}

/**
 * Re-descarga el origen y compara con lo guardado. **No toca nuestra versión**: está adaptada a
 * propósito, y sobrescribirla con lo que publique el upstream destruiría justo lo que la hace útil.
 * Devuelve el hecho, para que decidir sea humano.
 */
export async function upstreamStatus(id, key, { root = defaultRoot(), fetchImpl, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const provenance = readProvenance(id, key, { root });
  if (!provenance) {
    const motivo = mensaje('vendor.upstream.not-vendored', { id }, `${id} no tiene procedencia de origen`);
    return { status: 'not-vendored', errors: textosDe([motivo]), errorCodes: codigosDe([motivo]) };
  }

  const source = parseSource(provenance.source.url);
  if (!source.ok) {
    const motivo = mensaje(source.reasonCode, source.reasonParams, source.reason);
    return { status: 'bad-url', errors: textosDe([motivo]), errorCodes: codigosDe([motivo]) };
  }

  const fetched = await fetchSource(source, { fetchImpl, signal, timeoutMs });
  if (!fetched.ok) {
    const motivo = mensaje(fetched.reasonCode, fetched.reasonParams, fetched.reason);
    return { status: fetched.status, errors: textosDe([motivo]), errorCodes: codigosDe([motivo]) };
  }

  const stored = provenance.upstream?.sha256;
  const current = fetched.primarySha256;
  return {
    status: 'checked',
    id,
    url: provenance.source.url,
    ref: provenance.ref ?? provenance.source.ref,
    fetchedAt: provenance.fetchedAt,
    storedSha256: stored,
    upstreamSha256: current,
    changed: stored !== current,
    storedBytes: provenance.upstream?.bytes ?? null,
    upstreamBytes: fetched.files[0]?.bytes ?? null,
  };
}
