# Seguridad del plugin — qué protege, de qué, y qué no

Este documento es el **contrato** de la capa de seguridad. No describe intenciones: describe lo que el código
hace y cómo se comprueba. Lo que no cubre está escrito al final, porque un documento de seguridad que sólo
enumera virtudes no sirve para decidir.

## 1 · El modelo de amenaza, en una frase por riesgo

| Riesgo | Por qué existe aquí | Qué lo cierra |
|---|---|---|
| **El id es una ruta** | `projects/<clave>/<estado>/<id>/SKILL.md` se construye con un id que llega de la línea de comandos | Contrato de id único (`motivoDeIdInseguro`) aplicado **donde se mueve y se lee** (`move`, `locate`), no sólo en la puerta |
| **Una skill son instrucciones** | El texto se sirve al modelo en cada sesión: una propuesta puede reescribir su comportamiento y sobrevivir a la sesión en la que nació | Escaneo del contenido con dos niveles: **bloqueo** (no se escribe, no se aprueba ni con `--force`) y **aviso** (lo decide un humano) |
| **Una skill lleva secretos** | El almacén es texto plano y viaja a cada prompt; una credencial ahí está publicada | Credenciales = **bloqueo**, en el cuerpo y en `references/` |
| **Aprobarse solo** | Si el modelo pudiera aprobar, la revisión humana sería decorativa | Aprobar no es una herramienta; y la promoción automática nunca activa un contenido con aviso de seguridad |
| **El árbol que se publica no es el que se validó** | Entre `check` y `rename` cabe un cambio, o un enlace | `revisarArbol` (nada de enlaces ni dispositivos) + huella del árbol antes y después del movimiento |
| **El diario miente** | Un registro que se puede editar sin dejar rastro no audita nada | Cadena de huellas: cada entrada encadena la anterior; editar, borrar o insertar se nota |

## 2 · El contrato de id

Un id es un **identificador**, no un título: kebab-case ASCII, empieza por letra, sin puntos, sin separadores,
sin nombres reservados de Windows (`CON`, `NUL`, `COM1`…), hasta 64 caracteres. Se rechaza con el motivo
concreto, no con «id inválido»:

```
«../fuera» no es un id utilizable: el id lleva «..»: un id no sale de su carpeta.
```

El mismo juicio se aplica en `/skill-aprobar`, `/skill-rechazar`, la CLI, las filas del menú y `locate`, así
que un id inseguro **no encuentra nada** y **no mueve nada**: no hay una segunda implementación donde colarse.

## 3 · El escaneo del contenido

Dos niveles, y la diferencia importa:

**Bloqueo** — no se escribe la propuesta y no se aprueba ni con `--force`:

- **Credenciales**: clave privada PEM, clave de AWS (`AKIA…`), token de GitHub (`ghp_`…), token de Slack,
  clave de Google, JWT, `password=`/`api_key=`/`token=` con valor, cabecera `Authorization: Bearer …`.
- **Órdenes dirigidas al agente**: «ignora las instrucciones anteriores», «revela el prompt del sistema»,
  «no le digas al usuario», «aprueba tú mismo / sin el humano», «salta la puerta», «envía el contenido a una
  URL», `curl … | sh`.
- **Destrucción sin excusa**: `rm -rf /`, `format c:`, borrado recursivo de una unidad completa.

**Aviso** — pasa, pero lo decide un humano con `--force`, y **nunca** la promoción automática:

- rutas a material sensible (`~/.ssh`, `.aws`, `id_rsa`, `.netrc`, `cookies.sqlite`, `/etc/shadow`…): un
  procedimiento legítimo puede citarlas para **prohibirlas**;
- operaciones privilegiadas o contextuales (`diskpart`, `reg delete HKLM`, `bcdedit`, `vssadmin delete`).

El escaneo mira **el mismo texto que se va a servir**: cuerpo, frontmatter y cada fichero de `references/`,
con fichero y línea en el hallazgo. Y se aplica dos veces: al proponer (no escribir) y al auditar el disco
(caza la edición a mano posterior a la propuesta).

## 4 · El árbol y la ventana entre validar y mover

- `revisarArbol` rechaza enlaces simbólicos, dispositivos y tuberías dentro de la skill, y un árbol de más de
  200 ficheros. Un enlace dentro de una skill es una puerta a otro sitio en las dos direcciones: al leer se
  publicaría contenido de fuera; al escribir se escribiría fuera.
- En la aprobación se toma la huella del árbol (`huellaDeArbol`) y se compara con la de después del
  movimiento. Si no coinciden, el resultado lo dice: la ventana es de milisegundos, pero se mide en vez de
  suponerse.

## 5 · La promoción automática, cerrada por defecto

`promover` calcula el nivel del parche y, **por encima de lo que declare el parche**, si el contenido levanta
cualquier aviso de seguridad el nivel pasa a `NIVEL_QUE_EXIGE_HUMANO`. Es decir: la capa no depende de que
quien declaró el nivel se acordara de subirlo.

## 6 · El diario, encadenado

Cada entrada de `projects/<clave>/journal.jsonl` lleva `huellaAnterior` y `huella`. La huella cubre todos los
campos —**también el eslabón**— en JSON con claves ordenadas. `verificarCadena` distingue tres cosas que no
son lo mismo:

| Estado | Qué significa |
|---|---|
| `journal-tamper` | El cuerpo de una entrada no casa con su huella: se editó después de escribirse |
| `journal-chain` | El eslabón no casa con la huella de la anterior: se borró o se insertó algo |
| `sinHuella` | Entrada anterior al encadenado: se declara y **no** cuenta como rotura |

Límite declarado: sin un secreto local no hay firma. La cadena detecta la edición accidental, la de una
herramienta torpe y la de quien no sabía que estaba encadenada; **no** detiene a quien tiene escritura y
recalcula la cadena entera. Para eso haría falta una clave fuera del almacén, y eso es otro diseño.

## 7 · Cómo se comprueba

```sh
node bin/skill-compiler.mjs security   # recorre el almacén entero y verifica cada cadena (exit 1 si hay algo)
node bin/skill-compiler.mjs doctor     # una línea: skills revisadas, bloqueos y avisos
node bin/skill-compiler.mjs audit --estado approved,disabled,proposed,published
npm test                               # tests/security.test.mjs: 17 casos adversarios
```

`security` es **sólo lectura**: no repara, no aprueba y no mueve. Devuelve exit 1 si hay un bloqueo o una
cadena rota, para poder usarlo en una puerta.

## 8 · Lo que esta capa NO hace

- **No ejecuta** el contenido de una skill (el plugin nunca lo evalúa), así que no hay ejecución de código que
  sandboxear; lo que se protege es el texto que el modelo va a leer.
- **No es un antivirus**: los patrones son los del riesgo medido, no una taxonomía exhaustiva. Un contenido
  malicioso escrito sin ninguna de esas formas puede pasar el escaneo; lo que no puede es pasar el escaneo
  **y** la revisión humana **y** tener avisos, porque el aviso fuerza humano.
- **No protege de un humano** que decide publicar con `--force` sobre un aviso. Eso es exactamente lo que
  `--force` significa, y queda registrado.
- **No autentica** el diario (ver §6).
- **No cifra** el almacén: una credencial que llegue por otra vía no está protegida por estar aquí.
