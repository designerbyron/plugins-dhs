# Plan — aprendizaje en lote: varias skills y varios parches en una sesión

**Fecha:** 2026-10-16 · **Ámbito:** `skill-compiler` · **Estado:** propuesto (fases con gate)
**Base:** `v2.0.0` publicada (`8ecd891`)

---

## 0. Lo que se pide, y lo que la auditoría encontró

Pedido: *«¿qué pasa si en una sesión la evaluación o reflexión debería crear más de una skill, o el
conocimiento revisado toca más de un tema y se deberían hacer patches en varias skills? ¿Cómo manejamos esos
casos y cómo la interfaz puede seguir dándonos el feedback correctamente?»*

Auditoría hecha **antes** de este plan, con el almacén real intacto y en cajas de arena. Lo medido:

| # | Comprobación | Resultado real |
|---|---|---|
| 1 | Tres skills de temas **distintos** en la misma sesión | **La 2ª y la 3ª se VETAN por «mismo-tema»** contra la 1ª (score 0,68) |
| 2 | De dónde sale ese 0,68 | La huella de tema compara **descripción y disparador completos**, y el estilo de redacción del mismo autor (`«… con los pasos medidos, el orden comprobado y las trampas ya pagadas»`, `«Cuando haya que … en este proyecto»`) está en **8/8** skills de la biblioteca: la parte común pesa más que la que distingue |
| 3 | Separación del veto hoy | Pares que **deben** vetarse: 0,800–1,000. Pares de temas distintos: **0,708–0,739**. Margen: **0,06** — el umbral 0,5 no puede separar |
| 4 | ¿Hay concepto de lote/grupo? | **No existe.** Ni en el esquema de la herramienta, ni en `meta.json`, ni en la CLI, ni en la interfaz |
| 5 | Varios parches a varias skills | Se puede, uno a uno, cada uno con su `revision`; pero **sin vínculo entre ellos**, y **el veto del punto 1 los bloquea igual** si comparten vocabulario |
| 6 | Aprobación en lote | No hay. `approve <id>` es de una en una; `check` sin id revisa todas, pero aprobar no tiene modo conjunto |
| 7 | Qué dice el feedback con varias skills | La píldora pinta `«Skill updated <último id> ×N»`, donde `N = creados + actualizados` **contando eventos, no skills**: con tres skills distintas sugiere que una se actualizó tres veces. Es exactamente el `×3` de la captura |
| 8 | Filas del menú | Una por pendiente y verbo (correcto), pero **ninguna fila para el conjunto** |

**Causa raíz del caso, en una frase:** el sistema mide parecido de **estilo** y lo llama parecido de **tema**, y
no tiene forma de decir «estas propuestas van juntas». Por eso una sesión que aprende tres cosas solo puede
proponer una, y tres correcciones del mismo motivo no se pueden ni proponer ni decidir en conjunto.

## 1. Cómo se mide el parecido después (el núcleo del cambio)

La huella de tema pasa a **descontar lo que es estilo de la casa**: un token que aparece en casi todas las
skills de la biblioteca no distingue nada, así que pesa poco; un token que aparece en una sola pesa mucho.
Peso por token: `log(1 + N / (1 + df))`, con `N` = skills de la biblioteca y `df` = en cuántas aparece; y los
tokens con `df/N ≥ 0,8` **no cuentan** cuando `N ≥ 6` (estilo puro, no tema). Los tallos del **id** cuentan
siempre con peso pleno: el nombre es el tema que el autor declara.

Medido con ocho pares etiquetados (**el mismo corpus que irá a la prueba**):

| Par | Esperado | Hoy | Con la huella nueva |
|---|---|---|---|
| «restaurar copia de seguridad MySQL» / «… de MySQL» | vetar | 1,000 | 1,000 |
| «respaldar las bases antes de migrar» / «hacer copia de seguridad de la base antes de migrar» | vetar | 0,800 | 0,609 |
| «migrar de MySQL 8.2 a MariaDB» / «… 8.3 …» | vetar | 1,000 | 1,000 |
| «optimizar los índices lentos» / «… de las tablas lentas» | vetar | 0,864 | 0,700 |
| «firmar contratos PDO locales» / «escribir migradores de esquema» | **no** vetar | 0,708 | **0,490** |
| «respaldar antes de migrar» / «renovar los certificados TLS» | **no** vetar | 0,739 | **0,528** |
| «rotar los ficheros de log» / «ajustar los permisos de carpetas» | **no** vetar | 0,739 | **0,528** |
| «programar correos de aviso» / «optimizar los índices lentos» | **no** vetar | 0,739 | **0,528** |

