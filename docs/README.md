# Documentación de la colección

Índice de la gobernanza de **LifeCode Plugins**. Si vas a trabajar aquí (humano o agente), empieza por
[`AGENTS.md`](../AGENTS.md): es el resumen que entra en cada prompt.

## Gobernanza de este repositorio

| Documento | Qué declara |
|---|---|
| [`01-governing-rules.md`](01-governing-rules.md) | El contrato de la casa: dónde vive el estado, qué se prueba, cómo se decide y cómo se publica |
| [`02-master-vision.md`](02-master-vision.md) | Qué es esta colección, qué problema resuelve y cómo se mide el éxito |
| [`03-architecture.md`](03-architecture.md) | La forma de un plugin, cómo se conecta con el harness, el camino de una decisión y los límites medidos |
| [`05-golden-rules.md`](05-golden-rules.md) | Las reglas no negociables, cada una con el defecto real del que nació |
| [`design-system.md`](design-system.md) | Color, movimiento, accesibilidad, estilos e idioma de la pieza de interfaz |

## Estado vivo

- [`MEMORY.md`](../MEMORY.md) — versión publicada, qué está verificado, qué queda pendiente y las
  decisiones recientes. Es la memoria durable del repositorio.

## Por plugin

| Plugin | Documentación |
|---|---|
| `skill-compiler` | [`README.md`](../skill-compiler/README.md) · [`docs/`](../skill-compiler/docs/) (operación, dependencias, desarrollo, feedback visual, confianza) |

## Auditorías

| Documento | Qué resuelve |
|---|---|
| [`AUDITORIA-2026-10-13-cruces-entre-repos.md`](AUDITORIA-2026-10-13-cruces-entre-repos.md) | Qué se cruzó entre repositorios tras el desarrollo y las pruebas: ocho hallazgos con su evidencia, la limpieza ejecutada (cinco skills de proyecto devueltas a su ámbito) y el procedimiento, reutilizable, para mover conocimiento entre capas |

## Planes de trabajo

- [`plans/`](../plans/) — planes con su análisis, sus fases y su estado. Los autorizados llevan su `.sha256`.
- [`PLAN-2026-10-13-gestion-de-skills.md`](../plans/PLAN-2026-10-13-gestion-de-skills.md) — el ciclo de vida
  completo: deshabilitar (reversible) y eliminar (con respaldo y vuelta), en lote y desde las cuatro
  superficies. **Anotado, sin implementar.**

## Historial

- [`CHANGELOG.md`](../CHANGELOG.md) — versiones de la colección, con lo que entró en cada una y lo que la
  demuestra.
