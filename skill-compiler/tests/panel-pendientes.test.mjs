/**
 * El store de pendientes del panel: la pieza que decide CUÁNTAS veces se le pregunta al host y qué foto ven
 * todas las tarjetas.
 *
 * Por qué existe esta prueba (defecto medido en una decisión real, 2026-10-23): el panel preguntaba «¿qué está
 * pendiente?» cuatro veces antes de decidir y una después, y el anfitrión **ejecuta un comando para contestar**
 * (no hay canal de lectura), así que cada pregunta dejaba una notificación en el flujo. Además, cada tarjeta
 * guardaba su propia foto: la que había leído antes de publicar seguía ofreciendo aprobar lo ya publicado.
 *
 * Lo que se prueba aquí es el BLOQUE MARCADO del propio `client.js` (no una copia): si alguien cambia el store
 * que se entrega, esto mide el nuevo.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const RAIZ = process.cwd();
const cliente = readFileSync(join(RAIZ, 'client.js'), 'utf8');

function cargarStore() {
  const ini = cliente.indexOf('/* [store:pendientes:inicio]');
  const fin = cliente.indexOf('/* [store:pendientes:fin] */');
  assert.notEqual(ini, -1, 'el bloque del store desapareció de client.js');
  assert.notEqual(fin, -1, 'el bloque del store quedó sin cierre');
  const fuente = cliente.slice(ini, fin);
  return new Function(`${fuente}; return { createPendingStore, pendingStoreFor };`)();
}

/** Un lector que cuenta cuántas veces se le llama (cada llamada es una ejecución de comando en el host). */
function lectorContado(respuestas) {
  const estado = { llamadas: 0 };
  const fn = async () => {
    estado.llamadas += 1;
    const siguiente = respuestas[Math.min(estado.llamadas - 1, respuestas.length - 1)];
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  };
  return { fn, estado };
}

describe('store de pendientes · una lectura, no cinco', () => {
  it('la primera lectura trae la foto, y hasta entonces `ids` es null (no «no hay nada»)', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn, estado } = lectorContado([{ ids: ['a'], medible: true, avisos: new Map() }]);
    store.usarLector(fn);
    assert.equal(store.foto().ids, null, 'antes de leer no se sabe nada, y eso no es «vacío»');
    const foto = await store.leer();
    assert.deepEqual(foto.ids, ['a']);
    assert.equal(foto.medible, true);
    assert.equal(estado.llamadas, 1);
  });

  it('dos preguntas dentro de la ventana cuestan UNA ejecución (y concurrentes, también)', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn, estado } = lectorContado([{ ids: ['a', 'b'], medible: true, avisos: new Map() }]);
    store.usarLector(fn);
    await Promise.all([store.leer(), store.leer(), store.leer()]);
    await store.leer();
    assert.equal(estado.llamadas, 1, `el host ejecutó ${estado.llamadas} veces el comando para el mismo dato`);
  });

  it('`force` vuelve a preguntar aunque la foto sea reciente (el efecto se comprueba de verdad)', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn, estado } = lectorContado([
      { ids: ['a'], medible: true, avisos: new Map() },
      { ids: [], medible: true, avisos: new Map() },
    ]);
    store.usarLector(fn);
    await store.leer();
    const despues = await store.leer({ force: true });
    assert.equal(estado.llamadas, 2);
    assert.deepEqual(despues.ids, [], 'la foto forzada es la nueva');
  });

  it('`invalidar` hace que la próxima lectura pregunte, y así decide la tarjeta', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn, estado } = lectorContado([
      { ids: ['a'], medible: true, avisos: new Map() },
      { ids: [], medible: true, avisos: new Map() },
    ]);
    store.usarLector(fn);
    await store.leer();
    store.invalidar();
    const foto = await store.leer();
    assert.equal(estado.llamadas, 2);
    assert.deepEqual(foto.ids, []);
  });

  it('la ventana caduca: pasado el plazo, se vuelve a preguntar', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn, estado } = lectorContado([{ ids: ['a'], medible: true, avisos: new Map() }]);
    store.usarLector(fn);
    await store.leer();
    await new Promise((listo) => setTimeout(listo, 1600));
    await store.leer();
    assert.equal(estado.llamadas, 2, 'la foto vieja no puede servir para siempre');
  });
});

