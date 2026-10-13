# MEMORY — estado vivo de la colección

Memoria durable del repositorio. No es el historial de una sesión: es lo que hay que saber al entrar.
Última actualización: 2026-10-13.

## Versión publicada

**v1.5.0** del plugin `skill-compiler` — `main` sincronizado con `designerbyron/plugins-dhs`.
228 pruebas en verde, suite hermética en verde, `doctor` con 14 comprobaciones en verde.

## Qué está verificado (con la evidencia)

| Afirmación | Cómo se comprobó |
|---|---|
| Una skill aprobada se usa **sin reiniciar** el harness | Log real de la sesión: catálogo de 34 skills (seq 6380) → aprobación (seq 8675) → 35 skills, con la nueva (seq 8688) |
| Las pruebas no tocan el almacén real | Suite hermética: huella del store antes y después |
| El ámbito es por proyecto | El store tiene una sola clave de proyecto y no aparece nada suyo en otros catálogos |
| Decidir dos veces la misma cosa no miente | Aprobar algo ya aprobado responde «Ya estaba activa» sin mover nada (repro contra el CLI real) |
| Los bloques de resultado se cierran con X y el cierre sobrevive | `localStorage` (el cliente de escritorio se sirve desde el origen estable `dsh-app://app`) — **pendiente de que Byron lo vea en vivo** |

## Pendiente, con su estado

| Tema | Estado |
|---|---|
| Probar en vivo el **panel de decisiones en lote** (casillas + confirmación) en la tarjeta | Implementado en v1.5.0; falta el clic real. Si el anfitrión no expusiera `commands.execute` a un plugin de cliente, la tarjeta lo dirá con el motivo |
| **Adiciones a tres skills de tenants** (`hostinger-tenant-release`, `tenant-onboarding-provision`, `tenant-maintenance-update`) | Contenido redactado, **sin aplicar**. Las tres viven ahora en `approved/` del proyecto `saas-corporative`, así que las adiciones se aplican **ahí** (ámbito del proyecto), no en la biblioteca compartida |
| **Cruces entre repos** | **Resuelto el 2026-10-13.** El cruce estaba fuera del plugin: cinco skills de proyecto en la biblioteca global y una nota del README de `prompt-doctor` que citaba la ruta de un proyecto. Ambas fuentes cerradas; evidencia en [`docs/AUDITORIA-2026-10-13-cruces-entre-repos.md`](docs/AUDITORIA-2026-10-13-cruces-entre-repos.md) |
| Capturas y tarjetas del menú `/` no admiten decoración por fila | Medido y cerrado: no se reintenta |

## Decisiones que no se vuelven a discutir

- **Zod, no schemastery**, para las proyecciones: el registro valida con `schema.parse(...)`.
- **Comprobar el contrato antes de registrar**: `register()` no valida los esquemas que recibe.
- **Aprobar no es una herramienta del modelo**; vive en `bin/` y en los comandos del compositor.
- **Una regla, una implementación**: la puerta se comparte entre CLI, comandos, interfaz y página.
- **El estado se repara, la vista se exige** estricta.
- **Nada se escribe dentro del repositorio del usuario**: lo aprendido vive en `$DSH_HOME` por proyecto.

## Trampas ya medidas

- El log de una sesión son **miles de frames zstd independientes**: hay que descomprimir desde cada cabecera
  mágica; descomprimir el fichero entero sólo lee el primero.
- Un plugin de cliente **no puede** reemplazar la tarjeta de una herramienta: el nodo `tool` no declara hijo
  keyed y su clave ya está ocupada.
- El cierre de un bloque **no** se guarda en `sessionStorage`: muere con la ventana.
- Dentro de un *template literal*, un backtick en un comentario CSS rompe el fichero.
