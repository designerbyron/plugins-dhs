#!/usr/bin/env node
/**
 * Aprendizaje en lote: varias skills y varios parches en una sesión.
 *
 * ── El defecto que esto mide ────────────────────────────────────────────────────────────────────
 *
 * El veto de solapamiento comparaba **descripción y disparador completos**, así que medía el **estilo** de
 * redacción además del tema. Con skills del mismo autor —las cuatro muletillas «pasos medidos», «orden
 * comprobado», «trampas ya pagadas», «en este proyecto»— la parte común pesaba más que la que distingue, y
 * tres temas claramente distintos se vetaban entre sí: una sesión que aprendía tres cosas solo podía
 * proponer una.
 *
 * Los pares de aquí abajo están **etiquetados a mano** (lo que debe vetarse y lo que no) y son el corpus con
 * el que se calibró el umbral. Un veto que deja pasar un duplicado real es un defecto; un veto que rechaza
 * dos temas distintos, también.
 *
 *   node --test tests/aprendizaje-en-lote.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { approve, checkOverlap, existingSkills, projectKey, propose, similarity } from '../lib/compiler.mjs';
import { applyLearning, initialLearning, learningView, partesDeActividad, resumenDeActividad } from '../lib/presentation.mjs';
import { pendingRowsFor } from '../lib/pending-rows.mjs';
import { historial, leerDiario, promover } from '../lib/promote.mjs';
import { reparar } from '../lib/repair.mjs';
import { skillPropose } from '../lib/definitions.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);

/** El estilo de la casa: lo que escribe el mismo autor en todas sus skills, y que no distingue nada. */
const estilo = (tema) => `Guía para ${tema}, con los pasos medidos, el orden comprobado y las trampas ya pagadas.`;
const disparador = (tema) => `Cuando haya que ${tema} en este proyecto sin improvisar.`;
/**
 * Una skill del corpus con **id descriptivo del tema**, que es como se nombran de verdad: el nombre declara
 * el tema, y por eso cuenta como señal. Con ids genéricos (`primera-propuesta`, `segunda-propuesta`) la
 * comparación medía el ruido de mis propios fixtures en vez del tema.
 */
const slug = (tema) => tema.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const skill = (id, tema, { tags = [] } = {}) => ({ id: id ?? slug(tema), description: estilo(tema), whenToUse: disparador(tema), tags });

/**
 * La biblioteca con la que se calcula qué es estilo y qué es tema. Sus temas **no** son ninguno de los pares
 * que se juzgan: si el corpus contuviera el mismo tema que se está midiendo, el veredicto lo decidiría la
 * gemela del corpus y no el par — que es un fixture midiendo otra cosa (ya pasó dos veces montándolo).
 */
const BIBLIOTECA = [
  ['medir-el-rendimiento-de-la-web', 'medir el rendimiento de la web'],
  ['archivar-los-justificantes-del-trimestre', 'archivar los justificantes del trimestre'],
  ['controlar-el-stock-del-almacen-central', 'controlar el stock del almacén central'],
  ['reservar-las-salas-de-reunion', 'reservar las salas de reunión'],
  ['registrar-las-horas-del-equipo', 'registrar las horas del equipo'],
  ['valorar-el-estado-de-la-furgoneta', 'valorar el estado de la furgoneta'],
  ['preparar-el-pedido-de-material-de-oficina', 'preparar el pedido de material de oficina'],
  ['medir-el-consumo-electrico-de-la-nave', 'medir el consumo eléctrico de la nave'],
];

const corpus = BIBLIOTECA.map(([id, tema]) => ({ ...skill(id, tema), where: `aprobado:${'proyecto-de-prueba'}` }));
/**
 * ¿Se veta proponer `b` cuando `a` ya está en el mismo proyecto? Se comparan **entre sí** (con ids distintos,
 * como en la vida), y el corpus sólo aporta los pesos. Se pasa `scope`, que es como lo llama `propose`: sin
 * él, todo se clasifica como «relacionado en otro ámbito» y nada se veta — un fixture que mide otra cosa da
 * un rojo que señala al sitio equivocado.
 */
