#!/usr/bin/env node
/**
 * Auditoría integral del almacén: cobertura, diagnóstico, errores parciales, solo lectura y
 * reproducibilidad.
 *
 * ── Qué tiene que quedar demostrado ─────────────────────────────────────────────────────────────
 *
 * 1. **Cobertura**: se audita lo que hay, en todos sus estados, y lo que no es nuestro se dice en vez de
 *    auditarse con la vara equivocada. Un almacén vacío no es un fallo.
 * 2. **Diagnóstico**: cada hallazgo lleva regla, valor observado, umbral, severidad y corrección — y los
 *    identificadores son estables (misma clave en cualquier máquina y en cualquier orden).
 * 3. **Errores parciales**: una skill ilegible o una carpeta denegada son **hallazgos**, no el final de la
 *    auditoría; y un vínculo dentro de una carpeta que no se pudo leer se declara no comprobable, no
 *    «falta el fichero» — que sería afirmar algo que no se ha medido.
 * 4. **Solo lectura**: la huella del árbol entero es la misma antes y después, y no aparece ningún fichero
 *    nuevo. Si la auditoría escribiera algo, en cualquier sitio, esta prueba lo vería.
 * 5. **Reproducibilidad**: dos ejecuciones del mismo estado dan exactamente el mismo informe.
 *
 * Las skills de prueba se crean con `propose` (formato real del almacén) y se mueven de estado con un
 * `rename`, que es lo que hace el plugin: así lo auditado es lo que el almacén produce de verdad.
 *
 * Y cada skill de prueba **habla de lo suyo**: el veto de solapamiento compara la descripción y el
 * disparador, así que una plantilla repetida con otro nombre se veta —como debe— y aquí no serviría para
 * montar una arena de varios estados. Doce asuntos distintos, con su redacción propia.
 *
 *   node --test tests/audit.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { folderHash, projectKey, propose, treeOf } from '../lib/compiler.mjs';
import { auditarAlmacen, NOMBRE_DE_ESTADO, resumenDeAuditoria } from '../lib/audit.mjs';
import { cleanupSandboxes, sandbox } from './helpers.mjs';

// La prosa de este fichero se afirma en espanol: el idioma se fija explicitamente (el base es `en`).
process.env.DSH_LANG = 'es';

after(cleanupSandboxes);

const CWD = 'C:\\xampp\\htdocs\\saas-corporative';
const KEY = projectKey(CWD);
/** La raíz del paquete: el CLI se invoca como lo invoca una persona. */
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/** Doce asuntos distintos, cada uno con su redacción: es como se puebla un almacén de verdad. */
const TEMAS = {
  'copias-de-seguridad': [
    'Respalda las bases de datos antes de cualquier migración y verifica la copia al terminar.',
    'Antes de tocar el esquema, los datos o la versión del servidor de MySQL.',
    'Comprueba el espacio libre en el disco de destino antes de volcar nada.',
  ],
  'registro-de-puertos': [
    'Inventaría los puertos que escucha la máquina y avisa de los que no esperabas abiertos.',
    'Al revisar la superficie de un servidor recién preparado.',
    'Compara el listado con el del mes anterior y explica cada diferencia.',
  ],
  'indices-de-mysql': [
    'Optimiza los índices de las tablas grandes leyendo antes el plan de ejecución real.',
    'Cuando una consulta concreta se vuelve lenta en producción.',
    'Guarda el plan de antes y el de después: sin esa pareja no hay prueba.',
  ],
  'certificados-tls': [
    'Renueva los certificados TLS antes de que caduquen y deja constancia de la fecha nueva.',
    'Treinta días antes del vencimiento, o al cambiar de proveedor.',
    'Anota la huella del certificado nuevo junto a la fecha de caducidad.',
  ],
  'rotacion-de-logs': [
    'Rota los ficheros de log del servidor web sin perder las líneas del día en curso.',
    'Cuando el disco se llena o al cerrar cada jornada.',
    'Cierra el descriptor antes de mover el fichero, o las líneas se pierden.',
  ],
  'permisos-de-carpetas': [
    'Ajusta los permisos de las carpetas compartidas y deja por escrito quién puede qué.',
    'Al dar de alta a alguien nuevo en el equipo.',
    'Quita el acceso por defecto antes de conceder el que hace falta.',
  ],
  'compilacion-de-estilos': [
    'Compila las hojas de estilo del tema y publica únicamente el resultado minificado.',
    'Tras editar cualquier fichero de estilos antes de desplegar.',
    'Guarda el mapa de fuentes o el navegador señalará la línea equivocada.',
  ],
  'correos-de-aviso': [
    'Programa el envío de los correos de aviso y revisa la cola después de cada lote.',
    'Cuando se añade un aviso nuevo al sistema.',
    'Comprueba la cola de salida antes de dar el lote por enviado.',
  ],
  'numeracion-de-facturas': [
    'Cuadra la numeración de las facturas emitidas contra el libro de registro.',
    'Al cerrar el trimestre fiscal.',
    'Si falta un número, dilo antes de emitir el siguiente.',
  ],
  'etiquetado-de-imagenes': [
    'Etiqueta las fotografías del catálogo para que el buscador las encuentre por su nombre real.',
    'Cuando entra mercancía nueva con fotos propias.',
    'El nombre del archivo importa menos que la etiqueta que lleva dentro.',
  ],
  'procedencia-de-materiales': [
    'Rastrea de dónde salió cada material gráfico y con qué licencia se puede usar.',
    'Antes de publicar cualquier pieza con material de terceros.',
    'Sin licencia escrita, el material no se publica: no hay excepciones.',
  ],
  'version-anterior-web': [
    'Guarda las versiones anteriores del sitio por si hay que volver atrás tras un despliegue.',
    'Inmediatamente antes de publicar un cambio en producción.',
    'Etiqueta la versión guardada con la fecha y el motivo del retroceso.',
  ],
};

