/**
 * La auditoría integral del almacén: **solo lectura, reproducible y sin efectos**.
 *
 * ── Las tres reglas que la definen ──────────────────────────────────────────────────────────────
 *
 * 1. **No escribe nada.** Ni un temporal, ni un fichero de caché, ni un `meta.json` «normalizado». Sólo
 *    `readdirSync`, `statSync` y `readFileSync`. La prueba de `audit.test.mjs` compara la huella del árbol
 *    entero antes y después, así que una escritura —donde sea— se ve.
 * 2. **No se cae.** Un fichero ilegible, una carpeta denegada o un `meta.json` mal formado son hallazgos;
 *    nunca una excepción que deje sin auditar el resto. Perder catorce skills buenas por una mala no es un
 *    informe, es un accidente.
 * 3. **Es reproducible.** El orden sale de la clave de cada skill, no del recorrido del sistema de
 *    archivos, y no viaja ninguna fecha: dos ejecuciones sobre el mismo estado dan el **mismo** informe,
 *    comparables con una igualdad.
 *
 * La puerta de calidad no se reimplementa aquí: cada skill se mide con `auditarCarpeta`, que es lo mismo
 * que aplica la puerta de aprobar. Si la auditoría dijera algo distinto que la puerta, la culpa sería de
 * tener dos implementaciones, no de las skills.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { auditarCarpeta, curatedLibraryRoot, defaultRoot, isOurs, listProjects } from './compiler.mjs';

/** Los estados en los que puede vivir una skill dentro de un proyecto. */
export const ESTADOS_DE_PROYECTO = ['proposed', 'approved', 'disabled', 'rejected', 'superseded', 'published'];
/** Los estados de la biblioteca curada global: la raíz misma, y sus dos carpetas de retiro. */
export const ESTADOS_GLOBALES = ['global', 'global-disabled', 'global-superseded'];

/**
 * Cómo se ordenan y se nombran los estados en el informe. «published» es una constancia archivada de lo
 * que se publicó, así que se dice tal cual y no se llama «aprobada».
 */
export const NOMBRE_DE_ESTADO = {
  proposed: 'propuesta',
  approved: 'aprobada',
  disabled: 'apagada',
  rejected: 'rechazada',
  superseded: 'apartada',
  published: 'publicada',
  global: 'global',
  'global-disabled': 'global apagada',
  'global-superseded': 'global apartada',
};

const aRelativa = (base, ruta) => relative(base, ruta).split(sep).join('/');

/**
 * Subcarpetas de un directorio, sin lanzar: si el directorio no está o no se puede leer, lo dice.
 * @returns `{ nombres, error }`
 */
function subcarpetas(dir) {
  try {
    if (!existsSync(dir)) return { nombres: [], error: null };
    return {
      nombres: readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(),
      error: null,
    };
  } catch (error) {
    return { nombres: [], error: `${error.code ?? error.message}` };
  }
}

/** El estado observable de una skill a partir de sus hallazgos. */
function estadoDe(findings, unreadable) {
  if (unreadable) return 'UNREADABLE';
  if (findings.some((f) => f.severity === 'error')) return 'ERROR';
  if (findings.some((f) => f.severity === 'warn')) return 'WARN';
  return 'PASS';
}

/**
 * Audita **una** skill y devuelve su ficha, con clave estable para poder señalarla después.
 *
 * La clave es `estado/proyecto/id` (por ejemplo `approved/saas-corporative-a1b2c3d4/contratos`). No lleva
 * fecha ni índice de recorrido: la misma skill tiene la misma clave en cualquier máquina y en cualquier
 * orden, que es lo que permite decir «esta» sin ambigüedad.
 */
function ficha(dir, { root, estado, projectKey, id, cwd }) {
  const unica = `${estado}/${projectKey}/${id}`;
  let resultado = null;
  try {
    resultado = auditarCarpeta(dir, { cwd, id });
  } catch (error) {
    // `auditarCarpeta` no debería lanzar; si el entorno se las arregla para que sí, la auditoría entera no
    // se pierde por esta skill.
    resultado = {
      findings: [{ severity: 'error', rule: 'unreadable', observed: error.code ?? error.message, threshold: null, message: `no se pudo auditar: ${error.message}`, fix: 'Revisa los permisos de esa carpeta' }],
      unreadable: true,
      medidas: null,
    };
  }
  const findings = resultado.findings ?? [];
  return {
    key: unica,
    estado,
    estadoLegible: NOMBRE_DE_ESTADO[estado] ?? estado,
    projectKey,
    id,
    dir: aRelativa(root, dir),
    status: estadoDe(findings, resultado.unreadable),
    medidas: resultado.medidas ?? null,
    errores: findings.filter((f) => f.severity === 'error').length,
    avisos: findings.filter((f) => f.severity === 'warn').length,
    findings,
  };
}

/**
 * Audita el almacén **entero**: todos los proyectos, todos sus estados, la biblioteca global y la curada.
 *
 * @param root - raíz del almacén (por defecto `$DSH_HOME/skill-compiler`).
 * @param curated - biblioteca curada (por defecto la del harness).
 * @param cwd - proyecto desde el que se audita, para poder comprobar la evidencia declarada.
 * @param estados - si se pasa, sólo se auditan esos estados (filtro de lectura, no cambia el diagnóstico).
 * @returns El informe: totales, desglose por estado, por regla, y una ficha por skill.
 */
