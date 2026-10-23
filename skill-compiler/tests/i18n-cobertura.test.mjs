/**
 * F1.4 · cobertura ES/EN de la SUPERFICIE HUMANA, medida por comando y por CLI.
 *
 * Los grupos 1-5 migraron el texto. Lo que este fichero cierra es la COBERTURA: que no quede un camino sin
 * medir en los dos idiomas. Cinco cosas, todas ejecutando:
 *
 *   1. el idioma base es `en` **sin** `DSH_LANG`, tambien en el binario;
 *   2. los 31 comandos (16 canonicos + 15 alias) devuelven el MISMO `kind`, el MISMO `code` y los MISMOS
 *      `params` en los dos idiomas —el texto es lo unico que cambia—;
 *   3. avisos, errores, lote parcial y preguntas neutras conservan el `code` y la ESTRUCTURA de sus lineas
 *      (los tokens `ok` / `FALLO` son marcador de maquina, no prosa: el panel los parsea);
 *   4. ningun resultado lleva una clave cruda ni un placeholder sin sustituir en ninguno de los dos idiomas;
 *   5. los catalogos estan completos en los dos.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { pending, projectKey, propose } from '../lib/compiler.mjs';
import { clavesFaltantes, resolveLang, resetLangCache } from '../lib/i18n/index.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporativa-f14';
const KEY = projectKey(CWD);
const CLI = join(process.cwd(), 'bin', 'skill-compiler.mjs');
const ROOTS = [];

/** Fija el idioma, ejecuta y deja el entorno como estaba (`null` = sin `DSH_LANG`, el defecto). */
function con(idioma, ejecutar) {
  const previo = process.env.DSH_LANG;
  try {
    if (idioma === null) delete process.env.DSH_LANG;
    else process.env.DSH_LANG = idioma;
    resetLangCache();
    return ejecutar();
  } finally {
    if (previo === undefined) delete process.env.DSH_LANG;
    else process.env.DSH_LANG = previo;
    resetLangCache();
  }
}

const comandos = (root) => new Map(skillCommands({ root }).map((c) => [c.name, c]));
const invocar = (root, nombre, extra = {}) => comandos(root).get(nombre).handler({ ...fakeExec(CWD), ...extra });

function sembrar(over = {}) {
  const s = sandbox();
  const r = propose(goodInput(over), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
  return s;
}

/** Cuerpo grande: la puerta lo acepta con aviso (se paga entero en cada invocacion). */
const CUERPO_LARGO = `${goodInput().body}\n\n## Extra\n\n${'material de consulta. '.repeat(700)}`;

function arena() {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-f14-'));
  ROOTS.push(base);
  const root = join(base, 'skill-compiler');
  mkdirSync(root, { recursive: true });
  return { base, root };
}

function cli(base, args, idioma) {
  const env = { ...process.env, DSH_HOME: base };
  if (idioma === null) delete env.DSH_LANG;
  else env.DSH_LANG = idioma;
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: base, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

after(() => {
  for (const base of ROOTS) rmSync(base, { recursive: true, force: true });
});

describe('F1.4 · el idioma base es ingles, tambien sin DSH_LANG', () => {
  it('sin DSH_LANG el motor y el binario hablan ingles', () => {
    const info = con(null, () => resolveLang({ fresh: true }));
    assert.equal(info.lang, 'en', `idioma resuelto: ${info.lang}`);
    assert.equal(info.source, 'default');
    const s = arena();
    const r = cli(s.base, ['list'], null);
    const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, salida);
    assert.match(salida, /No learned skills yet/, `el listado por defecto no esta en ingles:\n${salida}`);
  });

  it('con DSH_LANG=es el mismo comando del binario contesta en espanol', () => {
    const s = arena();
    const r = cli(s.base, ['list'], 'es');
    const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 0, salida);
    assert.match(salida, /Sin skills aprendidas todavia/, salida);
    assert.doesNotMatch(salida, /No learned skills yet/);
  });
});

describe('F1.4 · los 31 comandos, en los dos idiomas', () => {
  it('mismo kind, mismo code y mismos params: el texto es lo unico que cambia', () => {
    const nombres = [...con(null, () => comandos(sandbox().root).keys())];
    assert.equal(nombres.length, 31, `se esperan 16 canonicos + 15 alias, hay ${nombres.length}`);
    const conProsa = [];
    for (const nombre of nombres) {
      // Cada idioma en SU caja: si algo escribe, escribe en la suya y la comparacion sigue siendo valida.
      const a = sandbox();
      const b = sandbox();
      const entrada = { rawInput: 'id-que-no-existe-jamas' };
      const en = con(null, () => invocar(a.root, nombre, entrada));
      const es = con('es', () => invocar(b.root, nombre, entrada));
      assert.equal(en.kind, es.kind, `${nombre}: kind distinto entre idiomas`);
      assert.equal(typeof en.text, 'string', `${nombre}: sin texto`);
      assert.deepEqual(en.code, es.code, `${nombre}: code distinto entre idiomas`);
      assert.deepEqual(en.params, es.params, `${nombre}: params distintos entre idiomas`);
      if (en.text !== es.text) conProsa.push(nombre);
    }
    // La cobertura que se busca: la mayoria de la superficie tiene prosa propia traducida de verdad. Si un dia
    // se queda en los datos (`skill-pending` devuelve solo ids), este numero lo dice en vez de suponerlo.
    assert.equal(conProsa.length >= 20, true, `solo ${conProsa.length} comandos cambian de texto entre idiomas`);
  });
});

