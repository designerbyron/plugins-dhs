#!/usr/bin/env node
/**
 * Puerta del **ámbito**: dónde vive una skill al aprobarla, y cómo se cambia de sitio después.
 *
 * Lo que se fija aquí, y por qué cada cosa:
 *
 *   · **Publicar es copiar y verificar, no mover a ciegas.** La huella del destino tiene que ser la del
 *     origen: si copiar cambiara algo, la biblioteca serviría una skill distinta de la aprobada y nadie se
 *     enteraría.
 *   · **La biblioteca de usuario es compartida.** Hoy tiene skills que escriben otras herramientas, así que
 *     la puerta de identidad es lo que impide que el plugin pise trabajo ajeno — y el test comprueba la
 *     huella del fichero ajeno, no sólo el mensaje.
 *   · **Una sola copia efectiva.** Una skill publicada NO se queda además en el proyecto: el provider la
 *     serviría dos veces, con dos rangos distintos, y el mismo conocimiento viajaría duplicado al prompt.
 *   · **El ciclo de vida entero vale para una global.** Apagar, encender, retirar y restaurar, con respaldo
 *     fechado y huella comprobada: lo global no es una excepción sin vuelta.
 *   · **El modo automático no publica.** Un gesto delegado delega la confirmación, no el alcance.
 *
 * Todo se mide sobre la caja de arena de `helpers.mjs`, que redirige `DSH_HOME`: ninguna prueba toca la
 * biblioteca real de la máquina.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approveProposal } from '../lib/commands.mjs';
import {
  ambito, approve, disable, enable, folderHash, isOurs, listForProject, projectKey, propose,
  publishToLibrary, restore, retire, retired,
} from '../lib/compiler.mjs';
import { GOOD_BODY, buenaRevision, cleanupSandboxes, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);

/** El id que usan casi todas: una propuesta buena, propuesta por el camino normal. */
function propuesta(s, over = {}) {
  const r = propose(goodInput(over), { root: s.root, curated: s.curated, cwd: CWD });
  assert.equal(r.status, 'proposed', JSON.stringify(r));
  return r.id;
}

/** Una skill AJENA en la biblioteca: con el mismo id, pero sin nuestra marca de origen. */
function ajena(s, id, cuerpo = 'De otra herramienta, no del plugin.') {
  mkdirSync(join(s.curated, id), { recursive: true });
  writeFileSync(join(s.curated, id, 'SKILL.md'), [
    '---', `name: ${id}`, `description: "${cuerpo}"`, '---', '', '# Ajena', '',
  ].join('\n'));
  return join(s.curated, id);
}

// ── publicar ──────────────────────────────────────────────────────────────────────────────────────

