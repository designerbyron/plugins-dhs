#!/usr/bin/env node
/**
 * Puerta del artefacto de interfaz.
 *
 * `client.js` no se puede ejecutar aquí: es un artefacto de navegador que pide React a la tabla de
 * módulos del anfitrión y vive dentro de la página. Lo que **sí** se puede comprobar —y es lo que
 * rompe de verdad una pieza de UI— es su forma y sus contratos con el resto del plugin:
 *
 *   · que el `id` del artefacto sea el nombre del paquete (el anfitrión lo busca así),
 *   · que pida la proyección con la MISMA clave que declara el Host,
 *   · que registre el idioma dentro de un efecto, para que se retire al descargar,
 *   · que el texto herede el color y el acento pinte solo la marca (la regla de contraste),
 *   · que haya una sola región viva, atómica y con contexto,
 *   · que respete el movimiento reducido, no use emoji y no toque el documento.
 *
 * Es una comprobación sobre el texto del fichero, a propósito: el objetivo es que un cambio futuro que
 * rompa alguno de esos contratos se ponga rojo aquí, y no en la interfaz de nadie.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(PACKAGE_ROOT, rel), 'utf8');

const client = read('client.js');
const manifest = JSON.parse(read('package.json'));
const host = read('index.js');
/** La clave vive con la unidad, en `lib/projection.mjs`; el Host la re-exporta. Las dos cosas se comprueban. */
const projection = read('lib/projection.mjs');

/** El literal de una constante exportada, leído del fuente (no se puede importar `index.js` aquí). */
const literal = (source, name) => new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(source)?.[1];

describe('artefacto de interfaz', () => {
  it('se declara como módulo de navegador con la identidad del paquete', () => {
    assert.match(client, /window\.__ModuleLoader__\.load\(\{/);
    const id = literal(client, 'PACKAGE');
    assert.equal(id, manifest.name, 'el id del artefacto tiene que ser el nombre del paquete');
    assert.equal(manifest.dsh.client.platform, 'web');
    assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'), true,
      'el paquete dueño del slot tiene que estar declarado como dependencia de cliente');
  });

  it('pide React al anfitrión y no lo trae consigo', () => {
    assert.match(client, /require\('react'\)/);
    assert.equal(/from ['"]react['"]/.test(client), false, 'no se importa React como dependencia propia');
  });

  it('pide la proyección con la misma clave que declara el Host', () => {
    const declared = literal(projection, 'LEARNING_KEY');
    const asked = literal(client, 'PROJECTION_KEY');
    assert.equal(declared, 'skillCompiler');
    assert.equal(asked, declared, 'cliente y Host tienen que coincidir en la clave de la proyección');
    // El Host la re-exporta: es parte de su identidad pública, y así sigue estando a la vista en el
    // fichero que lee quien instala el plugin.
    assert.match(host, /export \{ LEARNING_KEY \} from '\.\/lib\/projection\.mjs'/);
    assert.match(client, /useProjection\(PROJECTION_KEY\)/);
  });

  it('registra el idioma y el slot como recursos que se retiran', () => {
    assert.match(client, /ctx\.effect\(\(\)\s*=>\s*ctx\.locale\.register\(NS,\s*DICTIONARIES\)\)/);
    assert.match(client, /ctx\.slots\.inject\(\s*SLOT/);
    assert.match(client, /ctx\.slots\.register\(\{/);
    assert.match(client, /locale:\s*NS/, 'el slot tiene que declarar el espacio de nombres de idioma');
  });

  it('el texto hereda el color y el acento pinta solo la marca', () => {
    // La regla que salió de medir: ningún acento llega a 4.5:1 en los dos temas, así que el texto no
    // puede elegir color. Si alguien vuelve a poner `color: var(--skc-accent)` en la píldora, esto se
    // pone rojo antes de que el texto quede ilegible en un tema sin probar.
    assert.match(client, /\.skc-pill\s*\{[^}]*color:\s*inherit/s);
    assert.equal(/\.skc-pill\s*\{[^}]*color:\s*var\(--skc-accent/s.test(client), false);
    assert.match(client, /\.skc-mark\s*\{[^}]*color:\s*var\(--skc-accent/s);
    assert.match(client, /var\(--skc-accent[^)]*\)/, 'el tinte se deriva del acento');
  });

  it('usa los tonos de la marca en el arte, sin colores ajenos', () => {
    for (const tone of ['#22d3ee', '#3b82f6', '#7c3aed', '#d946ef']) {
      assert.equal(client.includes(tone), true, `falta el tono de marca ${tone}`);
    }
    assert.equal(client.includes('#fbbf24'), false, 'el ámbar no pertenece a la identidad');
  });

  it('tiene una sola región viva, atómica y con la frase entera', () => {
    assert.equal((client.match(/role:\s*'status'/g) ?? []).length, 1, 'una sola región viva, no varias que compitan');
    // Los atributos ARIA se escriben como cadenas: `aria-atomic="true"` en el HTML resultante.
    assert.match(client, /'aria-atomic':\s*'true'/);
    assert.match(client, /'aria-live':\s*'polite'/);
  });

  it('respeta el movimiento reducido', () => {
    assert.match(client, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(client, /animation:\s*none/);
  });

  it('no usa emoji como icono y no toca el documento', () => {
    assert.equal(/\p{Extended_Pictographic}/u.test(client), false, 'los iconos son SVG, no emoji');
    assert.match(client, /'aria-hidden':\s*true/, 'los iconos decorativos se ocultan al lector');
    assert.equal(client.includes('document.body'), false);
    assert.equal(client.includes('document.head'), false, 'los estilos van en el árbol, no al documento');
  });

  it('no depende de que una animación acabe para saber el estado', () => {
    assert.equal(client.includes('animationend'), false, 'el estado se lee del dato, no del fin de la animación');
    assert.equal(client.includes('transitionend'), false);
  });
});