function skillDe(id, { extra = '' } = {}) {
  const [description, whenToUse, trampa] = TEMAS[id];
  assert.ok(description, `el tema ${id} no está en la tabla de la arena`);
  return {
    id,
    description,
    whenToUse,
    body: [
      '## Cuándo se usa', '',
      whenToUse, '',
      '## Procedimiento', '',
      `1. ${description.replace(/\.$/, '')}.`,
      '2. Anota el valor observado antes de continuar.',
      `3. Trampa ya pagada: ${trampa}`,
      extra,
    ].join('\n'),
  };
}

/** Siembra una skill REAL (por la vía del plugin) y la deja en el estado pedido. */
function sembrar(arena, input, { estado = 'approved', key = KEY } = {}) {
  const hecho = propose(input, { root: arena.root, curated: arena.curated, cwd: CWD });
  assert.equal(hecho.status, 'proposed', `la siembra falló: ${JSON.stringify(hecho.errors ?? hecho.conflicts)}`);
  if (estado !== 'proposed') {
    const destino = join(arena.root, 'projects', key, estado);
    mkdirSync(destino, { recursive: true });
    renameSync(join(arena.root, 'projects', key, 'proposed', input.id), join(destino, input.id));
  }
  return join(arena.root, 'projects', key, estado, input.id);
}

/** Un estado del almacén hecho a mano: es lo que deja una edición posterior a la propuesta. */
function romper(dir, { description, whenToUse, body, references } = {}) {
  const skill = join(dir, 'SKILL.md');
  let texto = readFileSync(skill, 'utf8');
  if (description !== undefined) texto = texto.replace(/^description: .*$/m, `description: ${JSON.stringify(description)}`);
  if (whenToUse === null) texto = texto.replace(/^whenToUse: .*\r?\n/m, '');
  if (body !== undefined) {
    // El documento es frontmatter + título compuesto + cuerpo (sin línea en blanco entre ellos).
    const cabecera = texto.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n#\s[^\n]*\r?\n/);
    assert.ok(cabecera, 'la forma del SKILL.md del almacén no es la esperada');
    texto = cabecera[0] + body.trim() + '\n';
  }
  writeFileSync(skill, texto);
  if (references !== undefined) {
    const meta = join(dir, 'meta.json');
    const datos = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : {};
    datos.references = references;
    writeFileSync(meta, JSON.stringify(datos, null, 1));
  }
  return dir;
}