const AMBITO = 'proyecto-de-prueba';
const veredicto = (a, b, extra = {}) => checkOverlap(
  skill(null, b, extra),
  [{ ...skill(null, a, extra), where: `propuesto:${AMBITO}` }, ...corpus],
  { scope: AMBITO },
).ok;

describe('el veto mide tema, no estilo', () => {
  it('dos redacciones del MISMO tema se siguen vetando', () => {
    const mismoTema = [
      ['restaurar copia de seguridad MySQL', 'restaurar copia de seguridad de MySQL'],
      ['migrar de MySQL 8.2 a MariaDB', 'migrar de MySQL 8.3 a MariaDB'],
      ['optimizar los índices lentos', 'optimizar los índices de las tablas lentas'],
      ['rotar los ficheros de log del servidor', 'rotar los ficheros de log del servidor web'],
      ['respaldar las bases de datos de producción', 'respaldar la base de datos de producción'],
      ['inventariar los puertos abiertos del servidor', 'inventariar los puertos que escucha el servidor'],
    ];
    for (const [a, b] of mismoTema) {
      assert.equal(veredicto(a, b), false, `«${a}» y «${b}» son el mismo tema y tiene que vetarse`);
    }
  });

  it('el mismo tema con SINÓNIMOS se caza por la etiqueta declarada, no por adivinar el vocabulario', () => {
    // «respaldar» y «hacer copia de seguridad» son el mismo procedimiento y no comparten una sola palabra
    // de tema. Un parecido de vocabulario no puede verlo, y no se le va a pedir: el tema se **declara**.
    const a = 'respaldar las bases de datos antes de migrar';
    const b = 'hacer copia de seguridad de la base antes de migrar';
    const sinEtiqueta = checkOverlap(
      skill(null, b),
      [{ ...skill(null, a), where: `aprobado:${AMBITO}` }, ...corpus],
      { scope: AMBITO },
    );
    // Sin etiquetas, el vocabulario no basta y se dice tal cual: queda como propuesta, con el humano delante.
    assert.equal(sinEtiqueta.ok, true, 'sin etiqueta no hay forma determinista de saberlo: no se finge');

    const conEtiqueta = checkOverlap(
      skill(null, b, { tags: ['Respaldos de Producción'] }),
      [{ ...skill(null, a, { tags: ['respaldos-de-produccion'] }), where: `aprobado:${AMBITO}` }, ...corpus],
      { scope: AMBITO },
    );
    assert.equal(conEtiqueta.ok, false, 'con la misma etiqueta declarada, el choque es determinista');
    assert.equal(conEtiqueta.conflicts[0].reason, 'mismo-tag');
    assert.deepEqual(conEtiqueta.conflicts[0].tags, ['respaldos-de-produccion']);
  });

  it('dos temas DISTINTOS no se vetan, aunque el estilo sea idéntico', () => {
    const distintos = [
      ['firmar contratos PDO locales', 'escribir migradores de esquema'],
      ['inventariar los puertos abiertos', 'renovar los certificados TLS'],
      ['ajustar los permisos de carpetas', 'optimizar los índices lentos'],
      ['respaldar antes de migrar', 'programar correos de aviso'],
      ['revisar los certificados de la intranet', 'compilar las hojas de estilo del tema'],
    ];
    for (const [a, b] of distintos) {
      assert.equal(veredicto(a, b), true, `«${a}» y «${b}» no son el mismo tema: el veto no puede rechazarlos`);
    }
  });

  it('la separación entre una cosa y la otra es holgada, no un empate al filo', () => {
    // Con la huella anterior los pares distintos daban 0,708–0,739 y los del mismo tema 0,800–1,000: seis
    // centésimas de margen. Aquí se exige que la frontera no esté al filo, porque un umbral al filo veta
    // por casualidad según cómo se redacte.
    const contexto = { corpus };
    const distintos = [
      ['firmar contratos PDO locales', 'escribir migradores de esquema'],
      ['respaldar antes de migrar', 'programar correos de aviso'],
      ['inventariar los puertos abiertos', 'renovar los certificados TLS'],
    ].map(([a, b]) => similarity(skill(null, a), skill(null, b), contexto));
    const mismos = [
      ['restaurar copia de seguridad MySQL', 'restaurar copia de seguridad de MySQL'],
      ['migrar de MySQL 8.2 a MariaDB', 'migrar de MySQL 8.3 a MariaDB'],
    ].map(([a, b]) => similarity(skill(null, a), skill(null, b), contexto));
    const techoDistintos = Math.max(...distintos);
    const sueloMismos = Math.min(...mismos);
    assert.ok(techoDistintos <= 0.05, `un tema distinto puntúa ${techoDistintos.toFixed(3)}: el estilo sigue pesando en el veto`);
    assert.ok(sueloMismos >= 0.5, `un duplicado real puntúa ${sueloMismos.toFixed(3)}: el veto lo dejaría pasar`);
    assert.ok(sueloMismos - techoDistintos > 0.35, `el margen (${(sueloMismos - techoDistintos).toFixed(3)}) es demasiado estrecho para fiar el veto a él`);
  });

  it('sin corpus, la comparación se comporta como siempre (compatible hacia atrás)', () => {
    // El corpus es lo que aporta la frecuencia documental. Sin él, la vara es la de antes: nadie que llame
    // a `similarity` con dos argumentos ve un cambio de comportamiento inesperado.
    const a = skill('x', 'respaldar antes de migrar');
    const b = skill('y', 'respaldar antes de migrar');
    assert.equal(similarity(a, b), 1);
  });
});

