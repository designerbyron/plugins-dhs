/**
 * localized-commands.mjs - un nombre por operacion, y el idioma que se puede cambiar EN VIVO.
 *
 * -- El problema que resuelve ----------------------------------------------------------------------
 *
 * Los 16 comandos de sesion se registran con nombre ingles y los 15 nombres espanoles entran como
 * **alias obsoletos** con `aliasOf`/`deprecatedIn`. El anfitrion no interpreta esos metadatos (normaliza el
 * descriptor a `{definitionId, name, description, input}`), asi que el menu `/` pinta las dos formas a la vez
 * y la unica salida limpia seria retirar los alias, que es justo lo que el humano usa.
 *
 * La forma que si funciona la da el propio registro: `register()` devuelve un **disposer** y cada alta o
 * baja emite `commands/change`, que es el evento al que esta suscrito el adaptador de UI instalado
 * (`dsh-client-ui-commands`: `ctx.remote.$on("commands/change", ...)` invalida el directorio de comandos y el
 * siguiente `/` lo vuelve a pedir). Por tanto un cambio de idioma no necesita reiniciar: se retira lo que
 * habia con sus disposers y se registra el conjunto del idioma nuevo.
 *
 * -- El mapa es por OPERACION, no por nombre -------------------------------------------------------
 *
 * Cada operacion declara un id interno estable, el nombre slash de cada idioma, la clave de su descripcion y
 * la definicion base de la que **hereda el handler**. El handler es el MISMO objeto para los dos nombres: no
 * hay dos implementaciones que puedan divergir, que es la razon por la que el alias funcionaba.
 *
 * -- Lo que este modulo NO hace --------------------------------------------------------------------
 *
 * No migra los 16 comandos. El mapa trae la operacion `approve` como prueba vertical; el resto sigue en
 * `lib/commands.mjs` tal cual, con sus alias, y el plan de migracion se apoya en el mismo mecanismo.
 */
import { BASE, LANGS, normalizeTag, resolveLang, setLang, t } from './i18n/index.mjs';

/** Gramatica del nombre de comando en el anfitrion (`COMMAND_NAME` de `@deepseek-ai/dsh-commands`). */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u;

/** El comando de ajustes. Mismo nombre en los dos idiomas: no se retira nunca del registro. */
export const LANGUAGE_COMMAND = 'skill-compiler-language';

/**
 * El mapa declarativo. Una entrada por operacion; `source` es la definicion de `lib/commands.mjs` de la que se
 * heredan handler e `input`, y `descriptionKey` la clave del catalogo que da el texto en cada idioma.
 *
 * Anadir una operacion aqui es todo lo que hace falta para que su nombre siga al idioma: no hay una segunda
 * lista de nombres en ningun otro sitio.
 */
export const LOCALIZED_OPERATIONS = Object.freeze([
  Object.freeze({
    id: 'approve',
    definitionId: 'skill-compiler.approve',
    source: 'skill-approve',
    descriptionKey: 'cmd.approve.description',
    names: Object.freeze({ en: 'skill-approve', es: 'skill-aprobar' }),
  }),
]);

const ok = (text, extra = {}) => ({ kind: 'success', text, ...extra });
const bad = (text, extra = {}) => ({ kind: 'error', text, ...extra });

/** Un fallo del modulo se cuenta como texto: es superficie humana y no puede tumbar el arranque. */
const guarded = (run) => (invocation) => {
  try {
    return run(invocation);
  } catch (error) {
    return bad(t('code.internal-error', { message: error.message }), { code: 'internal-error', params: { message: error.message } });
  }
};

/** Los nombres que el conjunto ocupa, en cualquier idioma. Es lo que se omite del registro base. */
export function omitNames(operations = LOCALIZED_OPERATIONS) {
  const nombres = [];
  for (const op of operations) for (const lang of LANGS) nombres.push(op.names[lang]);
  return Object.freeze([...new Set(nombres)]);
}

/**
 * Construye el conjunto localizado a partir de las definiciones base.
 *
 * Se construye **una vez** y de aqui salen los dos idiomas: el handler de una operacion es la misma funcion,
 * asi que cambiar de idioma no puede cambiar el comportamiento. Lanza si el mapa esta mal, porque un mapa roto
 * tiene que verse al arrancar y no cuando alguien cambia de idioma.
 */