/**
 * Deniega el acceso de verdad, y **comprueba que quedó denegado**: un caso de permisos que no aplica la
 * denegación no probaría nada, y un test que pasa sin probar es peor que un test que falta.
 */
function denegar(ruta, { fichero = false } = {}) {
  if (process.platform === 'win32') {
    const usuario = process.env.USERNAME ?? process.env.USER ?? '';
    execFileSync('icacls', [ruta, '/deny', `${usuario}:(R)`], { stdio: 'pipe' });
  } else {
    execFileSync('chmod', ['000', ruta]);
  }
  let denegado = false;
  try {
    if (fichero) readFileSync(ruta, 'utf8');
    else readdirSync(ruta);
  } catch { denegado = true; }
  assert.ok(denegado, 'no se pudo denegar el acceso en este sistema: sin eso, el caso de permisos no está cubierto');
}

function permitir(ruta) {
  try {
    if (process.platform === 'win32') {
      const usuario = process.env.USERNAME ?? process.env.USER ?? '';
      execFileSync('icacls', [ruta, '/remove:d', usuario], { stdio: 'pipe' });
    } else execFileSync('chmod', ['755', ruta]);
  } catch { /* si no se puede restaurar, el borrado de la arena lo resolverá */ }
}

describe('cobertura: qué se audita y qué no', () => {
  it('un almacén vacío no es un fallo: cero skills y ningún hallazgo', () => {
    const arena = sandbox({ curated: false });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.equal(informe.totals.total, 0);
    assert.equal(informe.totals.error, 0);
    assert.deepEqual(informe.byState, {});
    assert.deepEqual(informe.contenedores, []);
    assert.deepEqual(informe.skills, []);
  });

  it('audita los estados vivos y cuenta el archivo aparte', () => {
    const arena = sandbox({ curated: false });
    const parejas = [
      ['proposed', 'copias-de-seguridad'], ['approved', 'registro-de-puertos'], ['disabled', 'indices-de-mysql'],
      ['rejected', 'certificados-tls'], ['published', 'permisos-de-carpetas'],
    ];
    for (const [estado, id] of parejas) sembrar(arena, skillDe(id), { estado });
    // El archivo guarda la versión anterior con el nombre `<id>-<fecha>` y el cuerpo que se aprobó entonces:
    // auditarlo con las reglas de hoy marcaría el nombre del archivo como id inválido. Se cuenta, no se mide.
    // Se siembra con un id válido y se renombra como lo hace el archivo: `<id>-<fecha>`, con el contenido de
    // entonces. La puerta no admitiría ese nombre, y por eso el archivo no se audita.
    const semilla = sembrar(arena, skillDe('version-anterior-web'), { estado: 'approved' });
    const archivo = join(arena.root, 'projects', KEY, 'superseded');
    mkdirSync(archivo, { recursive: true });
    renameSync(semilla, join(archivo, 'version-anterior-web-2026-10-18T18-35-34-156Z'));
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.equal(informe.totals.total, 5, 'el archivo no entra en el total auditado');
    assert.deepEqual(Object.keys(informe.byState).sort(), ['approved', 'disabled', 'proposed', 'published', 'rejected']);
    for (const [estado] of parejas) assert.equal(informe.byState[estado].total, 1, `el estado ${estado} no se contó`);
    assert.equal(informe.totals.pass, 5, 'las cinco están bien formadas');
    assert.equal(informe.archivadas.length, 1, 'el archivo se declara');
    assert.match(informe.archivadas[0], /^superseded\//);
    const publicada = informe.skills.find((s) => s.estado === 'published');
    assert.equal(publicada.estadoLegible, NOMBRE_DE_ESTADO.published);
  });

  it('la clave de una skill es estable: estado/proyecto/id', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('compilacion-de-estilos'), { estado: 'approved' });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.equal(informe.skills[0].key, `approved/${KEY}/compilacion-de-estilos`);
  });

  it('la biblioteca global: lo nuestro se audita, lo ajeno se dice y no se toca', () => {
    const arena = sandbox(); // siembra `session-state-recovery`, que no es nuestra
    const aprobada = sembrar(arena, skillDe('correos-de-aviso'), { estado: 'approved' });
    // La misma skill, publicada en la biblioteca curada (así la sirve el harness): copia fiel del árbol.
    const destino = join(arena.curated, 'correos-de-aviso');
    mkdirSync(destino, { recursive: true });
    for (const f of treeOf(aprobada).files) {
      const partes = f.split('/');
      if (partes.length > 1) mkdirSync(join(destino, ...partes.slice(0, -1)), { recursive: true });
      writeFileSync(join(destino, ...partes), readFileSync(join(aprobada, ...partes)));
    }
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const globales = informe.skills.filter((s) => s.estado === 'global');
    assert.equal(globales.length, 1, 'la global nuestra tiene que auditarse');
    assert.equal(globales[0].key, 'global/global/correos-de-aviso');
    assert.equal(globales[0].status, 'PASS');
    const ajenas = informe.contenedores.filter((c) => c.rule === 'not-ours');
    assert.equal(ajenas.length, 1);
    assert.match(ajenas[0].message, /no es de este plugin/);
  });

  it('un estado desconocido no se cae del informe en silencio', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('numeracion-de-facturas'));
    mkdirSync(join(arena.root, 'projects', KEY, 'archived'), { recursive: true });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const aviso = informe.contenedores.find((c) => c.rule === 'unknown-state');
    assert.ok(aviso, 'un estado nuevo tiene que aparecer como hallazgo');
    assert.match(aviso.observado, /archived$/);
  });

  it('el filtro por estado acota la lectura sin cambiar el diagnóstico', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('etiquetado-de-imagenes'), { estado: 'approved' });
    romper(sembrar(arena, skillDe('procedencia-de-materiales'), { estado: 'approved' }), { description: 'Corta del todo.' });
    const todo = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const soloAprobadas = auditarAlmacen({ root: arena.root, curated: arena.curated, estados: ['approved'] });
    assert.equal(todo.totals.total, soloAprobadas.totals.total);
    assert.deepEqual(soloAprobadas.byState.approved, todo.byState.approved);
  });
});

