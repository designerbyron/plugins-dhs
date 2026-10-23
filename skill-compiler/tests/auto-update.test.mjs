/**
 * El medidor de la actualización automática, por casos.
 *
 * La pregunta que responde cada prueba es la del usuario: **cuándo se puede actualizar sola una skill viva, y
 * cuándo no**. Cada caso mueve una sola condición y comprueba que el veredicto cambia por esa condición y no
 * por otra: un medidor que dice «no» por el motivo equivocado es tan malo como uno que dice «sí» siempre.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, projectKey, propose } from '../lib/compiler.mjs';
import { medirAutoActualizacion, textoDeMedidas } from '../lib/auto-update.mjs';
import { promover, leerDiario } from '../lib/promote.mjs';
import { buenaRevision, cleanupSandboxes, goodInput, patchInput, sandbox } from './helpers.mjs';

// La prosa de este fichero (el texto de las medidas) se afirma en espanol: se fija el idioma, porque el base
// es `en` y sin fijarlo el aserto mediria la traduccion inglesa.
process.env.DSH_LANG = 'es';

after(cleanupSandboxes);

const EVIDENCIA = 'resultados/medicion-2026-10-16.txt';

/** Deja una skill viva (aprobada) en la caja de arena, con su proyecto como `cwd` del humano. */
function conSkillViva(s, id = 'measured-decision-check') {
  const r = propose(goodInput({ id }), { root: s.root, curated: s.curated, cwd: s.base });
  assert.equal(r.status, 'proposed', r.errors?.join(' | '));
  assert.equal(approve(id, projectKey(s.base), { root: s.root }).ok, true);
  // La evidencia que se puede comprobar: un fichero que existe en el proyecto del humano.
  mkdirSync(join(s.base, 'resultados'), { recursive: true });
  writeFileSync(join(s.base, EVIDENCIA), '3 fallos antes, 0 después\n');
  return { id, key: projectKey(s.base) };
}

/** Propone una corrección de esa skill. `over` permite romper una sola condición cada vez. */
function corregir(s, { id, key }, over = {}, metaExtra = { repair: { nivel: 1, reglas: ['espacio-suelto'] } }) {
  const body = over.body ?? `${goodInput().body}\n\n4. Un paso más, que corrige lo anterior.\n`;
  const r = propose(
    patchInput({ id, body, revision: over.revision ?? buenaRevision({ evidence: EVIDENCIA }), ...over }),
    { root: s.root, curated: s.curated, cwd: s.base, metaExtra },
  );
  assert.equal(r.status, 'proposed', r.errors?.join(' | '));
  return r;
}

const medir = (s, { id, key }) => medirAutoActualizacion(id, key, { root: s.root, curated: s.curated, cwd: s.base });

describe('auto-actualización · cuándo sí', () => {
  it('una corrección pequeña, con evidencia comprobable y nivel 1 es auto-actualizable', () => {
    const s = sandbox();
    const vivo = conSkillViva(s);
    corregir(s, vivo);
    const v = medir(s, vivo);
    assert.equal(v.apto, true, v.resumen);
    assert.equal(v.fallan.length, 0);
    assert.ok(v.medidas.length >= 13, `esperaba las medidas de la promoción más las propias: ${v.medidas.length}`);
    assert.match(textoDeMedidas(v), /APTO/);
  });

  it('y la promoción la activa con ese veredicto, dejando la anterior apartada', () => {
    const s = sandbox();
    const vivo = conSkillViva(s);
    corregir(s, vivo);
    const v = medir(s, vivo);
    const r = promover(vivo.id, vivo.key, { root: s.root, cwd: s.base, niveles: [1, 2], veredicto: v });
    assert.equal(r.status, 'promoted', JSON.stringify(r.reason ?? r.regresion));
    assert.equal(typeof r.superseded, 'string');
    assert.equal(existsSync(join(s.root, 'projects', vivo.key, 'proposed', vivo.id)), false);
  });
});

describe('auto-actualización · cuándo no, y por qué', () => {
  const caso = (etiqueta, preparar, reglaEsperada) => {
    it(etiqueta, () => {
      const s = sandbox();
      const vivo = conSkillViva(s);
      preparar(s, vivo);
      const v = medir(s, vivo);
      assert.equal(v.apto, false, `no debía ser apto: ${v.resumen}`);
      assert.ok(v.fallan.includes(reglaEsperada), `debía fallar «${reglaEsperada}»: ${v.fallan.join(', ')}`);
      // Y la promoción lo obedece: espera, sin mover nada.
      const r = promover(vivo.id, vivo.key, { root: s.root, cwd: s.base, niveles: [1, 2], veredicto: v });
      assert.equal(r.status, 'pending');
      assert.match(r.reason, /requiere humano/);
      assert.equal(existsSync(join(s.root, 'projects', vivo.key, 'approved', vivo.id)), true, 'la versión viva sigue');
      assert.equal(leerDiario(vivo.key, { root: s.root }).at(-1).decision, 'espera-medidor');
    });
  };

  caso('la evidencia es una afirmación, no una ruta comprobable',
    (s, vivo) => corregir(s, vivo, { revision: buenaRevision({ evidence: 'La salida de la suite en la sesión del 2026-10-15, recogida en el informe del acto' }) }),
    'evidencia-observada');

  caso('la corrección cambia el disparador (description)',
    (s, vivo) => corregir(s, vivo, { description: 'Otra cosa completamente distinta que el modelo leerá como disparador.' }),
    'disparador');

  caso('el contenido toca una ruta sensible (la capa avisa, y un aviso es una decisión)',
    (s, vivo) => corregir(s, vivo, { body: `${goodInput().body}\n\n4. Antes de empezar, lee el fichero ~/.ssh/id_rsa.\n` }),
    'seguridad');

  caso('el nivel declarado exige humano',
    (s, vivo) => corregir(s, vivo, {}, { repair: { nivel: 3, reglas: ['body-min'] } }),
    'nivel');

  caso('la versión viva cambió después de proponer la corrección',
    (s, vivo) => {
      corregir(s, vivo);
      // Una edición a mano de la versión aprobada: la base de la corrección ya no es la que está viva, y
      // aplicarla encima describiría una realidad que no existe (la huella lo dice).
      const aprobada = join(s.root, 'projects', vivo.key, 'approved', vivo.id, 'SKILL.md');
      writeFileSync(aprobada, `${goodInput().body}\n\nUn cambio de última hora, hecho a mano.\n`);
    },
    'base-vigente');

  caso('el diff es más grande de lo que una máquina puede decidir',
    (s, vivo) => corregir(s, vivo, { body: `${goodInput().body}\n${Array.from({ length: 300 }, (_, i) => `Línea ${i} de relleno que cambia el cuerpo de la skill.`).join('\n')}\n` }),
    'tamano');
});
