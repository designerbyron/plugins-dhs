# Auditoría de cruces entre repositorios — 2026-10-13

Motivo del informe: en una sesión **nueva** abierta en el root de `plugins-dhs`, al escribir «hola» el agente
propuso acciones que mezclaban cosas del proyecto `saas-corporative` (entre ellas ir a leer el procedimiento
`prompt-doctor` a **otro** repositorio). Se pidió auditar y cerrar la situación de raíz, no el síntoma.

Principio que debe cumplirse (enunciado del propio autor del plugin): **cada proyecto tiene sus skills,
referenciadas a su origen de creación, y viven fuera del repositorio para no ensuciar el proyecto.**

## Qué se auditó

Todas las piezas donde un cruce puede ocurrir: el store del plugin, la biblioteca global de skills, el
`AGENTS.md` global del harness, el perfil del harness que arranca la aplicación, las herramientas globales
del home (`~/.dsh/`), los dos repositorios y la configuración de gobernanza de cada uno.

## Hallazgos, con la evidencia

| # | Pieza | Veredicto | Evidencia |
|---|---|---|---|
| 1 | `~/.dsh/skill-compiler/projects/` (store del plugin) | ✅ **correcto** | Una sola clave de proyecto, `saas-corporative-a3c393fa`, con 12 skills aprobadas. El ámbito sale del `cwd`: ninguna skill suya aparece en el catálogo de otro proyecto |
| 2 | `~/.dsh/AGENTS.md` (global, entra en todas las sesiones) | ✅ correcto | Se declara explícitamente como notas de máquina, «every DSH workspace… project-agnostic». **No nombra ningún proyecto** |
| 3 | Perfil del harness (`profiles/desktop/`) | ✅ limpio | `dsh.profile.bundles`: `dsh-base`, `dsh-web-app`, `@local/skill-compiler` → `link:<ruta-del-repo>/skill-compiler` (el enlace que crea el gestor al instalar por ruta). Nada instalado desde ningún proyecto |
| 4 | `~/.dsh/prompt-doctor/` (herramienta global del home) | ✅ legítima | Es el hook que inyecta el panel de gobernanza; audita **el workspace actual**, por eso en `plugins-dhs` decía la verdad («faltan pilares») |
| 5 | `plugins-dhs` (este repositorio) | ❌ **hueco real** | Sin `AGENTS.md`, sin `docs/`, sin `MEMORY.md`: el panel lo reportaba con razón. Y su `README.md` publicaba **v1.4.0 · 217 pruebas** cuando el paquete iba por 1.5.0 |
| 6 | `~/.dsh/skills/` (**biblioteca global**: la lee cualquier workspace) | ❌ **el cruce principal** | 5 skills de un proyecto concreto viven en la biblioteca compartida: `saas-corporative-gate-workflow` («Run **saas-corporative** gates»), `hostinger-tenant-release` («Ship a **saas-corporative** release…»), `tenant-onboarding-provision`, `tenant-maintenance-update`, `nuxt-storefront-frontend` («**saas-corporative** customer storefront») |
| 7 | `~/.dsh/prompt-doctor/README.md` (global) | ❌ **propagaba el cruce** | En «Design notes» documentaba la ruta `saas-corporative/.dsh/skills/prompt-doctor`. El log de la sesión del «hola» muestra la cadena: el agente leyó ese README (seq 41-49) y acto seguido fue a buscar el procedimiento a la ruta del **otro** repositorio (seq 55) |
| 8 | `saas-corporative/.dsh/` | ✅ correcto y **versionado** con el proyecto que gobierna | `prompt-doctor.yaml` + `skills/prompt-doctor/`. Su config declara sus pilares propios (incluida su «engineering bible»), distintos de los de `plugins-dhs` |

**Conclusión de la auditoría**: el mecanismo de ámbito de `skill-compiler` **no** es el que se cruzó —el
store está bien y el `cwd` decide correctamente—. El cruce tenía dos fuentes, ambas **fuera** del plugin:

1. **Cinco skills de proyecto en la biblioteca compartida** (`~/.dsh/skills`), que por diseño se sirve a
   todos los workspaces. Cualquier repo las ve; no es que se crucen entre repos, es que están en una capa
   que no les corresponde.
2. **Una nota histórica de una herramienta global** que citaba la ruta de un proyecto concreto, lo que
   llevaba al agente a salir de su workspace a buscar un procedimiento ajeno.

## Resolución aplicada en esta ronda

