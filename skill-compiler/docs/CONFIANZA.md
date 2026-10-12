# Modelo de confianza

Este plugin ingiere **contenido de terceros** y lo convierte en algo que el modelo lee como guía. Eso es
una superficie de ataque, y este documento dice exactamente qué se controla, qué no, y qué no ocurre
nunca. Lo último es lo más importante: varias de las garantías son ausencias.

## Qué se confía, y qué no

| Se confía en | No se confía en |
|---|---|
| La biblioteca curada de skills (`$DSH_HOME/skills`): es del operador y manda | Cualquier cosa descargada de un enlace, **aunque el repositorio sea popular** |
| La decisión humana de aprobar | El juicio del modelo sobre si un contenido ajeno es inocuo |
| Que el contenido guardado en disco es el que se descargó (SHA-256) | Que el contenido del enlace siga siendo el mismo mañana |

## Amenazas y controles

| Amenaza | Control | Límite declarado |
|---|---|---|
| **Inyección de prompt**: el texto del origen da órdenes al agente que lo lee («ignora las instrucciones anteriores», «no se lo digas al usuario») | Bloqueo por patrones, con la línea y la etiqueta. Se listan **sin reproducir** el contenido | Es detección por **forma**, no por intención. Una orden redactada de otra manera pasa; por eso la aprobación humana sigue siendo obligatoria |
| **Credencial filtrada** en el origen | Bloqueo: no se guarda nada | Se detectan formas conocidas. Un secreto con forma propia no se detecta — y el original solo se guarda si el fichero entero pasa el análisis |
| **Contrabando de texto invisible**: caracteres de ancho cero o de sobreescritura bidireccional que ocultan lo que un humano cree leer | Bloqueo, y al reportarlos se sustituyen por `⟦oculto⟧` para que se **vean** | Solo los rangos Unicode conocidos como problemáticos |
| **Cadena de suministro**: que el enlace traiga código que se ejecute | **No se copia código**: solo markdown. Binarios, scripts y carpetas se omiten y se declaran | Un bloque de código *dentro* de un markdown sí viaja: es texto, no se ejecuta, pero puede ser mal consejo |
| **Origen que cambia** después de tomarlo | SHA-256 guardado + `skill_upstream_check` | Detecta el cambio, **no lo arregla**: decidir es humano |
| **Acoplamiento a otra máquina**: rutas del autor del origen | Error en la propuesta; en vendorizado, aviso + reescritura de referencias | Las rutas absolutas en general solo avisan: documentar una herramienta del puesto es legítimo |
| **Elevación por lista negra**: aprovechar que el plugin no revisa algo | El modelo **no puede** desactivar un bloqueo: no hay parámetro, ni en la herramienta ni en la CLI | Es una garantía de diseño, no un detector: saneas el origen y vendorizas, o no se vendoriza |
| **Escritura fuera de sitio** | Todo va a `$DSH_HOME/skill-compiler/`, por proyecto. La biblioteca curada se lee y nunca se escribe | — |
| **Activación silenciosa**: que algo entre en el catálogo del modelo sin que nadie mire | `proposed` **no se sirve**. Solo `approved`, y aprobar es un acto humano por CLI | — |

## Lo que no ocurre nunca

Estas son garantías por construcción, no promesas de comportamiento:

1. **No se ejecuta contenido ajeno.** No hay `exec`, `spawn`, `eval` ni `Function` sobre el texto
   descargado. El plugin lee, analiza y escribe.
2. **No se instala nada del origen.** Ni dependencias, ni binarios, ni plugins.
3. **No se activa nada sin aprobación.** El proveedor sirve `approved/` y nada más.
4. **No se sobrescribe una versión adaptada.** El origen se comprueba; no se fusiona.
5. **No se escribe una credencial en el almacén.** Si el origen trae una, no se guarda ni el original:
   guardarlo verbatim crearía otra copia del secreto.
6. **El modelo no puede saltarse un bloqueo.** No existe el parámetro, y es deliberado.

## El riesgo que no se puede mecanizar

Un contenido ajeno puede ser **perfectamente inocente y estar equivocado**. No hay analizador que
distinga «procedimiento malo» de «procedimiento bueno»: eso es juicio, y por eso la aprobación es humana
y el flujo entero está construido alrededor de esa persona leyendo.

Lo que el plugin hace por ti es que esa lectura sea **informada**: te dice de dónde vino, qué se omitió,
qué se reescribió, de qué fecha es, con qué SHA-256, y si el origen se movió después. Lo que no puede
hacer es decidir por ti si el consejo es bueno.

## Los datos que se guardan

- **Del origen**: su markdown verbatim, su URL, su `ref`, su SHA-256 y la fecha de captura.
- **Nuestro**: la versión adaptada, la nota de adaptación local, los avisos y la licencia **si el origen
  la declara** (si no, se avisa de que no consta: reutilizar sin licencia es una decisión legal, no
  técnica).
- **Nunca**: credenciales, tokens, claves ni rutas personales de la máquina del autor.

Todo vive bajo `$DSH_HOME/skill-compiler/`, que es el almacén del harness y no un repositorio: no se
publica por git ni se sirve por HTTP.

## Cómo auditar lo que entró

```sh
# qué se aprobó, en qué proyecto y de dónde vino
node bin/skill-compiler.mjs list
node bin/skill-compiler.mjs provenance <id>

# el original, tal cual se descargó
type "$DSH_HOME/skill-compiler/projects/<clave>/approved/<id>/upstream/SKILL.md"

# ¿coincide con el origen hoy?
node bin/skill-compiler.mjs upstream <id>
```

`provenance.json` es la pieza que hace auditable todo lo demás: sin él, «esta skill vino de un
repositorio» sería una afirmación sin prueba.