describe('diagnóstico: regla, valor observado, umbral y corrección', () => {
  it('una skill conforme pasa sin un solo hallazgo', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('copias-de-seguridad'));
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.equal(informe.skills[0].status, 'PASS');
    assert.deepEqual(informe.skills[0].findings, []);
    assert.equal(informe.skills[0].medidas.secciones, 2);
    assert.ok(informe.skills[0].medidas.body >= 200);
  });

  it('un aviso no es un error: se informa y la skill sigue en pie', () => {
    const arena = sandbox({ curated: false });
    const dir = sembrar(arena, skillDe('registro-de-puertos'));
    romper(dir, { body: `## Un bloque\n\n${'x'.repeat(8100)}\n\n## Otro bloque\n\n${'y'.repeat(200)}` });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const skill = informe.skills[0];
    assert.equal(skill.status, 'WARN');
    const aviso = skill.findings.find((f) => f.rule === 'body-budget');
    assert.ok(aviso, 'el aviso de presupuesto tiene que aparecer');
    assert.equal(aviso.severity, 'warn');
    assert.ok(aviso.observed > 8000 && aviso.observed < 24000, `observado ${aviso.observed} fuera del tramo de aviso`);
    assert.equal(aviso.threshold, 8000);
    assert.ok(aviso.fix.length > 0, 'un aviso tiene que decir qué hacer');
  });

  it('un error trae el valor observado, el umbral y la corrección', () => {
    const arena = sandbox({ curated: false });
    romper(sembrar(arena, skillDe('indices-de-mysql')), { description: 'Demasiado corta.' });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const skill = informe.skills[0];
    assert.equal(skill.status, 'ERROR');
    const fallo = skill.findings.find((f) => f.rule === 'description-min');
    assert.equal(fallo.severity, 'error');
    assert.equal(fallo.observed, 'Demasiado corta.'.length);
    assert.equal(fallo.threshold, 60);
    assert.match(fallo.fix, /descripción/i);
  });

  it('una referencia que el cuerpo declara y no está es un error con la ruta observada', () => {
    const arena = sandbox({ curated: false });
    const dir = sembrar(arena, skillDe('certificados-tls'));
    romper(dir, { body: '## Procedimiento\n\nSigue `references/no-existe.md` al pie de la letra, sin saltarte nada.\n\n## Cuándo se usa\n\nSiempre que haya que renovar.' });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const fallo = informe.skills[0].findings.find((f) => f.rule === 'link-missing');
    assert.ok(fallo, 'el vínculo roto tiene que aparecer');
    assert.equal(fallo.observed, 'references/no-existe.md');
    assert.match(fallo.fix, /references\/no-existe\.md/);
  });

  it('una referencia que cambió después de proponerse es un error de integridad, con las dos huellas', () => {
    const arena = sandbox({ curated: false });
    const dir = sembrar(arena, skillDe('rotacion-de-logs'));
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(join(dir, 'references', 'contratos.md'), 'contenido aprobado\n');
    romper(dir, { references: [{ path: 'references/contratos.md', sha256: 'aaaaaaaaaaaaaaaa' }] });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const fallo = informe.skills[0].findings.find((f) => f.rule === 'reference-integrity');
    assert.ok(fallo, 'la huella distinta tiene que aparecer');
    assert.match(String(fallo.observed), /^references\/contratos\.md [0-9a-f]{16}$/);
    assert.match(String(fallo.threshold), /^references\/contratos\.md aaaaaaaaaaaaaaaa$/);
    assert.equal(informe.skills[0].status, 'ERROR');
  });

  it('el resumen por regla agrupa las skills y conserva la corrección: es la lista de trabajo', () => {
    const arena = sandbox({ curated: false });
    for (const id of ['permisos-de-carpetas', 'compilacion-de-estilos']) {
      romper(sembrar(arena, skillDe(id)), { description: 'Corta.' });
    }
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const regla = informe.byRule.find((r) => r.rule === 'description-min');
    assert.equal(regla.count, 2);
    assert.deepEqual(regla.skills, [`approved/${KEY}/compilacion-de-estilos`, `approved/${KEY}/permisos-de-carpetas`]);
    assert.equal(regla.severity, 'error');
    assert.ok(regla.fix.length > 0);
    assert.equal(informe.byRule[0].severity, 'error');
  });
});

