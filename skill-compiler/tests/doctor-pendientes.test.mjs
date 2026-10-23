/**
 * `doctor` · las filas que ofrece cada propuesta pendiente.
 *
 * El defecto que fija este fichero: `doctor` daba por bueno el menu solo si las filas eran
 * `pendientes x 3`, un numero escrito a mano cuando los verbos eran tres. `ROW_VERBS` tiene cuatro
 * desde que publicar es una decision propia (`show`, `approve`, `publish`, `reject`), asi que en un
 * almacen con UNA propuesta pendiente el diagnostico se contradecia consigo mismo en dos lineas
 * seguidas —«1 pendientes -> 4 filas del menu» y acto seguido «cada pendiente ofrece sus tres
 * verbos»— y cerraba con «con esto el plugin falla al activarse» y exit 1. La puerta de aceptacion
 * mentia sobre un almacen sano.
 *
 * Se mide con el BINARIO y sobre un almacen sembrado, no sobre una funcion: lo que se corrige es el
 * veredicto que lee una persona (su ultima linea y su exit code). Las arenas vacias ya estaban
 * cubiertas en `doctor-almacen.test.mjs`; aqui faltaba justo el caso con algo pendiente, que es el
 * estado normal de este plugin.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';

import { propose } from '../lib/compiler.mjs';
import { ROW_VERBS } from '../lib/pending-rows.mjs';
import { cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

// La prosa de este fichero se afirma en espanol: el idioma se fija explicitamente (el base es `en`).
process.env.DSH_LANG = 'es';

const CLI = join(process.cwd(), 'bin', 'skill-compiler.mjs');
const CWD = 'C:\\xampp\\htdocs\\doctor-con-pendientes';

after(cleanupSandboxes);

/** Siembra una propuesta valida en la arena. */
function sembrar(arena, id, description, extra = {}) {
  const r = propose(goodInput({ id, description, ...extra }), { root: arena.root, curated: arena.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', `${id}: ${JSON.stringify(r.errors ?? r.conflicts)}`);
  return r.id;
}

/** Ejecuta `doctor` desde el proyecto y devuelve lo que lee una persona: la salida y el codigo. */
function doctor(arena) {
  mkdirSync(CWD, { recursive: true });
  const r = spawnSync(process.execPath, [CLI, 'doctor'], {
    cwd: CWD,
    env: { ...process.env, DSH_HOME: arena.base, DSH_LANG: 'es' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('doctor · las filas de una propuesta pendiente', () => {
  it('con una pendiente cierra en verde y no se contradice con sus propios numeros', () => {
    const arena = sandbox();
    sembrar(arena, 'doctor-una', 'Medir el almacen antes de decidir y anotar el numero exacto en el diario.');

    // El numero de filas se lee del propio artefacto: si mañana se anade un verbo, esta prueba sigue
    // midiendo lo mismo (que el diagnostico cuadre) y no un 3 escrito a mano.
    const filas = ROW_VERBS.length;
    const { code, salida } = doctor(arena);
    assert.match(salida, new RegExp(`1 pendientes -> ${filas} filas del menu`), salida);
    assert.doesNotMatch(salida, /ofrece sus tres verbos/, `el diagnostico anuncia tres verbos donde hay ${filas}:\n${salida}`);
    assert.doesNotMatch(salida, /falla al activarse/, `un almacen sano con una pendiente no impide activar el plugin:\n${salida}`);
    assert.equal(code, 0, salida);
  });

  it('con dos pendientes cuenta las filas de las dos, no las de una', () => {
    const arena = sandbox();
    // Hermanas declaradas: dos pendientes del mismo tema se vetarian entre si (el veto mide tema), y
    // aqui lo que se mide es el recuento de filas, no el veto.
    const grupo = { id: 'doctor-dos', motivo: 'Dos propuestas sembradas para contar las filas del menu.', esperadas: 2 };
    sembrar(arena, 'doctor-dos-a', 'Conciliar el extracto bancario contra el libro de caja al cierre del mes.', { group: grupo });
    sembrar(arena, 'doctor-dos-b', 'Reparar el tono de una fotografia y exportarla al perfil de color del cliente.', { group: grupo });

    const { code, salida } = doctor(arena);
    assert.match(salida, new RegExp(`2 pendientes -> ${2 * ROW_VERBS.length} filas del menu`), salida);
    assert.equal(code, 0, salida);
  });

  it('sin pendientes cierra en verde y cuenta cero filas', () => {
    const arena = sandbox();
    const { code, salida } = doctor(arena);
    assert.match(salida, /0 pendientes -> 0 filas del menu/, salida);
    assert.match(salida, new RegExp(`ofrece sus ${ROW_VERBS.length} verbos`), salida);
    assert.doesNotMatch(salida, /falla al activarse/, salida);
    assert.equal(code, 0, salida);
  });

  // La prueba del CONTRATO: los dos numeros que el diagnostico imprime (filas y verbos) se
  // contrastan con lo que declara el artefacto, sin escribir ninguno a mano. Un literal en
  // cualquiera de los dos lados la pone roja, aunque hoy coincida por casualidad.
  it('el recuento que anuncia el diagnostico sale del contrato de verbos y cuadra consigo mismo', () => {
    const arena = sandbox();
    const grupo = { id: 'doctor-tres', motivo: 'Tres propuestas sembradas para contrastar el recuento con el contrato.', esperadas: 3 };
    sembrar(arena, 'doctor-tres-a', 'Cuadrar la caja del dia contra el arqueo del turno anterior.', { group: grupo });
    sembrar(arena, 'doctor-tres-b', 'Preparar el indice de materias de un manual largo sin perder enlaces.', { group: grupo });
    sembrar(arena, 'doctor-tres-c', 'Revisar el contraste de una paleta antes de publicar el tema.', { group: grupo });

    const { code, salida } = doctor(arena);
    const filas = salida.match(/(\d+) pendientes -> (\d+) filas del menu/);
    const verbos = salida.match(/ofrece sus (\d+) verbos/);
    assert.ok(filas, `el diagnostico no anuncia las filas:\n${salida}`);
    assert.ok(verbos, `el diagnostico no anuncia el numero de verbos:\n${salida}`);

    assert.equal(Number(filas[1]), 3, salida);
    assert.equal(Number(verbos[1]), ROW_VERBS.length, `anuncia ${verbos[1]} verbos y el contrato tiene ${ROW_VERBS.length}:\n${salida}`);
    assert.equal(Number(filas[2]), Number(filas[1]) * Number(verbos[1]), `las filas no son pendientes x verbos:\n${salida}`);
    assert.equal(code, 0, salida);
  });
});