describe('F1.4 · avisos, errores, parciales y preguntas neutras', () => {
  it('un aviso es error con el mismo code en los dos idiomas, y su texto cambia', () => {
    const a = sembrar({ body: CUERPO_LARGO });
    const b = sembrar({ body: CUERPO_LARGO });
    const en = con(null, () => invocar(a.root, 'skill-approve', { rawInput: 'measured-decision-check --local' }));
    const es = con('es', () => invocar(b.root, 'skill-approve', { rawInput: 'measured-decision-check --local' }));
    for (const r of [en, es]) {
      assert.equal(r.kind, 'error');
      assert.equal(r.code, 'with-warnings');
      assert.equal(r.params.id, 'measured-decision-check');
    }
    assert.notEqual(en.text, es.text, 'el aviso no esta traducido');
    // Y el aviso se lee en su idioma: nada de media frase en espanol dentro del ingles.
    assert.match(en.text, /warnings/i);
    assert.match(es.text, /avisos/i);
  });

  it('un lote parcial conserva los marcadores de maquina en los dos idiomas', () => {
    for (const idioma of [null, 'es']) {
      const s = sembrar();
      const r = con(idioma, () => invocar(s.root, 'skill-approve', { rawInput: 'measured-decision-check,no-existe-jamas --local' }));
      assert.equal(r.kind, 'error', `${idioma}: un lote con un fallo es error`);
      const lineas = r.text.split('\n').map((l) => l.trim()).filter(Boolean);
      // Los tokens son del PROTOCOLO (el panel los parsea), no prosa: no se traducen nunca.
      assert.equal(lineas.some((l) => /^ok\s+measured-decision-check/.test(l)), true, `${idioma}: falta la linea ok del id aprobado`);
      assert.equal(lineas.some((l) => /^FALLO\s+no-existe-jamas/.test(l)), true, `${idioma}: falta la linea FALLO del id ausente`);
      assert.equal(pending({ root: s.root, key: KEY }).length, 0, `${idioma}: el bueno del lote no se movio`);
    }
  });

  it('las preguntas siguen siendo neutras: scope-ask y pending-list, en los dos idiomas', () => {
    for (const idioma of [null, 'es']) {
      const s = sembrar();
      const lote = con(idioma, () => invocar(s.root, 'skill-approve', { rawInput: 'measured-decision-check' }));
      assert.equal(lote.code, 'scope-ask', `${idioma}: el lote sin ambito tiene que preguntar`);
      const uno = con(idioma, () => invocar(s.root, 'skill-approve', { rawInput: 'measured-decision-check' }));
      assert.equal(uno.code, 'scope-ask', `${idioma}: el singular sin ambito tambien`);
      const ids = con(idioma, () => invocar(s.root, 'skill-pending'));
      assert.equal(ids.code, 'pending-list', `${idioma}: la linea de ids es neutra`);
      // El listado largo (`/skill-proposals`) no emite `code` a proposito: es una LISTA, no un veredicto,
      // y el panel la pinta por nombre de comando. Se fija aqui para que el dato no cambie sin decidirlo.
      const lista = con(idioma, () => invocar(s.root, 'skill-proposals'));
      assert.equal(lista.kind, 'success', `${idioma}: el listado es correcto`);
      assert.equal(lista.code, undefined, `${idioma}: el listado no es un veredicto y no lleva code`);
    }
  });

  it('un id inseguro es error con el mismo code y el mismo parametro en los dos idiomas', () => {
    const a = sandbox();
    const b = sandbox();
    const en = con(null, () => invocar(a.root, 'skill-reject', { rawInput: '../fuera' }));
    const es = con('es', () => invocar(b.root, 'skill-reject', { rawInput: '../fuera' }));
    for (const r of [en, es]) {
      assert.equal(r.kind, 'error');
      assert.equal(r.code, 'unsafe-id');
      assert.equal(r.params.id, '../fuera');
      assert.equal(typeof r.params.motivo, 'string');
      assert.equal(r.params.motivo.length > 0, true);
    }
  });
});

describe('F1.4 · nada de claves crudas ni de placeholders sin sustituir', () => {
  it('ningun resultado de los 31 comandos, en ninguno de los dos idiomas', () => {
    const nombres = [...con(null, () => comandos(sandbox().root).keys())];
    const sospechosos = [];
    for (const idioma of [null, 'es']) {
      for (const nombre of nombres) {
        const s = sandbox();
        for (const entrada of [{}, { rawInput: 'id-que-no-existe-jamas' }]) {
          const r = con(idioma, () => invocar(s.root, nombre, entrada));
          const texto = String(r.text ?? '');
          // Clave cruda: el catalogo empieza por uno de estos prefijos y lleva puntos.
          if (/\b(?:cmd|cli|code|scope|lang|id|auto|repair|audit|pending|batch)\.[a-z][\w.-]*/.test(texto)) sospechosos.push(`${idioma ?? 'base'}/${nombre}: clave cruda`);
          // Placeholder sin sustituir con forma de parametro del catalogo.
          const hueco = /\{(?:id|key|n|ids|done|failed|scope|retirada|nuevo|motivo|umbral|observado|regla|message|error|path|que|cerca|aviso|max|fallan|lang|source|value|supported|version|nombre|bytes|purpose|title)\}/.exec(texto);
          if (hueco !== null) sospechosos.push(`${idioma ?? 'base'}/${nombre}: placeholder ${hueco[0]}`);
        }
      }
    }
    assert.deepEqual(sospechosos, []);
  });

  it('los catalogos estan completos en los dos idiomas', () => {
    assert.deepEqual(clavesFaltantes('en'), []);
    assert.deepEqual(clavesFaltantes('es'), []);
  });
});