describe('errores parciales: lo que no se puede leer se dice, y el resto se audita igual', () => {
  it('un SKILL.md ilegible deja esa skill sin auditar, y las demás se auditan', () => {
    // Determinista y sin tocar permisos: un `SKILL.md` que es una CARPETA da error de lectura real.
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('correos-de-aviso'));
    sembrar(arena, skillDe('numeracion-de-facturas'));
    const rota = sembrar(arena, skillDe('etiquetado-de-imagenes'));
    rmSync(join(rota, 'SKILL.md'));
    mkdirSync(join(rota, 'SKILL.md'));

    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.equal(informe.totals.total, 3, 'las tres tienen que estar en el informe');
    assert.equal(informe.totals.pass, 2, 'las dos buenas siguen pasando');
    const sinSkill = informe.skills.find((s) => s.id === 'etiquetado-de-imagenes');
    assert.equal(sinSkill.status, 'UNREADABLE');
    assert.equal(sinSkill.findings[0].rule, 'unreadable');
    assert.match(String(sinSkill.findings[0].observed), /EISDIR|EPERM|EACCES|ENOTDIR/);
  });

  it('con el SKILL.md denegado: hallazgo identificable, y ninguna otra skill se pierde', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('procedencia-de-materiales'));
    const protegida = sembrar(arena, skillDe('version-anterior-web'));
    const fichero = join(protegida, 'SKILL.md');
    denegar(fichero, { fichero: true });
    try {
      const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
      assert.equal(informe.totals.total, 2, 'la protegida sigue contando: no se cae del informe');
      const sinLeer = informe.skills.find((s) => s.id === 'version-anterior-web');
      assert.equal(sinLeer.status, 'UNREADABLE');
      assert.equal(sinLeer.findings[0].rule, 'unreadable');
      assert.match(String(sinLeer.findings[0].observed), /EPERM|EACCES/);
      assert.ok(sinLeer.findings[0].fix.length > 0, 'un fallo de acceso tiene que decir por dónde se arregla');
      assert.equal(informe.skills.find((s) => s.id === 'procedencia-de-materiales').status, 'PASS');
    } finally {
      permitir(fichero);
    }
  });

  it('con la CARPETA denegada (pero el SKILL.md legible): la skill se mide y el acceso se declara', () => {
    // Denegar una carpeta no impide leer el fichero de dentro: lo que se pierde es el inventario. La
    // auditoría tiene que decir eso, y no fingir que la skill entera es ilegible.
    const arena = sandbox({ curated: false });
    const dir = sembrar(arena, skillDe('etiquetado-de-imagenes'));
    denegar(dir);
    try {
      const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
      const skill = informe.skills[0];
      assert.equal(skill.status, 'ERROR');
      assert.ok(skill.findings.some((f) => f.rule === 'unreadable' && String(f.observed).includes('EPERM')
        || f.rule === 'unreadable' && String(f.observed).includes('EACCES')));
      assert.ok(skill.medidas.body > 0, 'el cuerpo se pudo leer, así que se mide');
    } finally {
      permitir(dir);
    }
  });

  it('una carpeta ilegible dentro de la skill es un hallazgo, y su vínculo queda NO COMPROBABLE', () => {
    const arena = sandbox({ curated: false });
    const dir = sembrar(arena, skillDe('copias-de-seguridad'));
    const escondido = join(dir, 'references');
    mkdirSync(escondido, { recursive: true });
    writeFileSync(join(escondido, 'dentro.md'), 'material que sí está\n');
    romper(dir, { body: '## Procedimiento\n\nLee `references/dentro.md` antes de tocar nada, entero.\n\n## Cuándo se usa\n\nCada vez que se respalde.' });
    denegar(escondido);
    try {
      const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
      const skill = informe.skills[0];
      assert.ok(skill.findings.some((f) => f.rule === 'unreadable'), 'la carpeta denegada tiene que aparecer');
      const vinculo = skill.findings.find((f) => f.rule.startsWith('link-'));
      assert.ok(vinculo, 'el vínculo tiene que aparecer');
      assert.equal(vinculo.rule, 'link-unverifiable', 'no puede decirse que falta un fichero que no se ha podido mirar');
      assert.equal(vinculo.severity, 'info');
      assert.match(vinculo.message, /no se pudo comprobar/);
    } finally {
      permitir(escondido);
    }
  });

  it('un meta.json ilegible no impide auditar la skill', () => {
    const arena = sandbox({ curated: false });
    const dir = sembrar(arena, skillDe('registro-de-puertos'));
    writeFileSync(join(dir, 'meta.json'), '{ esto no es json');
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.equal(informe.skills[0].status, 'PASS', 'sin meta legible, la skill se mide por su SKILL.md');
  });
});

