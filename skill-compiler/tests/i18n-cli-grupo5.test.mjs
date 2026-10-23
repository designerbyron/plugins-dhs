/**
 * F1.2 · pruebas POR IDIOMA del grupo 5: la prosa humana del CLI y los diagnosticos que mezclaban idiomas.
 *
 * Dos cosas distintas se prueban aqui, y por eso hay dos clases de caso:
 *
 *   1. **El CLI de verdad**, como lo ejecuta una persona: un subproceso por idioma, con `DSH_HOME` en una
 *      arena y `DSH_LANG` puesto a mano (el idioma de fuera no se hereda, para no depender del orden). Se
 *      compara el codigo de salida —que es el contrato— y que la prosa sea del idioma pedido.
 *   2. **El diagnostico**: `estado` y `motivo` son datos en espanol y no se tocan; lo que se traduce es su
 *      representacion. Se prueba con una declaracion de propiedad rota de verdad en disco.
 *
 * Y en los dos casos la regla de siempre: el idioma no puede cambiar el efecto. Si cambia el codigo de
 * salida o el dato, es un defecto, no una traduccion.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { resetLangCache } from '../lib/i18n/index.mjs';
import { estadoEnTexto, leerPropiedad, motivoEnTexto, textoDeSistemas, textoDelEstado } from '../lib/scope.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CLI = join(process.cwd(), 'bin', 'skill-compiler.mjs');

/** Ejecuta con un idioma concreto y deja el entorno como estaba, sin depender del orden de las pruebas. */
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

