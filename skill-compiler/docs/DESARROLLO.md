# Desarrollo

Cómo está organizado, cómo se amplía sin romperlo, y qué reglas hacen que esto siga siendo mantenible.

## Mapa de ficheros

| Fichero | Responsabilidad | ¿Se puede probar sin el harness? |
|---|---|---|
| `lib/compiler.mjs` | El núcleo: identidad de proyecto, validación, anti-solapamiento, composición del `SKILL.md`, escritura atómica, propuesta, aprobación, proveedor | **Sí**, es Node puro |
| `lib/vendor.mjs` | El vendorizado: análisis del enlace, descarga, análisis del contenido ajeno, adaptación, procedencia, comprobación del origen | **Sí**, con `fetch` inyectado |
| `lib/presentation.mjs` | El estado del feedback visual: el contrato del marcador y el plegado de eventos | **Sí**, es Node puro |
| `lib/definitions.mjs` | El protocolo y las definiciones de las cuatro herramientas y del proveedor, como objetos planos | **Sí**, con un `exec` falso |
| `index.js` | El adaptador Cordis: elige los puntos de extensión y registra. **~120 líneas** | No: importa `@deepseek-ai/dsh-tools` |
| `client.js` | La pieza de interfaz del navegador (engranaje, píldora, idioma, estilos) | No: es un artefacto de navegador. Se comprueba su **forma**, no su dibujo |
| `bin/skill-compiler.mjs` | La CLI humana, incluido **aprobar** | Sí, manualmente |
| `tools/ico-to-png.mjs` | Extrae el PNG de un `.ico` para usarlo como icono (el harness no acepta `.ico`) | Sí, manualmente |
| `package.json` · `cordis.patch.yml` | El bundle que instala el gestor de plugins, y la declaración del artefacto de cliente | — |

## La regla que sostiene todo: núcleo puro, adaptador fino

`index.js` es el **único** fichero que no se puede probar antes de instalar, porque solo existe dentro del
harness. Por eso no decide nada: envuelve definiciones con `defineTool`, las registra y registra el
proveedor. Todo lo que decide algo vive en `lib/`, y `lib/` se prueba con `node --test`.

Si alguna vez tienes que elegir entre poner lógica en `index.js` o en `lib/`: **en `lib/`**. Un plugin que
rompe el arranque de todas las sesiones del perfil es el peor fallo posible, y este reparto es lo que lo
hace improbable.

## Cómo ampliarlo

### Añadir una regla de validación

1. En `lib/compiler.mjs`, dentro de `validateInput`, añade el patrón a `SECRET_SHAPES`,
   `PERSONAL_PATH_SHAPES` o `ABSOLUTE_PATH_SHAPES`, o una comprobación propia.
2. Decide si es **error** (rechaza) o **aviso** (viaja con la propuesta). La regla: un aviso para lo que
   el humano puede juzgar con contexto; un error para lo que no debe existir nunca.
3. Añade la prueba en `tests/compiler.test.mjs`. Una regla sin prueba es una regla que se romperá.
4. Si la regla debe bloquear también un origen ajeno, replícala en `lib/vendor.mjs` (`scanUpstream`) —
   son listas distintas a propósito: vender contenido ajeno es más grave que proponer el propio.

### Añadir una herramienta

1. Escribe la definición en `lib/definitions.mjs` como función que devuelve un objeto plano
   (`{ name, description, parameters, output, execute }`). `parameters` usa la forma del harness:
   `required: true` **en la propiedad**, no un array `required`.
2. Prueba su `execute` con un `exec` falso (`tests/helpers.mjs` → `fakeExec`), incluido el caso en que no
   hay `cwd`.
3. Regístrala en `index.js`: `ctx.tools.register(defineTool(tuDefinicion({ root })))`.
4. Si escribe algo, que pase por el mismo pipeline (`propose`), y que **no se active**.
5. Añade el contrato al protocolo solo si el modelo necesita saber cuándo llamarla, y **midiendo el
   coste**: el protocolo se paga entero en cada turno (`tests/definitions.test.mjs` fija el techo).