describe('solo lectura y reproducibilidad', () => {
  it('la auditoría no escribe nada: huella del árbol idéntica y ningún fichero nuevo', () => {
    const arena = sandbox();
    sembrar(arena, skillDe('indices-de-mysql'));
    sembrar(arena, skillDe('certificados-tls'), { estado: 'disabled' });
    romper(sembrar(arena, skillDe('rotacion-de-logs')), { description: 'Otra cosa distinta y muy corta.' });

    const antes = folderHash(arena.base);
    const ficherosAntes = treeOf(arena.base);
    auditarAlmacen({ root: arena.root, curated: arena.curated });
    auditarAlmacen({ root: arena.root, curated: arena.curated, estados: ['approved'] });
    const despues = folderHash(arena.base);
    const ficherosDespues = treeOf(arena.base);

    assert.equal(despues, antes, 'el almacén cambió: la auditoría no es de solo lectura');
    assert.deepEqual(ficherosDespues, ficherosAntes, 'aparecieron ficheros nuevos (¿temporales?)');
    assert.ok(existsSync(join(arena.root, 'projects')), 'y el almacén sigue donde estaba');
  });

  it('dos ejecuciones del mismo estado dan exactamente el mismo informe', () => {
    const arena = sandbox();
    sembrar(arena, skillDe('permisos-de-carpetas'));
    romper(sembrar(arena, skillDe('compilacion-de-estilos')), { description: 'Otra cosa distinta y muy corta.' });
    const primera = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const segunda = auditarAlmacen({ root: arena.root, curated: arena.curated });
    assert.equal(JSON.stringify(segunda), JSON.stringify(primera));
    const claves = primera.skills.map((s) => s.key);
    assert.deepEqual(claves, [...claves].sort());
    assert.equal(JSON.stringify(primera).includes(String(new Date().getFullYear())), false, 'el informe no lleva fechas');
  });

  it('el resumen en líneas cuenta lo mismo que el informe', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('correos-de-aviso'));
    romper(sembrar(arena, skillDe('numeracion-de-facturas')), { description: 'Otra cosa distinta y muy corta.' });
    const informe = auditarAlmacen({ root: arena.root, curated: arena.curated });
    const resumen = resumenDeAuditoria(informe);
    assert.match(resumen, /skills auditadas: 2 · PASS 1 · WARN 0 · ERROR 1/);
    assert.match(resumen, /aprobada/);
  });
});