describe('ámbito · aprobar para todos los proyectos', () => {
  it('publica en la biblioteca de usuario, y la propuesta queda archivada con la constancia', () => {
    const s = sandbox();
    const id = propuesta(s);
    const origen = folderHash(join(s.root, 'projects', KEY, 'proposed', id));

    const publicado = publishToLibrary(id, KEY, { root: s.root });
    assert.equal(publicado.ok, true, JSON.stringify(publicado));
    assert.equal(publicado.scope, 'global');

    // Está en la biblioteca, y es lo mismo: la huella lo dice.
    assert.equal(existsSync(join(s.curated, id, 'SKILL.md')), true);
    assert.equal(folderHash(join(s.curated, id)), origen, 'publicar no puede cambiar lo que se publica');
    assert.equal(isOurs(join(s.curated, id)), true, 'y lleva la marca de origen que la hace nuestra');

    // Ya no está como propuesta: pasó a `published/`, con la constancia de a dónde fue.
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', id)), false);
    const meta = JSON.parse(readFileSync(join(s.root, 'projects', KEY, 'published', id, 'meta.json'), 'utf8'));
    assert.equal(meta.published.sha256, origen);
    assert.equal(meta.published.projectKey, KEY);
    assert.equal(typeof meta.published.at, 'string');
  });

  it('el provider no la sirve como del proyecto: una sola copia efectiva', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(publishToLibrary(id, KEY, { root: s.root }).ok, true);

    const delProyecto = listForProject(CWD, { root: s.root }).map((e) => e.path);
    assert.equal(delProyecto.length, 0, 'lo publicado lo sirve el harness, no el provider del plugin');
  });

  it('la puerta de identidad: una skill ajena con el mismo id NO se pisa', () => {
    const s = sandbox();
    const id = propuesta(s);
    const suya = ajena(s, id);
    const antes = folderHash(suya);

    const intento = publishToLibrary(id, KEY, { root: s.root });
    assert.equal(intento.ok, false);
    assert.match(intento.reason, /no se pisa/);
    assert.match(intento.reason, /no es de skill-compiler/);

    // Y lo que importa: el fichero ajeno está intacto, byte a byte.
    assert.equal(folderHash(suya), antes, 'la skill ajena no se toca');
    assert.match(readFileSync(join(suya, 'SKILL.md'), 'utf8'), /De otra herramienta/);
    // Y la propuesta sigue donde estaba, sin moverse.
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'proposed', id, 'SKILL.md')), true);
  });

  it('actualizar una global nuestra aparta la versión anterior, no la destruye', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(publishToLibrary(id, KEY, { root: s.root }).ok, true);

    // Otra versión, publicada otra vez: la anterior tiene que quedar con su fecha.
    const segunda = propuesta(s, { body: `${goodInput().body}\n\n4. Cuarta línea, para que la versión cambie de verdad.`, revision: buenaRevision() });
    assert.equal(segunda, id, 'es el mismo id: una actualización');
    const otra = publishToLibrary(id, KEY, { root: s.root });
    assert.equal(otra.ok, true, JSON.stringify(otra));
    assert.notEqual(otra.superseded, null, 'y la anterior queda apartada con su fecha');

    const apartadas = readdirSync(join(s.root, 'global', 'superseded'));
    assert.equal(apartadas.length, 1);
    assert.equal(apartadas[0].startsWith(id), true);
    assert.equal(folderHash(join(s.root, 'global', 'superseded', apartadas[0])) !== folderHash(join(s.curated, id)), true,
      'la apartada es la versión vieja, no la nueva');
  });

  it('aprobar para todos desde el comando deja la constancia y avisa al catálogo', () => {
    const s = sandbox();
    const id = propuesta(s);
    let avisos = 0;
    const catalog = { notify: () => { avisos += 1; } };

    const r = approveProposal({ root: s.root, key: KEY, id, scope: 'global', catalog });
    assert.equal(r.kind, 'success', JSON.stringify(r));
    assert.equal(existsSync(join(s.curated, id, 'SKILL.md')), true);
    assert.equal(avisos, 1, 'publicar cambia lo que el agente ve: tiene que avisar');
  });

  it('publicar dos veces lo mismo no es un fallo: dice que ya estaba', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(approveProposal({ root: s.root, key: KEY, id, scope: 'global' }).kind, 'success');
    const otra = approveProposal({ root: s.root, key: KEY, id, scope: 'global' });
    assert.equal(otra.kind, 'success');
    assert.match(otra.text, /Ya estaba publicada/);
  });
});

// ── cambiar de sitio ────────────────────────────────────────────────────────────────────────────────