describe('varias habilidades en una sesión, por la herramienta real', () => {
  const herramienta = (arena) => defineTool(skillPropose({ root: arena.root, curated: arena.curated }));

  it('tres temas distintos se proponen los tres', async () => {
    const arena = sandbox({ curated: false });
    const tool = herramienta(arena);
    const exec = { agent: { session: { header: { cwd: CWD } } } };
    const input = (id, tema) => ({
      id, description: estilo(tema), whenToUse: disparador(tema),
      body: `## Cuándo se usa\n\nCuando toca ${tema}, con los datos delante y sin prisa.\\n\\n## Procedimiento\n\n1. Inspecciona ${tema} y anota el número que sale.\\n2. Ejecuta el paso y registra lo observado.\\n3. Cierra solo si las dos medidas coinciden.`,
    });
    const temas = [
      ['inventario-de-puertos', 'inventariar los puertos abiertos del servidor'],
      ['renovacion-de-certificados', 'renovar los certificados TLS antes de que caduquen'],
      ['rotacion-de-logs-web', 'rotar los ficheros de log sin perder el día en curso'],
    ];
    const resultados = [];
    for (const [id, tema] of temas) resultados.push({ id, ...(await tool.execute(input(id, tema), exec)) });
    for (const r of resultados) {
      assert.equal(r.status, 'proposed', `${r.id} no se pudo proponer: ${JSON.stringify(r.conflicts ?? r.errors)}`);
    }
  });

  it('y un duplicado real de lo ya propuesto se sigue vetando', async () => {
    const arena = sandbox({ curated: false });
    const tool = herramienta(arena);
    const exec = { agent: { session: { header: { cwd: CWD } } } };
    const cuerpo = (tema) => `## Cuándo se usa\n\nCuando toca ${tema}, con los datos delante y sin prisa.\n\n## Procedimiento\n\n1. Inspecciona ${tema} y anota el número que sale.\n2. Ejecuta el paso y registra lo observado.\n3. Cierra solo si las dos medidas coinciden.`;
    const primera = await tool.execute({ id: 'respaldos-de-produccion', description: estilo('respaldar las bases de datos de producción'), whenToUse: disparador('respaldar las bases de datos de producción'), body: cuerpo('respaldar las bases de datos de producción') }, exec);
    assert.equal(primera.status, 'proposed');
    // El mismo tema con otro nombre y otra redacción: tiene que seguir chocando.
    const segunda = await tool.execute({ id: 'copias-de-la-base-de-datos', description: estilo('respaldar la base de datos de producción'), whenToUse: disparador('respaldar la base de datos de producción'), body: cuerpo('respaldar la base de datos de producción') }, exec);
    assert.equal(segunda.status, 'conflict', 'un duplicado real no puede colarse por el cambio de umbral');
    assert.match(segunda.summary ?? '', /No se escribió nada|ya existe|choca/i);
  });
});

