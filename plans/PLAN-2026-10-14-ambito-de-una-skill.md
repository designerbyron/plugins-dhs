# Plan — el ámbito de una skill al aprobarla: local o global

**Estado: PROPUESTO — espera aprobación explícita antes de tocar una línea.**
Nace de la necesidad del autor, dicha así: *«skill-compiler necesita tener dos opciones al momento de
seleccionar una skill propuesta y preguntar antes de aprobar si desea que sea local o global, ya que me vi en
esa necesidad»*.

## Respuesta corta, medida

Hoy **no existe la elección**: aprobar es un solo gesto y siempre deja la skill en **el proyecto**.

| Qué | Dónde vive hoy | Quién lo sirve |
|---|---|---|
| Propuesta | `$DSH_HOME/skill-compiler/projects/<clave>/proposed/` | el plugin |
| Aprobada (local) | `$DSH_HOME/skill-compiler/projects/<clave>/approved/` | el plugin, rango **150** |
| — | — | — |
| «Global» | **no existe como destino del plugin** | — |

Y **el harness sí tiene un concepto de global**, medido en su código: resuelve **cuatro** raíces de skills y una
de ellas es la **biblioteca de usuario**, con rango propio:

```
join(projectRoot, '.agents/skills')   ·  proyecto
join(projectRoot, '.dsh/skills')      ·  proyecto (lo que declara el propio repositorio)
join(this.agentsHome, 'skills')       ·  usuario
join(this.dshHome, 'skills')          ·  usuario  ← $DSH_HOME/skills, rango 400
```

Rangos, que son el contrato de prioridad: proyecto **100/200**, el plugin **150**, biblioteca de usuario
**400**. Es decir: **lo del proyecto gana**, y la biblioteca de usuario está por debajo de todo lo que el
repositorio declare. Nuestro propio comentario en `lib/definitions.mjs` ya lo decía sin que existiera la
función: *«lo aprendido para un proyecto gana a lo global»*.

Dato que condiciona el diseño: `$DSH_HOME/skills` **no es una carpeta vacía nuestra**. Hoy tiene **21 skills
escritas por Hermes** (`author: Hermes Agent`), y el harness las sirve a todas las sesiones. Es una
biblioteca **compartida**.

## La idea, mejorada antes de ejecutar

La idea original es «elegir local o global al aprobar». Se mantiene, y se mejora en cuatro puntos que la
hacen soportable en el tiempo:

1. **«Global» tiene que ser lo que el harness lee como global**, no una carpeta nuestra nueva. Si publicáramos
   en un ámbito propio del plugin, la skill **no** estaría donde el humano la busca (el menú, otra sesión,
   otro proyecto) y habría **dos** sitios de skills globales. Global = `$DSH_HOME/skills`.
2. **Preguntar, no adivinar** — pero con un defecto seguro: sin decir nada, se aprueba **local**. Publicar
   para todos los proyectos es un gesto **explícito**, siempre.
3. **La decisión tiene vuelta.** Una aprobación con el ámbito equivocado se corrige (`skill-ambito`), y la
   global entra en el ciclo de vida que ya existe: apagar, retirar, restaurar.
4. **Marca de origen y puerta de no-pisar.** En una biblioteca compartida con Hermes, el plugin escribe ahí
   **sólo** si el destino no existe o si es suyo (el frontmatter ya lleva `metadata.dsh.origin:
   skill-compiler`). Ante una skill ajena con el mismo nombre: **no se pisa**, se dice y se ofrece un nombre
   alternativo.

Y una advertencia que me hago a mí mismo, porque es lo honesto: hace dos días **movimos cinco skills de
proyecto fuera de la biblioteca global** porque ahí eran ruido. Esto no lo contradice, y la diferencia es la
que importa: entonces **nadie eligió** (el plugin las había puesto ahí), ahora **lo elige el humano**, y una
global queda **marcada** — por tanto listable y retirable — en vez de mezclada sin origen.

## Principios (los del repositorio, aplicados aquí)

1. **El ámbito lo declara el humano, nunca el modelo.** Aprobar sigue sin ser una herramienta del modelo; el
   ámbito tampoco.
2. **Una regla, una implementación.** La puerta de publicación y el movimiento viven en `lib/`; CLI, comandos
   y tarjeta los invocan.
3. **Nada se pisa y nada se pierde.** Publicar verifica el destino y guarda huella; retirar guarda respaldo
   fechado y camino de vuelta.
4. **Una sola copia efectiva.** Una skill global no se queda también en el proyecto: el provider no serviría
   dos veces lo mismo.
5. **Nada silencioso.** Cada gesto dice **dónde** quedó la skill y cuál es el gesto inverso.

## Diseño

### Dónde vive cada cosa

```
$DSH_HOME/skills/<id>/                              ← EFECTIVA y global (la lee el harness, rango 400)
$DSH_HOME/skill-compiler/global/disabled/<id>/      ← una global apagada (reversible)
$DSH_HOME/skill-compiler/global/superseded/<id>/    ← versión anterior de una global al actualizarla
$DSH_HOME/backups/skills-eliminadas/<fecha>/global/<id>/   ← respaldo de una global retirada

$DSH_HOME/skill-compiler/projects/<clave>/proposed/<id>/    ← propuesta (nace en el proyecto)
$DSH_HOME/skill-compiler/projects/<clave>/approved/<id>/    ← aprobada LOCAL (la sirve el plugin, 150)
$DSH_HOME/skill-compiler/projects/<clave>/published/<id>/   ← salió de aquí hacia la biblioteca: se sabe de dónde salió
```

