#!/usr/bin/env node
/**
 * El detector de rutas absolutas: el falso positivo medido, y lo que debe seguir bloqueándose.
 *
 * ── Lo que hay que poder demostrar ──────────────────────────────────────────────────────────────
 *
 * 1. **El falso positivo está muerto.** El único aviso del almacén real (2026-10-16) era el literal de
 *    una expresión regular dentro de código en línea: dos barras invertidas seguidas de una barra parecen
 *    una ruta y no lo son. Se reproduce aquí tal cual.
 * 2. **La protección sigue en pie.** Una ruta de verdad, en prosa, se avisa; una con la barra duplicada
 *    (típica de un JSON) se declara **ambigua** en vez de callarse.
 * 3. **El contexto decide**: un ejemplo en un bloque de código y una cita en código en línea no engordan
 *    la lista de avisos — quedan como `info` en el informe, que es información y no una petición.
 *
 * Y todo esto sin tocar ninguna skill del almacén: se mide sobre los textos que se le pasan.
 *
 *   node --test tests/audit-rutas.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { rutasAbsolutasEn, validateInput } from '../lib/compiler.mjs';

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

/** Una entrada válida, con el cuerpo que se quiera medir. */
const conCuerpo = (body) => ({
  id: 'medir-rutas-absolutas',
  description: 'Medir qué rutas absolutas aparecen en un texto y en qué contexto, para no avisar de lo que no toca.',
  whenToUse: 'Cuando haya que decidir si una skill contiene una ruta absoluta que deba parametrizarse.',
  body,
  evidence: ['un gate que ya existe'],
});

const CUERPO_LARGO = `## Uno\n\n${'Detalle operativo con números y orden. '.repeat(30)}\n\n## Dos\n\nMás detalle operativo.\n`;

describe('el falso positivo medido', () => {
  it('una barra escapada dentro de código en línea NO es una ruta', () => {
    // El caso real, tal cual estaba en el almacén: el detector de un gate, citado con comillas invertidas.
    const texto = 'El detector se escribe con una expresión regular: el literal que separa «ninguna URL» del resto.';
    assert.deepEqual(rutasAbsolutasEn(texto), []);
    const escapado = 'El detector es `/https:\\/\\/api\\./` y no es una ruta.';
    assert.deepEqual(rutasAbsolutasEn(escapado), [], 'dos barras invertidas seguidas de una barra no son una ruta');
  });

  it('la letra de unidad sin camino tampoco dice nada', () => {
    assert.deepEqual(rutasAbsolutasEn('Se lee la unidad C:\\ y ya está.'), []);
  });
});

describe('lo que sí hay que ver', () => {
  it('una ruta de verdad, en prosa, se avisa con su línea y su muestra', () => {
    const hallazgos = rutasAbsolutasEn('La skill vive en C:\\xampp\\htdocs\\saas-corporative y se ejecuta allí.');
    assert.equal(hallazgos.length, 1);
    assert.equal(hallazgos[0].clase, 'prosa');
    assert.equal(hallazgos[0].linea, 1);
    assert.match(hallazgos[0].muestra, /^C:\\xampp/);
  });

  it('una ruta POSIX de sistema, en prosa, también', () => {
    const hallazgos = rutasAbsolutasEn('El binario está en /usr/local/bin/algo y se llama así.');
    assert.equal(hallazgos.length, 1);
    assert.equal(hallazgos[0].clase, 'prosa');
  });

  it('una ruta con la barra duplicada es AMBIGUA (no se calla, y no se confunde con una de verdad)', () => {
    const hallazgos = rutasAbsolutasEn('Dentro del JSON aparece "project": "C:\\\\xampp\\\\htdocs".');
    assert.equal(hallazgos.length, 1);
    assert.equal(hallazgos[0].clase, 'ambigua');
  });

  it('el contexto separa un ejemplo y una cita de una ruta que se usa', () => {
    const ejemplo = rutasAbsolutasEn(`Ejemplo:\n\n\`\`\`sh\ncd C:/xampp/htdocs/proyecto\nnpm run dev\n\`\`\`\n`);
    assert.deepEqual(ejemplo.map((h) => h.clase), ['ejemplo']);
    const cita = rutasAbsolutasEn('La ruta `C:\\xampp\\htdocs` se cita aquí.');
    assert.deepEqual(cita.map((h) => h.clase), ['cita']);
  });
});