describe('un lote: varias propuestas que van juntas', () => {
  const cuerpo = (tema) => `## Cuándo se usa\n\nCuando toca ${tema}, con los datos delante y sin prisa.\n\n## Procedimiento\n\n1. Inspecciona ${tema} y anota el número que sale.\n2. Ejecuta el paso y registra lo observado.\n3. Cierra solo si las dos medidas coinciden.`;
  const exec = { agent: { session: { header: { cwd: CWD } } } };
  const tema = (t) => ({ description: estilo(t), whenToUse: disparador(t), body: cuerpo(t) });
  const GRUPO = { id: 'respaldos-antes-de-migrar', motivo: 'las tres nacen del mismo incidente del 2026-10-16 y solo tienen sentido juntas' };

  it('las hermanas de un lote NO se vetan entre sí, y se avisa del parecido', async () => {
    const arena = sandbox({ curated: false });
    const tool = defineTool(skillPropose({ root: arena.root, curated: arena.curated }));
    const primera = await tool.execute({ id: 'respaldos-de-mysql-antes-de-migrar', ...tema('respaldar las bases de MySQL antes de migrar'), group: GRUPO }, exec);
    assert.equal(primera.status, 'proposed', JSON.stringify(primera.conflicts ?? primera.errors ?? []));
    // La segunda toca el mismo asunto (y por eso se parecería demasiado), pero es otra skill: el lote dice
    // que van juntas y por qué, así que se propone **con el aviso**, no con un veto.
    const segunda = await tool.execute({ id: 'respaldos-de-mariadb-antes-de-migrar', ...tema('respaldar las bases de MariaDB antes de migrar'), group: GRUPO }, exec);
    assert.equal(segunda.status, 'proposed', JSON.stringify(segunda.conflicts ?? segunda.errors ?? []));
    assert.equal(segunda.siblings?.[0]?.id, 'respaldos-de-mysql-antes-de-migrar');
    assert.ok(segunda.siblings[0].score >= 0.4, 'el aviso tiene que decir cuánto se parecen');
    assert.ok((segunda.warnings ?? []).some((w) => /lote|grupo|hermana/i.test(w)), 'y decirlo en el texto que el modelo lee');
  });

  it('sin lote, el mismo parecido se sigue vetando', async () => {
    const arena = sandbox({ curated: false });
    const tool = defineTool(skillPropose({ root: arena.root, curated: arena.curated }));
    await tool.execute({ id: 'respaldos-de-mysql-antes-de-migrar', ...tema('respaldar las bases de MySQL antes de migrar') }, exec);
    const suelta = await tool.execute({ id: 'respaldos-de-mariadb-antes-de-migrar', ...tema('respaldar las bases de MariaDB antes de migrar') }, exec);
    assert.equal(suelta.status, 'conflict', 'la vía del lote no puede aflojar el veto de los duplicados reales');
  });

  it('el lote queda escrito en la propuesta, y sin motivo no se acepta', async () => {
    const arena = sandbox({ curated: false });
    const tool = defineTool(skillPropose({ root: arena.root, curated: arena.curated }));
    const r = await tool.execute({ id: 'limpiar-los-temporales-del-despliegue', ...tema('limpiar los temporales del despliegue'), group: GRUPO }, exec);
    assert.equal(r.status, 'proposed');
    const meta = JSON.parse(readFileSync(join(arena.root, 'projects', KEY, 'proposed', 'limpiar-los-temporales-del-despliegue', 'meta.json'), 'utf8'));
    assert.deepEqual(meta.group, GRUPO);
    // Un lote sin motivo no es un lote: es un atajo para saltarse el veto. Lo para el **esquema de la
    // herramienta**, antes de ejecutar nada — más arriba que la validación del motor, y así se prueba.
    await assert.rejects(
      () => tool.execute({ id: 'otra-cosa-distinta', ...tema('otra cosa distinta'), group: { id: 'lote-sin-motivo' } }, exec),
      /motivo/,
      'el esquema tiene que exigir el motivo antes de que el motor llegue a mirarlo',
    );
    // Y un motivo de una palabra pasa el esquema pero no es un motivo: ahí decide el motor.
    const motivoVacio = await tool.execute({ id: 'otra-cosa-distinta', ...tema('otra cosa distinta'), group: { id: 'lote-sin-motivo', motivo: 'porque si' } }, exec);
    assert.equal(motivoVacio.status, 'invalid');
    assert.ok(motivoVacio.errors.some((e) => /motivo/i.test(e)));
    // El identificador del lote es un identificador: kebab-case ASCII, sin acentos ni mayúsculas.
    const idMalo = await tool.execute({ id: 'otra-cosa-mas', ...tema('otra cosa más'), group: { id: 'Lote de Respaldo', motivo: 'un motivo suficientemente largo para pasar la puerta' } }, exec);
    assert.equal(idMalo.status, 'invalid');
    assert.ok(idMalo.errors.some((e) => /group\.id/.test(e)));
  });

  it('el lote lo acepta la HERRAMIENTA, con sus tres campos (incluido `esperadas`)', async () => {
    // Este caso faltaba, y por eso el defecto llegó hasta la prueba de fuego: los demás pasaban el lote por
    // el motor y `esperadas` no estaba declarado en el esquema del parámetro, así que el harness rechazaba
    // la llamada entera con «not a declared property». Lo que el modelo puede enviar lo prueba la
    // herramienta, no el motor.
    const arena = sandbox({ curated: false });
    const tool = defineTool(skillPropose({ root: arena.root, curated: arena.curated }));
    const r = await tool.execute({ id: 'respaldos-de-produccion', ...tema('respaldar las bases de producción'), group: { ...GRUPO, esperadas: 2 } }, exec);
    assert.equal(r.status, 'proposed', JSON.stringify(r.errors ?? r.conflicts ?? []));
    assert.deepEqual(r.group, { ...GRUPO, esperadas: 2 });
    assert.ok(Number.isInteger(r.group.esperadas), 'el motor conserva el número de propuestas del lote');
  });

  it('una etiqueta con acento se tolera y se avisa con la forma canónica', async () => {
    const arena = sandbox({ curated: false });
    const tool = defineTool(skillPropose({ root: arena.root, curated: arena.curated }));
    const r = await tool.execute({ id: 'respaldos-de-produccion', ...tema('respaldar las bases de producción'), tags: ['Respaldos de Producción'] }, exec);
    assert.equal(r.status, 'proposed');
    assert.ok((r.warnings ?? []).some((w) => /kebab-case ASCII/i.test(w)), 'los identificadores no llevan acentos: se tolera y se dice');
  });
});

