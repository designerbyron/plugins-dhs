/**
 * Utilidades compartidas por las pruebas del compilador.
 *
 * Todo se construye sobre raíces TEMPORALES: ninguna prueba lee ni escribe la biblioteca real de la
 * máquina, y ninguna necesita el plugin instalado.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOTS = [];
const ORIGINAL_DSH_HOME = process.env.DSH_HOME;
let savedDshHome = null;

/**
 * Raíz de datos + biblioteca curada efímeras. `curated: false` para no sembrar nada.
 *
 * Además **redirige `DSH_HOME` a la caja de arena**: `defaultRoot()` lo lee en el momento de la
 * llamada, así que una prueba que olvide pasar `root` escribe en la arena y no en el store real. Es
 * una guarda estructural, no una limpieza: la suite entera es hermética aunque una llamada se
 * equivoque, que es exactamente el error que ya se cometió una vez.
 */
export function sandbox({ curated = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'skill-compiler-test-'));
  ROOTS.push(base);
  if (savedDshHome === null) savedDshHome = process.env.DSH_HOME ?? null;
  process.env.DSH_HOME = base;
  const root = join(base, 'skill-compiler');
  const lib = join(base, 'skills');
  mkdirSync(root, { recursive: true });
  mkdirSync(lib, { recursive: true });
  if (curated) {
    mkdirSync(join(lib, 'session-state-recovery'), { recursive: true });
    writeFileSync(join(lib, 'session-state-recovery', 'SKILL.md'), [
      '---', 'name: session-state-recovery',
      'description: "Use when rebuilding state after a lost or closed session."',
      '---', '', '# Session state recovery', '', 'Procedimiento de reconstrucción en solo lectura.',
    ].join('\n'));
  }
  return { base, root, curated: lib };
}

export function cleanupSandboxes() {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
  ROOTS.length = 0;
  if (savedDshHome === null) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = ORIGINAL_DSH_HOME;
  savedDshHome = null;
}

/**
 * Un cuerpo que supera el mínimo, con las dos secciones que la puerta de calidad exige a partir de
 * 1.500 caracteres, y que se lee como procedimiento: es el patrón de una skill bien formada.
 */
export const GOOD_BODY = [
  '## When to Use',
  '',
  'Cuando hay que decidir algo con evidencia y no con impresiones.',
  '',
  '## Procedure',
  '',
  '1. Medir antes de tocar nada y anotar el número.',
  '2. Comparar contra el registro previo y declarar la diferencia.',
  '3. Cerrar solo si las dos medidas coinciden.',
].join('\n');

/** La descripción de prueba, por encima del mínimo de 60 caracteres que exige la puerta. */
export const GOOD_DESCRIPTION = 'Decide with measured evidence instead of impressions, every single time.';

export const goodInput = (over = {}) => ({
  id: 'measured-decision-check',
  description: GOOD_DESCRIPTION,
  whenToUse: 'Cuando una decisión necesite un número medido.',
  body: GOOD_BODY,
  ...over,
});

/**
 * Una revisión válida: lo que la puerta exige cuando el parche toca una skill **viva**. Sin esto, un
 * parche se rechaza — y esa es la regla que la Fase 3 implementa, así que las pruebas de actualización
 * parten de aquí en vez de inventar cuatro campos cada vez.
 *
 * La evidencia va como **texto**, no como ruta, a propósito: así estas pruebas no dependen de que exista
 * un fichero en el proyecto de nadie, y el caso «afirmación no verificada» queda además ejercitado.
 */
export const buenaRevision = (over = {}) => ({
  claim: 'La versión anterior afirmaba que el orden de los pasos no importaba.',
  evidence: 'La salida de la suite en la sesión del 2026-10-15, recogida en el informe del acto',
  measurement: 'Medido con `node --test`: 3 fallos antes, 0 después en la misma máquina.',
  change: 'Ahora el procedimiento declara el orden como parte del contrato.',
  ...over,
});

/** Un parche válido de una skill viva: el mismo id, con su revisión. */
export const patchInput = (over = {}) => goodInput({ revision: buenaRevision(), ...over });

/** Un `exec` falso con la forma que el harness entrega a una herramienta. */
export const fakeExec = (cwd) => ({ agent: { session: { header: { cwd } } } });
