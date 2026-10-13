# Arquitectura

## Forma de un plugin

Todo plugin de esta colección tiene la misma anatomía, y la razón de cada pieza es la misma: **lo que decide
algo tiene que poder probarse sin el harness**.

```
<plugin>/
  index.js          Adaptador Cordis. Elige puntos de extensión y registra. Fino a propósito:
                    es el único fichero que no se puede importar fuera del harness.
  client.js         Pieza de interfaz del navegador. Se carga como artefacto; se prueba su FORMA.
  lib/              Las reglas, en Node puro: aquí está todo lo que decide.
  bin/              CLI humana. Comparte implementación con los comandos del harness.
  tests/            `node --test`, contra raíces temporales.
  docs/             Operación, dependencias, desarrollo, feedback visual, confianza.
  locale/           Textos, si la pieza de interfaz los necesita.
  cordis.patch.yml  Cómo se inserta el plugin en el perfil que lo instala.
  package.json      Identidad, dependencias del harness, bundle y artefacto de cliente.
```

## Cómo se conecta con el harness

`skill-compiler` usa cinco puntos de extensión, y cada uno está elegido por una razón:

| Punto | Para qué | Por qué así |
|---|---|---|
| `ctx.systemPrompt.section` | El protocolo de aprendizaje | Sección **estática**: la guía del harness prohíbe `assemble` para añadir texto, y una sección fija protege el prompt caching |
| `ctx.tools.register` | Las herramientas del modelo (`skill_propose`, `skill_vendor`, `skill_review`, `skill_upstream_check`) | El modelo propone y revisa; **no aprueba** |
| `ctx.skills.registerProvider` | Sirve las skills aprobadas **del proyecto actual** | El `cwd` es el ámbito; el provider conserva la invalidación que el registro le entrega |
| `ctx.sessionProjections.register` | El estado del feedback visual | **Opcional y a prueba de fallos**: si no cumple el contrato, no se registra y el historial sigue abriendo |
| `ctx.inject(['commands'])` | Los comandos humanos | Opcional: en un perfil sin comandos, el plugin no se cae por una superficie |

## Dónde vive el estado

```
$DSH_HOME/skill-compiler/projects/<clave>/{proposed,approved,rejected,superseded}/
$DSH_HOME/skill-compiler/…      ← nada más se escribe fuera del repositorio del plugin
```

- La **clave de proyecto** sale de `projectKey(cwd)`: el nombre de la última carpeta más un hash corto del
  path completo, para que dos proyectos con el mismo nombre en sitios distintos no colisionen.
- La biblioteca **curada** (`$DSH_HOME/skills`) es global por diseño, y sólo debería contener conocimiento
  que aplica a cualquier proyecto. Lo aprendido para un proyecto vive en su carpeta de proyecto.
- Nada de esto entra en el repositorio del usuario.

## El camino de una decisión

```
modelo propone (skill_propose)  →  proposed/           ← el humano decide
   ├── CLI:        bin/skill-compiler.mjs approve
   ├── comandos:   /skill-aprobar <id>  y las filas del menú `/`
   ├── interfaz:   la tarjeta del resultado (casillas + lote, con confirmación)
   └── página:     bin/skill-compiler.mjs review  (servidor local con token de un solo uso)
        ↓  todas pasan por la MISMA puerta: checkProposal()
   approved/  →  el provider avisa al registro → el agente la ve sin reiniciar
```

Aprobar una **actualización** no destruye la versión vigente: la aparta en `superseded/` con su fecha.

## Límites conocidos, y por qué

- El **menú `/`** no admite decoraciones por fila: sus filas las pinta el paquete del harness. Por eso la
  decisión se ofrece en dos sitios: filas del menú (una por pendiente, sin argumentos) y la tarjeta del
  resultado, que sí es nuestra (slot keyed por nombre de comando).
- La tarjeta de una **herramienta** (el bloque de `skill_propose`) no se puede reemplazar: el nodo `tool`
  del chat no declara hijo keyed y su clave ya está ocupada.
- El **cliente del harness** cachea el catálogo de skills por sesión y su invalidación no está en manos de
  un plugin: `/nombre` funciona igual, y la lista sugerida puede tardar en refrescarse.