describe('un lote no se activa a medias', () => {
  const tema = (id) => ({
    id,
    description: `Mantiene al día el ${id.replace(/-/g, ' ')} con pasos medidos y comprobados en producción.`,
    whenToUse: `Cuando haya que ocuparse del ${id.replace(/-/g, ' ')} tras una recepción de material.`,
    body: ['## Cuándo se usa', '', `Cuando toca el ${id.replace(/-/g, ' ')}, con las hojas de conteo delante.`, '',
      '## Procedimiento', '', '1. Recorre el registro entero y anota el número que sale.',
      '2. Compara con el registro previo y declara la diferencia.', '3. Cierra solo las referencias que cuadren.'].join('\n'),
  });
  const CUERPO_SUCIO = '## Cuándo se usa   \r\n\r\nAl cerrar la jornada, con el registro delante.   \r\n\r\n## Procedimiento  \r\n\r\n1. Recorre el registro entero.   \r\n2. Anota lo observado sin interpretarlo.  \r\n3. Cierra lo resuelto y deja el resto abierto.  \r\n\r\n\r\n';
  const opciones = (arena) => ({ root: arena.root, curated: arena.curated });

  /** Dos skills vivas y sucias, con su corrección de nivel 1 ya propuesta y el lote declarado. */
  function loteDeNivel1(arena, ids, { esperadas = ids.length } = {}) {
    const group = { id: 'trazabilidad-de-recepciones', motivo: 'las dos nacen del mismo acto de conteo y se deciden juntas', esperadas };
    for (const id of ids) {
      // El lote se declara al proponer —que es la vía real, y la que evita que la segunda se vete contra la
      // primera— y después viaja con la skill: al aprobarla, y al repararla.
      assert.equal(propose(tema(id), { ...opciones(arena), cwd: CWD, key: KEY, group }).status, 'proposed');
      assert.equal(approve(id, KEY, opciones(arena)).ok, true);
      const dirViva = join(arena.root, 'projects', KEY, 'approved', id);
      const texto = readFileSync(join(dirViva, 'SKILL.md'), 'utf8');
      const cabecera = texto.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n#\s[^\n]*\r?\n/)[0];
      writeFileSync(join(dirViva, 'SKILL.md'), cabecera + CUERPO_SUCIO);
      const r = reparar(id, KEY, { ...opciones(arena), cwd: CWD });
      assert.equal(r.status, 'proposed', `la reparación tenía que proponer: ${JSON.stringify(r.bloqueos ?? r.reason)}`);
      // La propuesta de reparación conserva el lote por sí sola: no se escribe a mano en el fixture.
      const meta = JSON.parse(readFileSync(join(arena.root, 'projects', KEY, 'proposed', id, 'meta.json'), 'utf8'));
      assert.deepEqual(meta.group, group, 'el lote tiene que sobrevivir a la reparación');
    }
    return group;
  }

  it('con una hermana sin proponer, la vía automática ESPERA en vez de activar media parte', () => {
    const arena = sandbox({ curated: false });
    const grupo = loteDeNivel1(arena, ['registro-de-recepciones'], { esperadas: 2 });
    const viva = readFileSync(join(arena.root, 'projects', KEY, 'approved', 'registro-de-recepciones', 'SKILL.md'), 'utf8');
    const r = promover('registro-de-recepciones', KEY, { ...opciones(arena), cwd: CWD, niveles: [1] });
    assert.equal(r.status, 'pending', `activó media parte: ${JSON.stringify(r)}`);
    assert.match(r.reason, /lote/);
    assert.equal(readFileSync(join(arena.root, 'projects', KEY, 'approved', 'registro-de-recepciones', 'SKILL.md'), 'utf8'), viva, 'la viva no se tocó');
    assert.equal(leerDiario(KEY, opciones(arena)).at(-1).group, grupo.id, 'el diario anota el lote');
  });

  it('con el lote entero propuesto y verificado, la promoción autorizada sigue su curso', () => {
    const arena = sandbox({ curated: false });
    loteDeNivel1(arena, ['registro-de-recepciones', 'registro-de-devoluciones']);
    const r = promover('registro-de-recepciones', KEY, { ...opciones(arena), cwd: CWD, niveles: [1] });
    assert.equal(r.status, 'promoted', JSON.stringify(r.reason ?? r.regresion?.pruebas?.slice(0, 3)));
    assert.equal(historial(KEY, { ...opciones(arena), grupo: 'trazabilidad-de-recepciones' })[0].decision, 'promovida');
  });

  it('el humano sí puede ir una a una: el lote no le bloquea la decisión', () => {
    const arena = sandbox({ curated: false });
    loteDeNivel1(arena, ['registro-de-recepciones'], { esperadas: 3 });
    // La vía humana no la pasa el guardián del lote: es una decisión, no un accidente.
    const r = promover('registro-de-recepciones', KEY, { ...opciones(arena), cwd: CWD });
    assert.equal(r.status, 'pending');
    assert.match(r.reason, /promoción automática está apagada/);
    assert.equal(approve('registro-de-recepciones', KEY, opciones(arena)).ok, true, 'el humano decide igual, hermana o no');
  });
});