export function createLocalizedSet({ definitions, operations = LOCALIZED_OPERATIONS } = {}) {
  const porNombre = new Map((definitions ?? []).map((def) => [def.name, def]));
  const operaciones = [];
  const vistos = new Set();
  for (const op of operations) {
    const base = porNombre.get(op.source);
    if (base === undefined) throw new Error(`operacion "${op.id}": no hay definicion base "${op.source}"`);
    if (typeof op.descriptionKey !== 'string' || op.descriptionKey.trim() === '') throw new Error(`operacion "${op.id}": falta descriptionKey`);
    const porIdioma = {};
    for (const lang of LANGS) {
      const nombre = op.names?.[lang];
      if (typeof nombre !== 'string' || !COMMAND_NAME.test(nombre)) throw new Error(`operacion "${op.id}": nombre invalido para "${lang}"`);
      if (vistos.has(nombre)) throw new Error(`operacion "${op.id}": el nombre "${nombre}" ya lo ocupa otra operacion`);
      vistos.add(nombre);
      porIdioma[lang] = Object.freeze({ name: nombre, description: t(op.descriptionKey, {}, { lang }) });
    }
    operaciones.push(Object.freeze({
      id: op.id,
      definitionId: op.definitionId,
      source: op.source,
      handler: base.handler,
      input: base.input,
      byLang: Object.freeze(porIdioma),
    }));
  }
  const nombresDe = (lang) => operaciones.map((op) => op.byLang[lang].name);
  return Object.freeze({
    operations: Object.freeze(operaciones),
    omitNames: Object.freeze([...vistos]),
    namesFor: (lang) => nombresDe(normalizeTag(lang) ?? BASE),
    /** Definiciones nuevas en cada llamada: `register()` recibe un objeto por alta. */
    definitionsFor(lang) {
      const idioma = normalizeTag(lang) ?? BASE;
      return operaciones.map((op) => {
        const { name, description } = op.byLang[idioma];
        return {
          ...op.definitionId === undefined ? {} : { definitionId: op.definitionId },
          name,
          description,
          ...op.input === undefined ? {} : { input: op.input },
          handler: op.handler,
        };
      });
    },
  });
}

/**
 * Lo que el registro rechazaria, medido ANTES de tocar nada: nombres repetidos o fuera de la gramatica,
 * descripcion vacia, handler que no es funcion, o un nombre que ya ocupa un comando que no es nuestro.
 */
export function problemsOfSet(definitions, { taken = new Set() } = {}) {
  const problemas = [];
  const vistos = new Set();
  for (const def of definitions) {
    if (typeof def?.name !== 'string' || !COMMAND_NAME.test(def.name)) problemas.push(`nombre invalido: ${String(def?.name)}`);
    else if (vistos.has(def.name)) problemas.push(`nombre repetido: ${def.name}`);
    else if (taken.has(def.name)) problemas.push(`nombre ya ocupado por otro comando: ${def.name}`);
    if (typeof def?.description !== 'string' || def.description.trim() === '') problemas.push(`descripcion vacia: ${String(def?.name)}`);
    if (typeof def?.handler !== 'function') problemas.push(`handler invalido: ${String(def?.name)}`);
    if (typeof def?.name === 'string') vistos.add(def.name);
  }
  return problemas;
}

/** Estado del conjunto vivo: que nombres estan puestos y con que disposer se retiran. */
export function createLanguageState() {
  return { lang: null, live: new Map() };
}

/**
 * Pone el conjunto de un idioma: **altas primero, bajas despues**.
 *
 * El orden no es cosmetico. Retirar antes de registrar deja una ventana en la que la operacion no existe en
 * el registro, y el menu `/` la pintaria como ausente; al reves, la ventana muestra las dos formas, que es un
 * estado raro pero nunca una perdida. Si un alta falla se retiran las que si entraron y el conjunto anterior
 * queda intacto: es la unica forma de que un error de registro no deje el menu a medias.
 */
