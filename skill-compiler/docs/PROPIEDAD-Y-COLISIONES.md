# La propiedad del proceso de creación de skills, y los choques entre sistemas

## El problema, medido

Este plugin **no es el único que escribe skills en el puesto**. Medido el 2026-10-16 en la máquina del
usuario responsable (`node bin/skill-compiler.mjs systems`):

| Sistema | Almacén | Skills |
|---|---|---:|
| skill-compiler (nuestro) | `~/.dsh/skill-compiler/projects` | 29 |
| DSH · biblioteca curada | `~/.dsh/skills` | 22 |
| Hermes · perfil `byron-saas-corporative` | `~/AppData/Local/hermes/profiles/…/skills` | 1 |
| Hermes · perfil por defecto | `~/AppData/Local/hermes/skills` | 0 |
| Claude Code · usuario | `~/.claude/skills` | no existe |
| Codex · usuario | `~/.codex/skills` | no existe |
| Cursor · usuario | `~/.cursor/skills` | no existe |

Dos hechos que el plugin no estaba mirando:

1. **En la biblioteca curada hay skills que no escribió este plugin** (medido: 22 carpetas, **2 nuestras y 20
   ajenas**). Escriben otras herramientas y el propio humano. El anti-solapamiento ya se niega a pisar un id
   curado que no sea nuestro, pero eso es una defensa por id, no una política de puesto. Y al revés: los dos
   ids que hoy viven en la curada **y** en nuestro almacén (`dsh-local-mcp-integration`,
   `php-pdo-mariadb-local-contracts`) son nuestras propias publicaciones, leídas como una sola copia efectiva.
2. **Nada declaraba quién manda sobre qué.** El plugin asumía que el puesto era suyo —un defecto de
   alcance—, y con otros agentes instalados el mismo id podía acabar viviendo en dos sitios con contenido
   distinto: dos verdades sobre lo mismo, y ninguna señal.

## Lo que se declara

Una respuesta, en un fichero del almacén (`ownership.json`), con dos valores posibles y **ningún valor por
defecto**:

| `ownership` | Qué significa | Qué hace el plugin |
|---|---|---|
| `dsh-only` | sólo se trabaja con DSH | escribe **sólo** en su almacén y en la biblioteca curada de DSH, y **rechaza** un id que ya viva fuera: no compite con los demás sistemas |
| `machine` | el proceso entero del PC | además **mira** los otros sistemas, avisa de cada choque de id con su sitio, y puede traer lo ajeno como propuesta con procedencia — sin sobrescribir jamás |

### Los cuatro estados de la declaración (no dos)

`ownership.json` puede estar en cuatro situaciones distintas, y **no se leen igual** porque son distintas:

| `estado` | Qué significa | Qué hace el plugin |
|---|---|---|
| `ausente` | no hay fichero: nadie ha respondido | aplica la política segura y **dice que falta la respuesta** |
| `declarada` | respuesta válida | aplica la política declarada |
| `invalida` | el fichero existe y no dice una de las dos respuestas: JSON roto, valor fuera de contrato, o **campos desconocidos** | **no se presume**: aplica la política segura y declara el motivo y cómo arreglarlo |
| `ilegible` | el fichero existe y no se pudo leer (permisos, es un directorio…) | **no se presume**, y **no se confunde con ausente** |

`invalida` e `ilegible` no son «sin declarar» por comodidad: son estados que hay que **arreglar**. Un JSON
roto leído como «nadie ha respondido» haría creer que la pregunta sigue abierta cuando lo que hay es una
respuesta rota. Y un campo de más invalida la declaración entera: un contrato que no conoce un campo no
puede saber qué significa.

**Declarar es compare-and-swap**: `declararPropiedad(..., { esperadaHuella })` se niega si el fichero cambió
entre la lectura y la escritura (`status: 'concurrente'`), así que dos sesiones no se pisan la respuesta.
La escritura es atómica (temporal + `rename`) y se relee para comprobar que quedó como se escribió.

Sin respuesta —o con una que no sirve— **elegir «todo el PC» solo no es una decisión del motor**. Mientras
la propiedad no sirva, el plugin lo dice donde importa —al proponer, en `/skill-propiedad` y en
`doctor`/`ownership`— y sigue trabajando como `dsh-only` en la práctica, sin bloquear trabajo por una
respuesta que nadie ha pedido.

### Las cuatro invariantes