describe('ámbito · cambiar de sitio una ya aprobada', () => {
  it('de local a global: sale del proyecto y entra en la biblioteca', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(approve(id, KEY, { root: s.root }).ok, true);

    const movido = ambito(id, KEY, { to: 'global', root: s.root });
    assert.equal(movido.ok, true, JSON.stringify(movido));
    assert.equal(movido.scope, 'global');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', id)), false, 'no queda copia local');
    assert.equal(existsSync(join(s.curated, id, 'SKILL.md')), true);
    assert.equal(movido.sha256, folderHash(join(s.curated, id)));
  });

  it('de global a local: vuelve al proyecto, y se puede volver a publicar', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(approveProposal({ root: s.root, key: KEY, id, scope: 'global' }).kind, 'success');

    const vuelta = ambito(id, KEY, { to: 'project', root: s.root });
    assert.equal(vuelta.ok, true, JSON.stringify(vuelta));
    assert.equal(vuelta.scope, 'project');
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', id, 'SKILL.md')), true);
    assert.equal(existsSync(join(s.curated, id)), false, 'y sale de la biblioteca: una sola copia efectiva');

    // La constancia se apartó, así que volver a publicarla no choca con ella.
    const ida = propuesta(s, { body: `${goodInput().body}\n\n5. Una línea más.`, revision: buenaRevision() });
    const otra = ambito(ida, KEY, { to: 'global', root: s.root });
    assert.equal(otra.ok, true, JSON.stringify(otra));
  });

  it('sin decir a dónde no se mueve nada, y se dice cómo', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(approve(id, KEY, { root: s.root }).ok, true);

    const r = ambito(id, KEY, { root: s.root });
    assert.equal(r.ok, false);
    assert.match(r.reason, /--global/);
    assert.match(r.reason, /--local/);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', id)), true);
  });

  it('no se lleva a la biblioteca por encima de una skill ajena', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(approve(id, KEY, { root: s.root }).ok, true);
    const suya = ajena(s, id);
    const antes = folderHash(suya);

    const r = ambito(id, KEY, { to: 'global', root: s.root });
    assert.equal(r.ok, false);
    assert.match(r.reason, /no se pisa/);
    assert.equal(folderHash(suya), antes);
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', id)), true, 'y la local sigue en su sitio');
  });
});

// ── el ciclo de vida de una global ──────────────────────────────────────────────────────────────────