describe('la píldora cuenta skills, no eventos', () => {
  /** Un resultado de herramienta con su marcador, como lo emite `skill_propose`. */
  const resultado = (id, outcome = 'created', callId = `c-${id}`) => ({
    type: 'tool/result',
    seq: 1,
    time: 1000,
    data: { message: { source: { callId }, content: [{ type: 'text', text: `[skill-compiler] ${outcome} ${id}` }] } },
  });
  const llamada = (callId) => ({ type: 'tool/call', seq: 0, data: { name: 'skill_propose', callId } });

  function trasLosResultados(pares) {
    let state = initialLearning();
    for (const [id, outcome] of pares) {
      state = applyLearning(state, llamada(`c-${id}`));
      state = applyLearning(state, resultado(id, outcome));
    }
    return learningView(state);
  }

  it('tres skills distintas se cuentan como tres skills, y no se enseña un id que parezca repetido', () => {
    const view = trasLosResultados([['rotacion-de-logs', 'created'], ['certificados-tls', 'created'], ['indices-lentos', 'created']]);
    const r = resumenDeActividad(view);
    assert.equal(r.skills, 3, 'son tres skills distintas');
    assert.deepEqual(r.ids, ['rotacion-de-logs', 'certificados-tls', 'indices-lentos']);
    // Lo que impide que un id suelto parezca el de todas: la frase se compone con las cuentas, y el id sólo
    // se pinta cuando el turno hizo una sola cosa con una sola skill (`simple` en el cliente).
    assert.deepEqual(partesDeActividad(view, { created: ['nueva', 'nuevas'], updated: ['actualizada', 'actualizadas'] }), ['3 nuevas']);
    assert.equal(r.repetido, false, 'no es una repetición: son tres cosas distintas');
  });

  it('la misma skill repetida sí es una repetición, y entonces «×N» dice la verdad', () => {
    const view = trasLosResultados([['rotacion-de-logs', 'created'], ['rotacion-de-logs', 'created'], ['rotacion-de-logs', 'updated']]);
    const r = resumenDeActividad(view);
    assert.equal(r.skills, 1);
    assert.equal(r.id, 'rotacion-de-logs');
    assert.equal(r.repetido, true);
    assert.equal(r.total, 3);
  });

  it('una sola skill enseña su id y no un contador', () => {
    const r = resumenDeActividad(trasLosResultados([['un-solo-tema', 'created']]));
    assert.equal(r.skills, 1);
    assert.equal(r.id, 'un-solo-tema');
    assert.equal(r.repetido, false);
  });

  it('el acumulado de la sesión se conserva, y las skills también', () => {
    // La regla ya estaba probada en `presentation.test.mjs` y yo la rompí al leer mal el código: los
    // contadores de la sesión NO se reinician, y la lista de ids sigue la misma regla (es el acumulado,
    // igual que el `×N`, que se titula «En esta sesión»). Lo que se retira al abrir turno es el resultado
    // ANTERIOR (`outcome`/`id`), que es lo que deja de estar vigente.
    let state = initialLearning();
    state = applyLearning(state, llamada('c-a'));
    state = applyLearning(state, resultado('una-cosa', 'created', 'c-a'));
    state = applyLearning(state, { type: 'turn/end', seq: 9 });
    // El prompt humano es lo que abre turno nuevo (no un `turn/start`, que no existe en este flujo).
    state = applyLearning(state, { type: 'user/message', seq: 10, data: { source: { kind: 'user' } } });
    assert.deepEqual(resumenDeActividad(learningView(state)).ids, ['una-cosa'], 'abrir turno no borra lo aprendido en la sesión');
    state = applyLearning(state, llamada('c-b'));
    state = applyLearning(state, resultado('otra-cosa', 'created', 'c-b'));
    assert.deepEqual(resumenDeActividad(learningView(state)).ids, ['una-cosa', 'otra-cosa']);
    assert.equal(resumenDeActividad(learningView(state)).total, 2, 'y el total es el de la sesión');
  });

  it('la misma skill repetida en dos turnos sigue contando una sola vez', () => {
    let state = initialLearning();
    state = applyLearning(state, llamada('c-a'));
    state = applyLearning(state, resultado('una-sola', 'created', 'c-a'));
    state = applyLearning(state, { type: 'turn/end', seq: 9 });
    state = applyLearning(state, { type: 'user/message', seq: 10, data: { source: { kind: 'user' } } });
    state = applyLearning(state, llamada('c-b'));
    state = applyLearning(state, resultado('una-sola', 'updated', 'c-b'));
    const r = resumenDeActividad(learningView(state));
    assert.deepEqual(r.ids, ['una-sola'], 'la misma skill no se cuenta dos veces');
    assert.equal(r.repetido, true, 'y entonces «×N» dice la verdad');
    assert.equal(r.id, 'una-sola');
    assert.equal(r.total, 2);
  });
});

