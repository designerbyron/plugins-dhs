# Changelog

El formato sigue la idea de [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado
es semántico: `mayor` cuando cambia un contrato (herramientas o formato del almacén), `menor` cuando se
añade capacidad, `parche` cuando se corrige un defecto.

## [1.0.0] — 2026-10-12

Primera versión funcional y probada de `skill-compiler`.

### Añadido — aprendizaje progresivo

- Protocolo estático en el prompt vía `ctx.systemPrompt.section()` (orden 9000, `interpolate: false`):
  entra una vez y no rompe el prompt caching.
- Herramienta `skill_propose`: convierte conocimiento propio en una skill **propuesta**.
- Herramienta `skill_review`: lectura de pendientes y aprobadas del proyecto actual. No aprueba nada.
- Proveedor de skills (`ctx.skills.registerProvider`) con rango 150: sirve **solo** las aprobadas del
  proyecto actual, de modo que una skill no se cargue en el lugar equivocado.
- Ámbito derivado del `cwd` de la sesión; el modelo no lo declara.

### Añadido — vendorizado

- Herramienta `skill_vendor`: crea **nuestra versión** de una skill publicada en un repositorio ajeno,
  guardando el original **verbatim** con su SHA-256 y una `provenance.json` auditable.
- Herramienta `skill_upstream_check`: informa de si el origen cambió, sin tocar nuestra versión.
- Resolución de enlaces: `.md` servido por https, `blob`/`tree` de GitHub, raíz de repositorio y API de
  contenidos. Solo `https`; solo markdown (hasta 10 `references/*.md`); techo de 512 KB y timeout de 15 s.
- `needs-choice` cuando el enlace apunta a una carpeta con varias skills: elige el humano, no la
  herramienta.
- Análisis del contenido ajeno con **bloqueo** (no aviso) ante credenciales, órdenes dirigidas al agente,
  tuberías a shell, escalada de privilegios y caracteres invisibles. Un bloqueo no escribe nada.
- Adaptación: frontmatter del contrato DSH, descripción acotada a lo que el modelo puede leer, título
  normalizado, referencias reescritas a `upstream/references/`, avisos de lo omitido y banner que declara
  que la copia local **no es la fuente autoritativa**.

### Añadido — operación y control

- CLI: `where`, `list`, `show`, `check`, `approve`, `reject`, `active`, `vendor`, `upstream`,
  `provenance`. **Aprobar es un acto humano**: no existe como herramienta del modelo.
- Puerta `check` antes de aprobar, y `--force` solo para avisos: nunca para un fallo.
- Idempotencia de la propuesta (reescritura atómica sin restos), supersesión de la versión anterior al
  aprobar una actualización, y rechazo sin borrado.
- Documentación: `docs/FUNCIONAMIENTO.md`, `docs/CONFIANZA.md`, `docs/OPERACION.md`,
  `docs/DESARROLLO.md`.

### Añadido — licencia

- **MIT** (Copyright (c) 2026 designerbyron): uso, modificación, redistribución y uso comercial libres,
  conservando el aviso de copyright. Texto estándar sin añadidos, para que GitHub y las herramientas de
  cumplimiento la reconozcan.
- La referencia al repositorio original queda como **petición destacada** en el README, declarada como
  tal: MIT no la exige, y ponerla en el `LICENSE` la habría sacado del estándar.

### Verificado

- 83 pruebas automáticas, todas en caja de arena, con `fetch` falso inyectado para el vendorizado.
- Puerta de hermetismo: huella del almacén real idéntica antes y después de la suite.
- Cadena completa contra la red real, 15/15: resolver → descargar → adaptar → proponer → aprobar →
  servir, con el original verbatim comprobado y el origen sin cambios.
- Propuesta real contra la biblioteca curada del puesto (25 skills): sin solapamiento.

### Corregido antes de la primera publicación

Ninguno de estos llegó a publicarse; se listan porque el historial de un defecto vale tanto como el
código que lo arregla.

- `bytes` contaba caracteres, no bytes UTF-8: un `’` multibyte hacía que la cuenta no cuadrara con el
  original guardado.
- Un `\b` mal colocado impedía detectar `exfiltrate the .env` en el análisis de contenido ajeno.
- La reescritura de referencias no reconocía las comillas invertidas, así que en la práctica no
  reescribía ninguna ruta de markdown.
- Las carpetas omitidas del origen (como `scripts/`) no se declaraban.
- Los avisos de una propuesta se calculaban y no llegaban al resumen (un aviso que no se lee no es un
  aviso), y la rama de conflicto devolvía la lista de colisiones vacía.
- Dos pruebas escribían en el almacén real por pasar `root: undefined`. Se cerró de raíz: `sandbox()`
  redirige `DSH_HOME` y `check-hermetic.mjs` lo **mide**.
- El mensaje de la CLI que indica cómo aprobar llevaba la ruta del repositorio incrustada, y se quedó
  obsoleta al mover el proyecto. Ahora el CLI **deriva su propia ruta** en tiempo de ejecución: una
  instrucción de aprobación que no funciona es peor que no darla.

### Pendiente

- **Instalación del bundle** en el perfil (no realizada todavía).
- **Primer `git push`**: el remoto está configurado, el envío no se ha ejecutado.
- Consolidación de las skills silenciadas de la biblioteca curada (fuera de este plugin).