describe('store de pendientes · todas las tarjetas ven la misma foto', () => {
  it('decidir en una tarjeta deja la lista nueva en las demás', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn } = lectorContado([
      { ids: ['agent-team-specialized-delivery'], medible: true, avisos: new Map() },
      { ids: [], medible: true, avisos: new Map() },
    ]);
    store.usarLector(fn);
    // Dos tarjetas de la misma sesión: las dos se suscriben a la misma foto.
    const vistas = { tarjetaA: null, tarjetaB: null };
    store.suscribir((foto) => { vistas.tarjetaA = foto; });
    store.suscribir((foto) => { vistas.tarjetaB = foto; });
    await store.leer();
    assert.deepEqual(vistas.tarjetaA.ids, ['agent-team-specialized-delivery']);
    assert.deepEqual(vistas.tarjetaB.ids, ['agent-team-specialized-delivery']);
    // La tarjeta A decide: invalida y comprueba el efecto.
    store.invalidar();
    await store.leer({ force: true });
    for (const [nombre, foto] of Object.entries(vistas)) {
      assert.deepEqual(foto.ids, [], `${nombre} sigue ofreciendo lo ya decidido`);
      assert.equal(foto.ids.includes('agent-team-specialized-delivery'), false, `${nombre} ofrece un id ya decidido`);
    }
  });

  it('dos tarjetas de la misma sesion, con operaciones distintas: decide una y la otra ve la foto nueva', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const llamadas = { a: 0, b: 0 };
    // La tarjeta A (aprobar) instala su lector y despues la B (publicar) instala el suyo: la ultima gana como
    // lector, y aun asi la decision de A tiene que dejar la foto nueva para las dos.
    store.usarLector(async () => { llamadas.a += 1; return { ids: ['x'], medible: true, avisos: new Map() }; });
    store.usarLector(async () => { llamadas.b += 1; return { ids: ['x'], medible: true, avisos: new Map() }; });
    const vistas = {};
    store.suscribir((foto) => { vistas.aprobar = foto; });
    store.suscribir((foto) => { vistas.publicar = foto; });

    await store.leer();
    assert.equal(llamadas.a + llamadas.b, 1, 'una sola ejecucion para las dos tarjetas');
    assert.deepEqual(vistas.aprobar.ids, ['x']);
    assert.deepEqual(vistas.publicar.ids, ['x']);

    // La tarjeta A decide: invalida y comprueba el efecto con su lector.
    store.invalidar();
    store.usarLector(async () => { llamadas.b += 1; return { ids: [], medible: true, avisos: new Map() }; });
    await store.leer({ force: true });

    for (const [nombre, foto] of Object.entries(vistas)) {
      assert.deepEqual(foto.ids, [], `la tarjeta de ${nombre} sigue ofreciendo lo ya decidido`);
    }
  });

  it('el lector comun no depende del verbo de la tarjeta (el fallback no cambia de significado)', () => {
    // El verbo de las filas del menu es por comando (`approve`/`retire`); si el lector compartido lo usara, la
    // foto cambiaria segun cual se pinto la ultima. El lector solo habla con `/skill-pending`.
    const ini = cliente.indexOf('const leerPendientes = async () => {');
    assert.notEqual(ini, -1);
    const fin = cliente.indexOf('store.usarLector(leerPendientes);', ini);
    const cuerpo = cliente.slice(ini, fin);
    assert.equal(/listVerbFor\(/.test(cuerpo), false, 'la foto comun no puede depender del verbo de la tarjeta');
    assert.equal(/rowIds\(/.test(cuerpo), false, 'la foto comun no puede depender de las filas del menu');
    assert.match(cuerpo, /runCommand\(sessionId, '\/skill-pending'\)/);
  });

  it('quien se suscribe recibe la foto al momento y puede darse de baja', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn } = lectorContado([{ ids: ['x'], medible: true, avisos: new Map() }]);
    store.usarLector(fn);
    let veces = 0;
    const baja = store.suscribir(() => { veces += 1; });
    await store.leer();
    assert.equal(veces, 1);
    baja();
    store.invalidar();
    await store.leer();
    assert.equal(veces, 1, 'tras darse de baja no se le avisa más');
  });

  it('una sesión, un store: dos sesiones no comparten foto', () => {
    const { pendingStoreFor } = cargarStore();
    assert.equal(pendingStoreFor('s1'), pendingStoreFor('s1'), 'la misma sesión tiene que compartir');
    assert.notEqual(pendingStoreFor('s1'), pendingStoreFor('s2'), 'dos sesiones no pueden compartir la foto');
  });
});

