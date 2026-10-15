# Diagnóstico de las skills que no pasan la auditoría

**Medido el 2026-10-15** con `node bin/skill-compiler.mjs audit` sobre el almacén real, sin modificar nada:
la huella del almacén es la misma antes y después de todo el diagnóstico.

Estado de partida: **26 skills auditadas · PASS 8 · WARN 7 · ERROR 11 · ilegibles 0**
(20 aprobadas, 1 apagada, 4 propuestas, 1 global). Las 4 propuestas y la global no dan error.

**Este documento diagnostica. No repara.** Ninguna skill del almacén se ha tocado: lo que sigue es qué
incumple cada una, por qué, y quién tendría que firmar cada arreglo.

---

## La causa raíz, en una frase

De los 11 errores, **seis son el mismo**: el contrato creció y esas skills son anteriores a él. `whenToUse`
—el campo con el que el harness decide cuándo aparece una skill— pasó a ser **obligatorio** en la versión que
se está preparando, y las que se aprendieron antes no lo tienen. No están «mal escritas»: les falta un campo
que antes no existía. Escribirlo es **criterio** (decide el comportamiento de la skill ante el modelo), no
formato, y por eso el motor no lo redacta: lo propone una persona.

El segundo grupo es de **presupuesto**: cinco skills tienen el cuerpo por encima del techo de 24.000
caracteres, que se paga entero en cada invocación. Ese sí lo sabe arreglar el motor: mover el material de
consulta a `references/` sin recortar una línea.

## Las 11, una a una

| Skill (estado) | Reglas incumplidas | Observado → umbral | Reparación |
|---|---|---|---|
| `design-taste-frontend` (aprobada) | `body-max` | 95.436 → 24.000 | **nivel 2**, automática: mueve las secciones de consulta |
| `image-to-code` (aprobada) | `body-max` | 37.546 → 24.000 | **nivel 2**, automática |
| `imagegen-frontend-web` (aprobada) | `body-max` | 37.717 → 24.000 | **nivel 2**, automática |
| `nuxt-storefront-frontend` (aprobada) | `description-min`, `whenToUse-min`, `body-max` | 48 → 60 · 0 → 20 · 50.737 → 24.000 | **nivel 3** (la descripción y el disparador son criterio); el cuerpo lo movería el motor |
| `tenant-maintenance-update` (aprobada) | `description-max`, `whenToUse-min` | 320 → 300 · 0 → 20 | **nivel 3** |
| `tenant-onboarding-provision` (aprobada) | `whenToUse-min` | 0 → 20 | **nivel 3** |
| `impeccable` (aprobada, otro proyecto) | `whenToUse-min` | 0 → 20 | **nivel 3** |
| `hostinger-tenant-release` (aprobada) | `whenToUse-min`, `personal-path` | 0 → 20 · ruta de perfil de Windows | **nivel 3** (el disparador, y una ruta personal que ata la skill a un puesto) |
| `saas-corporative-gate-workflow` (apagada) | `description-min`, `whenToUse-min`, `body-max` | 50 → 60 · 0 → 20 · 25.872 → 24.000 | **nivel 3** |
| `generated-images-to-project-assets` (aprobada) | `link-missing` | `references/atomic-chat-local-provider.md` no existe | **no reparable** |
| `saas-corporative-context-discipline` (aprobada) | `link-missing` ×2 | `references/delivery-artifact-chain.md` y `references/customer-storefront-local-validation.md` no existen | **no reparable** |

Recuento por regla: `whenToUse-min` ×6 · `body-max` ×5 · `link-missing` ×3 (en 2 skills) ·
`description-min` ×2 · `description-max` ×1 · `personal-path` ×1.

## Los dos vínculos rotos, con lo que hay de verdad

Aquí no se inventa nada: **un vínculo roto significa que la skill promete material que no está**, y el motor
no puede reconstruir lo que nadie escribió. Lo que se ha medido, fichero a fichero:

- **`generated-images-to-project-assets`** (duranspainting): el cuerpo declara
  `references/atomic-chat-local-provider.md`, y **la skill no tiene ni carpeta `references/`**. Es decir: el
  material nunca llegó a viajar con la skill, o viajó en una versión anterior. La salida correcta es
  **aportar el fichero** (existe en el proyecto donde se escribió: búscalo ahí) **o corregir la ruta del
  cuerpo** si el nombre cambió. Nadie puede decidir cuál de las dos sin ver el original.
- **`saas-corporative-context-discipline`** (saas-corporative): declara
  `references/delivery-artifact-chain.md` y `references/customer-storefront-local-validation.md`, y en su
  carpeta **sí hay** `references/local-image-generation.md`. Dos hipótesis, y hace falta una persona para
  elegir: o el material se **renombró** (entonces el arreglo es la ruta) o el cuerpo arrastra vínculos de una
  versión anterior y el material de esas dos cadenas **se perdió**. Consumir esa skill hoy significa que el
  modelo leerá un enlace que no lleva a ninguna parte, y eso es peor que no enlazarlo.

En los dos casos, la reparación —aportar el material o corregir la ruta— pasa por **propuesta con revisión y
aprobación humana**: no es un cambio mecánico.

## Qué haría el motor, si se le pide

Comprobado con copias reales en una caja de arena (el almacén original no se ha tocado):

- `saas-corporative-gate-workflow` → **bloqueada**. El motor sí prepararía la forma canónica (nivel 1) y el
  traslado del material pesado (nivel 2), pero **no crea la propuesta**: la skill incumple `description-min` y
  `whenToUse-min`, que son nivel 3, y una propuesta que la puerta rechazaría no se fabrica. Primero se
  redactan esos dos campos (revisión humana) y después el motor hace el resto.
- `generated-images-to-project-assets` → **bloqueada**, con el motivo escrito: «el fichero que el cuerpo
  enlaza no está y nadie lo ha escrito: inventarlo sería fabricar conocimiento».

Para las tres de `body-max` y sólo `body-max`, el motor **sí** prepararía la propuesta de nivel 2: mueve la
sección más larga **entera** (con su encabezado) a `references/`, deja el vínculo en su sitio, y comprueba que
no se pierde nada del inventario del conocimiento (comandos, cifras, rutas y encabezados siguen ahí). Antes de
activarla, el motor comprueba la base, el alcance, el tamaño del diff, la reversibilidad y los ciclos, y deja
la versión anterior apartada con su huella. **No se ha preparado ninguna**: eso es una decisión del operador,
y cada una llena su bandeja de revisión.

## Por qué no se ha reparado nada

- Reparar en masa 11 skills porque no pasan la puerta sería confundir **conformidad estructural con
  comportamiento correcto**: que una skill cumpla el formato no demuestra que haga bien su trabajo, y
  reescribir descripciones y disparadores de skills que hoy se están usando cambia **cuándo aparecen y qué se
  elige**. Eso no lo decide un script.
- Las dos con vínculos rotos necesitan el material original, y el material original no lo tiene el motor.
- Y el almacén es conocimiento aprobado: mientras nadie pida lo contrario, se queda como está.

## Lo que sí se puede hacer, en orden

1. **Las tres de `body-max` a secas** (`design-taste-frontend`, `image-to-code`, `imagegen-frontend-web`):
   `repair <id>` → revisar la propuesta → `promote <id> --nivel 2` (o `approve` a mano). El material se mueve,
   no se recorta.
2. **Las seis de `whenToUse`**: redactar el disparador es de una persona. Con eso hecho, `repair` resuelve lo
   mecánico y el resto.
3. **Las dos de vínculos rotos**: recuperar el material (o corregir la ruta) y volver a proponer con su
   revisión. Hasta entonces, esas dos skills se leen con un enlace muerto dentro.
