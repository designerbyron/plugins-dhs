#!/usr/bin/env node
/**
 * Deuda 1 · la prosa de `scope.mjs`, del medidor automatico y de `repair`, en el idioma de quien lee.
 *
 * La regla que se fija, y que vale para las tres capas:
 *
 *   · el **dato** (`estado`, `motivo`, `observado`, `umbral`, `reason`, `bloqueos`) no se traduce ni se toca:
 *     es lo que afirman las pruebas, lo que viaja al diario y lo que leen otros consumidores;
 *   · lo que se traduce es su **representacion**, en el punto de presentacion, con `t(key, params)`;
 *   · un valor sin representacion se pinta **tal cual** —nunca una clave cruda, nunca una conclusion falsa—.
 *
 * Y se mide por el COMANDO REAL: la CLI en un subproceso y el comando de sesion, no solo el ayudante.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { medirAutoActualizacion, textoDeMedidas } from '../lib/auto-update.mjs';
import { projectKey, propose } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import { codigoDeReparacion, reparar, REPARACIONES } from '../lib/repair.mjs';
import { estadoEnTexto, motivoEnTexto } from '../lib/scope.mjs';
import { cleanupSandboxes, goodInput } from './helpers.mjs';

const PAQUETE = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(PAQUETE, 'bin', 'skill-compiler.mjs');

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\deuda-prosa';
const KEY = projectKey(CWD);
const ID_VIVA = 'sonda-viva';

/** Marcas de prosa espanola en una salida que deberia estar en ingles. */
const ESPANOL = [
  'no se ha creado', 'ninguna propuesta', 'es criterio', 'no se repara sola', 'version vigente',
  'nivel de la correccion', 'sin poder leerlo', 'no se pudo leer', 'la propuesta no', 'esta pendiente',
  'se ha retirado', 'no hay ninguna',
];

const ARENAS = [];
/** Una arena con una skill viva que incumple reglas de nivel 3, para que `repair` bloquee con motivos. */
function arena() {
  const base = mkdtempSync(join(tmpdir(), 'deuda-prosa-'));
  const root = join(base, 'skill-compiler');
  const curated = join(base, 'skills');
  mkdirSync(root, { recursive: true });
  mkdirSync(curated, { recursive: true });
  const dir = join(root, 'projects', KEY, 'approved', ID_VIVA);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    `name: ${ID_VIVA}`,
    'description: "Skill viva con un defecto, para medir la prosa de repair en los dos idiomas."',
    '---',
    '',
    `# ${ID_VIVA}`,
    '',
    'Cuerpo corto.',
    '',
  ].join('\n'));
  const a = { base, root, curated };
  ARENAS.push(a);
  return a;
}
after(() => {
  for (const a of ARENAS.splice(0)) rmSync(a.base, { recursive: true, force: true });
});

/** La CLI en un subproceso, con su almacen y su idioma: es el comando que usa una persona. */
function cli(a, { lang, args }) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--project-key', KEY], {
    cwd: PAQUETE,
    env: { ...process.env, DSH_HOME: a.base, DSH_LANG: lang },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('deuda 1 · repair: el dato se conserva y se dice en el idioma de quien lee', () => {
  it('los motivos de bloqueo salen en ingles y sin una sola frase en espanol', () => {
    const a = arena();
    const en = cli(a, { lang: 'en', args: ['repair', ID_VIVA] });
    assert.equal(en.code, 0, en.salida);
    assert.match(en.salida, /BLOCKED/, 'el caso tiene que bloquear: si no, no mide motivos');
    for (const marca of ESPANOL) {
      assert.equal(en.salida.includes(marca), false, `quedó prosa espanola («${marca}») en:\n${en.salida}`);
    }
    assert.equal(/^[\x00-\x7F]*$/u.test(en.salida), true, `la salida inglesa no es ASCII:\n${en.salida}`);
    // Y el motivo se lee: nombra la regla y dice por que necesita a una persona.
    assert.match(en.salida, /whenToUse-min: The trigger decides WHEN/u);
  });

  it('la misma corrida en espanol dice lo mismo, en ASCII, y conserva la regla', () => {
    const a = arena();
    const es = cli(a, { lang: 'es', args: ['repair', ID_VIVA] });
    assert.equal(es.code, 0, es.salida);
    assert.match(es.salida, /BLOQUEADA/u);
    assert.match(es.salida, /whenToUse-min: El disparador decide CUANDO/u);
    assert.equal(/^[\x00-\x7F]*$/u.test(es.salida), true, `la prosa espanola del plugin es ASCII:\n${es.salida}`);
  });

  it('el dato es identico en los dos idiomas: mismo status, mismo motivo, mismas reglas', () => {
    const datos = [];
    for (const lang of ['en', 'es']) {
      const a = arena();
      const guardado = process.env.DSH_LANG;
      process.env.DSH_LANG = lang;
      resetLangCache();
      const r = reparar(ID_VIVA, KEY, { root: a.root, curated: a.curated, cwd: CWD });
      datos.push({
        lang,
        status: r.status,
        nivel: r.nivel,
        motivoTextos: r.bloqueos.map((b) => b.motivo),
        motivoCodigos: r.bloqueos.map((b) => b.motivoCode),
        reglas: r.bloqueos.map((b) => b.rule),
        reason: r.reason,
        reasonCode: r.reasonCode,
      });
      process.env.DSH_LANG = guardado ?? '';
      resetLangCache();
    }
    assert.deepEqual(
      { ...datos[0], lang: null },
      { ...datos[1], lang: null },
      'el dato de repair cambió con el idioma',
    );
    // El motivo es de la tabla de reglas y su codigo se deriva de la regla: no hay un segundo mapa.
    for (const b of datos[0].motivoCodigos ?? []) assert.match(b, /^repair\.(rule\.[\w.-]+\.why|why\.)/u);
  });

  it('una regla sin motivo conocido se pinta tal cual: el valor crudo, nunca una conclusion', () => {
    const a = arena();
    const en = cli(a, { lang: 'en', args: ['repair', ID_VIVA] });
    // La sonda no tiene reglas fuera del catalogo, asi que se mide la funcion: es el mismo camino.
    assert.equal(motivoEnTexto('una frase que nadie tradujo'), 'una frase que nadie tradujo');
    assert.equal(motivoEnTexto(''), '');
    assert.equal(en.code, 0);
  });

  it('toda regla del catalogo de repair tiene su frase en los dos idiomas', async () => {
    const { default: en } = await import('../lib/i18n/en.mjs');
    const { default: es } = await import('../lib/i18n/es.mjs');
    for (const regla of Object.keys(REPARACIONES)) {
      for (const cual of ['what', 'why']) {
        const clave = codigoDeReparacion(regla, cual);
        assert.equal(typeof en[clave], 'string', `falta en:${clave}`);
        assert.equal(typeof es[clave], 'string', `falta es:${clave}`);
      }
    }
  });
});

