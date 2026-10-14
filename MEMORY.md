# MEMORY — estado vivo de la colección

Memoria durable del repositorio. No es el historial de una sesión: es lo que hay que saber al entrar.
Última actualización: 2026-10-13.

## Versión publicada

**v1.7.1** — **primera versión estable** del plugin `skill-compiler` — `main` sincronizado con `designerbyron/plugins-dhs`.
251 pruebas en verde, suite hermética en verde (huella del almacén real idéntica antes y después), `doctor`
con 14 comprobaciones en verde.

## Qué está verificado (con la evidencia)

| Afirmación | Cómo se comprobó |
|---|---|
| Una skill aprobada se usa **sin reiniciar** el harness | Log real de la sesión: catálogo de 34 skills (seq 6380) → aprobación (seq 8675) → 35 skills, con la nueva (seq 8688) |
| Las pruebas no tocan el almacén real | Suite hermética: huella del store antes y después |
| El ámbito es por proyecto | El store tiene una sola clave de proyecto y no aparece nada suyo en otros catálogos |
| Decidir dos veces la misma cosa no miente | Aprobar algo ya aprobado responde «Ya estaba activa» sin mover nada (repro contra el CLI real) |
| Los bloques de resultado se cierran con X y el cierre sobrevive | `localStorage` (el cliente de escritorio se sirve desde el origen estable `dsh-app://app`). **Verificado en vivo por el autor** el 2026-10-13: cerró un bloque, reinició la aplicación y no volvió a aparecer |

## Pendiente, con su estado

| Tema | Estado |
|---|---|
| Probar en vivo el **panel de decisiones en lote** (casillas + confirmación) en la tarjeta | Implementado en v1.5.0 y **reparado en v1.5.2**: el cliente declaraba `inject: ['slots', 'locale']` y le faltaba `'remote.commands'` (el path que el anfitrión exige, igual que su propio paquete de comandos), así que el panel no podía leer las pendientes y encima decía «no hay nada» — ahora dice el motivo y por dónde seguir. Requiere recargar el plugin para tomar efecto |
| Filas del menú por sesión | Implementado en v1.6.0: se montan bajo el `agent.ctx` de la sesión, con el agente que el provider recibe. **Verificado en vivo por el autor**: ya no aparecen pendientes de otros proyectos |
| **Deshabilitar y eliminar una skill** | **Implementado en v1.7.0** y **probado en vivo por el autor**: apagó una skill y el disco quedó correcto. Su prueba destapó el defecto que la v1.7.1 arregla: `skill-deshabilitar`/`skill-habilitar`/`skill-eliminar` movían la skill **sin avisar al catálogo**, así que el agente seguía viéndola ofrecida. Ahora toda acción que mueve avisa (una sola puerta, con suite que lo exige) y `/skill-propuestas` lista las apagadas con su vuelta |
| La X en el resultado de una fila | Reparado en v1.6.1: el cliente aprende del catálogo los nombres de las filas y registra su tarjeta. La tarjeta **ya pintada** antes de aprender sigue sin X |
| Reducir el ruido del catálogo global | Medido el 2026-10-13: de las 20 skills de `~/.dsh/skills`, al prompt llegan 13. El motivo **no está medido** (candidatos: deduplicación por similitud o presupuesto). La composición por proyecto sí: 0 skills de otros proyectos en los tres casos |
| **Adiciones a tres skills de tenants** (`hostinger-tenant-release`, `tenant-onboarding-provision`, `tenant-maintenance-update`) | Contenido redactado, **sin aplicar**. Las tres viven ahora en `approved/` del proyecto `saas-corporative`, así que las adiciones se aplican **ahí** (ámbito del proyecto), no en la biblioteca compartida |
| **Cruces entre repos** | **Resuelto el 2026-10-13.** El cruce estaba fuera del plugin: cinco skills de proyecto en la biblioteca global y una nota del README de `prompt-doctor` que citaba la ruta de un proyecto. Ambas fuentes cerradas; evidencia en [`docs/AUDITORIA-2026-10-13-cruces-entre-repos.md`](docs/AUDITORIA-2026-10-13-cruces-entre-repos.md) |
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
- El cierre de un bloque **no** se guarda en `sessionStorage`: muere con la ventana.
- Dentro de un *template literal*, un backtick en un comentario CSS rompe el fichero.
