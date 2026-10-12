# Dependencias

Este plugin **necesita paquetes del harness** para funcionar, y durante la primera instalación eso no
estaba resuelto: el plugin los importaba sin declararlos. Este documento explica el fallo, la regla que
lo gobierna y cómo se resuelve, para que no vuelva a pasar ni aquí ni en el siguiente plugin.

## El fallo, contado entero

El plugin importa `@deepseek-ai/dsh-tools` para construir sus herramientas. En la máquina donde se
escribió funcionaba; **al instalarlo en un perfil de DSH falló** con `failed to import`.

La causa es una regla de Node, no un capricho de DSH:

> Un módulo resuelve sus importaciones **desde su propia ruta real**, subiendo por los `node_modules`
> que encuentra.

Y tres hechos que se combinan mal:

1. Los paquetes del harness viven **dentro del archivo de la aplicación** (`app.asar`), no sueltos en
   disco. Los plugins que el harness trae dentro pueden importarlos porque son **hermanos** suyos ahí
   dentro; un plugin externo no lo es.
2. El perfil instaló el plugin como **enlace simbólico** (`link:`) a la carpeta del repositorio, porque
   se instaló por **ruta local**. Con un enlace, Node resuelve desde la carpeta del repositorio, que está
   fuera del perfil.
3. El `node_modules` del perfil **no contiene** los paquetes del harness: el perfil declara el plugin y
   los *bundles* que trae la instalación, nada más.

Resultado: `@deepseek-ai/dsh-tools` no estaba en ninguna parte del camino de búsqueda.

Se comprobó con un experimento mínimo, y fue concluyente:

| Cómo se instala el paquete | ¿Resuelve sus dependencias? |
|---|---|
| **Enlace** a una carpeta fuera del perfil (lo que hizo `pnpm add <ruta>`) | **No** · `ERR_MODULE_NOT_FOUND` |
| **Copia** dentro del perfil, con la dependencia en el perfil | **Sí** |

## La solución: declarar lo que se importa

La regla es la de siempre en Node, y ahora está escrita y comprobada:

> **Todo paquete que el plugin importa está declarado en `dependencies`.**

Se declaran **20 paquetes**, y no tres. El motivo es concreto: `@deepseek-ai/dsh-tools` **importa en su
primera línea** paquetes que declara como *peers* (`cordis`, `dsh-scope`, `dsh-llm`, `dsh-sandbox`…), y no
todos los gestores instalan peers — **el perfil de DSH trae `autoInstallPeers: false`**. Declarar el cierre
completo hace que la instalación funcione con cualquier gestor y cualquier política de peers, en vez de
depender de un ajuste del gestor. Son 22 paquetes y unos 8 MB.

Las tres que el plugin usa **directamente** son:

| Paquete | Para qué | Versión |
|---|---|---|
| `@deepseek-ai/dsh-tools` | `defineTool`: convierte la declaración de una herramienta en el esquema que ve el modelo y en su validador de argumentos | `0.2.0-rc.2` |
| `@deepseek-ai/schemastery` | Los esquemas del estado y de la vista de la proyección que alimenta el feedback visual | `3.18.4` |
| `@deepseek-ai/cordis` | La base del propio `dsh-tools`; sin ella no se puede cargar | `4.0.4` |

Las otras 17 llegan como cierre de esas tres. Todas van **clavadas a la versión exacta del runtime**
(`0.2.0-rc.2` para la familia `dsh-*`), porque mezclar dos versiones del mismo runtime es peor que
quedarse atrás.

### Por qué no se evita la dependencia

Se evaluó, y se descartó con motivo:

- **Registrar la declaración sin `defineTool`.** Se leyó el código del registro: `register(definition)`
  acepta la declaración cruda, así que *funcionaría*. Pero `defineTool` es quien convierte `parameters`
  en el **esquema JSON que ve el modelo** y quien construye el validador de argumentos. Sin él, las
  herramientas aparecerían **sin parámetros**: funcionaría y estaría roto. Descartado.
- **Instalar `dsh-tools` desde npm a secas.** Su manifiesto arrastra diez peers del ecosistema; con
  `autoInstallPeers: false` quedarían sin instalar. Es lo que llevó a declarar el cierre explícito.
- **Copiar los paquetes del harness dentro del repositorio.** Duplicaría código ajeno, se quedaría
  obsoleto en silencio y convertiría el repositorio en un almacén de terceros. Descartado.

## Cómo se instala ahora

### En el repositorio (desarrollo, o instalación por ruta)

```sh
cd C:\xampp\htdocs\plugins-dhs\skill-compiler
npm install      # instala el cierre declarado en node_modules/
node bin/skill-compiler.mjs doctor   # comprueba que todo carga y que las herramientas compilan
```

**Ese `npm install` es obligatorio antes de instalar el bundle por ruta**: el perfil enlaza esta carpeta,
así que el plugin carga sus dependencias **de aquí**.

### Instalado por nombre o desde un tarball

El cierre va declarado, así que el gestor del perfil las instala al añadir el paquete. Si el perfil tuviera
`autoInstallPeers: false` no importa: aquí no hay peers, son dependencias.

## Cuando el harness se actualice

Las versiones están clavadas a `0.2.0-rc.2` (el runtime verificado). Si el harness sube de versión:

```sh
cd C:\xampp\htdocs\plugins-dhs\skill-compiler
npm install @deepseek-ai/dsh-tools@<nueva> @deepseek-ai/schemastery@<nueva> @deepseek-ai/cordis@<nueva>
npm install
npm test                          # incluye las puertas de contrato con el harness
node bin/skill-compiler.mjs doctor
```

y se suben las versiones del resto del cierre a la misma. `tests/harness-contracts.test.mjs` comprueba que
**la familia `dsh-*` comparta una sola versión**, para que un cierre a medio actualizar no pase inadvertido.

## Las dos puertas que lo protegen

- **`tests/harness-contracts.test.mjs`** — comprueba que (1) las cuatro herramientas compilan con el
  compilador **real** del harness, con los parámetros que el modelo debe ver; (2) **toda importación de
  paquete está declarada**; (3) la familia `dsh-*` comparte versión; (4) el cierre está instalado.
  La regla (2) es exactamente la que faltaba: cierra el defecto por construcción.
- **`node bin/skill-compiler.mjs doctor`** — dice qué falta y con qué comando se arregla, sin instalar
  nada a ciegas. Distingue «no está instalado» de «no se puede cargar», que son problemas distintos.

## Lo que queda fuera del alcance, y se dice

- **El artefacto de navegador (`client.js`) no declara dependencias**, y no debe: pide React a la tabla de
  módulos del navegador, no a `node_modules`. Su única declaración es `dsh.client.inject`
  (`@deepseek-ai/dsh-client-ui-conversation`), que es una **dependencia de orden de carga entre paquetes
  de cliente** y la resuelve la aplicación, no este `node_modules`. Eso **no está verificado en vivo**:
  se comprobará al activar el plugin en la interfaz.
- **Las versiones no se actualizan solas.** Un plugin externo no puede leer la versión del runtime que lo
  carga; por eso están clavadas y el procedimiento de subida está escrito arriba.