export function auditarAlmacen({ root = defaultRoot(), curated = curatedLibraryRoot(), cwd = null, estados = null } = {}) {
  const contenedores = [];
  const fichas = [];
  const quiere = (estado) => estados === null || estados.includes(estado);

  const anotaContenedor = (severity, rule, observado, message, fix) => {
    contenedores.push({ severity, rule, observado, message, fix });
  };

  // ── 1. Los proyectos y todos sus estados ────────────────────────────────────────────────────────
  let claves = [];
  try {
    claves = listProjects(root);
  } catch (error) {
    anotaContenedor('error', 'store-unreadable', root, `no se pudo listar el almacén: ${error.message}`, 'Revisa los permisos de la carpeta del almacén');
  }

  for (const projectKey of claves) {
    const base = join(root, 'projects', projectKey);
    for (const estado of ESTADOS_DE_PROYECTO) {
      if (!quiere(estado)) continue;
      const dir = join(base, estado);
      const { nombres, error } = subcarpetas(dir);
      if (error) {
        anotaContenedor('error', 'state-unreadable', aRelativa(root, dir), `no se pudo leer el estado «${estado}» de ${projectKey}: ${error}`, 'Revisa los permisos de esa carpeta');
        continue;
      }
      for (const id of nombres) fichas.push(ficha(join(dir, id), { root, estado, projectKey, id, cwd }));
    }
    // Un estado que el auditor no conoce no puede caerse del informe en silencio.
    const { nombres: enProyecto } = subcarpetas(base);
    const conocidos = new Set([...ESTADOS_DE_PROYECTO, '.git']);
    for (const nombre of enProyecto) {
      if (!conocidos.has(nombre)) {
        anotaContenedor('warn', 'unknown-state', aRelativa(root, join(base, nombre)), `«${nombre}» no es un estado conocido: se ha quedado fuera de la auditoría`, 'Comprueba si el almacén estrena un estado que el auditor debe conocer');
      }
    }
  }

  // ── 2. La biblioteca global (lo que se sirve fuera de todo proyecto) ────────────────────────────
  for (const estado of ESTADOS_GLOBALES) {
    if (!quiere(estado)) continue;
    const dir = estado === 'global' ? curated : join(curated, estado.replace(/^global-/, ''));
    const { nombres, error } = subcarpetas(dir);
    if (error) {
      anotaContenedor('error', 'state-unreadable', `global/${estado.replace(/^global-/, '')}`, `no se pudo leer la biblioteca global («${estado}»): ${error}`, 'Revisa los permisos de esa carpeta');
      continue;
    }
    for (const id of nombres) {
      const destino = join(dir, id);
      // La biblioteca es compartida: las skills que no son nuestras se dicen y no se auditan, porque su
      // puerta no es la nuestra.
      let nuestra = true;
      try {
        nuestra = isOurs(destino);
      } catch { nuestra = false; }
      if (!nuestra) {
        contenedores.push({ severity: 'info', rule: 'not-ours', observado: aRelativa(curated, destino), message: `«${estado}/${id}» no es de este plugin: queda fuera de la auditoría (su puerta no es la nuestra)`, fix: 'Nada: es de otro sistema' });
        continue;
      }
      fichas.push(ficha(destino, { root: curated, estado, projectKey: 'global', id, cwd }));
    }
  }

  // ── 3. El informe ───────────────────────────────────────────────────────────────────────────────
  fichas.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // el orden lo pone la clave, no el disco

  const cuenta = (lista) => ({
    total: lista.length,
    pass: lista.filter((s) => s.status === 'PASS').length,
    warn: lista.filter((s) => s.status === 'WARN').length,
    error: lista.filter((s) => s.status === 'ERROR').length,
    unreadable: lista.filter((s) => s.status === 'UNREADABLE').length,
  });

  const byState = {};
  for (const estado of [...new Set(fichas.map((s) => s.estado))].sort()) {
    byState[estado] = cuenta(fichas.filter((s) => s.estado === estado));
  }

  // Por regla: qué está fallando y en qué skills, que es lo que convierte el informe en una lista de
  // trabajo. Se ordena por severidad y luego por cuántas toca: primero lo que más arregla.
  const porRegla = new Map();
  for (const skill of fichas) {
    for (const finding of skill.findings) {
      const clave = `${finding.severity}|${finding.rule}`;
      if (!porRegla.has(clave)) porRegla.set(clave, { rule: finding.rule, severity: finding.severity, count: 0, fix: finding.fix, skills: [] });
      const entrada = porRegla.get(clave);
      entrada.count += 1;
      entrada.skills.push(skill.key);
    }
  }
  const byRule = [...porRegla.values()]
    .map((e) => ({ ...e, skills: e.skills.sort() }))
    .sort((a, b) => {
      const orden = { error: 0, warn: 1, info: 2 };
      return (orden[a.severity] - orden[b.severity]) || (b.count - a.count) || (a.rule < b.rule ? -1 : 1);
    });

  const totals = cuenta(fichas);
  return {
    almacen: { root, curated, proyectos: claves.length },
    totals,
    byState,
    byRule,
    contenedores,
    skills: fichas,
  };
}

/** El informe en líneas, para leerlo de un vistazo sin abrir el JSON. */
export function resumenDeAuditoria(informe) {
  const lineas = [
    `skills auditadas: ${informe.totals.total} · PASS ${informe.totals.pass} · WARN ${informe.totals.warn} · ERROR ${informe.totals.error} · ilegibles ${informe.totals.unreadable}`,
  ];
  for (const [estado, c] of Object.entries(informe.byState)) {
    lineas.push(`  ${(NOMBRE_DE_ESTADO[estado] ?? estado).padEnd(15)} ${String(c.total).padStart(3)}   PASS ${c.pass} · WARN ${c.warn} · ERROR ${c.error}${c.unreadable ? ` · ilegibles ${c.unreadable}` : ''}`);
  }
  if (informe.contenedores.length > 0) lineas.push(`  contenedores: ${informe.contenedores.length} hallazgo(s)`);
  return lineas.join('\n');
}