Con umbral **0,60** la separación es limpia: lo que debe vetarse queda en ≥0,60 y lo que no, en ≤0,53.

## 2. El lote: declarar que varias propuestas van juntas

- `skill_propose` acepta `group: { id, motivo }` (opcional). Se guarda en `meta.json`.
- **Entre hermanas del mismo grupo no se veta**: el autor está diciendo que van juntas y por qué. Se **avisa**
  del parecido en el resultado, sin bloquear — y el aviso dice con qué hermana se parece.
- **Sin grupo, el veto sigue igual** (ahora midiendo tema, que es lo que faltaba).
- **La activación automática exige el grupo entero verificado**: un cambio que toca tres skills no se activa a
  medias por la vía automática. La **decisión humana** sí puede ir una a una (avisando qué queda del grupo):
  que un humano decida aprobar dos de tres es una decisión, no un accidente.
- **El diario** anota el grupo, y `history` responde «grupo X: 2 de 3 activadas».

## 3. La superficie: que el feedback no mienta con varias skills

- **La píldora cuenta skills, no eventos**: con ids distintos dice `N skills · última: <id>`; con uno solo
  repitiéndose, mantiene `×N` (que ahí sí significa lo que dice). El `title` lleva la lista completa.
- **Filas del menú**: además de una por pendiente, una **fila de grupo** para revisar/aprobar el conjunto.
- **CLI**: `check --grupo <id>`, `approve --grupo <id>`, `promote --grupo <id>` (cada skill pasa **su** puerta;
  el grupo no es un atajo, es un atajo **para mirarlas juntas**), `history --grupo <id>`.
- Los textos de decisión dicen cuántas quedan **del grupo**, no sólo del proyecto.

## 4. Fases, con su gate

| Fase | Qué se hace | Gate de salida |
|---|---|---|
| **1** | La huella de tema descuenta el estilo (frecuencia documental) y el umbral se fija en 0,60 | Los 8 pares etiquetados dan el veredicto esperado; los tres temas distintos de una sesión se proponen; los duplicados reales siguen vetándose; la biblioteca real no cambia de veredicto donde no debe |
| **2** | `group` en la propuesta, el `meta.json`, el anti-solapamiento y la promoción | Un lote de 3 se propone; las hermanas no se vetan y se avisa del parecido; la promoción automática no activa media parte; el humano sí puede ir una a una; queda en el diario |
| **3** | Superficie: píldora, filas del menú y CLI con `--grupo` | Con 3 skills distintas la píldora dice «3 skills»; con la misma dos veces dice «×2»; hay fila de grupo; `check/approve/promote/history --grupo` funcionan por el CLI real |
| **4** | Pruebas, hermetismo, docs, versión candidata y revisión de lo construido | Suite completa en verde, `test:hermetic` con huella idéntica, `doctor` verde, coherencia docs↔código↔versión, auditoría de lo construido con el informe pass/fail |

## 5. Reglas de ejecución

1. **No se relaja ningún rechazo sin medirlo**: el veto de duplicados reales no se afloja; lo que cambia es
   *qué* mide, y se demuestra con pares etiquetados que sigue vetando lo que debe.
2. **El almacén real no se toca**: todo se mide en cajas de arena; la huella antes y después tiene que ser la
   misma.
3. **Nada se activa solo**: `repair`/`promote` siguen con la promoción apagada por defecto; el lote no cambia
   quién firma.
4. **Ninguna función nueva sin su prueba roja antes del arreglo** (el defecto se demuestra primero).
5. **No hay commit ni push sin autorización expresa**; esta entrega se deja sin versionar.
6. **El fichero firmado no se reescribe**: si algo cambia, se registra en el informe, no en el plan.

## 6. Lo que este plan NO hace

- No convierte la herramienta en «proponer varias de golpe»: cada skill sigue siendo una propuesta con su
  puerta, su evidencia y su firma. El grupo dice que van juntas, no las mete en un sobre.
- No toca el almacén real ni repara ninguna de las 11 skills con error (sigue su propio acto).
- No cambia quién puede activar: la promoción automática sigue apagada y el nivel 3 sigue siendo humano.
