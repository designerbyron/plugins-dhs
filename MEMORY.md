# MEMORY — estado vivo de la colección

Memoria durable del repositorio. No es el historial de una sesión: es lo que hay que saber al entrar.
Última actualización: 2026-10-16.

## Versión publicada

**v3.0.1** en `main` local (sin publicar): cierra los defectos que aparecieron al reparar el almacén real —
el motor preparaba correcciones que su propia puerta rechazaba (doble vara para el tope: bytes al preparar,
trozos al promocionar), `conservacion` medía el título de nivel 1 como conocimiento, un aviso de nivel 3
arrastraba a nivel humano la corrección de un error de nivel 2, y el montaje de las filas del menú se caía en
silencio dejando la sesión sin superficie de decisión. **v3.0.0** en `main` local: el veto de solapamiento mide
**tema** (no estilo), el **lote** permite que varias propuestas del mismo asunto convivan sin activarse a
medias, y el aviso del turno **cuenta por tipo y se retira**. **v2.0.0** publicada (`8ecd891`): la puerta de
calidad vigente, `audit`, `repair`/`promote` con los tres niveles de riesgo y la promoción automática
**apagada** por defecto.

456 pruebas en verde, suite hermética en verde (huella del almacén real idéntica antes y después), `doctor`
verde.

## Almacén: el objetivo del `DIAGNOSTICO-2026-10-15`, alcanzado

Medido el 2026-10-16 sobre los estados **vivos** (`audit --estado approved,disabled,proposed,published`):
**30 skills · PASS 14 · WARN 16 · ERROR 0**. Al empezar el día eran 32 auditadas con **11 errores**. Las 11 se
cerraron así:

| Skill | Qué incumplía | Cómo se cerró |
|---|---|---|
| `design-taste-frontend`, `image-to-code`, `imagegen-frontend-web` | `body-max` | `repair` + `promote --nivel 2` (secciones enteras a `references/`, versión anterior en `superseded/`) |
| `nuxt-storefront-frontend` | `description-min`, `whenToUse-min`, `body-max` | Texto redactado y aprobado por el autor + `repair`/`promote` |
| `tenant-maintenance-update` | `description-max`, `whenToUse-min` | Ídem |
| `tenant-onboarding-provision`, `impeccable` | `whenToUse-min` | Ídem |
| `hostinger-tenant-release` | `whenToUse-min`, `personal-path` | Ídem, y la ruta personal pasa a `$DSH_HOME\secrets\` |
| `saas-corporative-gate-workflow` (apagada) | `description-min`, `whenToUse-min`, `body-max` | Ídem; la corrección se activó y la skill **se volvió a apagar** (su estado original) |
| `generated-images-to-project-assets` | `link-missing` | La frase aclara que la referencia es de la skill `ai-image-batch-generation`, donde el fichero sí existe |
| `saas-corporative-context-discipline` | `link-missing` ×2 | El aviso deja de citarlos como vínculos propios: el material está perdido y vive en `docs/133`/`docs/276` |

Copia previa de los ocho ficheros editados a mano: `$DSH_HOME/backups/skills-edicion-2026-10-16/`.

Queda **declarado, no escondido**: 16 `body-budget` (aviso, no error: cuerpos entre 8.000 y 24.000) y 1
`absolute-path` (aviso; el patrón casa con el `project:` del propio frontmatter y con escapes de código).

## Qué está verificado (con la evidencia)

| Afirmación | Cómo se comprobó |
|---|---|
| Una skill aprobada se usa **sin reiniciar** el harness | Log real de la sesión: catálogo de 34 skills (seq 6380) → aprobación (seq 8675) → 35 skills, con la nueva (seq 8688) |
| Las pruebas no tocan el almacén real | Suite hermética: huella del store antes y después |
| El ámbito es por proyecto | El store tiene una sola clave de proyecto y no aparece nada suyo en otros catálogos |
| Decidir dos veces la misma cosa no miente | Aprobar algo ya aprobado responde «Ya estaba activa» sin mover nada (repro contra el CLI real) |
| Los bloques de resultado se cierran con X y el cierre sobrevive | `localStorage` (el cliente de escritorio se sirve desde el origen estable `dsh-app://app`). **Verificado en vivo por el autor** el 2026-10-13: cerró un bloque, reinició la aplicación y no volvió a aparecer |
| Una sesión que aprende **varios temas** propone todos | Prueba de fuego con la **biblioteca real como corpus**: tres temas distintos → las tres propuestas (antes la 2ª y la 3ª se vetaban con 0,68). El veto mide tema: pares etiquetados, distintos **0,000** y mismo tema **0,500–1,000** (margen 0,500; era 0,06) |
| Un **lote** no se activa a medias, y la vía humana sigue libre | Probado con dos correcciones de nivel 1 reales: con una hermana sin proponer, la promoción automática **espera**; con el lote completo y verificado, promueve. `approve <id>` no la bloquea |
| La píldora cuenta lo que pasó por **tipo** | Congelado en `tests/aviso-del-turno.test.mjs`: creación + actualización dicen las dos, tres resultados se cuentan por tipo, y creación + rechazo **no** se resume como «no se creó ninguna» |
| **El montaje de las filas no se cae en silencio ni se rinde** | `tests/activation.test.mjs`: un comando humano monta las filas que el provider no montó, y cuando el `inject` del hijo no registra nada el resultado **lo declara** con el motivo y un intento posterior sí monta (el agente ya no queda cacheado a medias) |
| **El motor no prepara correcciones que su puerta rechace** | `tests/repair.test.mjs` + `tests/promote.test.mjs`: el tope se mide en bytes con la misma función en las dos partes; lo que el motor prepara cabe en su tope y deja el cuerpo bajo el umbral; `sin-ciclos` mide progreso; y el H1 de una skill editada a mano no impide promover |
| **El almacén queda sin errores vivos** | `audit --estado approved,disabled,proposed,published` → 30 skills · ERROR 0 (antes 11) |