describe('el CLI: un lote por la superficie que usa una persona', () => {
  const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
  /** El CLI de verdad, con la arena como almacén. */
  function cli(arena, ...args) {
    try {
      return { code: 0, out: execFileSync(process.execPath, [join(RAIZ, 'bin', 'skill-compiler.mjs'), ...args], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, DSH_HOME: arena.base } }) };
    } catch (error) {
      return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  }
  const tema = (t) => ({
    description: `Guía para ${t}, con los pasos medidos, el orden comprobado y las trampas ya pagadas.`,
    whenToUse: `Cuando haya que ${t} en este proyecto sin improvisar.`,
    body: `## Cuándo se usa\n\nCuando toca ${t}, con los datos delante.\n\n## Procedimiento\n\n1. Inspecciona ${t} y anota el número.\n2. Registra lo observado.\n3. Cierra si coincide.`,
  });
  const GRUPO = { id: 'certificados-y-claves', motivo: 'las dos salen de la misma renovación fallida de octubre', esperadas: 2 };

  function lotePropuesto(arena) {
    const grupo = { id: 'certificados-y-claves', motivo: 'las dos salen de la misma renovación fallida de octubre', esperadas: 2 };
    for (const [id, t] of [['renovar-certificados-tls', 'renovar los certificados TLS'], ['rotar-las-claves-de-firma', 'rotar las claves de firma']]) {
      const r = propose({ id, ...tema(t) }, { root: arena.root, curated: arena.curated, cwd: CWD, key: KEY, group: grupo });
      assert.equal(r.status, 'proposed', `${id}: ${JSON.stringify(r.conflicts ?? r.errors)}`);
    }
  }

  it('`check --grupo` revisa el lote entero, y `history --grupo` lo filtra', () => {
    const arena = sandbox({ curated: false });
    lotePropuesto(arena);
    const check = cli(arena, 'check', '--grupo', GRUPO.id, '--project-key', KEY);
    assert.equal(check.code, 0, check.out);
    assert.match(check.out, /renovar-certificados-tls/);
    assert.match(check.out, /rotar-las-claves-de-firma/);
    const vacio = cli(arena, 'check', '--grupo', 'lote-que-no-existe', '--project-key', KEY);
    assert.match(vacio.out, /No hay ninguna propuesta en el lote/);
  });

  it('`approve --grupo` aprueba el lote entero, y lo dice', () => {
    const arena = sandbox({ curated: false });
    lotePropuesto(arena);
    const r = cli(arena, 'approve', '--grupo', GRUPO.id, '--project-key', KEY);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Aprobadas las 2 propuestas del lote «certificados-y-claves»/);
    for (const id of ['renovar-certificados-tls', 'rotar-las-claves-de-firma']) {
      assert.ok(existsSync(join(arena.root, 'projects', KEY, 'approved', id)), `${id} tenía que quedar aprobada`);
    }
  });
});

