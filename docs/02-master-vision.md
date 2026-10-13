# Visión

## Qué es esto

**LifeCode Plugins** es la colección de plugins propios para **DeepSeek Harness**. No es un producto
suelto: es la forma de que el harness aprenda cómo se trabaja aquí, sin depender de que nadie lo recuerde
en la sesión siguiente.

## El problema que resuelve

Un agente que trabaja bien una tarea compleja se lleva su aprendizaje en el historial de esa sesión. Al día
siguiente, ese conocimiento no está: se repite el error, se vuelve a descubrir la trampa, se pierde el
procedimiento que costó media tarde. La alternativa habitual —volcar todo en instrucciones permanentes— es
peor: el prompt se llena de cosas que sólo aplican a un proyecto y a un momento.

La respuesta es el **aprendizaje progresivo**: el conocimiento se destila al cerrar la tarea, se guarda
**con el ámbito del proyecto donde se aprendió**, y espera a que un humano lo apruebe. Ni se pierde ni se
mezcla.

## El norte

1. **Cada proyecto aprende lo suyo, y nada más.** Una skill aprendida en un proyecto no se carga en otro; el
   ámbito lo decide el directorio de trabajo, no el modelo.
2. **El repositorio del usuario no se ensucia.** Lo aprendido vive fuera, en `$DSH_HOME`, referenciado a su
   origen. En el repositorio sólo hay código.
3. **La decisión es humana.** El modelo propone; aprobar es un acto de la persona, con la evidencia delante
   (qué es, qué toca, qué avisa la puerta).
4. **Lo aprobado se usa de inmediato.** Sin reiniciar nada y sin pasos manuales: si aprobar exigiera
   reiniciar, el flujo no existiría.
5. **La interfaz no miente.** Un resultado que quedó atrás de una decisión se marca; si algo no se pudo
   hacer, se dice con el motivo.

## Qué entra y qué no

**Entra** lo que reduce trabajo repetido en un proyecto concreto: trampas medidas del entorno, procedimientos
que ya se validaron, el estado real de un despliegue. **No entra** lo obvio, lo que ya está en las
instrucciones del proyecto, ni la narración de una sesión.

## Cómo se mide el éxito

- Una skill aprendida se reutiliza en una tarea posterior del mismo proyecto (y no aparece en otros).
- Aprobar sirve sin salir de la sesión y sin reiniciar.
- Cero residuo: ni el repositorio del proyecto ni la biblioteca compartida acaban con cosas que no son suyas.
- Los defectos que aparecen se convierten en contratos probados, no en notas de "ojo con esto".
