# Plan — ciclo de vida completo de una skill: deshabilitar y eliminar

**Estado: anotado, sin implementar.** Nace de la pregunta del autor: *«¿qué pasa si ya no quiero una skill,
puedo eliminarla de mi proyecto/sesión?»*, y de su propuesta: *«podría tener una lista de deshabilitados que
se pueden eliminar y podría eliminar de una vez»*. Este documento la cierra como clase, no como parche: se
diseña el ciclo de vida entero y lo que hoy falta.

## Respuesta corta, medida

Hoy **no se puede eliminar** una skill, y una **aprobada tampoco se puede apagar**. Lo que existe:

| Estado en disco | Cómo se llega | Qué puede hacer el humano hoy |
|---|---|---|
| `proposed/` | el modelo propone | aprobar, rechazar (apartar sin borrar), leer entera |
| `approved/` | aprobar una propuesta | **actualizarla** (proponer con el mismo id) — y **nada más** |
| `rejected/` | rechazar una propuesta | nada: queda guardada |
| `superseded/` | aprobar una actualización | nada: es el historial de lo que se sabía |

Es decir: el ciclo de vida tiene *proponer → aprobar → actualizar*, y **no tiene *apagar → retirar***. El
único gesto disponible sobre algo que ya no se quiere es pedir una actualización, que es otra cosa.

## Principios (los del repositorio, aplicados aquí)

1. **Nada se borra sin respaldo.** Antes de quitar nada del disco: copia con huella, y la operación se
   verifica contra el original (como en la limpieza del 2026-10-13).
2. **Apagar no es borrar.** Son dos gestos distintos, con dos estados distintos y dos consecuencias
   distintas. Mezclarlos es cómo se pierde trabajo por accidente.
3. **Decide el humano.** Igual que aprobar: deshabilitar y eliminar no son herramientas del modelo.
4. **Una regla, una implementación.** La puerta y el movimiento viven en `lib/`; la CLI, los comandos y la
   tarjeta los invocan.
5. **Nada silencioso.** Si una operación no se pudo hacer, se dice con el motivo y por dónde seguir.
6. **El repositorio del usuario no se ensucia.** Todo sigue viviendo en `$DSH_HOME`, fuera del proyecto.

## Diseño

### Estados

```
proposed ──aprobar──▶ approved ──deshabilitar──▶ disabled ──eliminar──▶ (respaldo fechado)
    │                     ▲                          │
    └──rechazar──▶ rejected│◀────habilitar───────────┘   restaurar ◀── respaldo
```

- **`disabled/`** es un estado nuevo: la skill **estaba activa** y el humano la apagó. **Se conserva
  entera**, deja de servirse al agente y sale de la lista de activas. Es reversible con un gesto.
- **Eliminar** es lo irreversible: la carpeta sale del almacén **a un respaldo fechado**
  (`$DSH_HOME/backups/skills-eliminadas-<fecha>/<proyecto>/<id>/`) con su huella, y hay un camino de vuelta
  (`restaurar`) que la devuelve a `approved/`.
- `rejected/` no cambia: es una propuesta que nunca se activó, y **«eliminar» una pendiente es rechazarla**
  (no hay nada que borrar). Que el gesto se llame distinto según el estado es parte del diseño, no ruido.

### Las cuatro superficies, como todo lo demás

| Superficie | Qué ofrece |
|---|---|
| **CLI** | `disable <id>` · `enable <id>` · `delete <id>` (con `--yes`, respaldo y huella) · `retired` (la lista) · `restore <id>` |
| **Comandos de la sesión** | `/skill-deshabilitar <id>` · `/skill-habilitar <id>` · `/skill-eliminar <id>` · `/skill-retiradas`, y **una fila por skill aprobada** (`skill-deshabilitar-<id>`), montada en el ámbito de su agente |
| **Tarjeta del resultado** | Lista de activas y de retiradas con **casillas**; acciones `Deshabilitar las marcadas (N)` y `Eliminar las marcadas (N)`; **paso de confirmación** que dice cuántas son, que se guarda respaldo y dónde; y tras el lote, `N hechas · M con fallo` con el motivo de cada fallo |
| **Página de revisión** | Lo mismo, en la página local, para trabajar sin sesión abierta |

La **eliminación en lote** es la petición literal del autor («eliminar de una vez»): marcar varias,
confirmar una vez, y el respaldo se toma **antes** de cada borrado, no después de todos.

### Guardas

- Eliminar exige **confirmación explícita** —un clic no borra— y **respaldo verificado con huella**.
- **El ámbito no se elige a mano**: una skill de otro proyecto se rechaza diciendo a cuál pertenece (ya
  medido: la puerta lo hace así con las propuestas).
- **Se rechaza mientras algo esté en uso**: si hay una propuesta pendiente con ese id, primero se decide
  (evita que una actualización en vuelo apunte a algo que ya no está).
- La **biblioteca global** no se toca desde aquí: es otra capa y otra decisión (y su limpieza ya tiene su
  procedimiento auditado).
- `restore` no pisa nada: si el id volvió a existir, lo dice en vez de sobrescribir.

### Pruebas de la clase

1. Deshabilitar saca la skill del **catálogo servido** y **no** borra nada del disco (huella igual).
2. Habilitar la devuelve al catálogo, sin reiniciar (la invalidación ya está).
3. Eliminar deja **respaldo con huella idéntica** y la quita del almacén; el catálogo deja de servirla.
4. En lote, **un fallo no se lleva las demás**, y el informe dice cuál falló y por qué.
5. `restore` devuelve la skill y su meta, y se niega si el id está ocupado.
6. El ámbito: no se puede deshabilitar ni eliminar lo de otro proyecto.

## Fases

| Fase | Contenido | Verificación |
|---|---|---|
| 1 | Estado `disabled/` + `lib/` (mover, habilitar, respaldar, restaurar) | pruebas de `lib/` contra cajas de arena |
| 2 | CLI (`disable`, `enable`, `delete`, `retired`, `restore`) + `doctor` | `doctor` los ejecuta, no los reimplementa |
| 3 | Comandos + filas por agente (`skill-deshabilitar-<id>`, …) | pruebas de activación con dos proyectos |
| 4 | Tarjeta con casillas, paso de confirmación y lote | pruebas de forma del artefacto + prueba en vivo del autor |
| 5 | Docs (`OPERACION`, `README`, `CHANGELOG`) y `MEMORY` | y el conteo de pruebas al día |

## Fuera de alcance, y por qué

- **Borrado automático por antigüedad**: no. Decide el humano, no un temporizador.
- **Vaciar `rejected/` de golpe**: no hace daño (no se sirve), y borrarlo destruye la explicación de por qué
  algo se descartó.
- **Tocar la biblioteca global**: otra capa, otro procedimiento.