1. **Nunca se escribe en el almacén de otro sistema.** Ni con `machine`. Lo ajeno se lee, se cita y —como
   mucho— se copia **hacia dentro** como propuesta con procedencia. Se comprueba midiendo la huella del
   árbol ajeno antes y después (`tests/scope.test.mjs`): ni un byte.
2. **Nunca se sobrescribe lo que no es nuestro**, tampoco dentro de la biblioteca curada: el id curado sin
   nuestro `origin` no se toca; se rechaza la propuesta y se dice con quién choca.
3. **Una copia publicada no es una colisión.** Nuestra skill publicada vive en la curada (`--global`) y deja
   constancia en `published/`: es **una sola copia efectiva**, y el inventario la lee así en vez de acusarse
   a sí misma — se declara en `copiasPropias` con su motivo.
4. **La huella informa, no decide.** Que dos copias tengan el mismo contenido no demuestra de quién son: un
   id idéntico en dos sistemas, sin procedencia que lo firme, es un **choque declarado** (`misma-copia`) y no
   se descarta por parecerse. La propiedad la resuelve el `origin`.

Y el corolario de todo lo anterior: **un barrido incompleto no prueba nada**. Si una fuente configurada y
existente no se pudo leer, el inventario se declara `completo: false`, dice qué fuentes quedaron sin leer y
**no afirma que no haya choques**: dice «sin choques COMPROBADOS».

## Cómo se declara

En cualquier sesión del harness:

```
/skill-propiedad                      # sin argumento: dice lo declarado, o pregunta
/skill-propiedad dsh-only             # sólo DSH
/skill-propiedad machine              # todo el PC
```

Y en el menú `/`, sin teclear nada: las filas `skill-propiedad-dsh-only` y `skill-propiedad-machine`
declaran su respuesta **al seleccionarlas** —mismo contrato que las filas de las pendientes: un comando sin
argumentos se ejecuta en el acto—.

Desde el terminal, con el mismo efecto (una sola implementación: `lib/scope.mjs`):

```
node bin/skill-compiler.mjs ownership              # estado, con la pregunta si falta
node bin/skill-compiler.mjs ownership machine      # declararla
```

### «Que al instalarse me pregunte»

El harness donde vive este plugin no tiene un diálogo de instalación que el plugin pueda bloquear: un
plugin se carga, no se instala con asistente. Así que la pregunta se pone **donde el humano la ve y donde
la respuesta tiene efecto**, en vez de fingir un asistente:

- `node bin/skill-compiler.mjs doctor` y `ownership` la imprimen mientras no haya respuesta.
- `/skill-propiedad` la imprime entera —las dos opciones, explicadas— y la declara con un argumento.
- Las dos filas del menú `/` la resuelven **en un clic**.
- La primera propuesta de una skill nueva, si el id ya vive fuera, la menciona en el aviso.
- El protocolo del plugin le dice al agente que la propiedad existe y cómo se declara (una sola línea).

Lo que **no** hace: preguntarla una y otra vez, ni elegir por ti. Se declara una vez.

## El inventario y los choques

```
node bin/skill-compiler.mjs systems      ·      /skill-sistemas
```

Lista cada sistema con su ruta y sus skills, y los **ids que viven en más de un sistema**, con el sitio
exacto de cada copia. Marca cuáles son nuestros. No escribe nada.

### Almacenes que este módulo no puede adivinar

Un agente o un editor recién instalado, o con la carpeta en otro disco, no está en la lista. Se declara por
entorno, separando por el delimitador del sistema (`;` en Windows):

```
SKILL_COMPILER_SISTEMAS="D:\skills-de-otro-agente;E:\mas-skills" node bin/skill-compiler.mjs systems
```

Lo declarado así se **mira**; nunca se escribe.

## Lo que decide la puerta al proponer

Sólo para una propuesta **nueva** (actualizar lo nuestro no puede ser una colisión), si el id ya vive en
otro sistema:

