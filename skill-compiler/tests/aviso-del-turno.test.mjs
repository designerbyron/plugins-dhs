#!/usr/bin/env node
/**
 * El aviso del turno: qué dice cuando pasan varias cosas, y cuánto tiempo se queda.
 *
 * ── Los defectos que esto mide ──────────────────────────────────────────────────────────────────
 *
 * 1. **Un solo verbo para un turno con varias cosas.** El estado guardaba un `outcome` único (el último
 *    resultado pisaba al anterior) y dos contadores. Medido con la proyección real:
 *
 *    · crea una skill y actualiza otra  → «Skill existente actualizada: la-segunda» (la creación no aparece)
 *    · crea, actualiza, crea            → «Nueva skill creada: la-última ×3» (el ×3 mezcla 2 nuevas + 1 act.)
 *    · crea una y rechaza otra          → «No se creó ninguna skill» (¡con created=1!)
 *
 * 2. **Sin retirada.** La píldora no tenía temporizador: permanecía indefinidamente.
 *
 * La frase con UN solo resultado no cambia: eso ya funcionaba, y aquí se congela para que siga igual.
 *
 *   node --test tests/aviso-del-turno.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { applyLearning, initialLearning, learningView, partesDeActividad, resumenDeActividad } from '../lib/presentation.mjs';
import { cleanupSandboxes } from './helpers.mjs';

after(cleanupSandboxes);

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const llamada = (callId) => ({ type: 'tool/call', seq: 1, data: { name: 'skill_propose', callId } });
const resultado = (callId, outcome, skill, seq = 2) => ({
  type: 'tool/result', seq, time: 1000,
  data: { message: { source: { callId }, content: [{ type: 'text', text: `[skill-compiler] ${outcome} ${skill}` }] } },
});

/** El turno, resultado a resultado, tal y como lo ve el plegado. */
function turno(pasos) {
  let state = initialLearning();
  for (const [outcome, skill] of pasos) {
    state = applyLearning(state, llamada(`c-${skill}`));
    state = applyLearning(state, resultado(`c-${skill}`, outcome, skill));
  }
  return learningView(state);
}

/** Las palabras del idioma, para probar la composición sin depender del cliente. */
const PALABRAS = {
  created: ['nueva', 'nuevas'], updated: ['actualizada', 'actualizadas'],
  rejected: ['rechazada', 'rechazadas'], blocked: ['bloqueada', 'bloqueadas'],
};
const partes = (view) => partesDeActividad(view, PALABRAS);

describe('el aviso de un turno con varias cosas', () => {
  it('una creación y una actualización dicen las dos, y no se pierde ninguna', () => {
    const r = resumenDeActividad(turno([['created', 'conciliacion-bancaria'], ['updated', 'purga-de-temporales']]));
    assert.equal(r.nuevas, 1, 'la creación tiene que contarse');
    assert.equal(r.actualizadas, 1);
    assert.deepEqual(partes(turno([['created', 'conciliacion-bancaria'], ['updated', 'purga-de-temporales']])), ['1 nueva', '1 actualizada']);
    // Y en cualquier orden: el turno no cambia por el orden en que llegaron los resultados.
    const alReves = turno([['updated', 'purga-de-temporales'], ['created', 'conciliacion-bancaria']]);
    assert.deepEqual(partes(alReves), ['1 nueva', '1 actualizada']);
    assert.equal(resumenDeActividad(alReves).total, 2);
  });

  it('crear, actualizar y crear se cuenta por tipo: 2 nuevas · 1 actualizada', () => {
    const view = turno([['created', 'uno'], ['updated', 'dos'], ['created', 'tres']]);
    assert.deepEqual(partes(view), ['2 nuevas', '1 actualizada'], 'el viejo «×3» mezclaba dos cosas distintas');
    const r = resumenDeActividad(view);
    assert.equal(r.total, 3, 'y el total sigue siendo el del acumulado de la sesión');
    assert.equal(r.skills, 3);
  });

  it('una creación y un rechazo NO se resumen como «no se creó ninguna»', () => {
    const view = turno([['created', 'buena'], ['rejected', 'choca-con-otra']]);
    assert.deepEqual(partes(view), ['1 nueva', '1 rechazada']);
    const r = resumenDeActividad(view);
    assert.equal(r.nuevas, 1);
    assert.equal(r.rechazadas, 1);
    // En la frase COMPUESTA no se pinta un id suelto: van las dos cosas y los ids completos al `title`. Lo
    // que sí tiene que estar es la skill creada en la lista, que es lo que hace que la frase sea verificable.
    assert.deepEqual(r.ids, ['buena'], 'la creada tiene que aparecer');
    assert.equal(r.skills, 1);
  });

  it('un rechazo solo sigue diciendo «no se creó ninguna», y un bloqueo solo, lo suyo', () => {
    assert.deepEqual(partes(turno([['rejected', 'choca-con-otra']])), ['1 rechazada']);
    assert.deepEqual(partes(turno([['blocked', 'origen-peligroso']])), ['1 bloqueada']);
    const r = resumenDeActividad(turno([['rejected', 'choca-con-otra']]));
    assert.equal(r.nuevas, 0, 'un rechazo no es una creación');
    assert.equal(r.rechazadas, 1);
  });

  it('un bloqueo junto a una creación dice las dos cosas', () => {
    assert.deepEqual(partes(turno([['created', 'buena'], ['blocked', 'origen-peligroso']])), ['1 nueva', '1 bloqueada']);
  });
});