export function swapSet({ registry, state, set, lang, taken = new Set() }) {
  const destino = set.definitionsFor(lang);
  const problemas = problemsOfSet(destino, { taken });
  if (problemas.length > 0) return { ok: false, phase: 'validate', problemas };

  const nombres = new Set(destino.map((def) => def.name));
  const altas = destino.filter((def) => !state.live.has(def.name));
  const bajas = [...state.live.keys()].filter((nombre) => !nombres.has(nombre));

  const puestas = [];
  try {
    for (const def of altas) {
      const dispose = registry.register(def);
      if (typeof dispose !== 'function') throw new Error(`el registro no devolvio un disposer para "${def.name}"`);
      puestas.push([def.name, dispose]);
    }
  } catch (error) {
    for (const [, dispose] of [...puestas].reverse()) {
      try {
        dispose();
      } catch {
        /* ya retirada */
      }
    }
    return { ok: false, phase: 'register', problemas: [error.message] };
  }
  for (const [nombre, dispose] of puestas) state.live.set(nombre, dispose);

  const retiradas = [];
  for (const nombre of bajas) {
    const dispose = state.live.get(nombre);
    state.live.delete(nombre);
    try {
      dispose();
      retiradas.push(nombre);
    } catch (error) {
      return { ok: false, phase: 'dispose', problemas: [`${nombre}: ${error.message}`], retiradas };
    }
  }
  state.lang = normalizeTag(lang) ?? BASE;
  return { ok: true, altas: altas.map((def) => def.name), bajas: retiradas, kept: [...state.live.keys()] };
}

/**
 * Sintaxis del comando estable. Acepta `--en`, `--es` y tambien `en`, `es`.
 *
 * El anfitrion NO valida banderas: `input` solo lleva una pista para el menu y el texto llega entero al
 * handler, asi que `--en` no es una bandera del host sino una palabra del argumento. Se admite tambien la
 * forma sin guiones porque es la que usa el CLI (`lang es`) y dos puertas con la misma verdad no deben
 * discrepar en la ortografia.
 */
export function parseLanguageArg(rawInput) {
  const texto = String(rawInput ?? '').trim();
  if (texto === '') return { kind: 'none' };
  const limpio = texto.replace(/^--?/u, '');
  const normal = normalizeTag(limpio);
  if (normal === null) return { kind: 'invalid', value: texto };
  return { kind: 'lang', lang: normal };
}

/** El estado que el comando estable imprime: idioma vivo, fuente de la resolucion y nombres por idioma. */
export function languageStatusText({ state, set, root, env = process.env.DSH_LANG }) {
  const info = resolveLang({ env, root, fresh: true });
  const lineas = [
    t('code.language-status', { lang: state.lang ?? info.lang, source: info.source }, { lang: state.lang ?? info.lang }),
    t('cmd.language.names', { en: slashNames(set, 'en'), es: slashNames(set, 'es') }, { lang: state.lang ?? info.lang }),
  ];
  if (info.source === 'env') {
    lineas.push(t('cmd.language.imposed', { lang: info.lang }, { lang: state.lang ?? info.lang }));
  }
  lineas.push(t('cmd.language.usage', {}, { lang: state.lang ?? info.lang }));
  return lineas.join('\n');
}

const slashNames = (set, lang) => set.namesFor(lang).map((nombre) => `/${nombre}`).join(',');

/**
 * El cambio de idioma, con la transicion que el registro no garantiza.
 *
 * No hay atomicidad que suponer: el conjunto destino se construye y se valida **entero** antes de tocar el
 * registro, las altas van antes que las bajas, y la configuracion se escribe **solo despues** de que el
 * registro este puesto. Si la persistencia falla se vuelve al conjunto anterior y se dice; si `DSH_LANG`
 * impone el idioma no se escribe nada y el comando no afirma que cambio lo que no cambio.
 */
