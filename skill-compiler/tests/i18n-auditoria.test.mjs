#!/usr/bin/env node
/**
 * La prosa de la auditoria, de la capa de seguridad y de la puerta de `check`, en los dos idiomas.
 *
 * La regla que se fija, y que vale para las tres capas:
 *
 *   · el **dato** (`rule`, `observed`, `threshold`, `severity`, el estado en disco) no se traduce ni se toca:
 *     es lo que afirman las pruebas, lo que viaja al diario y lo que leen otros consumidores;
 *   · lo que se traduce es su **representacion**, con `fraseDeHallazgo` / `arregloDeHallazgo` / `estadoEnTexto`
 *     y el catalogo, en el idioma de la sesion;
 *   · un valor sin representacion se pinta **tal cual** —nunca una clave cruda—.
 *
 * Y se mide por el COMANDO REAL: la CLI en un subproceso, con DSH_LANG, sobre un almacen de verdad; no solo el
 * ayudante. Se compara, ademas, el DATO de las dos corridas: si el idioma moviera `rule`, `observed`, `threshold`
 * o el estado del disco, la prueba se pone roja.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { arregloDeHallazgo, estadoEnTexto, fraseDeHallazgo } from '../lib/audit.mjs';
import { folderHash, projectKey } from '../lib/compiler.mjs';
import { anotarEntradaEnDiario, huellaDeEntrada } from '../lib/security.mjs';

const PAQUETE = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(PAQUETE, 'bin', 'skill-compiler.mjs');
const CWD = 'C:\\xampp\\htdocs\\i18n-auditoria';
const KEY = projectKey(CWD);

/** Marcas de prosa espanola: frases que SOLO puede escribir el modulo, nunca un valor observado del almacen. */
const ESPANOL = [
  'no se pudo', 'parece contener', 'no es de este plugin', 'no es un estado conocido', 'no se auditan',
  'skills auditadas', 'corrige:', 'nada se ha modificado', 'ninguna skill', 'auditoria del almacen',
  'contenedor', 'hallazgo(s)', 'Revisa los permisos', 'Mueve el material', 'Reescribe la descripcion',
  'no esta en su forma', 'encadena con', 'no coincide con su huella', 'es un enlace simbolico', 'la entrada',
  'Revisa permisos antes de aprobar', 'Elige un id', 'Quita la credencial', 'no esta en el proyecto',
  'Divide el cuerpo', 'Acorta el id',
];

const ASCII = /^[\x00-\x7F]*$/u;

/**
 * La salida con los VALORES del almacen sustituidos por un hueco.
 *
 * Lo que se mide aqui es la PROSA del plugin: un valor observado puede llevar cualquier caracter (una linea de
 * una skill escrita en espanol, la tipografia heredada del `observed` de la capa de seguridad), y eso es dato,
 * no texto nuestro.
 */
const prosa = (salida) => String(salida).replace(/(?:observado|observed) "(?:[^"\\]|\\.)*"/gu, 'observado (dato)');
const ARENAS = [];
after(() => {
  for (const a of ARENAS.splice(0)) rmSync(a.base, { recursive: true, force: true });
});

/** Una skill con la forma que escribe el plugin (`dsh.origin` es lo que la hace «nuestra»). */
function skill({ id, description, whenToUse, body }) {
  return [
    '---',
    `name: ${id}`,
    `description: "${description}"`,
    `whenToUse: "${whenToUse}"`,
    'dsh:',
    '  origin: skill-compiler',
    '---',
    '',
    `# ${id}`,
    '',
    body,
    '',
  ].join('\n');
}

const CUERPO = [
  '## When to use it', '',
  'Before touching anything that a person would have to undo by hand.', '',
  '## Procedure', '',
  '1. Read the current value and write it down before changing it.',
  '2. Change one thing, then measure again with the same instrument.',
  '3. Leave the before and after side by side: without that pair there is no proof.',
  '',
].join('\n');

/**
 * Un almacen con las tres capas cargadas: reglas de calidad (error y aviso), seguridad (bloqueo y aviso), un
 * diario roto en sus dos formas (eslabon y huella), un estado desconocido y una skill de otro sistema en la
 * biblioteca curada.
 */