describe('la puerta, sobre el cuerpo entero', () => {
  it('el falso positivo medido NO produce ningún aviso al validar la skill', () => {
    const cuerpo = `${CUERPO_LARGO}\nEl detector del gate se cita así: \`/https:\\/\\/api\\./\`.\n`;
    const r = validateInput(conCuerpo(cuerpo), { cwd: CWD });
    const rutas = r.findings.filter((f) => (f.rule ?? '').startsWith('absolute-path'));
    assert.deepEqual(rutas, [], 'el caso que se medía en el almacén no puede seguir avisando');
  });

  it('una ruta real en prosa avisa UNA vez, con la muestra en el mensaje', () => {
    const cuerpo = `${CUERPO_LARGO}\nLa configuración vive en C:\\xampp\\htdocs\\saas-corporative\\.env y se lee al arrancar.\nOtra vez: C:\\xampp\\htdocs\\otro\\.env.\n`;
    const r = validateInput(conCuerpo(cuerpo), { cwd: CWD });
    const rutas = r.findings.filter((f) => f.rule === 'absolute-path');
    assert.equal(rutas.length, 1, 'un solo aviso: la lista de avisos no se engorda con repeticiones');
    assert.equal(rutas[0].severity, 'warn');
    assert.match(rutas[0].message, /C:\\xampp/);
    assert.ok(r.warnings.some((w) => /ruta absoluta en la línea/.test(w)));
  });

  it('un ejemplo y una cita quedan como `info`: se ven en el informe, no piden nada', () => {
    const cuerpo = `${CUERPO_LARGO}\n\n\`\`\`sh\ncd C:/xampp/htdocs/proyecto\n\`\`\`\n\nY la ruta \`C:/xampp/htdocs\` se cita.\n`;
    const r = validateInput(conCuerpo(cuerpo), { cwd: CWD });
    const informativos = r.findings.filter((f) => (f.rule ?? '').startsWith('absolute-path'));
    assert.equal(informativos.length, 2);
    assert.ok(informativos.every((f) => f.severity === 'info'));
    assert.deepEqual(r.warnings.filter((w) => /ruta absoluta/.test(w)), [], 'un ejemplo no engorda los avisos');
  });

  it('la muestra se corta: un aviso no puede pegar medio fichero', () => {
    const larga = `C:\\${'carpeta-larguisima\\'.repeat(12)}final.txt`;
    const [hallazgo] = rutasAbsolutasEn(`Vive en ${larga} y se lee.`);
    assert.ok(hallazgo.muestra.length <= 60);
    assert.match(hallazgo.muestra, /…$/);
  });
});

describe('el almacén real, en solo lectura', () => {
  it('la skill que producía el aviso ya no lo produce, y no se ha tocado', () => {
    const raiz = process.env.HOME ? join(process.env.HOME, '.dsh') : null;
    if (raiz === null) return;
    const rutas = [
      join(raiz, 'skill-compiler', 'projects', 'saas-corporative-a3c393fa', 'disabled', 'saas-corporative-gate-workflow', 'SKILL.md'),
      join(raiz, 'skill-compiler', 'projects', 'saas-corporative-a3c393fa', 'approved', 'saas-corporative-gate-workflow', 'SKILL.md'),
    ];
    const fichero = rutas.find((ruta) => existsSync(ruta));
    if (fichero === undefined) return; // el almacén de esta máquina no tiene esa skill: caso sin cubrir, declarado
    const texto = readFileSync(fichero, 'utf8');
    const cuerpo = texto.split(/^---\s*$/m).slice(2).join('---');
    const hallazgos = rutasAbsolutasEn(cuerpo);
    assert.deepEqual(hallazgos.filter((h) => h.clase === 'prosa'), [], 'el aviso del almacén real era un falso positivo');
  });
});