Lo apagado y lo retirado de una global viven **dentro del store del plugin**, no en la carpeta compartida: la
biblioteca sólo contiene lo que está en servicio.

### Estados

```
proposed ──aprobar──────────▶ projects/<clave>/approved/     (local, el plugin lo sirve)
    │
    └─────aprobar --global──▶ $DSH_HOME/skills/<id>/         (global, lo sirve el harness)
                    │
       apagar ──────┤──────▶ global/disabled/  ──encender──▶ $DSH_HOME/skills/<id>/
       actualizar ──┘──────▶ global/superseded/<versión anterior>
       retirar ────────────▶ respaldo fechado + huella ──restaurar──▶ $DSH_HOME/skills/<id>/
```

### La puerta de publicación (`lib/compiler.mjs`)

`publish(id, { scope })` con esta comprobación, antes de escribir nada:

| Destino | Qué hace |
|---|---|
| No existe | publica (copia con huella), y anota la decisión en `published/` |
| Existe y es del plugin (`metadata.dsh.origin: skill-compiler`) | reemplaza guardando la anterior en `superseded/` |
| Existe y **no** es del plugin | **no publica**: lo dice y no toca el fichero ajeno |

### Superficie humana

- **Menú `/`**: dos filas por pendiente — `skill-aprobar-<id>` («aprobar en este proyecto») y
  `skill-aprobar-global-<id>` («aprobar para todos mis proyectos»). El nombre de la fila **es** la pregunta.
- **Panel de lote**: el paso a paso gana un paso «¿dónde?» con dos botones, antes de confirmar.
- **Gesto inverso**: `skill-ambito <id> --global|--local` mueve una ya aprobada, en las dos direcciones.
- **Los cinco comandos que ya mutan** (`aprobar`, `deshabilitar`, `habilitar`, `eliminar`, y ahora `ambito`)
  pasan por el envoltorio que avisa al catálogo **cuando y sólo cuando** movió algo (regla 16 / gobernanza 6).
- **CLI**: `approve <id> [--global]`, `scope <id> --global|--local`, y `list`/`retired` dicen el ámbito de
  cada una. `doctor` comprueba la raíz de la biblioteca y que la marca de origen se lee.

### Lo que **no** cambia

- El provider sigue sirviendo **sólo el proyecto**: las globales las sirve el harness (rango 400), no nosotros.
  Cero código de servido nuevo, una sola fuente.
- El modelo sigue sin poder aprobar ni publicar.
- Los 9 comandos actuales conservan su forma; se añaden `skill-ambito` y el modificador `--global` de
  `skill-aprobar`.

## Riesgos declarados

1. **La biblioteca es compartida con Hermes.** Mitigado con la puerta de no-pisar y la marca de origen; queda
   dicho que una skill publicada aquí la ve **todo** el que use esta máquina, no sólo este proyecto.
2. **¿Se ve sin reiniciar?** Está **por medir**: el catálogo del harness puede cachear la biblioteca de
   usuario. Es la primera comprobación de la fase 5 (con una skill de prueba propia y retirada después), y si
   el harness exige reconectar, se declara como límite en vez de prometer lo que no pasa.
3. **Colisión de nombre** con una skill de Hermes: se detecta y se dice, sin pisar.

## Fases, cada una con su verificación

| # | Qué | Cómo se comprueba |
|---|---|---|
| 1 | Ámbito en el compilador: `publish`, la puerta, la huella, `published/` | pruebas de la clase: destino libre, destino propio, destino ajeno (no pisa) |
| 2 | Ciclo de vida de una global: apagar, encender, retirar, restaurar, cambiar de ámbito | ciclo completo por el **CLI real** en arena, como el de v1.7.0 |
| 3 | Superficie: las dos filas, el paso «¿dónde?» del panel, textos ES/EN | pruebas de artefacto con anclas, y rojo demostrado |
| 4 | CLI, `doctor` y docs (OPERACION, CHANGELOG, README, reglas del repositorio) | suite completa, hermético, `doctor` verde |
| 5 | Verificación **en vivo**: publicar desde una sesión y verla en otra; apagar; retirar; restaurar | medición del autor, y versión **1.8.0** con tag |

## Decisiones que necesito del autor

1. **Qué significa «global»**: la biblioteca de usuario del harness (`$DSH_HOME/skills`, la que ve todo proyecto
   y que Hermes también usa) — **recomendado** —, o un ámbito global propio del plugin, aislado de Hermes.
2. **El defecto al no decir nada**: aprobar en **local** salvo que se pida global — **recomendado** —, o
   preguntar siempre con dos opciones.
3. **Cambiar de ámbito después**: permitirlo con `skill-ambito`, en las dos direcciones — **recomendado** —, o
   que el ámbito se decida una sola vez.