function arena() {
  const base = mkdtempSync(join(tmpdir(), 'i18n-auditoria-'));
  const root = join(base, 'skill-compiler');
  const curated = join(base, 'skills');
  const dir = (estado, id) => join(root, 'projects', KEY, estado, id);

  const buena = dir('approved', 'copia-verificada');
  mkdirSync(buena, { recursive: true });
  writeFileSync(join(buena, 'SKILL.md'), skill({
    id: 'copia-verificada',
    description: 'Verify the backup before and after a migration, and keep the measurement next to the change.',
    whenToUse: 'Before any migration that a person would have to undo by hand.',
    body: CUERPO,
  }));

  const corta = dir('approved', 'descripcion-corta');
  mkdirSync(corta, { recursive: true });
  writeFileSync(join(corta, 'SKILL.md'), skill({
    id: 'descripcion-corta',
    description: 'Short.',
    whenToUse: 'When a rule of the quality gate has to be seen on a card.',
    body: CUERPO,
  }));

  const secreta = dir('approved', 'credencial-pegada');
  mkdirSync(secreta, { recursive: true });
  writeFileSync(join(secreta, 'SKILL.md'), skill({
    id: 'credencial-pegada',
    description: 'A skill that carries a credential on purpose, so the security layer blocks it and says why.',
    whenToUse: 'Only in this measurement, never in a real store.',
    body: `${CUERPO}\npassword = "hunter2hunter2"\n`,
  }));

  const aviso = dir('approved', 'operacion-privilegiada');
  mkdirSync(aviso, { recursive: true });
  writeFileSync(join(aviso, 'SKILL.md'), skill({
    id: 'operacion-privilegiada',
    description: 'A skill that mentions a privileged operation, so the security layer warns about it once.',
    whenToUse: 'Only in this measurement, never in a real store.',
    body: `${CUERPO}\nRun diskpart only after the snapshot is verified.\n`,
  }));

  // Un estado que el auditor no conoce: no puede caerse del informe en silencio.
  mkdirSync(join(root, 'projects', KEY, 'estado-raro'), { recursive: true });

  // La biblioteca curada: una skill de otro sistema no se audita, y se dice por que.
  const ajena = join(curated, 'session-state-recovery');
  mkdirSync(ajena, { recursive: true });
  writeFileSync(join(ajena, 'SKILL.md'), [
    '---', 'name: session-state-recovery',
    'description: "Use when rebuilding state after a lost or closed session."',
    '---', '', '# Session state recovery', '',
  ].join('\n'));

  // El diario del proyecto: dos eslabones rotos distintos (cadena y huella).
  const diario = join(root, 'projects', KEY, 'journal.jsonl');
  anotarEntradaEnDiario(diario, { kind: 'approved', id: 'copia-verificada' }, { now: '2026-01-01T00:00:00.000Z' });
  const rota = { at: '2026-01-02T00:00:00.000Z', kind: 'approved', id: 'descripcion-corta', huellaAnterior: 'de'.repeat(32) };
  rota.huella = huellaDeEntrada(rota);
  const editada = { at: '2026-01-03T00:00:00.000Z', kind: 'approved', id: 'credencial-pegada', huellaAnterior: rota.huella, huella: 'f'.repeat(64) };
  writeFileSync(diario, `${readFileSync(diario, 'utf8')}${JSON.stringify(rota)}\n${JSON.stringify(editada)}\n`);

  const a = { base, root, curated };
  ARENAS.push(a);
  return a;
}