/** El CLI real: arena propia y `DSH_LANG` explicito. El codigo de salida se devuelve, no se lanza. */
function cli(arena, idioma, ...args) {
  const env = { ...process.env, DSH_HOME: arena.base };
  delete env.DSH_LANG;
  if (idioma !== null) env.DSH_LANG = idioma;
  try {
    const salida = execFileSync(process.execPath, [CLI, ...args], {
      cwd: process.cwd(), env, encoding: 'utf8', stdio: 'pipe',
    });
    return { code: 0, salida };
  } catch (error) {
    return { code: error.status ?? 1, salida: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** Una arena con la carpeta de proyectos, que es lo que `doctor` necesita para no dar un falso ENOENT. */
function arenaLista() {
  const s = sandbox();
  mkdirSync(join(s.root, 'projects'), { recursive: true });
  return s;
}

describe('F1.2 · grupo 5 en los dos idiomas · la ayuda', () => {
  it('la ayuda se pinta entera en el idioma pedido y nombra los MISMOS comandos', () => {
    const s = arenaLista();
    const en = cli(s, 'en');
    const es = cli(s, 'es');

    assert.equal(en.code, 2, 'sin comando, la ayuda es un uso mal dicho: 2');
    assert.equal(es.code, 2, 'el codigo de salida no depende del idioma');

    // La sintaxis es un dato: los mismos comandos y las mismas opciones, letra a letra.
    const comandos = (texto) => [...texto.matchAll(/skill-compiler\.mjs ([a-z]+)\b/g)].map((m) => m[1]);
    assert.deepEqual(new Set(comandos(en.salida)), new Set(comandos(es.salida)), 'la ayuda no puede prometer cosas distintas por idioma');
    assert.ok(comandos(en.salida).length >= 30, `la ayuda se quedo corta: ${comandos(en.salida).length} lineas`);
    assert.match(en.salida, /audit \[--json\] \[--estado X\] \[--todo\]/, 'la sintaxis no se traduce');
    assert.match(es.salida, /audit \[--json\] \[--estado X\] \[--todo\]/);

    // Y la prosa si: cada idioma con la suya, y sin la del otro.
    assert.match(en.salida, /^Commands:$/m);
    assert.match(en.salida, /^Options: --project-key/m);
    assert.match(en.salida, /^Exit: 0 ok/m);
    assert.doesNotMatch(en.salida, /Comandos:|Opciones:|Salida:|Desde la sesion:/);

    assert.match(es.salida, /^Comandos:$/m);
    assert.match(es.salida, /^Opciones: --project-key/m);
    assert.match(es.salida, /^Salida: 0 correcto/m);
    assert.doesNotMatch(es.salida, /Commands:|Options:|Exit: 0 ok|From the session:/);

    // La ayuda anuncia lo que se hace desde la sesion: es el texto que enlaza CLI y plugin, y el nombre que
    // anuncia es el del registro ACTIVO. Antes citaba `/skill-pending` en los dos idiomas, que en espanol es
    // una instruccion que no existe: el comando se llama `/skill-pendientes`.
    assert.match(en.salida, /\/skill-pending\b/);
    assert.match(es.salida, /\/skill-pendientes\b/);
    assert.doesNotMatch(es.salida, /\/skill-pending\b/, 'el nombre del otro idioma no se anuncia');
  });

  it('una opcion desconocida se dice en el idioma que toca y sale con 2', () => {
    const s = arenaLista();
    const en = cli(s, 'en', 'list', '--no-existe');
    const es = cli(s, 'es', 'list', '--no-existe');
    assert.equal(en.code, 2);
    assert.equal(es.code, 2);
    assert.match(en.salida, /Unknown option: --no-existe/);
    assert.match(es.salida, /Opcion desconocida: --no-existe/);
    assert.doesNotMatch(en.salida, /Opcion desconocida/);
  });
});

describe('F1.2 · grupo 5 en los dos idiomas · los comandos que informan', () => {
  const COMANDOS = [['where'], ['list'], ['retired'], ['active'], ['provenance', 'no-existe']];

  it('en una arena vacia, cada uno contesta en su idioma con el MISMO codigo de salida', () => {
    const s = arenaLista();
    for (const args of COMANDOS) {
      const en = cli(s, 'en', ...args);
      const es = cli(s, 'es', ...args);
      assert.equal(en.code, es.code, `${args.join(' ')}: el idioma no puede cambiar el veredicto`);
      assert.equal(en.salida.includes('ninguna skill activa'), false, `${args.join(' ')}: prosa espanola en la salida inglesa`);
      assert.equal(es.salida.includes('no active skill'), false, `${args.join(' ')}: prosa inglesa en la salida espanola`);
    }
    // Y donde hay un dato, el dato sale en los dos: la clave del proyecto no se traduce.
    const en = cli(s, 'en', 'where');
    const es = cli(s, 'es', 'where');
    assert.match(en.salida, /^ {2}project: .+$/m);
    assert.match(es.salida, /^ {2}proyecto: .+$/m);
    assert.match(en.salida, /^ {2}data: {4}.+$/m);
    assert.match(es.salida, /^ {2}datos: {4}.+$/m);
    const valor = (texto, etiqueta) => new RegExp(`^ {2}${etiqueta}: (.+)$`, 'm').exec(texto)[1];
    assert.equal(valor(en.salida, 'project'), valor(es.salida, 'proyecto'), 'la clave del proyecto es un dato, no prosa');
  });

  it('`lang` informa el efectivo con su fuente, y un idioma no admitido se rechaza igual en los dos', () => {
    const s = arenaLista();
    const enPorDefecto = cli(s, null, 'lang');
    assert.equal(enPorDefecto.code, 0);
    assert.match(enPorDefecto.salida, /^language: en \(source: default\)$/m);

    const esPorEntorno = cli(s, 'es', 'lang');
    assert.equal(esPorEntorno.code, 0);
    assert.match(esPorEntorno.salida, /^idioma: es \(fuente: env\)$/m);
    assert.equal(esPorEntorno.salida.includes('language:'), false);

    const enMalo = cli(s, 'en', 'lang', 'fr');
    const esMalo = cli(s, 'es', 'lang', 'fr');
    assert.equal(enMalo.code, 2);
    assert.equal(esMalo.code, 2);
    assert.match(enMalo.salida, /unsupported language "fr": use en, es/);
    assert.match(esMalo.salida, /idioma no admitido "fr": usa en, es/);
    assert.doesNotMatch(enMalo.salida, /idioma no admitido/);
  });

  it('`doctor` dice el idioma, y el diagnostico de la propiedad sale entero en el idioma de quien lee', () => {
    const s = arenaLista();
    const en = cli(s, 'en', 'doctor');
    const es = cli(s, 'es', 'doctor');
    assert.equal(en.code, es.code, 'el semaforo de doctor no puede depender del idioma');

    assert.match(en.salida, /^language: en \(source: env\)$/m);
    assert.match(es.salida, /^idioma: es \(fuente: env\)$/m);

    // El defecto que cierra este grupo: el marco traducido con el motivo en espanol dentro.
    assert.match(en.salida, /machine ownership: ABSENT \(nobody has answered\)/);
    assert.match(es.salida, /propiedad del puesto: AUSENTE \(nadie ha respondido\)/);
    assert.equal(en.salida.includes('nadie ha respondido'), false, 'el ingles no puede llevar el motivo en espanol');
    assert.equal(es.salida.includes('nobody has answered'), false);

    // La ayuda de remedio tambien: es prosa que se lee cuando algo va mal.
    assert.match(en.salida, /the manifest declares its dependencies/);
    assert.match(es.salida, /el manifiesto declara sus dependencias/);
  });
});

describe('F1.2 · grupo 5 en los dos idiomas · el diagnostico no se traduce, su representacion si', () => {
  it('un estado y un motivo conocidos se dicen en el idioma pedido; uno desconocido se pinta tal cual', () => {
    assert.equal(con('es', () => estadoEnTexto('ausente')), 'ausente', 'el espanol no cambia de palabra');
    assert.equal(con(null, () => estadoEnTexto('ausente')), 'absent');
    assert.equal(con('es', () => motivoEnTexto('nadie ha respondido')), 'nadie ha respondido');
    assert.equal(con(null, () => motivoEnTexto('nadie ha respondido')), 'nobody has answered');

    // Reserva: sin traduccion no se inventa nada ni se pinta una clave cruda.
    const raro = 'un diagnostico que todavia no tiene clave';
    assert.equal(con(null, () => motivoEnTexto(raro)), raro);
    assert.equal(con(null, () => estadoEnTexto('estado-futuro')), 'estado-futuro');
    assert.equal(con(null, () => motivoEnTexto(undefined)), '');
  });

  it('el detalle del motivo se conserva literal (codigo, ruta, cuenta) en los dos idiomas', () => {
    const conDetalle = 'la declaración no es JSON válido (Unexpected token } in JSON at position 3)';
    assert.match(con(null, () => motivoEnTexto(conDetalle)), /Unexpected token \} in JSON at position 3/);
    assert.match(con(null, () => motivoEnTexto('4 carpeta(s) sin poder leer')), /^4 folder\(s\)/);
    assert.equal(
      con(null, () => motivoEnTexto('fuera del ámbito autorizado (C:/otro/sitio)')),
      'outside the authorised scope (C:/otro/sitio)',
      'la ruta es un dato: no se toca',
    );
  });

  it('una declaracion de propiedad rota se lee en los dos idiomas sin tocar el fichero ni el dato', () => {
    const s = arenaLista();
    const ruta = join(s.root, 'ownership.json');
    writeFileSync(ruta, `${JSON.stringify({ ownership: 'nadie', declaredAt: '2026-01-01T00:00:00.000Z' })}\n`, 'utf8');
    const antes = readFileSync(ruta, 'utf8');

    const estado = leerPropiedad({ root: s.root });
    assert.equal(estado.estado, 'invalida', 'el estado es un dato del contrato');
    assert.match(estado.motivo, /la declaración no dice/, 'el motivo guardado sigue siendo el de siempre');

    const en = con(null, () => textoDelEstado(estado));
    const es = con('es', () => textoDelEstado(estado));
    assert.match(en, /state: invalid/);
    assert.match(en, /says neither "dsh-only" nor "machine"/);
    assert.equal(en.includes('no dice'), false, 'el ingles no puede llevar el motivo en espanol');
    assert.match(es, /estado: invalida/);
    assert.match(es, /no dice "dsh-only" ni "machine"/);
    assert.equal(es.includes('says neither'), false);

    assert.equal(readFileSync(ruta, 'utf8'), antes, 'leer en dos idiomas no puede tocar la declaracion');
    assert.equal(leerPropiedad({ root: s.root }).motivo, estado.motivo, 'ni cambiar el motivo persistido');
  });

  it('el inventario traduce el estado de cada fuente y sigue diciendo cual no se pudo leer', () => {
    const s = arenaLista();
    const datos = {
      sistemas: [{
        nombre: 'de-prueba', ruta: 'C:/no/existe', existe: false, estado: 'inexistente',
        motivo: 'la ruta no existe', enlace: false, enlaceRoto: false, ids: [], nuestro: false,
      }],
      totales: { sistemas: 1, existentes: 0, accesibles: 0, ids: 0, colisiones: 0 },
      colisiones: {},
      copiasPropias: {},
      nombresEquivalentes: [],
      sinLeer: [{ nombre: 'de-prueba', ruta: 'C:/no/existe', estado: 'inexistente', motivo: 'la ruta no existe' }],
      completo: false,
    };
    const estado = { estado: 'ausente', motivo: 'nadie ha respondido', ownership: null, huella: null, ruta: 'C:/x/ownership.json' };
    const en = con(null, () => textoDeSistemas({ datos, estado }));
    const es = con('es', () => textoDeSistemas({ datos, estado }));
    assert.match(en, /de-prueba - 0 skill\(s\) - missing: the path does not exist/);
    assert.match(es, /de-prueba - 0 skill\(s\) - inexistente: la ruta no existe/);
    assert.equal(en.includes('la ruta no existe'), false);
    assert.equal(es.includes('the path does not exist'), false);
    assert.equal(s.root.length > 0, true);
  });
});
