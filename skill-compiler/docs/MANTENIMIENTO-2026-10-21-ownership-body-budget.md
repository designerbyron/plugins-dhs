# Mantenimiento — ownership y presupuesto del cuerpo (2026-10-21)

Mandato: `PROMPT_MANTENIMIENTO_AUTONOMO_SKILL_COMPILER_OWNERSHIP_BODY_BUDGET.md`. Ejecución autónoma, sin push ni
commit (el propio mandato lo prohíbe y el repositorio exige autorización explícita para commitear).

## 1 · Arranque y respaldo

| Dato | Valor |
|---|---|
| Raíz | `<donde-clonaste-el-repo>` (paquete en `skill-compiler/`) |
| Rama · HEAD inicial | `main` · `2492481` · árbol limpio |
| Versión inicial | `3.8.6` |
| Almacén | `%USERPROFILE%\.dsh\skill-compiler` (proyectos + `ownership.json` + diarios) |
| Biblioteca curada | `%USERPROFILE%\.dsh\skills` |
| Respaldo | `<disco-de-respaldo>\BACKUP-skill-compiler-body-budget-2026-10-21\` |
| Contenido del respaldo | **341 ficheros · 12,7 MB** (190 del almacén, 151 de la curada) + `MANIFIESTO.json` con SHA-256 por fichero |
| Verificación del respaldo | SHA-256 recomputado y comparado: **OK, 0 discrepancias** |

## 2 · Propiedad del puesto

| | Antes | Después |
|---|---|---|
| `ownership.json` | **AUSENTE** | `{"ownership":"machine","declaredAt":"2026-10-21T18:52:03.596Z","declaredBy":"humano"}` (huella `752f9a7ddd4f`) |
| `ownership` | «Nadie ha declarado quién manda» | «Propiedad del proceso de creación de skills: «machine»» |
| `doctor` | `propiedad del puesto: AUSENTE` | `ok propiedad del puesto: «machine» — barrido completo (64 identificadores, 0 choque(s))` |

Motivo: en el puesto existen **cuatro** sistemas de skills (skill-compiler, biblioteca curada de DSH, Hermes por
defecto, Hermes `byron-saas-corporative`); `machine` describe la máquina y no relaja ninguna garantía — no se
escribe ni se sobrescribe nada ajeno. Reversible con `ownership dsh-only|machine`.

## 3 · Los 17 avisos `body-budget` — cerrados

Medición final con el auditor (que mide el cuerpo **sin** el título de nivel 1, como lo mide la puerta):

| Skill | Estado / ámbito | Cuerpo final | Refs |
|---|---|---:|---:|
| hostinger-tenant-release | approved / local | 5.944 | 9 |
| saas-corporative-context-discipline | approved / local | 6.112 | 9 |
| brandkit | approved / local | 7.674 | 30 |
| image-to-code | approved / local | 7.137 | 35 |
| imagegen-frontend-web | approved / local | 7.499 | 22 |
| design-taste-frontend | approved / local | 7.718 | 29 |
| nuxt-storefront-frontend | approved / local | 7.223 | 18 |
| redesign-existing-projects | approved / local | 5.740 | 1 |
| **saas-corporative-gate-workflow** | **disabled** | **5.779** | 12 |
| tenant-onboarding-provision | approved / local | 5.540 | 7 |
| tenant-maintenance-update | approved / local | 5.161 | 4 |
| high-end-visual-design | approved / local | 6.302 | 3 |
| impeccable | approved / local | 6.188 | 1 |
| **dsh-local-mcp-integration** | **global** | **4.492** | 2 |
| industrial-brutalist-ui | approved / local | 5.876 | 3 |
| gpt-taste | approved / local | 5.713 | 4 |
| minimalist-ui | approved / local | 6.097 | 3 |

**Los 17 por debajo de 8.000, `audit` en WARN 0.** Los dos casos especiales conservan su estado: la apagada se
corrigió con `--preserve-state` (sigue en `disabled/`), y la global se corrigió desde la copia publicada y se
republicó en el mismo sitio (`approve --global`), con la anterior archivada en nuestro almacén.

## 4 · Tratamiento estructural de `brandkit` e `image-to-code`

La reparación mecánica se **bloqueaba** (`body-sin-corte-posible`) porque el peso no estaba donde el motor mira:

| Skill | Diagnóstico | Corrección estructural | Resultado |
|---|---|---|---|
| `brandkit` | 20.493 B con **22 encabezados `#` de primer nivel** (8.417 B, el 41 %) que el reparador no ve —sólo parte por `##`— | Se bajan a `##` los encabezados de sección (salvo el título). Mismo texto, un nivel más de marca | cuerpo tratable → reparación nivel 2 → 7.961 |
| `image-to-code` | 19.956 B con un preámbulo de **4.064 B** de prosa antes de la primera sección | El preámbulo viaja **íntegro** a `references/introduccion-y-alcance.md`; el cuerpo deja el enlace | 16.694 → reparación nivel 2 → 7.447 |

No se rebajó el umbral, no se suprimió el aviso y no se eliminó procedimiento: se corrigió la **estructura** para
que el material pesado fuera movible. Cero líneas sustantivas ausentes (78 y 111 líneas comprobadas).

## 5 · Skills divididas

Ninguna. No hubo dos flujos independientes que exigieran separar ids; la consolidación estructural bastó.

## 6 · Pruebas