## Pendiente, con su estado

| Tema | Estado |
|---|---|
| Probar en vivo el **panel de decisiones en lote** (casillas + confirmación) en la tarjeta | Implementado en v1.5.0 y **reparado en v1.5.2**: el cliente declaraba `inject: ['slots', 'locale']` y le faltaba `'remote.commands'` (el path que el anfitrión exige, igual que su propio paquete de comandos), así que el panel no podía leer las pendientes y encima decía «no hay nada» — ahora dice el motivo y por dónde seguir. Requiere recargar el plugin para tomar efecto |
| Filas del menú por sesión | Implementado en v1.6.0: se montan bajo el `agent.ctx` de la sesión, con el agente que el provider recibe. **Verificado en vivo por el autor**: ya no aparecen pendientes de otros proyectos |
| **Deshabilitar y eliminar una skill** | **Implementado en v1.7.0** y **probado en vivo por el autor**: apagó una skill y el disco quedó correcto. Su prueba destapó el defecto que la v1.7.1 arregla: `skill-deshabilitar`/`skill-habilitar`/`skill-eliminar` movían la skill **sin avisar al catálogo**, así que el agente seguía viéndola ofrecida. Ahora toda acción que mueve avisa (una sola puerta, con suite que lo exige) y `/skill-propuestas` lista las apagadas con su vuelta |
| Ver en vivo el **aviso del turno**: la retirada a los 8 s / 30 s, la pausa con el foco, y la frase compuesta con una creación y un rechazo | Implementado y con su contrato probado (los dos tiempos declarados, el foco que pausa, el reloj fuera del plegado). **Falta verlo correr**: en este puesto no hay control de navegador. El autor lo verá al usar el plugin |
| La X en el resultado de una fila | Reparado en v1.6.1: el cliente aprende del catálogo los nombres de las filas y registra su tarjeta. La tarjeta **ya pintada** antes de aprender sigue sin X |
| Reducir el ruido del catálogo global | Medido el 2026-10-13: de las 20 skills de `~/.dsh/skills`, al prompt llegan 13. El motivo **no está medido** (candidatos: deduplicación por similitud o presupuesto). La composición por proyecto sí: 0 skills de otros proyectos en los tres casos |
| **Adiciones a tres skills de tenants** (`hostinger-tenant-release`, `tenant-onboarding-provision`, `tenant-maintenance-update`) | Contenido redactado, **sin aplicar**. Las tres viven ahora en `approved/` del proyecto `saas-corporative`, así que las adiciones se aplican **ahí** (ámbito del proyecto), no en la biblioteca compartida |
| **Cruces entre repos** | **Resuelto el 2026-10-13.** El cruce estaba fuera del plugin: cinco skills de proyecto en la biblioteca global y una nota del README de `prompt-doctor` que citaba la ruta de un proyecto. Ambas fuentes cerradas; evidencia en [`docs/AUDITORIA-2026-10-13-cruces-entre-repos.md`](docs/AUDITORIA-2026-10-13-cruces-entre-repos.md) |
| **16 skills con `body-budget` (aviso)** | Cuerpos entre 8.000 y 24.000 caracteres: aviso, no error — el motor sabe mover ese material a `references/` con `repair` + `promote --nivel 2`. **No se ha hecho**: es una tanda de 16 promociones y el objetivo del diagnóstico eran los errores. Se puede lanzar cuando el autor lo diga |
| **Un H1 que no coincide con la descripción no está en la auditoría** | El motor **compone** el H1 desde la descripción al escribir, así que la divergencia se normaliza en la siguiente corrección y ya no impide promoverla (era el defecto). Lo que no hay es una regla de auditoría que la señale por sí sola: una skill con el H1 cambiado y nada más no aparece en el informe |
| **El `absolute-path` casa con el `project:` del frontmatter** | El patrón `[A-Za-z]:\\…` encuentra la ruta del proyecto que el propio motor escribe en el `meta` de cada skill (y escapes de código, como `\n`). Hoy es un aviso por skill; si molesta, la regla debe excluir el frontmatter y los bloques de código —**medir antes** cuántos avisos eran falsos positivos |
| Capturas y tarjetas del menú `/` no admiten decoración por fila | Medido y cerrado: no se reintenta |

