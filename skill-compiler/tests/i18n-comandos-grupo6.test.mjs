/**
 * F1.2 grupo 6 · lo que quedaba fuera del catalogo: las tres descripciones del menu "/" y el mensaje de la
 * fila de otro proyecto.
 *
 * Las cuatro cadenas eran texto VISIBLE y vivian literales en `lib/commands.mjs`. Ahora se leen del catalogo
 * y se miden por lo que el humano ve, no por la clave:
 *
 *   · `skill-proposals`, `skill-pending` y `skill-show` entregan su descripcion en `en` (base) y en `es`;
 *   · la fila de otro proyecto devuelve las MISMAS tres lineas, con el id y el proyecto de origen, en el
 *     idioma que toque;
 *   · identificadores, argumentos y resultado no cambian: mismo `kind`, mismo estado en disco, mismos ids;
 *   · el texto español es ASCII puro (la deuda del catalogo es cero en los dos idiomas).
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands, targetCommands } from '../lib/commands.mjs';
import { pendingRowsFor } from '../lib/pending-rows.mjs';
import { pending, projectKey, propose } from '../lib/compiler.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const OTRO = 'C:\\xampp\\htdocs\\otro-proyecto';
const ID = 'measured-decision-check';

/** Fija el idioma, ejecuta y deja el entorno como estaba (`null` = sin `DSH_LANG`, el base). */
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
const sinNoAscii = (texto) => (texto.match(/[^\x00-\x7F]/g) ?? []).length === 0;

const DESCRIPCIONES_EN = {
  'skill-proposals': 'Which learned skills are waiting for your approval in this project, and which ones are already active.',
  'skill-pending': 'The ids waiting for a decision, on one line: what the card asks before deciding.',
  'skill-show': 'Read a learned skill of this project: the pending proposal or the one already active.',
};
const DESCRIPCIONES_ES = {
  'skill-proposals': 'Que skills aprendidas esperan tu aprobacion en este proyecto y cuales estan activas.',
  'skill-pending': 'Los ids que esperan decision, en una linea: lo que la tarjeta consulta antes de decidir.',
  'skill-show': 'Lee una skill aprendida de este proyecto: la propuesta pendiente o la ya activa.',
};

function sembrarEn(cwd) {
  const s = sandbox();
  const r = propose(goodInput(), { root: s.root, curated: s.curated, cwd });
  assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts));
  return s;
}

describe('F1.2 grupo 6 · las descripciones del menu se leen del catalogo', () => {
  it('en el idioma base cada comando entrega su descripcion en ingles', () => {
    const s = sembrarEn(CWD);
    con(null, () => {
      const porNombre = comandos(s.root);
      for (const [nombre, texto] of Object.entries(DESCRIPCIONES_EN)) {
        assert.equal(porNombre.get(nombre).description, texto, `${nombre}: la descripcion real no es la del catalogo base`);
      }
    });
  });

  it('con DSH_LANG=es la misma superficie entrega la descripcion en español ASCII', () => {
    const s = sembrarEn(CWD);
    con('es', () => {
      const porNombre = comandos(s.root);
      for (const [nombre, texto] of Object.entries(DESCRIPCIONES_ES)) {
        assert.equal(porNombre.get(nombre).description, texto, `${nombre}: la descripcion real no es la española`);
        assert.equal(sinNoAscii(texto), true, `${nombre}: el texto español lleva algo fuera de ASCII`);
      }
    });
  });

  it('el cambio de idioma no toca identificadores, argumentos ni orden de la superficie', () => {
    const s = sembrarEn(CWD);
    const en = con(null, () => comandos(s.root));
    const es = con('es', () => comandos(s.root));
    assert.deepEqual([...en.keys()], [...es.keys()], 'el conjunto de comandos cambio con el idioma');
    assert.equal(es.get('skill-show').input.hint, en.get('skill-show').input.hint);
    assert.equal(es.get('skill-show').input.hint, '<id>');
    for (const nombre of Object.keys(DESCRIPCIONES_EN)) {
      assert.notEqual(en.get(nombre).description, es.get(nombre).description, `${nombre}: los dos idiomas dicen lo mismo`);
    }
  });

  it('ninguna descripcion pinta una clave cruda', () => {
    const s = sembrarEn(CWD);
    for (const idioma of [null, 'es']) {
      con(idioma, () => {
        for (const [nombre, comando] of comandos(s.root)) {
          assert.equal(/^cmd\./.test(comando.description), false, `${nombre}: se pinta la clave cruda`);
          assert.equal(comando.description.includes('{'), false, `${nombre}: placeholder sin sustituir`);
        }
      });
    }
  });
});

describe('F1.2 grupo 6 · la fila de otro proyecto, en los dos idiomas', () => {
  const filaDeOtro = (root) => targetCommands({ root, rows: pendingRowsFor({ root, cwd: OTRO }) })
    .find((row) => row.name === `skill-approve-${ID}`);

  it('en ingles: tres lineas que nombran el id, el proyecto de origen y la sesion', () => {
    const s = sembrarEn(OTRO);
    const resultado = con(null, () => filaDeOtro(s.root).handler(fakeExec(CWD)));
    assert.equal(resultado.kind, 'error');
    assert.equal(resultado.text, [
      `"${ID}" is pending in otro-proyecto, not in this session.`,
      `This session works in ${CWD}.`,
      'Open it from the project it belongs to: scope is not chosen by hand.',
    ].join('\n'));
  });

  it('en español: el mismo contrato, ASCII puro y las mismas menciones', () => {
    const s = sembrarEn(OTRO);
    const resultado = con('es', () => filaDeOtro(s.root).handler(fakeExec(CWD)));
    assert.equal(resultado.kind, 'error');
    assert.equal(resultado.text, [
      `"${ID}" esta pendiente en otro-proyecto, no en esta sesion.`,
      `Esta sesion trabaja en ${CWD}.`,
      'Abrela desde el proyecto que le corresponde: el ambito no se elige a mano.',
    ].join('\n'));
    assert.equal(sinNoAscii(resultado.text), true, 'el mensaje español lleva algo fuera de ASCII');
  });

  it('equivale en los dos idiomas: mismo veredicto y nada movido en disco', () => {
    const a = sembrarEn(OTRO);
    const b = sembrarEn(OTRO);
    const en = con(null, () => filaDeOtro(a.root).handler(fakeExec(CWD)));
    const es = con('es', () => filaDeOtro(b.root).handler(fakeExec(CWD)));
    assert.equal(en.kind, es.kind);
    for (const s of [a, b]) {
      assert.equal(existsSync(join(s.root, 'projects', projectKey(OTRO), 'approved', ID)), false, 'la fila aprobo en el proyecto equivocado');
      assert.equal(pending({ root: s.root, key: projectKey(OTRO) }).length, 1, 'la propuesta de origen desaparecio');
      assert.equal(pending({ root: s.root, key: projectKey(CWD) }).length, 0, 'aparecio una propuesta en la sesion equivocada');
    }
    assert.equal(en.text.split('\n').length, es.text.split('\n').length);
  });
});