/** La CLI en un subproceso, con su almacen y su idioma: es el comando que usa una persona. */
function cli(a, lang, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: PAQUETE,
    env: { ...process.env, DSH_HOME: a.base, DSH_LANG: lang },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** El DATO de un informe: lo que no puede moverse con el idioma. */
const dato = (informe) => ({
  totals: informe.totals,
  byState: informe.byState,
  contenedores: informe.contenedores.map((c) => [c.rule, c.observado, c.severity]),
  skills: informe.skills.map((s) => ({
    key: s.key,
    estado: s.estado,
    status: s.status,
    errores: s.errores,
    avisos: s.avisos,
    medidas: s.medidas,
    findings: s.findings.map((f) => [f.rule, f.observed, f.threshold, f.severity]),
  })),
  archivadas: informe.archivadas,
});

describe('audit · la salida humana en los dos idiomas, el dato identico', () => {
  it('en ingles no queda una sola frase en espanol, y la salida es ASCII', () => {
    const a = arena();
    const en = cli(a, 'en', ['audit']);
    assert.equal(ASCII.test(prosa(en.salida)), true, `la salida inglesa no es ASCII:\n${en.salida}`);
    for (const marca of ESPANOL) {
      assert.equal(en.salida.includes(marca), false, `quedo prosa en espanol («${marca}») en:\n${en.salida}`);
    }
    // Y la prosa inglesa esta: cabecera, resumen, por regla y por contenedor.
    assert.match(en.salida, /store audit - read only/u);
    assert.match(en.salida, /skills audited: 4 - PASS 1 - WARN 1 - ERROR 2/u);
    assert.match(en.salida, /by rule \(the one that fixes most first\):/u);
    assert.match(en.salida, /in the container:/u);
    assert.match(en.salida, /no skill without an error|skill\(s\) with an error/u);
  });

  it('en espanol dice lo mismo, en ASCII, y conserva la regla', () => {
    const a = arena();
    const es = cli(a, 'es', ['audit']);
    assert.equal(ASCII.test(prosa(es.salida)), true, `la prosa espanola del plugin es ASCII:\n${es.salida}`);
    assert.match(es.salida, /auditoria del almacen - solo lectura/u);
    assert.match(es.salida, /skills auditadas: 4 - PASS 1 - WARN 1 - ERROR 2/u);
    assert.match(es.salida, /corrige: Reescribe la descripcion/u);
    // La regla y el valor observado no se tocan: solo cambia la representacion.
    assert.match(es.salida, /\[error\] description-min \(observado 6, umbral 60\)/u);
  });

  it('el dato del informe es identico en los dos idiomas, y la auditoria no escribe', () => {
    const a = arena();
    const antes = folderHash(a.base);
    const en = JSON.parse(cli(a, 'en', ['audit', '--json']).salida);
    const es = JSON.parse(cli(a, 'es', ['audit', '--json']).salida);
    assert.deepEqual(dato(es), dato(en), 'el dato de la auditoria cambio con el idioma');
    assert.equal(folderHash(a.base), antes, 'leer el informe escribio en el almacen');
    // El `message` del informe es el DATO de reserva: viaja igual en los dos idiomas, y no es lo que se pinta.
    const hallazgo = (informe, regla) => informe.skills.flatMap((s) => s.findings).find((f) => f.rule === regla);
    assert.equal(hallazgo(es, 'description-min').message, hallazgo(en, 'description-min').message);
    assert.deepEqual(
      [hallazgo(es, 'description-min').observed, hallazgo(es, 'description-min').threshold, hallazgo(es, 'description-min').severity],
      [hallazgo(en, 'description-min').observed, hallazgo(en, 'description-min').threshold, hallazgo(en, 'description-min').severity],
    );
    // Lo que SI cambia es la representacion: la misma regla, dicha en cada idioma por la CLI.
    const enTexto = cli(a, 'en', ['audit']).salida;
    const esTexto = cli(a, 'es', ['audit']).salida;
    assert.match(enTexto, /      description too short \(minimum 60 characters\)/u);
    assert.match(esTexto, /      description demasiado corta \(minimo 60 caracteres\)/u);
    assert.notEqual(enTexto, esTexto, 'los dos idiomas dicen lo mismo: no se midio la traduccion');
  });
});

describe('security · los hallazgos y el diario, en los dos idiomas', () => {
  it('en ingles: bloqueos, avisos y roturas del diario, sin prosa espanola', () => {
    const a = arena();
    const en = cli(a, 'en', ['security']);
    assert.equal(ASCII.test(prosa(en.salida)), true, en.salida);
    for (const marca of ESPANOL) {
      assert.equal(en.salida.includes(marca), false, `quedo prosa en espanol («${marca}») en:\n${en.salida}`);
    }
    assert.match(en.salida, /Store security - 4 skills reviewed/u);
    assert.match(en.salida, /BLOCK/u);
    assert.match(en.salida, /it looks like it carries a credential/u);
    assert.match(en.salida, /entry \d+ chains with/u);
    assert.match(en.salida, /does not match its hash/u);
  });

  it('en espanol: las mismas reglas y los mismos identificadores, dichos en espanol ASCII', () => {
    const a = arena();
    const es = cli(a, 'es', ['security']);
    assert.equal(ASCII.test(prosa(es.salida)), true, es.salida);
    assert.match(es.salida, /parece contener una credencial/u);
    assert.match(es.salida, /la entrada \d+ encadena con/u);
    assert.match(es.salida, /no coincide con su huella/u);
    // Mismo numero de bloqueos, avisos y roturas que en ingles, y los mismos ids y reglas (el dato). Los
    // marcadores de la primera columna SI cambian de idioma (BLOCK/BLOQUEO), y se aceptan los dos.
    const en = cli(a, 'en', ['security']);
    const lineas = (salida) => salida.split('\n').filter((l) => /^ {2}(BLOCK|BLOQUEO|warning|aviso)\b/u.test(l));
    assert.ok(lineas(es.salida).length > 0, es.salida);
    assert.equal(lineas(es.salida).length, lineas(en.salida).length);
    const datos = (salida) => [...salida.matchAll(/^ {2}(?:BLOCK|BLOQUEO|warning|aviso) +(\w+)\/([\w-]+) - ([\w-]+)/gmu)]
      .map((m) => `${m[1]}/${m[2]}/${m[3]}`).sort();
    assert.deepEqual(datos(es.salida), datos(en.salida));
    // Y las roturas del diario son las mismas dos en los dos idiomas.
    assert.equal((es.salida.match(/^ {4}- /gmu) ?? []).length, (en.salida.match(/^ {4}- /gmu) ?? []).length);
  });
});

describe('check · la puerta de aprobar, en los dos idiomas', () => {
  it('la integridad de la base se dice en el idioma de la sesion y conserva las huellas', async () => {
    const a = arena();
    const { approve, propose } = await import('../lib/compiler.mjs');
    const { resetLangCache } = await import('../lib/i18n/index.mjs');
    const { goodInput } = await import('./helpers.mjs');
    const previo = process.env.DSH_LANG;
    const guardado = process.env.DSH_HOME;
    const ID = goodInput().id;
    try {
      process.env.DSH_HOME = a.base;
      process.env.DSH_LANG = 'es';
      resetLangCache();
      // Una skill viva y, encima, un parche suyo: la base del parche es la version aprobada.
      assert.equal(propose(goodInput(), { root: a.root, curated: a.curated, cwd: CWD }).status, 'proposed');
      assert.equal(approve(ID, KEY, { root: a.root }).ok, true);
      const parche = propose(goodInput({
        revision: {
          claim: 'La version anterior afirmaba que el orden de los pasos no importaba.',
          evidence: 'tests/i18n-auditoria.test.mjs',
          measurement: 'Medido con `node --test`: 3 fallos antes, 0 despues.',
          change: 'Ahora el procedimiento declara el orden como parte del contrato.',
        },
        body: `${goodInput().body}\n\n4. Un paso mas.\n`,
      }), { root: a.root, curated: a.curated, cwd: CWD });
      assert.equal(parche.status, 'proposed', JSON.stringify(parche.errors ?? parche.conflicts));

      // La vigente cambia por otra via: la base del parche deja de ser la que hay.
      const aprobada = join(a.root, 'projects', KEY, 'approved', ID, 'SKILL.md');
      writeFileSync(aprobada, `${readFileSync(aprobada, 'utf8')}\nMoved by another path.\n`);

      const es = cli(a, 'es', ['check', ID, '--project-key', KEY]);
      assert.equal(ASCII.test(prosa(es.salida)), true, es.salida);
      assert.match(es.salida, /la version vigente cambio desde que se preparo esta correccion/u);
      const en = cli(a, 'en', ['check', ID, '--project-key', KEY]);
      assert.match(en.salida, /the current version changed since this correction was prepared/u);
      // Las dos huellas viajan en las dos frases: el dato es el mismo.
      const huellas = (salida) => [...salida.matchAll(/\b[0-9a-f]{16}\b/gu)].map((m) => m[0]).sort();
      assert.deepEqual(huellas(es.salida), huellas(en.salida));
      assert.ok(huellas(es.salida).length >= 2, `la frase tiene que llevar las dos huellas:\n${es.salida}`);
    } finally {
      if (previo === undefined) delete process.env.DSH_LANG;
      else process.env.DSH_LANG = previo;
      if (guardado === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = guardado;
      resetLangCache();
    }
  });
});

describe('los ayudantes · la reserva es el dato, nunca una clave cruda', () => {
  it('una regla de la tabla se compone; una desconocida se pinta tal cual', () => {
    assert.match(fraseDeHallazgo({ rule: 'description-min', message: 'crudo', messageParams: { minimo: 60 } }), /60/u);
    assert.equal(fraseDeHallazgo({ rule: 'regla-inventada', message: 'lo que dijo el motor' }), 'lo que dijo el motor');
    // Un parametro que falta se queda visible: es un defecto del codigo, y la puerta i18n y esta prueba lo ven.
    assert.equal(fraseDeHallazgo({ rule: 'description-min' }).includes('{minimo}'), true);
    assert.equal(arregloDeHallazgo({ rule: 'regla-inventada', fix: 'lo que propone el motor' }), 'lo que propone el motor');
  });

  it('un estado conocido se dice en el idioma; uno nuevo se queda crudo', () => {
    const previo = process.env.DSH_LANG;
    try {
      for (const [lang, esperado, desconocido] of [['en', 'approved', 'estado-futuro'], ['es', 'aprobada', 'estado-futuro']]) {
        process.env.DSH_LANG = lang;
        assert.equal(estadoEnTexto('approved'), esperado);
        assert.equal(estadoEnTexto(desconocido), desconocido, 'un estado nuevo no se inventa');
      }
    } finally {
      if (previo === undefined) delete process.env.DSH_LANG;
      else process.env.DSH_LANG = previo;
    }
  });
});