| Propiedad | Qué hace la puerta |
|---|---|
| sin declarar | propone, con el aviso de que falta la respuesta y las dos opciones para darla |
| `dsh-only` | **rechaza** con el sitio de la otra copia; elige otro id o cambia la propiedad |
| `machine` | propone, con el aviso del sitio y la constancia de que la nuestra es una copia con procedencia |

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| La declaración | `<almacén>/ownership.json` (`{ ownership, declaredAt, declaredBy }`) |
| La política y la medida | `lib/scope.mjs` |
| La puerta | `lib/compiler.mjs` (`propose`, tras el anti-solapamiento) |
| Los comandos y el CLI | `lib/commands.mjs` · `bin/skill-compiler.mjs` |
| El cerrojo | `lib/lock.mjs` (lo comparten proponer, promocionar y publicar) |
| Las pruebas | `tests/scope.test.mjs` (28) · `tests/scope-concurrencia.test.mjs` (8, con el CLI real) · `tests/audit-rutas.test.mjs` (9) |

## El inventario: lo que no se pudo leer no es «cero skills»

Un almacén puede estar **detectado y accesible**, **detectado e inaccesible** (permisos, no es una carpeta,
un enlace roto) o **no existir**, y las tres cosas se leían igual: cero skills. Con eso, «no hay choques» era
una afirmación que nadie había medido. Ahora la diferencia es un dato:

| `estado` de una fuente | Qué significa |
|---|---|
| `accesible` | se leyó entera |
| `parcial` | se listó, y alguna entrada no se pudo leer |
| `inaccesible` | existe y no se pudo leer: la ruta no es una carpeta, o un enlace roto apunta a nada |
| `inexistente` | no hay nada en esa ruta |

Y el inventario publica, además de sus sistemas y choques: `completo` (¿se pudo mirar todo lo que existe?),
`sinLeer` (qué quedó sin comprobar y por qué), `copiasPropias` (nuestras publicaciones), `nombresEquivalentes`
y una **huella** que identifica lo leído —lo mismo leído dos veces da la misma huella, y un cambio en las
fuentes la cambia—. No es una instantánea atómica: son lecturas seguidas, y se declara como huella de lo
leído, no como verdad congelada.

## Identidad: seis casos que no son el mismo

Dos skills con el mismo id no son automáticamente lo mismo. El inventario distingue: **copia publicada
nuestra** (la curada lleva nuestro `origin`), **choque de contenido** (`distinto-contenido`), **mismo
contenido sin procedencia** (`misma-copia`, que **sigue siendo un choque declarado**), **identidad no
determinable** (alguna copia no se pudo leer), **nombres equivalentes** por caja (el mismo fichero en Windows,
dos en Linux) y **fuente detectada pero inaccesible** (ni choque ni copia: se declara).

## Rutas: resolver, y no salirse

`resolverRuta` canóniza **hasta el ancestro que existe** y devuelve aparte la cola sin resolver: si sólo se
canonizara la ruta entera, una ruta que no existe no se podría comparar con su raíz y **un enlace que sale del
ámbito pasaría por dentro**. `bajoRaiz` compara canónicas, así que `..` y los enlaces que apuntan fuera no
pasan. Un enlace roto no es «no existe»: es un enlace roto.

## Concurrencia: la escritura, bajo el mismo cerrojo que la promoción

Proponer no escribe a ciegas: la escritura va bajo el **cerrojo por skill** que ya usaba la promoción
(`lib/lock.mjs`, `O_EXCL`, un fichero en `<almacén>/locks`) — **un solo mecanismo**, porque dos serían dos
verdades. Dentro del cerrojo se repiten las dos comprobaciones que sostienen la decisión: que la **política no
cambió** (`propiedadSinCambios`) y que el id **no vive fuera** con la política que se aplica ahora. Si algo
cambió, no se escribe y se dice por qué.

Un cerrojo tomado no se rompe nunca por viejo que sea: se informa de quién lo dejó y se para. Y un rechazo no
deja nada a medias: ni propuesta, ni cerrojo (medido en `tests/scope-concurrencia.test.mjs`).

## Lo que decide la puerta al proponer (tabla actualizada)

Sólo para una propuesta **nueva** (actualizar lo nuestro no puede ser una colisión), si el id ya vive en otro
sistema:

| Política aplicada | Qué hace la puerta |
|---|---|
| `dsh-only` (declarada, o porque la declaración no sirve) | **rechaza** con el sitio de la otra copia y con el estado real de la declaración |
| `machine` | propone, con el aviso del sitio; la propuesta guarda su `scope` (política, huella, sitios, barrido completo) |

Si el barrido no fue completo, se avisa de que **no se puede afirmar que el id no exista** fuera. Y si la
declaración está `invalida` o `ilegible`, cada propuesta lo dice: es un trabajo pendiente, no un estado normal.