### Añadir un comando a la CLI

1. `bin/skill-compiler.mjs`: un `case` más, con lectura estricta de flags (los `--` desconocidos fallan).
2. Reutiliza `lib/`: la CLI y el plugin **comparten implementación**, y así las reglas no pueden
   divergir entre lo que el modelo puede proponer y lo que tú puedes aprobar.
3. Documenta el comando en `docs/OPERACION.md` y en la cabecera del propio fichero.

### Añadir o cambiar una pieza de interfaz

1. La lógica va en `lib/` (como `presentation.mjs`), **nunca** en `client.js`: el artefacto de navegador
   no se puede probar antes de instalar, así que solo dibuja lo que ya viene calculado.
2. El estado se pliega de **eventos existentes**. No añadas un tipo de evento propio: el registro de
   sesiones rechaza reabrirse con un evento desconocido sin marca `ignorable`, y esa marca no se puede
   poner al escribir.
3. Si necesitas un dato nuevo del Host, amplía la vista de la proyección en `index.js` y **mantén la
   vista en primitivos** (cadenas y números): el esquema que valida cada lectura es donde menos conviene
   arriesgar.
4. En el cliente: `ctx.locale.register` dentro de `ctx.effect`, estilos como elementos de React (al
   desmontar se van), y **un solo** `role="status"` atómico con la frase completa.
5. Comprueba la forma del artefacto, que es lo que sí se puede comprobar sin navegador: carga por
   `window.__ModuleLoader__`, que el `id` coincide con el paquete, que el slot existe, que respeta
   `prefers-reduced-motion`, que no usa emoji como icono y que no toca `document.body`.
6. **Di que el dibujo no está verificado** hasta que alguien lo mire instalado. Un adorno sin ver no es
   un adorno terminado.

## Pruebas

```sh
npm install           # OBLIGATORIO antes de nada: el plugin declara sus dependencias del harness
npm test              # 124 pruebas
npm run test:hermetic # las mismas + huella del almacén real antes y después
```

- `tests/activation.test.mjs` — **ejecuta la activación de verdad**: importa `index.js` y llama a
  `apply(ctx)` con un contexto doble, y comprueba que no lanza y que registra la sección, las cuatro
  herramientas (con los parámetros que verá el modelo) y el proveedor. Nació de un fallo real: el respaldo
  de la inyección opcional podía lanzar dentro de `apply` y llevarse por delante la activación entera.
  Lo que no cubre: el contexto es un doble, así que valida el camino del plugin, no los servicios reales.
- `tests/compiler.test.mjs` — el núcleo.
- `tests/definitions.test.mjs` — el protocolo y las definiciones ejecutadas con un `exec` falso.
- `tests/harness-contracts.test.mjs` — los contratos con el harness, y la puerta que habría cazado el
  defecto de la primera instalación: **toda importación de paquete tiene que estar declarada como
  dependencia**. Compila además las cuatro herramientas con el compilador **real** (esquemas y parámetros
  que verá el modelo), exige que la familia `dsh-*` comparta una sola versión, y comprueba que el cierre
  declarado esté instalado. Por eso la suite **necesita `npm install`**: sin él, esta puerta no puede
  cargar el compilador, que es justo lo que hace el arranque del plugin.
- `tests/vendor.test.mjs` — vendorizado con un `fetch` **falso inyectado**: sin red y capaz de provocar
  un secreto en el origen, una orden al agente, texto invisible, un 404 o una respuesta gigante.
- `tests/presentation.test.mjs` — el estado del feedback visual: el contrato del marcador congelado contra
  el `render` real de las herramientas, y el plegado de eventos.