export function setLanguage({ registry, state, set, taken = new Set(), value, root, env = process.env.DSH_LANG }) {
  const pedido = parseLanguageArg(value);
  if (pedido.kind === 'invalid') {
    return { ok: false, code: 'language-ask', params: { value: pedido.value, supported: LANGS.join(', ') } };
  }
  if (pedido.kind !== 'lang') return { ok: false, code: 'internal-error', params: { message: 'sin idioma que fijar' } };

  const antes = resolveLang({ env, root, fresh: true });
  if (antes.source === 'env') {
    // Precedencia intacta: la variable manda y no se escribe una preferencia que hoy no puede surtir efecto.
    return {
      ok: true,
      changed: false,
      code: 'language-fixed-by-env',
      params: { imposed: antes.lang, requested: pedido.lang },
      lang: state.lang ?? antes.lang,
    };
  }

  const previo = state.lang ?? BASE;
  if (state.lang === pedido.lang) {
    return { ok: true, changed: false, code: 'language-unchanged', params: { lang: pedido.lang }, lang: pedido.lang };
  }

  const destino = set.definitionsFor(pedido.lang);
  const problemas = problemsOfSet(destino, { taken });
  if (problemas.length > 0) {
    return { ok: false, changed: false, code: 'language-name-conflict', params: { lang: pedido.lang, reason: problemas[0] }, lang: previo };
  }

  const puesto = swapSet({ registry, state, set, lang: pedido.lang, taken });
  if (!puesto.ok) {
    return { ok: false, changed: false, code: 'internal-error', params: { message: (puesto.problemas ?? []).join('; ') }, lang: previo };
  }

  const escrito = setLang(pedido.lang, { root });
  if (!escrito.ok) {
    const vuelta = swapSet({ registry, state, set, lang: previo, taken });
    return {
      ok: false,
      changed: false,
      code: 'language-persist-failed',
      params: { lang: pedido.lang, reason: escrito.reason ?? 'write' },
      lang: vuelta.ok ? previo : puesto.lang,
      restored: vuelta.ok,
    };
  }

  const efectivo = resolveLang({ env, root, fresh: true });
  if (efectivo.lang !== pedido.lang) {
    const vuelta = swapSet({ registry, state, set, lang: previo, taken });
    return {
      ok: false,
      changed: false,
      code: 'language-persist-failed',
      params: { lang: pedido.lang, reason: `efectivo:${efectivo.lang}` },
      lang: vuelta.ok ? previo : puesto.lang,
      restored: vuelta.ok,
    };
  }

  return {
    ok: true,
    changed: true,
    code: 'language-set',
    params: { lang: pedido.lang, previous: previo },
    lang: pedido.lang,
    altas: puesto.altas,
    bajas: puesto.bajas,
  };
}

/**
 * La definicion del comando estable, registrada **fuera** del conjunto intercambiable para que este disponible
 * en todo momento: si viviera dentro se retiraria junto con lo que cambia.
 *
 * Su descripcion se compone en el idioma base y no cambia al cambiar de idioma: reescribirla exigiria retirar
 * y volver a registrar el comando, justo lo que no se puede hacer con el unico comando que debe existir
 * siempre. La limitacion esta declarada, no escondida.
 */
export function languageCommandDefinition({ registry, state, set, taken = new Set(), root, env = process.env.DSH_LANG }) {
  return {
    name: LANGUAGE_COMMAND,
    description: t('cmd.language.description', {}, { lang: BASE }),
    input: { hint: '--en|--es' },
    handler: guarded(({ rawInput } = {}) => {
      const pedido = parseLanguageArg(rawInput);
      if (pedido.kind === 'none') {
        return ok(languageStatusText({ state, set, root, env }), { code: 'language-status', params: { lang: state.lang ?? BASE } });
      }
      const resultado = setLanguage({ registry, state, set, taken, value: rawInput, root, env });
      if (resultado.ok === false) {
        const texto = resultado.code === 'internal-error'
          ? t('code.internal-error', resultado.params)
          : t(`code.${resultado.code}`, resultado.params, { lang: state.lang ?? BASE });
        return bad(texto, { code: resultado.code, params: resultado.params });
      }
      const lineas = [t(`code.${resultado.code}`, { ...resultado.params, names: slashNames(set, resultado.lang) }, { lang: resultado.lang })];
      if (resultado.changed) {
        lineas.push(t('cmd.language.names', { en: slashNames(set, 'en'), es: slashNames(set, 'es') }, { lang: resultado.lang }));
      }
      return ok(lineas.join('\n'), { code: resultado.code, params: resultado.params });
    }),
  };
}