describe('la frase de un solo resultado no cambia', () => {
  it('sigue siendo una sola skill con su id, y sin partes de más', () => {
    for (const [outcome, skill] of [['created', 'medida-por-evidencia'], ['updated', 'medida-por-evidencia'], ['rejected', 'choca'], ['blocked', 'origen']]) {
      const r = resumenDeActividad(turno([[outcome, skill]]));
      assert.equal(r.id, skill, `${outcome}: con una sola skill se enseña su id`);
      // `total` cuenta skills **creadas o actualizadas**: un rechazo o un bloqueo no crean nada, así que no
      // entran ahí — pero se cuentan aparte, que es lo que impide perderlos.
      assert.equal(r.total, outcome === 'created' || outcome === 'updated' ? 1 : 0);
      assert.equal(partes(turno([[outcome, skill]])).length, 1, `${outcome}: y una sola parte, que es lo que se pinta como frase simple`);
    }
  });

  it('nada que aprender no produce ninguna parte: eso es «sin cambios»', () => {
    const vacio = learningView(initialLearning());
    assert.deepEqual(partes(vacio), [], 'sin resultados no hay nada que contar');
    assert.equal(resumenDeActividad(vacio).total, 0);
  });

  it('la misma skill dos veces sigue siendo una sola, con su repetición', () => {
    const view = turno([['created', 'una-sola'], ['updated', 'una-sola']]);
    const r = resumenDeActividad(view);
    assert.equal(r.skills, 1);
    assert.equal(r.id, 'una-sola');
    assert.equal(r.total, 2);
    assert.equal(r.repetido, true, 'el ×N de la misma skill sí dice la verdad');
  });
});

describe('el tiempo que un aviso permanece', () => {
  it('el cliente lo temporiza, y la proyección NO lleva reloj (sigue siendo reproducible)', () => {
    const cliente = readFileSync(join(RAIZ, 'client.js'), 'utf8');
    const presentacion = readFileSync(join(RAIZ, 'lib', 'presentation.mjs'), 'utf8');
    // El reloj vive en la vista (navegador), no en el plegado: una proyección con `Date.now()` no es
    // reproducible al releer un punto de control, y el esquema de estado no debe guardar el tiempo.
    assert.match(cliente, /setTimeout/, 'la retirada la arma el cliente');
    assert.ok(!/Date\.now/.test(presentacion), 'el plegado no puede depender del reloj');
    assert.ok(!/expira|expiresAt|ttl/i.test(presentacion), 'ni guardar un instante de caducidad');
  });

  it('los dos tiempos están declarados, y el de atención es mayor que el informativo', () => {
    const cliente = readFileSync(join(RAIZ, 'client.js'), 'utf8');
    const informativo = Number(cliente.match(/MS_INFORMATIVO\s*=\s*(\d+)/)?.[1]);
    const atencion = Number(cliente.match(/MS_ATENCION\s*=\s*(\d+)/)?.[1]);
    assert.ok(Number.isFinite(informativo) && Number.isFinite(atencion), 'los dos tiempos tienen que estar declarados con nombre');
    // 8 s es 2× el peor tiempo de lectura medido (73 caracteres ≈ 3,9 s a 200 ppm).
    assert.equal(informativo, 8000, 'el informativo se queda el doble de lo que cuesta leer el peor caso');
    assert.equal(atencion, 30000, 'el que pide atención se queda más: puede exigir una decisión');
    assert.ok(atencion > informativo);
  });

  it('el aviso que pide atención es el que no se va solo de inmediato, y el foco lo pausa', () => {
    const cliente = readFileSync(join(RAIZ, 'client.js'), 'utf8');
    assert.match(cliente, /pideAtencion|requiereAtencion/, 'tiene que distinguir los avisos que piden atención');
    assert.match(cliente, /onFocus|onPointerEnter|onMouseEnter/, 'y no puede retirarse mientras alguien lo está leyendo');
  });

  it('el detalle sigue estando fuera del aviso: la píldora es un resumen, no el registro', () => {
    const cliente = readFileSync(join(RAIZ, 'client.js'), 'utf8');
    // El `title` con la frase completa: si el aviso se retira, el dato sigue disponible al foco y al puntero.
    assert.match(cliente, /title: sentence/, 'la frase entera va en el title');
  });
});