- `tests/client-artifact.test.mjs` — la **forma** del artefacto de interfaz, que es lo único comprobable sin
  navegador: identidad igual al paquete, misma clave de proyección que el Host, el texto hereda el color y
  el acento pinta solo la marca, una sola región viva, movimiento reducido, sin emoji y sin tocar el
  documento. Un cambio que rompa cualquiera de esos contratos se pone rojo aquí, no en la interfaz.
- `tests/propose-real.e2e.mjs`, `tests/vendor-real.e2e.mjs` — guiones contra la red real. No los recoge
  `node --test` (necesitan un tercero), se ejecutan a mano.
- `tests/check-hermetic.mjs` — la puerta que mide que la suite no tocó el almacén real.

### Escribir una prueba hermética

```js
import { cleanupSandboxes, fakeExec, goodInput, sandbox } from './helpers.mjs';

after(cleanupSandboxes);          // borra las cajas de arena

const s = sandbox();              // raíz temporal + DSH_HOME redirigido ahí
propose(goodInput(), { root: s.root, curated: s.curated, cwd: 'C:\\un\\proyecto' });
```

Dos garantías que conviene no romper:

1. **`sandbox()` redirige `DSH_HOME`.** Es una guarda estructural: una prueba que olvide pasar `root`
   escribe en la caja de arena, no en el almacén real. Ya ocurrió una vez —dos fixtures entraron en el
   almacén real y ninguna prueba se puso roja—, y por eso existe también `check-hermetic.mjs`, que lo
   **mide** en lugar de confiar.
2. **Toda dependencia externa se inyecta.** `fetchImpl` en vendorizado, `now` donde importe el tiempo,
   `root` y `curated` siempre. Una prueba que dependa de la red o del reloj deja de ser una prueba.

## Versionado y publicación

- La versión vive en `package.json` y su entrada en [`CHANGELOG.md`](../CHANGELOG.md).
- **Tras cambiar el código hay que reinstalar el bundle**: el perfil guarda su propia copia del paquete.
  Si el resultado de la instalación dice `restart-required`, reinicia el harness.
- Criterio de versión: `mayor` cuando cambia el contrato de una herramienta o el formato del almacén;
  `menor` cuando se añade capacidad; `parche` cuando se corrige un defecto.
- Antes de publicar: `npm run test:hermetic` en verde, `CHANGELOG.md` al día, y ningún secreto en el
  árbol (`git diff --check` no comprueba eso: míralo tú).
- **Los recuentos de pruebas que citan los README y esta documentación se actualizan al cerrar la
  versión**: un número desfasado es una afirmación falsa, no un detalle. La entrada histórica del
  CHANGELOG no se toca: allí el número viejo era verdad, y un historial que se reescribe deja de ser un
  historial.

## Deliberadamente fuera de alcance

No son olvidos; son decisiones, y cada una tiene su motivo:

| No se hace | Por qué |
|---|---|
| `git clone` del origen | Ejecuta hooks y trae código. Se descarga markdown por HTTPS y nada más |
| Fusionar automáticamente cuando el origen cambie | Nuestra versión está adaptada a propósito: una fusión automática destruiría la adaptación |
| Aprobar desde una herramienta del modelo | Si el modelo pudiera auto-aprobarse, la revisión humana sería decorativa |
| Interfaz gráfica | La CLI y las herramientas cubren el flujo; una UI añadiría superficie sin resolver nada que hoy duela |
| Consolidar skills solapadas automáticamente | Reescribir prosa sin pruebas y sin humano delante es cómo se pierde conocimiento |

## Estado conocido

- `index.js` no tiene cobertura directa (no se puede importar fuera del harness). Es la razón de que sea
  fino; su verificación es la instalación real y el arranque del perfil.
- Las pruebas no cubren el comportamiento del **harness** (que la sección entre en el prompt, que el
  proveedor se consulte, que la herramienta se presente al modelo). Eso se comprueba instalando y
  observando, y queda declarado en cada entrega.