describe('la CLI: el comando audit, por la superficie que usa una persona', () => {
  /** El CLI de verdad, con la arena como almacén. */
  function cli(arena, ...args) {
    try {
      const salida = execFileSync(process.execPath, [join(RAIZ, 'bin', 'skill-compiler.mjs'), ...args], {
        cwd: RAIZ, encoding: 'utf8',
        env: { ...process.env, DSH_HOME: arena.base },
      });
      return { code: 0, out: salida };
    } catch (error) {
      return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  }

  it('resume, detalla y sale con 1 cuando hay errores', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('copias-de-seguridad'));
    romper(sembrar(arena, skillDe('registro-de-puertos')), { description: 'Corta.' });
    const r = cli(arena, 'audit');
    assert.equal(r.code, 1, 'con una skill en error, el código de salida lo dice');
    assert.match(r.out, /solo lectura/);
    assert.match(r.out, /skills auditadas: 2 · PASS 1 · WARN 0 · ERROR 1/);
    assert.match(r.out, /\[error\] description-min \(observado 6, umbral 60\)/);
    assert.match(r.out, /corrige: Reescribe la descripción/);
    assert.match(r.out, /nada se ha modificado/);
  });

  it('con todo en orden sale con 0 y no inventa hallazgos', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('indices-de-mysql'));
    const r = cli(arena, 'audit');
    assert.equal(r.code, 0);
    assert.match(r.out, /ninguna skill con error/);
  });

  it('--json da el informe entero y --estado acota la auditoría', () => {
    const arena = sandbox({ curated: false });
    sembrar(arena, skillDe('certificados-tls'));
    romper(sembrar(arena, skillDe('rotacion-de-logs'), { estado: 'disabled' }), { description: 'Corta.' });
    const json = cli(arena, 'audit', '--json');
    const informe = JSON.parse(json.out);
    assert.equal(informe.totals.total, 2);
    assert.equal(json.code, 1);

    const soloAprobadas = cli(arena, 'audit', '--estado', 'approved', '--json');
    assert.equal(JSON.parse(soloAprobadas.out).totals.total, 1);
    assert.equal(soloAprobadas.code, 0, 'la apagada es la que falla, y no se ha auditado');
  });

  it('la ayuda del CLI anuncia el comando: uno que no aparece no existe', () => {
    const arena = sandbox({ curated: false });
    const r = cli(arena, 'no-existe');
    assert.equal(r.code, 2);
    assert.match(r.out, /audit \[--json\] \[--estado X\] \[--todo\]/);
  });
});