describe('ámbito · el ciclo de vida de una skill global', () => {
  const publicada = (s) => {
    const id = propuesta(s);
    assert.equal(approveProposal({ root: s.root, key: KEY, id, scope: 'global' }).kind, 'success');
    return id;
  };

  it('apagar la saca de la biblioteca, encender la devuelve', () => {
    const s = sandbox();
    const id = publicada(s);

    const apagada = disable(id, KEY, { root: s.root, scope: 'global' });
    assert.equal(apagada.ok, true, JSON.stringify(apagada));
    assert.equal(existsSync(join(s.curated, id)), false, 'apagada no la sirve el harness');
    assert.equal(existsSync(join(s.root, 'global', 'disabled', id, 'SKILL.md')), true, 'pero se conserva entera');

    const encendida = enable(id, KEY, { root: s.root, scope: 'global' });
    assert.equal(encendida.ok, true, JSON.stringify(encendida));
    assert.equal(existsSync(join(s.curated, id, 'SKILL.md')), true);
    assert.equal(encendida.hash, folderHash(join(s.curated, id)));
  });

  it('retirar la deja en un respaldo fechado con su huella, y restaurar la trae con la MISMA huella', () => {
    const s = sandbox();
    const id = publicada(s);
    const antes = folderHash(join(s.curated, id));

    const retirada = retire(id, KEY, { root: s.root, scope: 'global' });
    assert.equal(retirada.ok, true, JSON.stringify(retirada));
    assert.equal(retirada.scope, 'global');
    assert.equal(retirada.hash, antes);
    assert.equal(existsSync(join(s.curated, id)), false);
    assert.equal(retirada.backup.includes('global'), true, 'el respaldo dice que era global');
    assert.equal(existsSync(join(retirada.backup, 'SKILL.md')), true);

    // Y la lista de lo apagado y retirado lo enseña, con su ámbito.
    const lista = retired(KEY, { root: s.root });
    const entrada = lista.find((e) => e.id === id);
    assert.equal(entrada.state, 'retired');
    assert.equal(entrada.scope, 'global', 'sin el ámbito dicho, el humano no sabe dónde volver a ponerla');

    const vuelta = restore(id, KEY, { root: s.root, scope: 'global' });
    assert.equal(vuelta.ok, true, JSON.stringify(vuelta));
    assert.equal(vuelta.hash, antes, 'lo que vuelve es lo mismo que se fue');
    assert.equal(folderHash(join(s.curated, id)), antes);
  });

  it('una skill ajena no se apaga ni se retira: no es nuestra', () => {
    const s = sandbox();
    const suya = ajena(s, 'de-otra-herramienta');
    const antes = folderHash(suya);

    const apagar = disable('de-otra-herramienta', KEY, { root: s.root, scope: 'global' });
    assert.equal(apagar.ok, false);
    assert.match(apagar.reason, /no la escribió skill-compiler/);

    const retirar = retire('de-otra-herramienta', KEY, { root: s.root, scope: 'global' });
    assert.equal(retirar.ok, false);

    assert.equal(folderHash(suya), antes, 'la ajena sigue intacta');
  });

  it('una global apagada no se enciende si la biblioteca ya tiene ese id', () => {
    const s = sandbox();
    const id = publicada(s);
    assert.equal(disable(id, KEY, { root: s.root, scope: 'global' }).ok, true);
    ajena(s, id);

    const r = enable(id, KEY, { root: s.root, scope: 'global' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /ya tiene/);
  });
});

// ── el defecto seguro ───────────────────────────────────────────────────────────────────────────────

describe('ámbito · una aprobación sin ámbito es del proyecto', () => {
  it('el defecto es local: publicar para todos exige decirlo', () => {
    const s = sandbox();
    const id = propuesta(s);

    // Sin `scope`: es la llamada que hace el modo automático, y la que hace el comando cuando el humano
    // dijo `--local`. No puede acabar en la biblioteca.
    const r = approveProposal({ root: s.root, key: KEY, id });
    assert.equal(r.kind, 'success', JSON.stringify(r));
    assert.equal(existsSync(join(s.root, 'projects', KEY, 'approved', id, 'SKILL.md')), true);
    assert.equal(existsSync(join(s.curated, id)), false, 'un gesto sin ámbito no publica a todos los proyectos');
  });
});

// ── y una publicada se puede seguir mejorando ───────────────────────────────────────────────────────

/**
 * Este hueco lo destapó la propia suite: el veto de solapamiento trataba la biblioteca curada como
 * territorio de nadie, así que **el mismo id** de una skill que habíamos publicado era un conflicto. Es
 * decir: publicada una vez, el modelo ya no podía mejorarla en ningún proyecto, y la mejora sólo cabía
 * retirándola. Lo que decide no es dónde está la otra, sino de quién es.
 */
describe('ámbito · una skill publicada se puede seguir mejorando', () => {
  it('proponer el mismo id de una publicada NUESTRA es una actualización, no un conflicto', () => {
    const s = sandbox();
    const id = propuesta(s);
    assert.equal(approveProposal({ root: s.root, key: KEY, id, scope: 'global' }).kind, 'success');

    const otra = propose(
      goodInput({ body: `${GOOD_BODY}\n4. Una línea más, para que la versión cambie.`, revision: buenaRevision() }),
      { root: s.root, curated: s.curated, cwd: CWD },
    );
    assert.equal(otra.status, 'proposed', JSON.stringify(otra));
    assert.equal(otra.updatesPublished, true,
      'el humano tiene que saber que afina lo que ya se sirve en todos sus proyectos');
  });

  it('y el mismo id de una skill AJENA sigue siendo conflicto: no se suplanta', () => {
    const s = sandbox();
    ajena(s, 'de-otra-herramienta');

    const r = propose(
      goodInput({ id: 'de-otra-herramienta', description: 'Intento de ocupar un identificador que ya usa otra herramienta.' }),
      { root: s.root, curated: s.curated, cwd: CWD },
    );
    assert.equal(r.status, 'conflict', JSON.stringify(r));
    assert.equal(r.conflicts[0].reason, 'id-ocupado');
    assert.equal(r.conflicts[0].ours, false, 'y el conflicto dice que no es nuestra: la vía es otro id');
  });
});