| Comprobación | Resultado |
|---|---|
| Suite del paquete | **603/603** (incluye 5 pruebas de CLI real por subproceso) |
| Hermética («no tocó nada fuera de su caja de arena») | verde |
| `audit --json` | 48 skills · **PASS 46** · **WARN 2** · **ERROR 0** · 28 archivadas (no auditadas) |
| `security` | 0 bloqueos · 0 avisos · cadena del diario válida |
| `doctor` | exit 0 · propiedad «machine» · «todo en su sitio» |
| Diario del proyecto | 32 entradas encadenadas: 14 `promovida/motor`, 7 `rechazada-por-regresion/motor`, 11 `aprobada/humano` |

Las 7 `rechazada-por-regresion` son el motor negándose a activar por su propia guarda de tamaño (diff > 200
líneas); esas correcciones se verificaron a mano (contenido, referencias) y se activaron por la vía humana
explícita (`approve --local`), que exige la misma puerta verde.

## 7 · Cambio de código: el cuerpo es también el índice del material

**Defecto 1 (medido en el mantenimiento)**: `moverMaterialPesado` mueve secciones enteras y un enlace que vivía
dentro de una sección movida **viaja con ella**; el cuerpo dejaba de listar referencias que existen
(`design-taste-frontend`: 11 → 1 enlaces; `imagegen-frontend-web`: 6 → 5).

**Defecto 2 (hallado en la revisión)**: la primera versión del índice se retiraba con una expresión que borraba
**desde cualquier `## Material consultable` hasta el final del cuerpo**. El título lo puede usar el autor para su
propio contenido: era una vía para borrar prosa legítima.

Corrección final, en `lib/repair.mjs`:

- **Marcadores propios y estables**: `<!-- skill-compiler:indice:inicio -->` / `…:fin`. El de inicio va **dentro**
  del bloque, en la línea siguiente al encabezado —si fuera antes del `##`, el texto de la sección anterior lo
  incluiría (`seccionesDe` corta en el `##`) y al moverla se llevaría el marcador: se midió y quedaba `fin`
  colgando—.
- **Nunca se borra por título**: sólo se reemplaza un bloque con los dos marcadores, con el inicio exactamente
  tras `## Material consultable` y con la forma que escribe el motor (lista de `references/….md`). Cualquier otra
  cosa es del autor y se deja como está.
- **Una sección del autor con ese nombre no se mueve ni se duplica**: se queda donde está y el reparador lo
  declara (`avisos: ['seccion-ajena']`, que la CLI imprime).
- **Migración del índice anterior**: se reconoce sólo si es exactamente su huella —última sección del cuerpo,
  frase fija `Además de las enlazadas arriba…` y nada más que rutas—. Con una sola diferencia es del autor: se
  conserva y se declara.
- **Presupuesto real**: el bucle mide `byteLength` del cuerpo **final con marcadores y lista**, no una constante
  por referencia; con nombres largos la constante se quedaba corta y el cuerpo salía del umbral en silencio.

Pruebas nuevas (`tests/repair.test.mjs`, todas en arena, sin tocar el almacén de la máquina): sección autoral
`Material consultable` con secciones detrás intacta; bloque refrescado en dos pasadas (uno solo, misma lista,
mismo tamaño); referencias previas byte a byte; cada sección movida íntegra frente al cuerpo original; nombres de
125+ caracteres que no dejan pasar un cuerpo por encima del presupuesto; colisiones de título con rutas distintas
y dentro de `references/`; y los dos casos de migración (huella exacta → se sustituye; con texto añadido → se
conserva y se declara).

**Por qué no puede borrar una sección autoral por coincidencia de título**: el borrado dejó de buscar títulos.
Sólo actúa sobre un rango delimitado por dos marcadores que escribe este motor, y además exige que entre ellos
esté exactamente la forma generada. Un `## Material consultable` sin marcadores nunca entra en `quitarIndice`; y
si el autor escribe esos mismos marcadores con otro contenido, `CUERPO_BLOQUE` no casa y el bloque se deja
intacto. La única vía de reconocimiento sin marcadores es la huella exacta del generador anterior, y su fallo
—cualquier línea extra— la desactiva.

Cambios **sin commitear** (mandato §10): 7 ficheros modificados + 1 nuevo, **+312/−45**.

## 8 · Integridad de los sistemas ajenos

| Sistema | Antes | Después | Veredicto |
|---|---|---|---|
| Hermes · perfil por defecto | 495 ficheros · `334afae555f3dab3` | igual | **sin cambios** |
| Hermes · perfil `byron-saas-corporative` | 446 ficheros · `6061815acef2e4c0` | igual | **sin cambios** |
| Claude Code · Codex · Cursor | inexistentes | inexistentes | **sin cambios** |

`saas-corporative-gate-workflow` sigue **apagada** (el `repair` no la tocó: su propuesta vive en `proposed/`).

## 9 · Pendientes y límites

1. **Sin pendientes de presupuesto**: los 17 cerrados, ninguno por encima del umbral.
2. **Índices heredados migrados** en `design-taste-frontend` e `imagegen-frontend-web` al formato delimitado,
   verificando antes la procedencia (última sección, frase fija y sólo rutas existentes). Sin procedencia
   inequívoca el motor devuelve ambigüedad y **no toca** el bloque.
3. La propuesta `shell-and-source-editing-traps` (ajena a este mandato) sigue pendiente, intacta.
4. `--preserve-state` no cambia el ámbito global: una global se corrige por la vía `--global`, no por este flag.

## 10 · Veredicto

**PASS.** Propiedad `machine` declarada y verificada; **los 17 avisos cerrados** con conservación comprobada
contra el respaldo; la skill apagada reparada **sin encenderla**; la global reparada **sin moverla de ámbito**;
índices heredados migrados con procedencia y política de ambigüedad; `audit` 47 · PASS 47 · WARN 0 · ERROR 0;
`security` y `doctor` en verde; suite 603/603 y hermética verde. Sin pérdida de conocimiento y sin tocar almacenes
ajenos.
