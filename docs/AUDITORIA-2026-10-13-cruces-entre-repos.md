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
| 3 | Perfil del harness (`profiles/desktop/`) | ✅ limpio | `dsh.profile.bundles`: `dsh-base`, `dsh-web-app`, `@local/skill-compiler` → `link:C:/xampp/htdocs/plugins-dhs/skill-compiler`. Nada instalado desde ningún proyecto |
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

## Pendiente, y por qué no se hizo aquí

**Mover las 5 skills de proyecto fuera de la biblioteca global** (hallazgo 6). Es un cambio en la biblioteca
**compartida** del home, y por la regla 7 de [`01-governing-rules.md`](01-governing-rules.md) requiere OK
explícito y respaldo previo. Procedimiento propuesto, en este orden:

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

Queda también, como decisión aparte: la skill interactiva `prompt-doctor` vive **sólo** en el repositorio de
`saas-corporative`. En `plugins-dhs` el panel funciona (mitad automática, es el hook global) pero los modos
interactivos (`audit`, `init`, `doctor`, `todo`, `export`) no están disponibles. Si se quieren en toda la
máquina, lo correcto es una decisión explícita: copiarla a `~/.dsh/skills/` (global de verdad, porque
gobierna cualquier proyecto) o dejarla por proyecto.
