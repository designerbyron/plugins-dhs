/**
 * F1.2 · pruebas POR IDIOMA del grupo 4 (ownership / systems / auto).
 *
 * Mismo metodo que los grupos 1-3: se mide el contrato y el EFECTO, no la frase. Cada caso corre en ingles
 * (borrando `DSH_LANG`) y en español (`DSH_LANG=es`), y exige el mismo `kind`, el mismo `code` y el mismo
 * estado en disco.
 *
 * Ademas, y esto es propio de este grupo: la prosa de `lib/scope.mjs` salia de una constante evaluada al
 * importar. Aqui se comprueba que la resolucion ocurre **despues** de cargar el modulo, llamando al mismo
 * comando ya construido con los dos idiomas y en los dos ordenes.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { skillCommands } from '../lib/commands.mjs';
import { resetLangCache } from '../lib/i18n/index.mjs';
import {
  inventario, leerPropiedad, proyectosConocidos, textoDeSistemas, textoDelEstado,
} from '../lib/scope.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';

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

const comandos = (root) => new Map(skillCommands({ root }).map((c) => [c.name, c]));
const agente = (events = []) => ({ agent: { session: { header: { cwd: CWD }, snapshotEvents: () => events } } });
const sinArgumento = (root) => comandos(root).get('skill-ownership').handler(agente());
const rutaDePropiedad = (root) => join(root, 'ownership.json');

const MODE_ON = [{ type: 'command/run', data: { name: 'skill-auto', args: ' activar' } }];

describe('F1.2 · grupo 4 en los dos idiomas', () => {
  it('la prosa se resuelve al llamar, no al importar: el mismo comando ya construido cambia de idioma', () => {
    const s = sandbox();
    // Construido bajo espanol: si el texto se hubiera congelado al importar, el handler no cambiaria.
    const cmds = con('es', () => comandos(s.root));
    const ownership = cmds.get('skill-ownership');

    const es = con('es', () => ownership.handler(agente()));
    assert.equal(es.kind, 'success', es.text);
    assert.match(es.text, /Propiedad|sin declarar/);
    assert.match(es.text, /solo se trabaja con DSH/);

    const en = con(null, () => ownership.handler(agente()));
    assert.equal(en.kind, 'success', en.text);
    assert.match(en.text, /Ownership|undeclared/);
    assert.match(en.text, /only DSH is used/);
    assert.doesNotMatch(en.text, /Propiedad|sin declarar|Solo se trabaja/, 'el ingles no puede llevar prosa espanola');

    // Y el orden inverso da lo mismo: no hay estado de idioma pegado al modulo.
    const otraVezEs = con('es', () => ownership.handler(agente()));
    assert.equal(otraVezEs.text, es.text);
  });

  it('/skill-ownership declara en los dos idiomas con el mismo kind y el mismo estado en disco', () => {
    for (const idioma of [null, 'es']) {
      const s = sandbox();
      const cmds = comandos(s.root);
      const r = con(idioma, () => cmds.get('skill-ownership').handler({ ...agente(), rawInput: 'machine' }));
      assert.equal(r.kind, 'success', r.text);
      assert.equal(r.code, undefined, 'declarar no inventa un codigo de resultado');
      assert.equal(existsSync(rutaDePropiedad(s.root)), true, 'la declaracion tiene que existir');
      const estado = leerPropiedad({ root: s.root });
      assert.equal(estado.estado, 'declarada');
      assert.equal(estado.ownership, 'machine', 'el valor declarado es un dato, no prosa: no se traduce');
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(rutaDePropiedad(s.root), 'utf8'))).sort(),
        ['declaredAt', 'declaredBy', 'ownership'], 'el contrato del fichero no cambia con el idioma');
      assert.match(r.text, /"machine"/);
    }
  });

  it('lo declarado en un idioma se lee en el otro sin tocar ownership.json ni su huella', () => {
    const s = sandbox();
    const cmds = comandos(s.root);
    const declarado = con('es', () => cmds.get('skill-ownership').handler({ ...agente(), rawInput: 'dsh-only' }));
    assert.equal(declarado.kind, 'success', declarado.text);
    const antes = leerPropiedad({ root: s.root });
    const bytesAntes = readFileSync(rutaDePropiedad(s.root), 'utf8');

    const en = con(null, () => cmds.get('skill-ownership').handler(agente()));
    assert.equal(en.kind, 'success', en.text);
    assert.match(en.text, /Ownership of the skill creation process/);
    assert.match(en.text, /"dsh-only"/);
    assert.match(en.text, /Only DSH is used/);
    assert.match(en.text, new RegExp(antes.huella.slice(0, 12)), 'la huella leida tiene que salir');

    const despues = leerPropiedad({ root: s.root });
    assert.equal(despues.huella, antes.huella, 'leer en otro idioma no cambia la huella');
    assert.equal(readFileSync(rutaDePropiedad(s.root), 'utf8'), bytesAntes, 'ni un byte del fichero');

    const es = con('es', () => cmds.get('skill-ownership').handler(agente()));
    assert.match(es.text, /Propiedad del proceso de creacion de skills/);
    assert.match(es.text, /"dsh-only"/);
  });

  it('/skill-ownership y /skill-systems pasan por el comando real y coinciden con las funciones de scope.mjs', () => {
    for (const idioma of [null, 'es']) {
      const s = sandbox();
      const cmds = comandos(s.root);
      con(idioma, () => cmds.get('skill-ownership').handler({ ...agente(), rawInput: 'machine' }));

      const delComando = con(idioma, () => cmds.get('skill-ownership').handler(agente()));
      const deLaFuncion = con(idioma, () => textoDelEstado(leerPropiedad({ root: s.root })));
      assert.equal(delComando.kind, 'success');
      assert.equal(delComando.text, deLaFuncion, 'comando y funcion tienen que decir lo mismo');

      const sistemas = con(idioma, () => cmds.get('skill-systems').handler({}));
      const datos = inventario({ root: s.root, curada: s.curated, proyectos: proyectosConocidos({ root: s.root }) });
      const inventarioEnTexto = con(idioma, () => textoDeSistemas({ datos, estado: leerPropiedad({ root: s.root }) }));
      assert.equal(sistemas.kind, 'success');
      assert.equal(sistemas.text, inventarioEnTexto, 'el comando y el texto compartido no pueden divergir');
      assert.match(sistemas.text, /"machine"/, 'la propiedad declarada sale en el inventario');
    }
  });

  it('el inventario dice lo mismo en los dos idiomas: ingles sin DSH_LANG y espanol con DSH_LANG=es', () => {
    const s = sandbox();
    const cmds = comandos(s.root);
    const en = con(null, () => cmds.get('skill-systems').handler({}));
    const es = con('es', () => cmds.get('skill-systems').handler({}));
    assert.equal(en.kind, 'success');
    assert.equal(es.kind, 'success');

    assert.match(en.text, /Skill systems on this machine/);
    assert.match(en.text, /Ownership: ABSENT/);
    assert.match(en.text, /Answer: \/skill-ownership dsh-only/);
    assert.doesNotMatch(en.text, /Sistemas de skills|Sin choques|Respuesta:/);

    assert.match(es.text, /Sistemas de skills del puesto/);
    assert.match(es.text, /Propiedad: AUSENTE/);
    // El nombre del comando sigue al idioma: en espanol se responde con `/skill-propiedad`.
    assert.match(es.text, /Respuesta: \/skill-propiedad dsh-only/);
    assert.doesNotMatch(es.text, /Skill systems|Ownership:|Answer:/);
  });

  it('/skill-auto en sus tres caminos: mismo kind y los mismos tokens de entrada', () => {
    for (const idioma of [null, 'es']) {
      const s = sandbox();
      const auto = comandos(s.root).get('skill-auto');

      const sinArgumentoOff = con(idioma, () => auto.handler({ ...agente([]), rawInput: '' }));
      assert.equal(sinArgumentoOff.kind, 'success', sinArgumentoOff.text);
      assert.match(sinArgumentoOff.text, /\/skill-auto activar/, 'el token de entrada no se traduce');

      const activar = con(idioma, () => auto.handler({ ...agente([]), rawInput: 'activar' }));
      assert.equal(activar.kind, 'success', activar.text);
      assert.match(activar.text, /\/skill-auto desactivar/);

      const sinArgumentoOn = con(idioma, () => auto.handler({ ...agente(MODE_ON), rawInput: '' }));
      assert.equal(sinArgumentoOn.kind, 'success');
      assert.match(sinArgumentoOn.text, /\/skill-auto desactivar/);

      const desactivar = con(idioma, () => auto.handler({ ...agente(MODE_ON), rawInput: 'desactivar' }));
      assert.equal(desactivar.kind, 'success', desactivar.text);

      // Una palabra que no es token no decide nada: informa, como sin argumento.
      const raro = con(idioma, () => auto.handler({ ...agente(MODE_ON), rawInput: 'no-se-que' }));
      assert.equal(raro.kind, 'success');
      assert.match(raro.text, /\/skill-auto desactivar/, 'sigue informando del modo activo');
    }
  });

  it('el informe de /skill-auto no mezcla idiomas', () => {
    const s = sandbox();
    const auto = comandos(s.root).get('skill-auto');
    const en = con(null, () => auto.handler({ ...agente(MODE_ON), rawInput: '' }));
    const es = con('es', () => auto.handler({ ...agente(MODE_ON), rawInput: '' }));

    assert.match(en.text, /Automatic approval in this session: ON/);
    assert.match(en.text, /Prior validation always applies/);
    assert.doesNotMatch(en.text, /Aprobacion|validacion previa|sesion/);

    assert.match(es.text, /Aprobacion automatica en esta sesion: ACTIVA/);
    assert.match(es.text, /La validacion previa se aplica siempre/);
    assert.doesNotMatch(es.text, /Automatic approval|Prior validation|session log/);
  });

  it('las descripciones del menu se traducen y siguen nombrando los mismos comandos', () => {
    const s = sandbox();
    const en = new Map(con(null, () => skillCommands({ root: s.root })).map((c) => [c.name, c]));
    const es = new Map(con('es', () => skillCommands({ root: s.root })).map((c) => [c.name, c]));

    for (const nombre of ['skill-ownership', 'skill-ownership-dsh-only', 'skill-ownership-machine', 'skill-systems', 'skill-auto']) {
      assert.ok(en.get(nombre).description.trim() !== '', `${nombre} sin descripcion en ingles`);
      assert.notEqual(en.get(nombre).description, es.get(nombre).description, `${nombre} no se tradujo`);
    }
    assert.match(en.get('skill-ownership').description, /Who is in charge/);
    assert.match(es.get('skill-ownership').description, /Quien manda/);
    assert.match(en.get('skill-ownership-dsh-only').description, /ONLY while working with DSH/);
    assert.match(es.get('skill-ownership-dsh-only').description, /SOLO mientras se trabaja con DSH/);
    assert.match(en.get('skill-systems').description, /skill systems on this machine/i);
    assert.match(es.get('skill-systems').description, /sistemas de skills de este puesto/i);
    assert.match(en.get('skill-auto').description, /delegate the confirmation, not the gate/);
    assert.match(es.get('skill-auto').description, /delegas la confirmacion, no la puerta/);
  });

  it('un almacen con choques se lee igual de bien en los dos idiomas, sin perder el dato', () => {
    const s = sandbox();
    const ajeno = join(s.base, 'ajeno');
    mkdirSync(join(ajeno, 'medida-ocupada'), { recursive: true });
    writeFileSync(join(ajeno, 'medida-ocupada', 'SKILL.md'), '---\nname: medida-ocupada\ndescription: "Otra cosa distinta, con cuerpo suficiente para no romper nada."\n---\n\n## When to Use\n\nOtra.\n', 'utf8');
    mkdirSync(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'approved', 'medida-ocupada'), { recursive: true });
    writeFileSync(join(s.root, 'projects', 'saas-corporative-a3c393fa', 'approved', 'medida-ocupada', 'SKILL.md'), '---\nname: medida-ocupada\ndescription: "Nuestra cosa distinta, con cuerpo suficiente para no romper nada."\n---\n\n## When to Use\n\nNuestra.\n', 'utf8');

    const datos = (() => {
      const previo = process.env.SKILL_COMPILER_SISTEMAS;
      process.env.SKILL_COMPILER_SISTEMAS = ajeno;
      try {
        return inventario({ root: s.root, curada: s.curated });
      } finally {
        if (previo === undefined) delete process.env.SKILL_COMPILER_SISTEMAS;
        else process.env.SKILL_COMPILER_SISTEMAS = previo;
      }
    })();
    assert.ok(datos.colisiones['medida-ocupada'], 'la prueba necesita un choque real');

    const estado = leerPropiedad({ root: s.root });
    const en = con(null, () => textoDeSistemas({ datos, estado }));
    const es = con('es', () => textoDeSistemas({ datos, estado }));
    assert.match(en, /Id collisions \(1\)/);
    assert.match(es, /Choques de id \(1\)/);
    for (const texto of [en, es]) {
      assert.match(texto, /medida-ocupada/, 'el id es un dato y sale en los dos');
      assert.match(texto, /2 copias|2 copies/, 'el numero de copias es el mismo dato');
    }
    assert.equal(en.includes('contenido distinto'), false);
    assert.equal(es.includes('different content'), false);
  });
});
