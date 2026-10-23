#!/usr/bin/env node
/**
 * Vertical por idioma contra el REGISTRO REAL del harness instalado.
 *
 * No hay doble de registro: se levanta un `Context` de `@deepseek-ai/cordis` del build instalado, se monta el
 * plugin de comandos del anfitrion, se registran las 16 operaciones reales del plugin con sus handlers reales, y
 * se invocan por `registry.execute()` — la ruta que usa el humano: parsea la linea, escribe `command/run` y
 * `command/done`, y devuelve el resultado RECORTADO a `{kind,text}`. Lo unico simulado es el `agent` (una sesion
 * con `append` en memoria), porque no hay harness vivo en este proceso.
 *
 * Uso:
 *
 *   node scripts/vertical-idioma-real.mjs <dir-de-node_modules-del-build>
 *
 * `<dir>` es la carpeta `dsh/node_modules` extraida del `app.asar` del harness con `scripts/asar-read.py` (ver
 * `docs/ANFITRION.md`). Tambien se acepta la variable `DSH_MODULES`. No lo corre `npm test`: necesita el build
 * instalado, y la suite no depende de la maquina.
 *
 * Sale 0 si todas las medidas son las esperadas; 1 con el detalle si alguna no lo es.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAQUETE = dirname(AQUI);
const MODULOS = process.argv[2] ?? process.env.DSH_MODULES;
if (typeof MODULOS !== 'string' || MODULOS.trim() === '') {
  process.stderr.write('falta la carpeta node_modules del build instalado: node scripts/vertical-idioma-real.mjs <dir> (o DSH_MODULES)\n');
  process.exit(2);
}

const { Context } = await import(`file://${MODULOS.replace(/\\/g, '/')}/@deepseek-ai/cordis/lib/index.js`);
const Commands = (await import(`file://${MODULOS.replace(/\\/g, '/')}/@deepseek-ai/dsh-commands/lib/index.js`)).default;
const { skillCommands } = await import(`file://${join(PAQUETE, 'lib/commands.mjs').replace(/\\/g, '/')}`);
const { createLocalizedSet, createLanguageState, swapSet, setLanguage } = await import(`file://${join(PAQUETE, 'lib/localized-commands.mjs').replace(/\\/g, '/')}`);
const { propose } = await import(`file://${join(PAQUETE, 'lib/compiler.mjs').replace(/\\/g, '/')}`);
const { goodInput } = await import(`file://${join(PAQUETE, 'tests/helpers.mjs').replace(/\\/g, '/')}`);

const OPERACIONES = 16;
const CWD = 'C:\\vertical\\idioma-real';
const base = mkdtempSync(join(tmpdir(), 'vertical-idioma-'));
const root = join(base, 'skill-compiler');
const curated = join(base, 'skills');
mkdirSync(root, { recursive: true });
mkdirSync(curated, { recursive: true });
process.env.DSH_HOME = base;

const medidas = [];
const mide = (paso, datos) => {
  medidas.push({ paso, ...datos });
  process.stdout.write(`${JSON.stringify({ paso, ...datos })}\n`);
};

try {
  // Una propuesta real en la arena: la vertical aprueba de verdad, y eso deja estado en disco.
  const sembrada = propose(goodInput({ id: 'vertical-en' }), { root, curated, cwd: CWD });
  assert.equal(sembrada.status, 'proposed', `no se sembro la propuesta: ${JSON.stringify(sembrada.errors ?? sembrada.conflicts)}`);

  const ctx = new Context();
  ctx.plugin(Commands);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const registry = ctx.commands;
  assert.notEqual(registry, undefined, 'el Context real no expone ctx.commands');

  const eventos = [];
  const signal = new AbortController().signal;
  const session = {
    header: { cwd: CWD },
    append(type, data) { eventos.push({ type, data }); return eventos.length; },
    snapshotEvents: () => eventos,
  };
  const agent = { session };

  const filas = () => registry.list(agent).length;
  const descriptor = (nombre) => registry.list(agent).find((c) => c.name === nombre) ?? null;
  const ejecutar = async (linea) => {
    const salida = await registry.execute(agent, linea, [], signal);
    if (salida === undefined) return undefined;
    return { kind: salida.result.kind, texto: salida.result.text, campos: Object.keys(salida.result).sort().join(',') };
  };
  const primera = (r) => (r === undefined ? null : r.texto.split('\n')[0]);
  const estados = () => readdirSync(join(root, 'projects')).flatMap((k) => readdirSync(join(root, 'projects', k))).sort();

  const set = createLocalizedSet({ definitions: skillCommands({ root, catalog: { notify() {} } }) });
  const state = createLanguageState();

  // 1 · Arranque en el idioma base: 16 filas, y el nombre espanol no existe.
  const altaEn = swapSet({ registry, state, set, lang: 'en' });
  assert.equal(altaEn.ok, true, 'el arranque en ingles no se pudo registrar');
  const descriptorEn = descriptor('skill-approve');
  assert.equal(filas(), OPERACIONES, 'el idioma base no registra 16 filas');
  assert.notEqual(descriptorEn, null, 'falta /skill-approve en el idioma base');
  assert.equal(descriptor('skill-aprobar'), null, 'el nombre espanol se registro en ingles');
  assert.equal(await ejecutar('/skill-aprobar vertical-en --local'), undefined, 'el nombre espanol es invocable en ingles');
  mide('1 · arranque en', {
    filas: filas(),
    descriptor: { name: descriptorEn.name, definitionId: descriptorEn.definitionId, hint: descriptorEn.input?.hint },
    nombreEspanol: 'NO INVOCABLE',
  });

  // 2 · Tres operaciones por su nombre ingles, incluida una de solo lectura.
  const proposalsEn = await ejecutar('/skill-proposals');
  const showEn = await ejecutar('/skill-show vertical-en');
  assert.equal(proposalsEn?.kind, 'success', '/skill-proposals no contesta');
  assert.equal(showEn?.kind, 'success', '/skill-show no contesta');
  assert.match(primera(proposalsEn), /Learning in /, 'la lista no esta en ingles');
  mide('2 · en · tres operaciones', {
    proposals: { kind: proposalsEn.kind, primera: primera(proposalsEn) },
    show: { kind: showEn.kind, primera: primera(showEn) },
    showConNombreEspanol: (await ejecutar('/skill-ver vertical-en')) ?? 'NO INVOCABLE',
  });

  // 3 · Cambio en vivo por el comando estable, sobre el registro real.
  const cambio = setLanguage({ registry, state, set, value: '--es', root, env: '' });
  assert.equal(cambio.ok, true, `el cambio a es fallo: ${cambio.code}`);
  assert.equal(cambio.altas.length, OPERACIONES - 1, 'las altas del cambio no son 15 (skill-auto no cambia)');
  assert.equal(cambio.bajas.length, OPERACIONES - 1, 'las bajas del cambio no son 15');
  assert.equal(filas(), OPERACIONES, 'tras el cambio no quedan 16 filas');
  assert.notEqual(descriptor('skill-aprobar'), null, 'no se registro el nombre espanol');
  assert.equal(descriptor('skill-approve'), null, 'el nombre ingles sigue registrado en espanol');
  assert.equal(await ejecutar('/skill-approve vertical-en --local'), undefined, 'el nombre ingles es invocable en espanol');
  mide('3 · cambio a es', {
    code: cambio.code,
    altas: cambio.altas.length,
    bajas: cambio.bajas.length,
    filas: filas(),
    nombreIngles: 'NO INVOCABLE',
    configEscrito: readdirSync(root).includes('config.json'),
  });

  // 4 · Las mismas tres operaciones por su nombre espanol, y la aprobacion de verdad.
  const proposalsEs = await ejecutar('/skill-propuestas');
  const showEs = await ejecutar('/skill-ver vertical-en');
  const approveEs = await ejecutar('/skill-aprobar vertical-en --local');
  assert.equal(proposalsEs?.kind, 'success', '/skill-propuestas no contesta');
  assert.equal(showEs?.kind, 'success', '/skill-ver no contesta');
  assert.equal(approveEs?.kind, 'success', `/skill-aprobar no aprobo: ${primera(approveEs)}`);
  assert.match(primera(proposalsEs), /Aprendizaje de /, 'la lista no esta en espanol');
  assert.equal(estados().includes('approved'), true, 'la aprobacion no dejo nada en approved/');
  // El registro real recorta el resultado: es la limitacion medida, no un defecto de esta prueba.
  assert.equal(approveEs.campos, 'kind,text', 'el registro real cambio la forma del resultado');
  mide('4 · es · tres operaciones', {
    proposals: { kind: proposalsEs.kind, primera: primera(proposalsEs) },
    show: { kind: showEs.kind, primera: primera(showEs) },
    approve: { kind: approveEs.kind, primera: primera(approveEs) },
    camposDelResultado: approveEs.campos,
    estadoEnDisco: estados(),
  });

  // 5 · Cinco vueltas EN/ES: 16 filas siempre, sin acumular.
  let minimo = Infinity;
  let maximo = 0;
  for (let i = 0; i < 5; i += 1) {
    const a = setLanguage({ registry, state, set, value: '--en', root, env: '' });
    minimo = Math.min(minimo, filas()); maximo = Math.max(maximo, filas());
    const b = setLanguage({ registry, state, set, value: '--es', root, env: '' });
    minimo = Math.min(minimo, filas()); maximo = Math.max(maximo, filas());
    assert.equal(a.ok && b.ok, true, `vuelta ${i}: ${a.code} / ${b.code}`);
  }
  assert.equal(minimo, OPERACIONES, 'una vuelta dejo menos de 16 filas');
  assert.equal(maximo, OPERACIONES, 'una vuelta dejo mas de 16 filas');
  assert.equal(descriptor('skill-approve'), null, 'el ingles quedo registrado al cerrar en espanol');
  assert.equal(state.live.size, OPERACIONES, 'el estado guarda disposers de mas o de menos');
  mide('5 · cinco vueltas', {
    filasMin: minimo,
    filasMax: maximo,
    disposersVivos: state.live.size,
    eventosDelLog: eventos.length,
  });

  // 6 · Repetir el idioma no toca nada.
  const igual = setLanguage({ registry, state, set, value: '--es', root, env: '' });
  assert.equal(igual.code, 'language-unchanged', 'repetir el idioma no dijo que ya era');
  assert.equal(igual.changed, false);
  mide('6 · repetir es', { code: igual.code, changed: igual.changed, filas: filas() });

  process.stdout.write(`\nVERTICAL: ${medidas.length} pasos medidos contra el registro real, todos en lo esperado.\n`);
} finally {
  rmSync(base, { recursive: true, force: true });
}
