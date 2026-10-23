/**
 * F1.2 grupo 6 · lo que quedaba fuera del catalogo: las tres descripciones del menu "/" y el mensaje de la
 * fila de otro proyecto.
 *
 * Las cuatro cadenas eran texto VISIBLE y vivian literales en `lib/commands.mjs`. Ahora se leen del catalogo
 * y se miden por lo que el humano ve, no por la clave:
 *
 *   · `skill-proposals`, `skill-pending` y `skill-show` entregan su descripcion en `en` (base) y en `es`;
 *   · la fila de otro proyecto devuelve UNA frase del catalogo (`row.wrong-project`) que nombra el id, el
 *     proyecto de origen, la sesion actual y que el ambito no se elige a mano, en el idioma que toque;
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
import { resetLangCache, t } from '../lib/i18n/index.mjs';
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

const DESCRIPCIONES = {
  'skill-proposals': 'cmd.proposals.description',
  'skill-pending': 'cmd.pending.description',
  'skill-show': 'cmd.show.description',
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
      for (const [nombre, clave] of Object.entries(DESCRIPCIONES)) {
        // El texto esperado se lee del CATALOGO y no se escribe aqui: si el codigo vuelve a clavar la prosa,
        // la definicion y el catalogo dejan de coincidir y esto se pone rojo.
        assert.equal(porNombre.get(nombre).description, t(clave, {}, { lang: 'en' }), `${nombre}: la descripcion real no es la del catalogo base`);
      }
    });
  });

  it('con DSH_LANG=es la misma superficie entrega la descripcion en español ASCII', () => {
    const s = sembrarEn(CWD);
    con('es', () => {
      const porNombre = comandos(s.root);
      for (const [nombre, clave] of Object.entries(DESCRIPCIONES)) {
        const texto = t(clave, {}, { lang: 'es' });
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
    for (const nombre of Object.keys(DESCRIPCIONES)) {
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
  // La fila se busca por su id y su forma, no por el nombre ingles: el prefijo depende del idioma activo
  // (skill-approve en `en`, skill-aprobar en `es`) y aqui se prueban los DOS.
  const filaDeOtro = (root) => targetCommands({ root, rows: pendingRowsFor({ root, cwd: OTRO }) })
    .find((row) => row.name.endsWith(`-${ID}`));

  it('en ingles: una linea que nombra el id, el proyecto de origen y la sesion', () => {
    const s = sembrarEn(OTRO);
    const resultado = con(null, () => filaDeOtro(s.root).handler(fakeExec(CWD)));
    assert.equal(resultado.kind, 'error');
    // La frase es UNA y vive en el catalogo: se compara contra el catalogo, no contra una copia de la prosa.
    assert.equal(resultado.text, t('row.wrong-project', { id: ID, project: 'otro-proyecto', cwd: CWD }, { lang: 'en' }));
    assert.match(resultado.text, /not in this session/);
    assert.ok(resultado.text.includes(CWD), 'la frase no nombra la sesion actual');
    assert.equal(resultado.text.includes('\n'), false, 'la fila de otro proyecto ya no es de tres lineas');
  });

  it('en español: el mismo contrato, ASCII puro y las mismas menciones', () => {
    const s = sembrarEn(OTRO);
    const resultado = con('es', () => filaDeOtro(s.root).handler(fakeExec(CWD)));
    assert.equal(resultado.kind, 'error');
    assert.equal(resultado.text, t('row.wrong-project', { id: ID, project: 'otro-proyecto', cwd: CWD }, { lang: 'es' }));
    assert.match(resultado.text, /no en esta sesion/);
    assert.ok(resultado.text.includes(CWD), 'la frase no nombra la sesion actual');
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
