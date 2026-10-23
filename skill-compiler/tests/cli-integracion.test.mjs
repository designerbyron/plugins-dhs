/**
 * La CLI, de verdad: subproceso sobre una caja de arena.
 *
 * Las pruebas del motor llaman a las funciones; esto ejecuta `bin/skill-compiler.mjs` como lo ejecuta una
 * persona, con `DSH_HOME` apuntando a la arena, y comprueba el **estado en disco**. Cubre lo que sólo se puede
 * romper en el borde: el `--preserve-state` que corrige una skill apagada sin encenderla, el guard que impide
 * usarlo en una activa, y el camino global (publicar, reparar desde la copia publicada y volver a publicar)
 * conservando la ubicación.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { approve, disable, propose, projectKey } from '../lib/compiler.mjs';
import { reparar } from '../lib/repair.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

// La prosa de este fichero se afirma en español: el idioma se fija explícitamente (el base es `en`).
process.env.DSH_LANG = 'es';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
const CLI = join(process.cwd(), 'bin', 'skill-compiler.mjs');

const cuerpoLargo = (titulo) => [
  '## Procedimiento', '',
  'Se lee el registro y se anota la cifra antes de decidir, nunca después.', '',
  `## ${titulo}`, '',
  'Se mide el estado, se anota la cifra y se contrasta con el sistema antes de tocar nada. '.repeat(150), '',
  '## Cierre', '',
  'Se firma el parte con la hora y la persona que lo hizo.', '',
].join('\n');

function cli(arena, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DSH_HOME: arena.base },
    encoding: 'utf8',
  });
  return { code: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Una skill viva (aprobada o apagada) en la arena, por la vía real del plugin. */
const cuerpoCorto = () => [
  '## Procedimiento', '',
  'Se lee el registro del turno, se anota la cifra y se contrasta con el sistema antes de decidir nada.',
  'Cuando la cifra no cuadra, se para y se avisa: decidir con un número inventado es peor que no decidir.',
  'El parte se firma con la hora y con la persona que lo hizo, para que la decisión tenga dueño.',
  'Si el registro no se puede leer, no se toca el turno: se documenta el bloqueo y se escala al responsable.', '',
  '## Cierre', '',
  'Se firma el parte con la hora y la persona que lo hizo.', '',
].join('\n');

function sembrar(arena, id, { apagada = false, publicada = false, tema = 'inventario del almacén', corta = false, descripcion = null, cuando = null } = {}) {
  const hecho = propose({
    id,
    description: descripcion ?? `Procedimiento de ${tema}: se mide su estado y se cierra con la cifra delante.`,
    whenToUse: cuando ?? `Cuando haya que ocuparse de ${tema} y falte la cifra medida que lo decide.`,
    body: corta ? cuerpoCorto() : cuerpoLargo('Medición'),
  }, { root: arena.root, curated: arena.curated, cwd: CWD });
  assert.equal(hecho.status, 'proposed', JSON.stringify(hecho.errors ?? hecho.conflicts));
  const movido = approve(id, KEY, { root: arena.root, curated: arena.curated, ...(publicada ? { scope: 'global' } : {}) });
  assert.equal(movido.ok, true, movido.reason);
  if (apagada) {
    const apagado = disable(id, KEY, { root: arena.root });
    assert.equal(apagado.ok, true, apagado.reason);
  }
}