## Pendientes del harness (no del plugin)

| Tema | Estado |
|---|---|
| **`create_goal` choca con un objetivo pausado** | Reportado por el autor el 2026-10-13: el modelo respondió *«El create_goal chocó con el objetivo pausado, pero tu mensaje es la instrucción directa y sigo… tuvo que tomar otra ruta para no detenerse»*. **Auditado el 2026-10-14, y la interfaz queda descartada como defecto**: `Resume goal`/`Edit goal`/`Clear goal` son de la UI **oficial** de objetivos (`@deepseek-ai/dsh-client-ui-goal`, montada por los bundles `dsh-base` + `dsh-web-app`; el `cordis.patch.yml` del usuario no la menciona y la instalación está intacta). Aparecen porque las acciones **dependen de la fase**: el diccionario declara `phase.active` / `active.disarmed` / `paused` / `blocked` y, con el objetivo pausado, salen esas tres (nunca antes vistas porque nunca hubo uno pausado). Lo que sigue abierto es el **comportamiento**, no la interfaz: qué debe hacer el modelo cuando `create_goal` choca con un objetivo pausado — ¿reanudarlo, no dejar crear otro, o parar y preguntar antes de cambiar de ruta? Decisión del autor. Contexto disponible: el host trae `dsh-goal` + `dsh-goal-round-driver` (driver de rondas) y los objetivos viven en `$DSH_HOME/storages/` |

## Decisiones que no se vuelven a discutir

- **Zod, no schemastery**, para las proyecciones: el registro valida con `schema.parse(...)`.
- **Comprobar el contrato antes de registrar**: `register()` no valida los esquemas que recibe.
- **Aprobar no es una herramienta del modelo**; vive en `bin/` y en los comandos del compositor.
- **Una regla, una implementación**: la puerta se comparte entre CLI, comandos, interfaz y página.
- **El estado se repara, la vista se exige** estricta.
- **Nada se escribe dentro del repositorio del usuario**: lo aprendido vive en `$DSH_HOME` por proyecto.

## Cómo se compone el catálogo que ve el agente

Medido el 2026-10-13 leyendo el bloque `<available_skills>` del log de tres sesiones reales —la del plugin, la
de `saas-corporative` y la de `duranspainting`—:

| Origen | `plugins-dhs` | `saas-corporative` | `duranspainting` |
|---|---|---|---|
| Del proyecto (store del plugin, servido por `cwd`) | **0** | 17 | 2 |
| Biblioteca global (`~/.dsh/skills`, lo transversal) | 13 | 13 | 13 |
| Empaquetadas en la app (office-docx/pptx/xlsx, diagnose-windows-sandbox-acl) | 4 | 4 | 4 |
| Del workspace (`.dsh/skills` del repo, p. ej. `prompt-doctor`) | 0 | 1 | 0 |
| **De otro proyecto** | **0** | **0** | **0** |

El ámbito funciona: ningún proyecto ve skills de otro. Lo que se ve de más es lo global, que por diseño entra
en todas las sesiones.

## Trampas ya medidas

- El log de una sesión son **miles de frames zstd independientes**: hay que descomprimir desde cada cabecera
  mágica; descomprimir el fichero entero sólo lee el primero.
- Un plugin de cliente **no puede** reemplazar la tarjeta de una herramienta: el nodo `tool` no declara hijo
  keyed y su clave ya está ocupada.
- El cierre de un bloque se guarda en **`localStorage`**, no en `sessionStorage`: un `sessionStorage` moría con
  la ventana y el bloque volvía a aparecer al reiniciar (era la trampa de la v1.4.0, y está arreglada y
  verificada en vivo por el autor).
- Dentro de un *template literal*, un backtick en un comentario CSS rompe el fichero.