describe('deuda 1 · el medidor automatico: observado y umbral en el idioma de quien lee', () => {
  it('cada medida lleva su codigo, y el texto impreso no es el espanol del motor', () => {
    const a = arena();
    propose(goodInput({ id: 'sonda-nueva' }), { root: a.root, curated: a.curated, cwd: CWD });
    const guardado = process.env.DSH_LANG;
    const salidas = {};
    for (const lang of ['en', 'es']) {
      process.env.DSH_LANG = lang;
      resetLangCache();
      const v = medirAutoActualizacion('sonda-nueva', KEY, { root: a.root, curated: a.curated, cwd: CWD });
      salidas[lang] = { texto: textoDeMedidas(v), medidas: v.medidas };
    }
    process.env.DSH_LANG = guardado ?? '';
    resetLangCache();

    for (const marca of ESPANOL) {
      assert.equal(salidas.en.texto.includes(marca), false, `quedó prosa espanola («${marca}») en:\n${salidas.en.texto}`);
    }
    assert.equal(/^[\x00-\x7F]*$/u.test(salidas.en.texto), true, salidas.en.texto);
    // El DATO es el mismo en los dos idiomas, medida a medida.
    assert.deepEqual(
      salidas.en.medidas.map((m) => [m.regla, m.observado, m.umbral, m.pasa]),
      salidas.es.medidas.map((m) => [m.regla, m.observado, m.umbral, m.pasa]),
      'el dato medido cambió con el idioma',
    );
    // Y en espanol se lee en espanol (la representacion existe, no es el ingles de reserva).
    assert.match(salidas.es.texto, /No hay version vigente|Sin nivel|requiere humano/u, salidas.es.texto);
  });

  it('una medida sin representacion se pinta con su texto: un dato raro no se convierte en frase', () => {
    const texto = textoDeMedidas({
      apto: false,
      nivel: 3,
      avisosSeguridad: 0,
      fallan: ['inventada'],
      medidas: [{ regla: 'inventada', pasa: false, observado: 'lo que midio el motor', umbral: 'lo que exigia' }],
    });
    assert.match(texto, /lo que midio el motor/u);
    assert.match(texto, /lo que exigia/u);
  });
});

describe('deuda 1 · scope: estado y motivo se dicen, el dato no se mueve', () => {
  it('el estado conocido se traduce; el desconocido se queda crudo', () => {
    const guardado = process.env.DSH_LANG;
    for (const [lang, esperado] of [['en', 'absent'], ['es', 'ausente']]) {
      process.env.DSH_LANG = lang;
      resetLangCache();
      assert.equal(estadoEnTexto('ausente'), esperado);
      assert.equal(estadoEnTexto('estado-futuro'), 'estado-futuro', 'un estado nuevo no se inventa');
    }
    process.env.DSH_LANG = guardado ?? '';
    resetLangCache();
  });

  it('el mismo diagnostico, declarado en disco, se lee en los dos idiomas y el fichero no se toca', () => {
    const a = arena();
    const propiedad = join(a.root, 'ownership.json');
    writeFileSync(propiedad, JSON.stringify({ ownership: 'nadie-ha-respondido' }));
    const antes = readFileSync(propiedad, 'utf8');
    const salidas = {};
    for (const lang of ['en', 'es']) {
      salidas[lang] = cli(a, { lang, args: ['doctor'] }).salida;
    }
    assert.equal(readFileSync(propiedad, 'utf8'), antes, 'leer el diagnostico escribió en el almacén');
    assert.match(salidas.en, /ownership/u);
    assert.equal(salidas.en === salidas.es, false, 'los dos idiomas dicen lo mismo: no se midió la traducción');
    assert.equal(existsSync(join(a.root, 'projects')), true);
  });
});