const cuerpoDe = (dir) => readFileSync(join(dir, 'SKILL.md'), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
const bytes = (dir) => Buffer.byteLength(cuerpoDe(dir));

describe('CLI real (subproceso, arena) · corregir sin cambiar el estado', () => {
  it('una skill apagada se repara y SIGUE apagada; no aparece en approved/', () => {
    const arena = sandbox();
    const id = 'apagada-que-se-corrige';
    sembrar(arena, id, { apagada: true });
    const dirApagada = join(arena.root, 'projects', KEY, 'disabled', id);
    assert.equal(bytes(dirApagada) > 8000, true, 'parte por encima del presupuesto');

    const r = cli(arena, 'repair', id, '--project-key', KEY);
    assert.equal(r.code, 0, r.salida);
    assert.equal(existsSync(join(arena.root, 'projects', KEY, 'proposed', id)), true, 'deja propuesta');

    const a = cli(arena, 'approve', id, '--local', '--preserve-state', '--project-key', KEY);
    assert.equal(a.code, 0, a.salida);
    assert.match(a.salida, /Actualizada \(sigue apagada\)/);
    assert.equal(existsSync(dirApagada), true, 'sigue en disabled/');
    assert.equal(bytes(dirApagada) <= 8000, true, 'y ya cabe');
    assert.equal(existsSync(join(arena.root, 'projects', KEY, 'approved', id)), false, 'no se ha encendido');
    assert.equal(readdirSync(join(arena.root, 'projects', KEY, 'superseded')).some((x) => x.startsWith(id)), true, 'la anterior se apartó');
  });

  it('`--preserve-state` sobre una skill activa es un error, no un cambio de estado silencioso', () => {
    const arena = sandbox();
    const id = 'activa-sin-apagar';
    sembrar(arena, id);
    assert.equal(cli(arena, 'repair', id, '--project-key', KEY).code, 0);
    const a = cli(arena, 'approve', id, '--local', '--preserve-state', '--project-key', KEY);
    assert.notEqual(a.code, 0);
    assert.match(a.salida, /solo tiene sentido con una skill apagada/);
    assert.equal(bytes(join(arena.root, 'projects', KEY, 'approved', id)) > 8000, true, 'no se ha tocado la activa');
  });
});

describe('CLI real (subproceso, arena) · corregir una skill global sin moverla', () => {
  it('repara desde la copia publicada y vuelve a publicar en el mismo sitio, guardando la anterior', () => {
    const arena = sandbox();
    const id = 'global-que-se-corrige';
    sembrar(arena, id, { publicada: true });
    const cartel = join(arena.curated, id);
    assert.equal(existsSync(cartel), true, 'vive en la biblioteca');
    assert.equal(bytes(cartel) > 8000, true, 'y pasa del presupuesto');

    const r = cli(arena, 'repair', id, '--project-key', KEY);
    assert.equal(r.code, 0, r.salida);
    assert.match(r.salida, /base: published/, 'la base es la copia global, no una local');

    const a = cli(arena, 'approve', id, '--global', '--project-key', KEY);
    assert.equal(a.code, 0, a.salida);
    assert.equal(bytes(cartel) <= 8000, true, 'la global ya cabe');
    assert.equal(existsSync(join(arena.root, 'projects', KEY, 'published', id)), true, 'la propuesta queda como publicada');
    assert.equal(existsSync(join(arena.root, 'projects', KEY, 'approved', id)), false, 'no se ha localizado');
    const archivadas = readdirSync(join(arena.root, 'global', 'superseded'));
    assert.equal(archivadas.some((x) => x.startsWith(id)), true, 'la versión anterior de la global queda recuperable');
    assert.equal(bytes(join(arena.root, 'global', 'superseded', archivadas.find((x) => x.startsWith(id)))) > 8000, true, 'y entera');
  });
});

describe('CLI real (subproceso, arena) · el motor dice la verdad', () => {
  it('`audit` sin avisos devuelve 0 y lo dice; con el cuerpo largo, 0 pero con el aviso contado', () => {
    const arena = sandbox();
    sembrar(arena, 'conforme-a-la-primera', { corta: true });
    const limpio = cli(arena, 'audit');
    assert.equal(limpio.code, 0, limpio.salida);
    assert.match(limpio.salida, /WARN 0/);

    sembrar(arena, 'larga-sin-reparar', {
      descripcion: 'Rotación de certificados TLS: renovar la cadena de confianza y comprobar el vencimiento con la fecha delante.',
      cuando: 'Cuando venza un certificado del servidor y haya que renovarlo sin cortar el servicio.',
    });
    const conAviso = cli(arena, 'audit');
    assert.equal(conAviso.code, 0);
    assert.match(conAviso.salida, /WARN 1/);
    assert.match(conAviso.salida, /body-budget/);
  });

  it('`repair` de un id que no existe sale con código distinto de cero y no escribe nada', () => {
    const arena = sandbox();
    const r = cli(arena, 'repair', 'no-existe-esta-skill', '--project-key', KEY);
    assert.notEqual(r.code, 0);
    assert.match(r.salida, /no hay ninguna skill viva/);
  });
});

describe('CLI real (subproceso, arena) · una propuesta con avisos', () => {
  it('publicar sin `--force` se niega y lo dice; con `--force` publica (lo que hace la tarjeta al confirmar)', () => {
    const arena = sandbox();
    const id = 'con-avisos-sin-decidir';
    const hecho = propose({
      id,
      description: 'Procedimiento largo que dispara el aviso de presupuesto para probar la decisión humana.',
      whenToUse: 'Cuando haya que probar que una propuesta con avisos no se publica sin decirlo.',
      body: cuerpoLargo('Detalle que no cabe'),
    }, { root: arena.root, curated: arena.curated, cwd: CWD });
    assert.equal(hecho.status, 'proposed', JSON.stringify(hecho.errors ?? hecho.conflicts));

    const sin = cli(arena, 'approve', id, '--global', '--project-key', KEY);
    assert.notEqual(sin.code, 0, 'sin --force no se publica');
    assert.match(sin.salida, /tiene avisos/);
    assert.equal(existsSync(join(arena.curated, id)), false, 'no se publicó nada');

    const con = cli(arena, 'approve', id, '--global', '--force', '--project-key', KEY);
    assert.equal(con.code, 0, con.salida);
    assert.equal(existsSync(join(arena.curated, id)), true, 'con --force sí');
  });

  it('`/skill-pending` en la CLI: la orden existe y el comando base la declara', () => {
    const arena = sandbox();
    sembrar(arena, 'pendiente-para-consultar', { corta: true });
    // El comando es del plugin (no de la CLI): se comprueba que la CLI lo anuncia en su ayuda.
    const r = cli(arena, 'where');
    assert.equal(r.code, 0, r.salida);
    // La ayuda se pinta desde el catalogo (`cli.usage.*` / `cli.help.*`), no desde un comentario del fichero:
    // se comprueba la salida real, que es lo que lee una persona.
    const ayuda = cli(arena);
    assert.equal(ayuda.code, 2, 'sin comando, la ayuda sale con 2 (uso)');
    assert.match(ayuda.salida, /skill-pending/);
  });
});

describe('CLI real (subproceso, arena) · idioma del plugin', () => {
  it('sin preferencia dice en y de dónde sale; fijarlo persiste y se lee en el proceso siguiente', () => {
    const arena = sandbox();
    // Este caso mide el idioma POR DEFECTO, así que corre sin `DSH_LANG`: el resto del fichero lo fija a
    // `es` para poder afirmar la prosa española de los comandos.
    const guardado = process.env.DSH_LANG;
    delete process.env.DSH_LANG;
    const antes = cli(arena, 'lang');
    assert.equal(antes.code, 0, antes.salida);
    assert.match(antes.salida, /^language: en \(source: default\)$/m);

    const puesto = cli(arena, 'lang', 'es');
    assert.equal(puesto.code, 0, puesto.salida);
    assert.match(puesto.salida, /idioma fijado en es/);

    const despues = cli(arena, 'lang');
    assert.match(despues.salida, /^idioma: es \(fuente: config\)$/m);
    if (guardado === undefined) delete process.env.DSH_LANG;
    else process.env.DSH_LANG = guardado;
  });

  it('un idioma no admitido sale con código 2 y no crea configuración', () => {
    const arena = sandbox();
    const r = cli(arena, 'lang', 'fr');
    assert.equal(r.code, 2, r.salida);
    assert.match(r.salida, /no admitido|not supported|unsupported/i);
    assert.equal(existsSync(join(arena.root, 'config.json')), false);
  });

  it('DSH_LANG manda sobre la preferencia y deja el config intacto', () => {
    const arena = sandbox();
    cli(arena, 'lang', 'es');
    const r = spawnSync(process.execPath, [CLI, 'lang'], {
      cwd: process.cwd(),
      env: { ...process.env, DSH_HOME: arena.base, DSH_LANG: 'en' },
      encoding: 'utf8',
    });
    assert.match(String(r.stdout), /^language: en \(source: env\)$/m);
    assert.equal(JSON.parse(readFileSync(join(arena.root, 'config.json'), 'utf8')).lang, 'es');
  });

  it('doctor publica el idioma con su fuente', () => {
    const arena = sandbox();
    // Este caso mide la fuente `config`: corre sin `DSH_LANG`, que el resto del fichero fija a `es`.
    const guardado = process.env.DSH_LANG;
    delete process.env.DSH_LANG;
    cli(arena, 'lang', 'es');
    const r = cli(arena, 'doctor');
    assert.match(r.salida, /idioma: es \(fuente: config\)/);
    if (guardado === undefined) delete process.env.DSH_LANG;
    else process.env.DSH_LANG = guardado;
  });

  it('el ajuste conserva claves ajenas del config', () => {
    const arena = sandbox();
    mkdirSync(arena.root, { recursive: true });
    writeFileSync(join(arena.root, 'config.json'), `${JSON.stringify({ otra: 'dato', lang: 'en' })}\n`, 'utf8');
    assert.equal(cli(arena, 'lang', 'es').code, 0);
    const datos = JSON.parse(readFileSync(join(arena.root, 'config.json'), 'utf8'));
    assert.deepEqual(datos, { otra: 'dato', lang: 'es' });
  });
});