describe('el menú: una fila que dice a qué lote pertenece', () => {
  it('cada fila de un lote lo nombra, y dice cuántas van juntas', () => {
    const arena = sandbox({ curated: false });
    const grupo = { id: 'renovacion-de-certificados', motivo: 'las dos salen del mismo corte de servicio', esperadas: 2 };
    for (const [id, t] of [['certificados-del-balanceador', 'renovar los certificados del balanceador'], ['certificados-de-la-api', 'renovar los certificados de la api interna']]) {
      const r = propose({ id, description: estilo(t), whenToUse: disparador(t), body: `## Cuándo se usa\n\nCuando toca ${t}, con los datos delante.\n\n## Procedimiento\n\n1. Inspecciona ${t} y anota el número.\n2. Registra lo observado.\n3. Cierra si coincide.` }, { root: arena.root, curated: arena.curated, cwd: CWD, key: KEY, group: grupo });
      assert.equal(r.status, 'proposed', `${id}: ${JSON.stringify(r.conflicts ?? r.errors)}`);
    }
    const filas = pendingRowsFor({ root: arena.root, cwd: CWD });
    const deLote = filas.filter((f) => f.group === grupo.id);
    assert.equal(new Set(deLote.map((f) => f.id)).size, 2, 'las dos propuestas del lote tienen sus filas');
    for (const fila of deLote) {
      assert.match(fila.description, /va en el lote «renovacion-de-certificados»/, 'la fila dice a qué lote pertenece');
      assert.match(fila.description, /2 propuesta\(s\) juntas/, 'y con cuántas más va');
    }
    // Y una propuesta suelta no lleva lote: la fila no puede inventarse uno.
    assert.equal(filas.find((f) => f.id === 'certificados-del-balanceador').group, grupo.id);
  });
});
