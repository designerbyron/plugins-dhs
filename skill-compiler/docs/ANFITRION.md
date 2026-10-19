# El anfitrión: qué ofrece hoy, qué no, y cómo queda el plugin

Este documento declara **lo que el anfitrión (DeepSeek Harness) ofrece de verdad**, lo que no, y cómo el plugin
se comporta en cada caso. Todo lo de la primera tabla está medido contra la compilación instalada el 19-10-2026
(`app.asar` del 17-10 03:20), no deducido de la documentación.

## 1 · Capacidades medidas

| Capacidad del anfitrión | Estado | Cómo se midió |
|---|---|---|
| Comandos humanos globales (`ctx.commands.register` desde el plugin raíz) | **sí** | los 15 comandos contestan (`/skill-propuestas`, `/skill-aprobar`, …) |
| Registro de comandos **por agente** (filas por propuesta en el menú «/») | **no** | tres caminos probados, tres motivos (abajo) |
| Ejecutar una orden desde la interfaz (`runCommand` con texto) | **sí**, con **texto con barra** | el panel aprobó 10 propuestas reales: 3 + 7, 0 fallos |
| Listar los comandos existentes (`listCommands`) | **sí** | el panel mide el efecto contra esa lista |
| Eventos de sesión (`session.snapshotEvents()`) | **sí** | `/skill-auto` se pliega de los `command/run` |
| Catálogo de skills por proyecto (`~/.dsh/skills`, `approved/`) | **sí** | 12 activas, 3 publicadas, servidas sin reiniciar |

### Lo que no ofrece: filas de comando por agente

La documentación de `@deepseek-ai/dsh-commands` describe la forma correcta («un plugin montado bajo `agent.ctx`
que declara su propio `inject: ['commands']`»). El plugin la intenta y **el anfitrión no la compone**:

| Camino | Resultado medido |
|---|---|
| `agent.ctx.inject(['commands'], cb)` | no llama a su callback |
| `agent.ctx.plugin({ inject: ['commands'], apply })` | el hijo no recibe el servicio |
| `agent.ctx.commands` | lanza `cannot get property "commands" without inject` |

Conclusión: en esta compilación, el servicio de comandos **no está en el ámbito del contexto del agente**. No es
un defecto del plugin y no hay variante de llamada que lo arregle.

## 2 · Qué se implementó para no depender de esa capacidad

1. **Tres caminos de montaje con motivo distinto.** `inject`, hijo montado y registro directo; el aviso dice
   cuál se agotó. Si mañana cualquiera funciona, las filas se montan (ver §3).
2. **La orden exacta, siempre.** `/skill-propuestas` imprime, junto a las pendientes, una línea que las decide
   todas (`/skill-aprobar a,b,c --local`) y las variantes por id, por ámbito y con `--force`. No hay que
   recordar ningún identificador ni depende del menú.
3. **El panel verifica por efecto.** Una aprobación cuenta si el id **deja** de estar pendiente en la lista del
   anfitrión, no si la respuesta parece un éxito. El lote va en **una** orden del servidor.
4. **El aviso calla cuando no hay nada que anunciar.** Sólo aparece si el montaje falló **y** hay pendientes.
5. **Integridad y rastro.** Se aprueba el contenido que se validó (huella de `SKILL.md` + `references/`), con
   rollback a `proposed` si no casa, y cada decisión queda en el diario encadenado
   (`decision`/`ambito`/`por`/`canal`/`hash*`), verificable con `security`.

Ninguna de estas piezas es un parche sobre el defecto del anfitrión: son la vía canónica (orden escrita, panel,
CLI) funcionando sin él.

## 3 · Qué ocurre cuando el anfitrión gane la capacidad

**Nada que tocar.** No hay ningún camino desactivado a mano:

- el montaje se reintenta en cada listado y en cada sesión que el provider observe;
- el primer camino que funcione registra las filas y **el aviso desaparece solo** (`montaje.ok`);
- el menú «/» ofrecería `skill-aprobar-<id>`, `skill-globalizar-<id>` y sus pares de ámbito;
- y si el anfitrión cambia la forma de `runCommand`, el panel sondea y **verifica el efecto** antes de dar nada
  por hecho, y escribe en el informe qué forma funcionó.

Esto no es una promesa: `tests/activation.test.mjs` monta tres anfitriones falsos —uno por camino— y exige, en
cada uno, que las filas aparezcan, que el aviso no salga y que al descargar el plugin no quede nada colgando.

## 4 · Limitaciones declaradas (hoy)

| Limitación | Alcance | Qué la cierra |
|---|---|---|
| Filas por propuesta en el menú «/» | cosmético: la decisión tiene tres vías sin menú | una compilación del anfitrión que componga `commands` en el contexto del agente |
| La forma de `runCommand` no está publicada | el panel la sondea y la verifica por efecto | un contrato documentado por el anfitrión |
| 16 avisos `body-budget` en la auditoría | 14 son proponibles; 2 exigen criterio humano (`brandkit` entre ellas, sin corte posible) | decisión del humano sobre el material |
| `ownership.json` ausente | la propiedad del puesto no se presume | `ownership dsh-only` o `ownership machine` |
| Sin etiqueta de release por encima de `v3.8.0` | el tree va en `3.8.4`; se etiqueta al promover | una promoción de release (`docs` del repo) |

Lo que **no** es una limitación y conviene no confundir: el aprendizaje funciona de punta a punta —proponer,
decidir, activar, servir, auditar— sin el menú. El menú es comodidad.
