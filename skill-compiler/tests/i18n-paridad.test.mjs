/**
 * Paridad de catálogos ES/EN.
 *
 * Existe por un defecto real: `bulk_ids_hint` vivía en el bloque inglés con el texto en español y faltaba en
 * castellano, así que un host español pintaba la clave cruda y uno inglés pintaba español. Nada lo veía porque
 * no había prueba de paridad. Esta es esa prueba, y es **bidireccional**.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import en from '../lib/i18n/en.mjs';
import es from '../lib/i18n/es.mjs';

const claves = (d) => Object.keys(d).sort();
const huecos = (texto) => [...String(texto).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catálogos · paridad de claves', () => {
  it('los dos idiomas tienen exactamente las mismas claves', () => {
    assert.deepEqual(claves(es), claves(en));
  });

  it('ningún valor está vacío ni es sólo espacios', () => {
    for (const [idioma, dicc] of [['en', en], ['es', es]]) {
      for (const [clave, valor] of Object.entries(dicc)) {
        assert.equal(typeof valor, 'string', `${idioma}.${clave}`);
        assert.equal(valor.trim().length > 0, true, `${idioma}.${clave} vacío`);
      }
    }
  });

  it('cada clave usa los MISMOS placeholders en ambos idiomas', () => {
    for (const clave of Object.keys(en)) {
      assert.deepEqual(huecos(es[clave]), huecos(en[clave]), `${clave}: placeholders distintos`);
    }
  });

  it('ningún valor repite un placeholder ni deja uno sin cerrar', () => {
    for (const [idioma, dicc] of [['en', en], ['es', es]]) {
      for (const [clave, valor] of Object.entries(dicc)) {
        assert.equal((valor.match(/\{/g) ?? []).length, (valor.match(/\}/g) ?? []).length, `${idioma}.${clave}: llave sin cerrar`);
        const nombres = huecos(valor);
        assert.equal(new Set(nombres).size, nombres.length, `${idioma}.${clave}: placeholder repetido`);
      }
    }
  });
});

describe('catálogos · idioma cruzado', () => {
  // Heurística acotada: palabras funcionales del español que no son palabras inglesas ni nombres propios.
  const ESPANOL = /\b(de|del|la|el|los|las|una|que|para|con|sin|por|como|cuando|desde|hasta|cada|más|pero|aunque|sólo|también|aquí|idioma|fuente|guardado|usa)\b/i;
  const INGLES = /\b(the|and|with|from|this|that|use|language|source|saved|when|each|only|also|here)\b/i;
  // Los placeholders se llaman igual en los dos idiomas y no son texto: se quitan antes de mirar el idioma.
  const sinHuecos = (valor) => String(valor).replace(/\{\w+\}/g, ' ');

  it('el catálogo inglés no contiene frases en español', () => {
    const sospechosas = Object.entries(en).filter(([, valor]) => ESPANOL.test(sinHuecos(valor))).map(([clave]) => clave);
    assert.deepEqual(sospechosas, [], `claves con texto español en el catálogo inglés: ${sospechosas.join(', ')}`);
  });

  it('el catálogo español no contiene frases en inglés', () => {
    const sospechosas = Object.entries(es).filter(([, valor]) => INGLES.test(sinHuecos(valor))).map(([clave]) => clave);
    assert.deepEqual(sospechosas, [], `claves con texto inglés en el catálogo español: ${sospechosas.join(', ')}`);
  });

  it('ningún valor es una clave cruda (contiene punto y no espacios)', () => {
    for (const [idioma, dicc] of [['en', en], ['es', es]]) {
      for (const [clave, valor] of Object.entries(dicc)) {
        assert.equal(/^[a-z]+(\.[a-z-]+)+$/.test(valor.trim()), false, `${idioma}.${clave} parece una clave`);
      }
    }
  });
});
