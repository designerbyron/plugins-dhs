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

// La prosa de este fichero se afirma en español: el idioma se fija explícitamente (el base es `en`).
process.env.DSH_LANG = 'es';

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
      'el paquete dueño del slot de la píldora tiene que estar declarado como dependencia de cliente');
    // El segundo slot que usa la pieza —el del nodo `command`— lo declara el paquete de chat al registrar
    // su nodo: sin declararlo aquí, el registro puede llegar antes que la declaración del slot.
    assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-chat'), true,
      'el paquete que declara `conversation.chat.commandview` también tiene que estar declarado');
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

describe('artefacto de interfaz · tarjeta de resultados', () => {
  it('registra una entrada keyed por comando en el slot del nodo `command`', () => {
    assert.match(client, /COMMAND_VIEW_SLOT = 'conversation\.chat\.commandview'/,
      'el slot keyed del nodo command es el único sitio desde el que se puede decidir cómo se pinta un resultado');
    assert.match(client, /ctx\.slots\.inject\(COMMAND_VIEW_SLOT, \(\) => ctx\.slots\.register\(\{\s*\n\s*name: COMMAND_VIEW_SLOT,\s*\n\s*key: name,/);
    assert.match(client, /locale: NS/, 'la tarjeta recibe la `t` de nuestro espacio de nombres');
  });

  it('cubre los comandos que dejan un bloque en el flujo, incluidos los del ciclo de vida', () => {
    const declared = /COMMAND_NAMES = \[([^\]]+)\]/.exec(client)?.[1] ?? '';
    for (const name of [
      'skill-proposals', 'skill-show', 'skill-approve', 'skill-publish', 'skill-scope', 'skill-auto', 'skill-reject',
      'skill-disable', 'skill-enable', 'skill-retire', 'skill-retired',
    ]) {
      assert.equal(declared.includes(`'${name}'`), true, `falta ${name} en COMMAND_NAMES`);
    }
  });

  it('la X es un botón de verdad, accesible, y vive en la esquina derecha', () => {
    assert.match(client, /className: 'skc-card-icon skc-card-close'/);
    assert.match(client, /'aria-label': say\('card_close'\)/);
    assert.match(client, /title: say\('card_close'\)/, 'el nombre tiene que servir también a puntero y teclado');
    assert.match(client, /\.skc-card-close \{ margin-left: auto; \}/, 'la X va al final de la cabecera');
    assert.match(client, /\.skc-card-icon:hover, \.skc-card-icon:focus-visible/, 'se descubre con puntero y con teclado');
    assert.match(client, /\.skc-card-icon:focus-visible \{ outline:/);
  });

  it('el cierre se recuerda entre arranques, y no crece sin fin', () => {
    // Defecto reportado: con `sessionStorage` el cierre moría con la pestaña, así que al cerrar y reabrir
    // la aplicación los bloques cerrados volvían. Persiste en `localStorage`, que aquí es fiable porque el
    // cliente de escritorio se sirve desde un origen estable (`dsh-app://app`), no desde un puerto efímero.
    assert.match(client, /window\.localStorage\.getItem\(CLOSED_KEY\)/);
    assert.match(client, /window\.localStorage\.setItem\(CLOSED_KEY/);
    assert.equal(/window\.sessionStorage/.test(client), false, 'el almacén de sesión no sobrevive al cierre de la app');
    assert.match(client, /ids\.slice\(-CLOSED_MAX\)/);
    assert.equal(client.includes("'skc-closed'"), true);
    // Cerrar es por ejecución, no por comando: dos `/skill-proposals` son dos bloques distintos.
    assert.match(client, /if \(!ids\.includes\(commandId\)\) writeClosed\(\[\.\.\.ids, commandId\]\)/);
  });

  it('si el nodo del comando no llega, se dice: nunca desaparece en silencio', () => {
    assert.match(client, /say\('card_unreadable'\)/);
  });

  it('el texto del resultado se pinta como texto, jamás como HTML', () => {
    assert.equal(client.includes('dangerouslySetInnerHTML'), false);
    assert.match(client, /h\('pre', \{ className: 'skc-card-body' \}, text\)/);
  });

  it('un fallo al registrar la tarjeta no puede llevarse el registro de la píldora', () => {
    const pill = client.indexOf('}, SkillCompilerBadge));');
    const card = client.indexOf('}, (props) => h(SkillCommandCard');
    assert.equal(pill > 0 && card > pill, true, 'la píldora se registra primero');
    // El registro de la tarjeta sigue protegido, ahora dentro de `ensureCard`: un fallo ahí no puede
    // llevarse por delante la píldora ni el resto del plugin.
    assert.match(client, /try \{\s*\n\s*const dispose = ctx\.slots\.inject\(COMMAND_VIEW_SLOT/, 'el registro de la tarjeta va protegido');
    assert.match(client, /for \(const command of COMMAND_NAMES\) ensureCard\(command\)/, 'y los cinco nombres fijos se registran por el mismo camino');
  });

  it('la tarjeta lleva su propia hoja de estilos: puede montarse sin la píldora', () => {
    const card = client.slice(client.indexOf('function SkillCommandCard'));
    assert.match(card, /h\('style', null, STYLES\)/, 'el CSS vive en el árbol, y cada pieza lo lleva consigo');
  });
  it('una lista anterior a una decisión se marca, y no se adivina nada', () => {
    // Medido con el usuario delante: aprobó una skill y el bloque que tenía debajo siguió enseñándola
    // como pendiente. El texto de un resultado es el registro de lo que pasó, así que lo que se puede
    // decir es que hubo una decisión POSTERIOR, y eso viaja en la proyección (plegada del log).
    assert.match(client, /const LIST_COMMANDS = \['skill-proposals', 'skill-show', 'skill-retired', 'skill-publish', 'skill-scope'\]/);
    assert.match(client, /view\.decisionSeq/, 'el dato viene de la proyección, no de inventarlo');
    assert.match(client, /decision\.seq > seq/, 'la comparación es contra el seq del propio bloque');
    assert.match(client, /Number\.isFinite\(node\?\.seq\)/, 'sin seq en el nodo no se compara');
    assert.match(client, /className: 'skc-card-stale'/);
    assert.match(client, /card_stale_approved/);
    assert.match(client, /card_stale_rejected/);
    // El `stale` MARCA el bloque, y eso se avisa aparte; lo que no puede es ESCONDER el resultado: el
    // texto de un bloque es el registro de lo que pasó, y el usuario reportó que su lista de pendientes
    // desaparecía. No hay adorno que valga si se lleva por delante lo que el humano pidió ver.
    assert.match(client, /const expanded = touched \? open : open;/);
    assert.doesNotMatch(client, /const expanded = touched \? open : open && !stale/, 'marcar no es ocultar');
  });

  it('el panel reintenta antes de decir que no hay filas, y no miente si no las encuentra', () => {
    // Medido con el usuario delante: el comando arma sus filas al correr (`onListed`) y el host puede
    // tardar un instante en anunciarlas, así que el panel leía «nada» justo cuando acababa de llegar algo.
    assert.match(client, /if \(found\.length === 0\)/);
    assert.match(client, /setTimeout\(resolve, 400\)/);
    assert.match(client, /bulk_no_rows/);
    assert.match(client, /La lista está en el resultado de arriba/);
    // La banda va fuera del cuerpo desplegable: se lee aunque la tarjeta esté colapsada.
    assert.match(client, /role: 'note'/);
  });
  it('la lista se puede marcar, y decidir en lote va paso a paso', () => {
    // Lo pedido: con más de una pendiente, marcar varias y aprobarlas a la vez, con un paso de
    // confirmación por medio —un clic no decide—.
    assert.match(client, /function BulkActions\(props\)/);
    assert.match(client, /type: 'checkbox'/, 'cada pendiente se marca con su casilla');
    assert.match(client, /'aria-label': `\$\{say\(bulk \? 'bulk_title' : 'bulk_single'\)\}: \$\{id\}`/);
    assert.match(client, /stage === 'confirm'/, 'hay un paso de confirmación antes de ejecutar');
    assert.match(client, /bulk_ask_footer/, 'la confirmación dice que cada una pasa por la misma puerta');
    assert.match(client, /setStage\('confirm'\)/);
    assert.match(client, /disabled: stage === 'running' \|\| stage === 'confirm'/);
  });

  it('las pendientes salen del catálogo del host, no de parsear el texto del resultado', () => {
    // La única fuente estructurada: cada pendiente ya tiene su fila `skill-approve-<id>` en el catálogo,
    // que es también la que alimenta el menú `/`. Parsear el texto duplicaría el formato en dos sitios.
    assert.match(client, /function rowIds\(commands, verb\)/);
    assert.match(client, /const rowPrefix = \(verb\) => `skill-\$\{verb\}-`/);
    assert.match(client, /listCommands\(sessionId\)/);
    assert.equal(/outcome\?\.text[^\n]*split/.test(client), false, 'el texto del resultado no se parsea');
  });

  it('ejecutar es ejecutar el comando, por el mismo remoto que el menú', () => {
    assert.match(client, /remote\.commands\.execute\(sessionId, line, \[\]\)/);
    assert.match(client, /remote\.commands\.list\(sessionId\)/);
    assert.match(client, /const remote = ctx\.get\?\.\('remote'\) \?\? ctx\.remote \?\? null/);
    // Se busca tolerante y se falla diciendo el motivo: nada de un plan B silencioso.
    assert.match(client, /este anfitrión no expone commands\.execute/);
    assert.match(client, /'data-tone': 'error'/);
    // El ámbito entra por las props del kit de sesión, no se adivina.
    assert.match(client, /const \{ node, t, sessionId, runCommand, listCommands, ensureCard \} = props;/);
  });

  it('tras el lote, el estado de la lista se mueve con lo que dice el HOST (no con lo que creía el panel)', () => {
    // Antes se recortaba la lista local con `done`, que es el informe del propio panel: si el host no
    // ejecutó nada, la lista se vaciaba igual y decía «Pending now: 0». Ahora manda la relectura del host,
    // y el recorte local queda sólo como respaldo cuando la relectura falla.
    assert.match(client, /setIds\(restantes \?\? rows\.filter\(\(id\) => !done\.includes\(id\)\)\)/);
    assert.match(client, /bulk_remaining/);
    assert.match(client, /report\.failed\.length === 0/);
  });

  it('la tarjeta de una propuesta leída ofrece decidir sobre ella', () => {
    assert.match(client, /const bulk = node\?\.name === 'skill-proposals'/);
    assert.match(client, /const reading = typeof node\?\.args === 'string' \? node\.args\.trim\(\) : ''/);
    assert.match(client, /bulk_approve_one|bulk_reject_one/);
  });

  /**
   * El defecto que se vio en vivo: el panel decía «no hay nada pendiente» cuando lo que pasaba es que no
   * había podido preguntar. La causa era la inyección —el contexto de cliente resuelve los servicios por su
   * PATH, y el propio paquete de comandos del anfitrión declara `'remote.commands'`—, y el efecto, un
   * mensaje que negaba el trabajo del humano.
   */
  /**
   * Defecto reportado en vivo: al elegir del menú una **fila** (`skill-approve-<id>`) el resultado salía
   * con la tarjeta del anfitrión, **sin X**, y el bloque quedaba fijo en la conversación. La causa: el
   * slot keyed se registraba sólo para los cinco nombres fijos, y el de una fila lleva el id dentro.
   */
  it('una fila del menú también tiene tarjeta propia: el cliente aprende los nombres del catálogo', () => {
    assert.match(client, /const ensureCard = \(name\) =>/, 'el registro del slot tiene que poder hacerse en caliente');
    assert.match(client, /name\.startsWith\(COMMAND_PREFIX\)/, 'y sólo para los comandos del plugin');
    assert.match(client, /const COMMAND_PREFIX = 'skill-'/);
    // Y los aprende de la fuente estructurada, no del texto de un resultado.
    assert.match(client, /const commands = await listCommands\(sessionId\)/);
    assert.match(client, /ensureCard\(name\)/);
    // Las retiradas se guardan: descargar el plugin no deja slots vivos.
    assert.match(client, /cardSlots\.clear\(\)/);
  });

  it('declara el remoto que usa, con el path que el anfitrión exige', () => {
    assert.match(client, /inject: \['slots', 'locale', 'remote\.commands'\]/,
      'sin declararlo, ctx.remote.commands lanza «without inject» al primer uso');
  });

  it('si no pudo leer las pendientes, no dice que no hay nada', () => {
    // Las dos afirmaciones dependen de que se haya podido leer: «leyendo…» mientras se lee, y «ninguna
    // pendiente» sólo si la lectura salió bien y vino vacía. Sin `failure === ''`, las dos mienten.
    assert.match(client, /ids === null && failure === '' \? h\('div', \{ className: 'skc-bulk-note' \}, say\('bulk_reading'\)\)/);
    // Tres estados distintos, tres mensajes: leyendo, nada pendiente, y pendientes sin fila anunciada.
    assert.match(client, /ids !== null && failure === '' && ids\.length === 0 && report === null/);
    assert.match(client, /ids !== null && failure === '' && ids\.length > 0 && rows\.length === 0 && report === null/);
    assert.match(client, /bulk_nothing/);
    assert.match(client, /bulk_ids_hint/);
    assert.equal(
      /ids !== null && rows\.length === 0 && report === null/.test(client),
      false,
      'la condición de «ninguna pendiente» no puede ignorar el fallo de lectura',
    );
    // Y el error no deja sin salida: dice por dónde seguir, que es el mismo camino de siempre.
    assert.match(client, /say\('bulk_unreadable_hint'\)/);
  });
});

describe('artefacto de interfaz · decidir incluye el ámbito', () => {
  it('las pendientes ofrecen aprobar, publicar para todos y apartar', () => {
    assert.match(client, /\['aprobar', 'globalizar', 'rechazar'\]/);
  });

  it('todo el texto de «publicar para todos» está en los dos idiomas', () => {
    for (const clave of ['bulk_global', 'bulk_global_one', 'bulk_confirm_global', 'bulk_ask_global', 'bulk_ok_global', 'bulk_global_note']) {
      const veces = (client.match(new RegExp(`${clave}:`, 'g')) ?? []).length;
      assert.equal(veces, 2, `«${clave}» debe estar en español y en inglés`);
    }
  });

  it('el verbo manda a la fila que existe, y la confirmación dice el alcance', () => {
    assert.match(client, /globalizar: \{ go: 'bulk_global'/);
    assert.match(client, /skill-\$\{verb\}/, 'el comando se compone del verbo: globalizar → skill-globalizar');
    assert.match(client, /texts\.note/, 'la pantalla de confirmación dice el alcance');
  });
});

describe('artefacto de interfaz · decidir no puede contar una pregunta como hecha', () => {
  it('la aprobación del panel lleva el ámbito explícito', () => {
    assert.match(client, /verb === 'aprobar' \? ' --local'/, 'sin --local el comando pregunta y no aprueba');
  });

  it('una respuesta que pregunta el ámbito se cuenta como pendiente, no como hecha', () => {
    assert.match(client, /const SCOPE_ASK = 'Dime donde quieres que viva'/);
    assert.match(client, /resultado\?\.code === 'scope-ask'/, 'y el codigo del contrato manda sobre la prosa');
    assert.match(client, /salida\.startsWith\(SCOPE_ASK\)/, 'y se apunta como motivo antes de comprobar el efecto');
  });

  it('el texto del comando y el del panel coinciden en el marcador', async () => {
    const { skillCommands } = await import('../lib/commands.mjs');
    const { sandbox, goodInput } = await import('./helpers.mjs');
    const { propose, projectKey } = await import('../lib/compiler.mjs');
    const s = sandbox();
    propose(goodInput(), { root: s.root, curated: s.curated, cwd: s.base });
    const byName = Object.fromEntries(skillCommands({ root: s.root }).map((c) => [c.name, c]));
    const r = byName['skill-approve'].handler({ agent: { session: { header: { cwd: s.base } } }, rawInput: 'measured-decision-check' });
    assert.equal(r.kind, 'success', 'para el humano sigue siendo una respuesta, no un fallo');
    assert.equal(r.code, 'scope-ask', 'la pregunta viaja como codigo, no solo como prosa');
    assert.ok(r.text.startsWith('Dime donde quieres que viva'), `el marcador del panel no casa con el comando: «${r.text.slice(0, 40)}»`);
    assert.equal(projectKey(s.base).length > 0, true);
  });
});

describe('artefacto de interfaz · el informe del lote se comprueba contra el efecto', () => {
  it('el éxito lo dice el veredicto por id del comando, no el `kind` que devuelva el host', () => {
    assert.match(client, /const NO_RESULT = 'el host no devolvió resultado/);
    // La evidencia es la frase que vería el humano: `Activa: <id>`, `Ya estaba activa: <id>`, `ok <id> — …`.
    // Un `kind: 'success'` sin veredicto NO basta: se sigue con la comprobación por filas y, si no las hay,
    // no se declara éxito.
    // La firma gano el quinto parametro (los `items` del contrato por elemento): el aserto se actualiza y el
    // comportamiento nuevo se mide en `resultados-por-elemento.test.mjs`.
    assert.match(client, /const v = veredicto\(salida, idsPedidos, resultado\?\.code, resultado\?\.params, resultado\?\.items\)/);
    assert.match(client, /ok: v\.fallos\.size === 0 && idsPedidos\.every\(\(id\) => v\.hechos\.has\(id\)\)/);
    assert.equal(/resultado\?\.kind === 'success'\)?\s*return \{ ok: true/.test(client), false, 'no se cree al kind');
    // Las filas quedan como comprobación de respaldo, y su ausencia es un estado de primera clase.
    assert.match(client, /medible: filas\.length > 0/);
    assert.match(client, /if \(observado === true\) \{/);
  });

  it('el veredicto se lee de las marcas reales del comando, y la puerta no se confunde con un fallo', () => {
    // Se extrae el bloque marcado del cliente y se ejecuta: es la MISMA función que corre en la interfaz.
    const ini = client.indexOf('// <veredicto>');
    const fin = client.indexOf('// </veredicto>');
    assert.ok(ini > 0 && fin > ini, 'el bloque del veredicto tiene que existir y estar marcado');
    const fuente = client.slice(ini, fin);
    const { veredicto } = new Function(`${fuente}; return { veredicto };`)();

    const lote = veredicto([
      'ok   mixed-encoding-repair — Activa en el proyecto',
      'FALLO nexus-authenticated-qa-session — tiene avisos: body-budget',
      'Pendientes de tu aprobación (0):',
    ].join('\n'), ['mixed-encoding-repair', 'nexus-authenticated-qa-session']);
    assert.deepEqual([...lote.hechos], ['mixed-encoding-repair']);
    assert.equal(lote.fallos.get('nexus-authenticated-qa-session'), 'tiene avisos: body-budget');

    const singular = veredicto('Ya estaba activa: mixed-encoding-repair [nexusbusinesssuite-3495896e]\n\nPendientes de tu aprobación (0):', ['mixed-encoding-repair']);
    assert.deepEqual([...singular.hechos], ['mixed-encoding-repair']);

    // La puerta imprime `  FALLO  <regla> …` sangrado y sin id: no puede contar como fallo de un id.
    const puerta = veredicto('  FALLO  body-max — el cuerpo es demasiado largo', ['otro-id']);
    assert.equal(puerta.fallos.size, 0);
    assert.equal(puerta.hechos.size, 0);
  });

  it('prueba las formas conocidas del host, en orden, y reutiliza la que funcione', () => {
    for (const forma of ['texto con barra', 'nombre + args', 'objeto {name,args}', 'texto solo']) {
      assert.ok(client.includes(`nombre: '${forma}'`), `falta la forma «${forma}»`);
    }
    assert.match(client, /const FORMA_DE = Object\.fromEntries\(FORMAS\.map/);
    assert.match(client, /let forma = null;/, 'la forma descubierta se guarda en el bucle');
    assert.match(client, /const salida = await ejecutar\(id, forma, forzar\)/);
    assert.match(client, /setFormaUsada\(salida\.forma\.nombre\)/);
  });

  it('cada forma lleva la MISMA orden, con su ámbito explícito', () => {
    assert.match(client, /`\/\$\{linea\(id\)\}`/, 'la orden va con barra, como en el compositor');
    assert.match(client, /`\/\$\{comando\} \$\{argumentos\}`/, 'y el lote también');
    assert.match(client, /verb === 'aprobar' \? ' --local'/, 'aprobar local dice el ámbito');
    assert.match(client, /skill-\$\{verb\}/, 'globalizar usa su propio comando');
  });

  it('si ninguna forma ejecuta, muestra las firmas reales del host', () => {
    assert.match(client, /String\(runCommand\)\.slice\(0, 240\)/);
    assert.match(client, /String\(listCommands\)\.slice\(0, 240\)/);
    assert.match(client, /host · \$\{Object\.entries\(tipos\)/);
  });

  it('después del lote se vuelve a leer la lista del host —si la ofrece— y se pinta lo que diga', () => {
    assert.match(client, /const despues = await pendientesAhora\(\)/);
    assert.match(client, /restantes = despues\.medible \? despues\.ids\.filter/, 'sin filas no se afirma una cifra');
    assert.match(client, /bulk_remaining_unknown/);
    assert.match(client, /report\.restantes/);
    assert.match(client, /bulk_remaining'}?[^\n]*report\.restantes/);
  });

  it('si no se ejecutó nada, da las líneas exactas para pegar en el compositor', () => {
    assert.match(client, /bulk_nothing_ran/);
    assert.match(client, /report\.lineas\.join/);
    assert.match(client, /skc-bulk-body/);
  });
});

describe('artefacto de interfaz · el lote va en UNA orden', () => {
  it('con más de una marcada, aprobar y publicar mandan UN comando con los ids', () => {
    assert.match(client, /const ejecutarLote = \(ids, conocida, forzar = false\)/);
    assert.match(client, /if \(\(verb === 'aprobar' \|\| verb === 'globalizar'\) && picked\.length > 1\)/);
    assert.match(client, /const argumentos = `\$\{ids\.join\(','\)\}\$\{ambito\}`/);
  });

  it('el ámbito del lote: aprobar va a --local, publicar a --global', () => {
    assert.match(client, /const ambito = verb === 'aprobar' \? ' --local' : verb === 'globalizar' \? ' --global' : ''/);
    assert.match(client, /const comando = verb === 'globalizar' \? 'skill-approve' : target/, 'publicar usa skill-aprobar … --global');
  });

  it('si el lote no obra, se cae a id a id: el singular sigue disponible', () => {
    assert.match(client, /pendientes = \[\.\.\.picked\]/);
    assert.match(client, /for \(const id of pendientes\)/);
  });
});

describe('artefacto de interfaz · el estado se lee por color, y se mueve poco', () => {
  it('cada tipo de mensaje tiene su tono, y todos derivan de currentColor', () => {
    for (const tono of ['error', 'ok', 'warn', 'muted']) {
      assert.match(client, new RegExp(`\[data-tone="${tono}"\]`), `falta el tono «${tono}»`);
    }
    // El color se mezcla con currentColor: el texto no baja del contraste del anfitrión.
    const reglas = client.match(/data-tone="(ok|warn|error)"\] \{ color: ([^;]+);/g) ?? [];
    assert.ok(reglas.length >= 3, 'los tres tonos con color propio');
    for (const regla of reglas) assert.match(regla, /color-mix\(in oklab, currentColor/, regla);
  });

  it('el resumen del lote se tiñe por resultado: verde si todo bien, ámbar si hay mezcla, rojo si nada', () => {
    assert.match(client, /'data-tone': report\.failed\.length === 0 \? 'ok' : \(report\.done\.length === 0 \? 'error' : 'warn'\)/);
  });

  it('cada fila dice si quedó hecha, y su marca lleva tono', () => {
    assert.match(client, /'data-hecha': 'si'/);
    assert.match(client, /\[data-hecha="si"\] label \{ opacity/);
    assert.match(client, /\.\.\.\(hecha \? \{ 'data-tone': 'ok' \}/, 'la fila hecha marca verde');
    assert.match(client, /\.\.\.\(fallada \? \{ 'data-tone': 'error' \}/, 'la que falló, roja');
  });

  it('microanimación de entrada, y con movimiento reducido no hay animación', () => {
    assert.match(client, /@keyframes skc-llega/);
    assert.match(client, /animation: skc-llega 170ms ease-out both/);
    assert.match(client, /@media \(prefers-reduced-motion: reduce\) \{\s*\.skc-bulk-note, \.skc-bulk-done, \.skc-bulk-body \{ animation: none; \}/);
  });
});

describe('artefacto de interfaz · la puerta pide decisión, la tarjeta la ofrece', () => {
  it('un «tiene avisos» no se queda en fallo: abre la pantalla de avisos con su texto', () => {
    // La negativa por avisos es semántica (no se reintenta con otra forma) y vuelve con el texto entero.
    assert.match(client, /if \(\/tiene avisos\/i\.test\(salida\)\)/);
    assert.match(client, /avisos: salida/);
    assert.match(client, /setStage\('avisos'\)/);
    assert.match(client, /\{ className: 'skc-bulk-body' \}, avisos\.texto\)/, 'los avisos se leen en la tarjeta');
  });

  it('aceptar los avisos ejecuta la MISMA orden con `--force`, y sólo al pulsarlo', () => {
    assert.match(client, /const restoFinal = forzar \? `\$\{resto\} --force`\.trim\(\) : resto;/);
    assert.match(client, /addButton\('force', say\('bulk_warnings_accept'\), \(\) => run\(\{ forzar: true \}\)\)/);
    assert.equal(/run\(\{ forzar: true \}\);\s*\n.*run\(\{ forzar: true \}\)/.test(client), false, 'una sola acción');
    // Sin la confirmación, ninguna llamada lleva `--force`: el panel no fuerza por su cuenta.
    assert.match(client, /const orden = conocida === null \? FORMAS : \[conocida\];/);
  });

  it('los textos de la pantalla existen en los dos idiomas', () => {
    assert.match(client, /bulk_warnings_title: 'La puerta pide una decisión/);
    assert.match(client, /bulk_warnings_accept: 'Acepto los avisos/);
    assert.match(client, /bulk_warnings_title: 'The gate asks for a decision/);
    assert.match(client, /bulk_warnings_accept: 'I accept the warnings/);
  });
});

describe('artefacto de interfaz · preguntar antes, no después del fallo', () => {
  it('los avisos se leen del almacén y la pantalla se abre SIN haber mandado la orden', () => {
    assert.match(client, /for \(const m of texto\.matchAll\(\/\^aviso:/);
    assert.match(client, /if \(!forzar\) \{/);
    assert.match(client, /const conAvisos = \[\.\.\.picked\]\.filter\(\(id\) => \(previo\.avisos\?\.get\(id\)\?\.length \?\? 0\) > 0\)/);
    assert.match(client, /setStage\('avisos'\);\s*\n\s*return;/, 'se detiene antes de ejecutar');
  });
});