describe('store de pendientes · una lectura que empezo antes de decidir no puede ser la foto final', () => {
  it('invalidar + force no aceptan como estado final la foto en vuelo de antes de la decision', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    let soltarVieja;
    const viejaEnVuelo = new Promise((listo) => { soltarVieja = listo; });
    let llamadas = 0;
    store.usarLector(async () => {
      llamadas += 1;
      if (llamadas === 1) {
        await viejaEnVuelo;
        return { ids: ['agent-team'], medible: true, avisos: new Map() };
      }
      return { ids: [], medible: true, avisos: new Map() };
    });

    // La tarjeta monta y empieza a leer. Ese lector arranco ANTES de que el humano decida.
    const primera = store.leer();
    // El humano decide: el estado del almacen cambia y se invalida la foto.
    store.invalidar();
    // La comprobacion del efecto pide una lectura forzada (no se espera aqui: la vieja sigue en vuelo).
    const forzada = store.leer({ force: true });
    // La vieja termina tarde, despues de la decision.
    soltarVieja();
    const [fotoForzada] = await Promise.all([forzada, primera]);

    assert.equal(llamadas, 2, 'la lectura forzada tiene que ejecutar su propio lector');
    assert.deepEqual(fotoForzada.ids, [], 'la lectura forzada acepto la foto anterior a la decision');
    assert.deepEqual(store.foto().ids, [], 'una lectura vieja sobrescribio la foto posterior a la decision');
  });

  it('dos force concurrentes de la MISMA generacion comparten una sola ejecucion', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    let llamadas = 0;
    store.usarLector(async () => {
      llamadas += 1;
      return { ids: [], medible: true, avisos: new Map() };
    });
    await Promise.all([store.leer({ force: true }), store.leer({ force: true }), store.leer({ force: true })]);
    assert.equal(llamadas, 1, 'sin invalidacion de por medio, el single-flight se conserva');
  });
});

describe('store de pendientes · un fallo de lectura no se convierte en «no hay nada»', () => {
  it('el error se declara, la foto anterior no se pierde y la próxima vuelve a intentarlo', async () => {
    const { createPendingStore } = cargarStore();
    const store = createPendingStore();
    const { fn, estado } = lectorContado([
      { ids: ['a'], medible: true, avisos: new Map() },
      new Error('el host no contestó'),
      { ids: ['a', 'b'], medible: true, avisos: new Map() },
    ]);
    store.usarLector(fn);
    await store.leer();
    store.invalidar();
    const rota = await store.leer();
    assert.match(rota.failure, /el host no contestó/);
    assert.deepEqual(rota.ids, ['a'], 'un fallo de lectura no puede borrar lo que se sabía');
    store.invalidar();
    const buena = await store.leer();
    assert.equal(buena.failure, '');
    assert.deepEqual(buena.ids, ['a', 'b']);
    assert.equal(estado.llamadas, 3);
  });
});