| # | Acción | Verificación |
|---|---|---|
| 5a | `README.md` de la portada puesto al día (v1.5.0 · 228 pruebas) | El dato coincide con `package.json` y `CHANGELOG.md` |
| 5b | **Gobernanza del repositorio creada** con el diseño real de esta colección: `AGENTS.md`, `docs/01-governing-rules.md`, `docs/02-master-vision.md`, `docs/03-architecture.md`, `docs/05-golden-rules.md`, `docs/design-system.md`, `docs/README.md`, `MEMORY.md` y `.dsh/prompt-doctor.yaml` (config **de este** workspace) | `hook.mjs selftest` → **7/7 pilares ✅**, «Gobernanza completa: no hay huecos que crear» |
| 7 | Nota del README global reescrita **sin la ruta del proyecto**: el procedimiento interactivo vive en el `.dsh/skills/prompt-doctor` **del propio workspace**, si lo trae, y **no es global** | Un agente que lea ese README ya no aprende la ruta de otro repositorio |
| — | Defecto colateral encontrado al verificar: el panel imprimía `[object Object]` porque el parser YAML del hook (subconjunto: `clave: valor`) leía un ítem del protocolo con dos puntos internos como si fuera un mapa | Reformulado con raya; verificado en la salida del panel |

## Ejecutado el mismo día (con OK explícito): las cinco skills, a su ámbito

Autorizado por el autor del plugin («sí, muévelas al ámbito del proyecto saas-corporative, con respaldo y
verificación antes de retirar nada»), se ejecutó el procedimiento en dos fases, cada una con su medición:

| Paso | Qué se hizo | Verificación |
|---|---|---|
| A1 | Huella SHA-256 de cada una de las 5 carpetas (fichero a fichero) | — |
| A2 | Copia al ámbito del proyecto: `~/.dsh/skill-compiler/projects/saas-corporative-a3c393fa/approved/<id>/`, con su `meta.json` compuesto a partir del frontmatter | Huella de la copia **idéntica** al original en las cinco |
| A3 | Catálogo del proyecto dueño, leído con el **mismo `skillProvider`** que usa el harness | **17 skills** (12 + las 5): las cinco, presentes |
| B1 | Apartadas de la biblioteca global a `~/.dsh/backups/skills-retiradas-2026-10-13/` (**renombradas, nunca borradas**), sólo tras comprobar que la copia era idéntica | Huella idéntica al store en las cinco; `approved/` nunca se tocó |
| B2 | Biblioteca global | **20 skills** visibles (+`.system`); 20 + 5 apartadas = las 25 de antes: **no falta ninguna otra** |
| B3 | El plugin, ya con las skills en su ámbito | `doctor`: «todo en su sitio, el plugin puede activarse»; 228 pruebas en verde |

### Corrección del diagnóstico, medida al ejecutar

La capa que propagaba el cruce **no** era el provider del plugin: al leer el catálogo con `skillProvider`,
el proyecto `plugins-dhs` devolvía **0 skills** —el provider sirve exclusivamente las aprobadas del proyecto
actual—. Las cinco llegaban al agente por la **biblioteca global del harness** (`~/.dsh/skills`), que se
carga en toda sesión, con plugin o sin él. Es decir: el mecanismo del plugin nunca estuvo cruzado, y la
limpieza correcta era exactamente la que se hizo: vaciar de la capa global lo que es de un proyecto, y
dejarlo en el ámbito que el plugin sirve sólo a su dueño.

### Efecto sobre el trabajo pendiente

Las tres skills de tenants que esperaban adiciones (`hostinger-tenant-release`,
`tenant-onboarding-provision`, `tenant-maintenance-update`) **ya no están en la biblioteca compartida**:
viven en `approved/` del proyecto `saas-corporative`. Las adiciones, cuando se apliquen, van ahí — ámbito
del proyecto, fuera del repositorio, y sin tocar la capa que ven todos los proyectos.

## Lo que no se hizo: mover `prompt-doctor`

Decisión del autor: la skill interactiva `prompt-doctor` **se queda por proyecto** (hoy, en el repositorio de
`saas-corporative`). No se copia a la biblioteca global.

## Procedimiento que se siguió (queda escrito para reutilizarlo)

Por si hay que mover más conocimiento entre capas, éste fue el orden, y el porqué:

1. **Respaldo** de las cinco carpetas con su hash.
2. **Copia** a `~/.dsh/skill-compiler/projects/saas-corporative-a3c393fa/approved/<id>/` — el sitio que el
   plugin ya usa y que se sirve **sólo** al proyecto dueño, fuera del repositorio (mecanismo ya verificado:
   una skill de `approved/` apareció en el catálogo del proyecto, sin reiniciar).
3. **Comprobar** que el catálogo de `saas-corporative` las sigue viendo y que el de `plugins-dhs` ya no las
   ve.
4. **Retirar** las de la biblioteca global (no borrar en el primer paso: se apartan, y se borran cuando el
   paso 3 está verificado).
5. Dejar en la biblioteca global **sólo** lo que aplica a cualquier proyecto (`data-backup-and-restore`,
   `live-host-release`, `windows-git-bash-commands`, las de sesiones y hashes, `deepseek-*`, …).

La verificación se hace **con el provider del plugin**, no reimplementando el descubrimiento: es la misma
implementación que le sirve el catálogo al agente.
