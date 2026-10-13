# Reglas de gobierno

El contrato de la casa para esta colección de plugins. Vinculante para humanos y agentes: si algo aquí
contradice lo que alguien (o algún modelo) propone, gana este fichero.

## 1. Los datos no viven en el repositorio

Un plugin **no escribe su estado dentro de un proyecto del usuario**. Lo aprendido, lo propuesto y lo
aprobado viven fuera del repositorio, bajo `$DSH_HOME`, con el ámbito del proyecto al que pertenecen:

```
$DSH_HOME/skill-compiler/projects/<clave-de-proyecto>/{proposed,approved,rejected,superseded}/
```

El ámbito sale **siempre del `cwd` de la sesión**, nunca de algo que declare el modelo. Así una skill
aprendida en un proyecto no se carga en otro, y el repositorio del usuario queda limpio: sólo se versiona
el código, no lo que el agente aprendió mientras trabajaba.

## 2. Lo que decide algo, se prueba

| Dónde vive | Qué es | Pruebas |
|---|---|---|
| `lib/` | Las reglas: validación, ámbito, escritura, composición, contratos | **Sí**, `node --test`, Node puro |
| `index.js` | El adaptador Cordis: elige puntos de extensión y registra | **No** (no se puede importar fuera del harness) → por eso es lo más fino posible |
| `client.js` | La pieza de interfaz de navegador | **Forma**, no dibujo: contratos de slot, accesibilidad, ausencia de emoji, estilos en el árbol |
| `bin/` | La CLI humana | Contra la misma implementación que los comandos |

Una regla, una implementación: si la puerta de validación vive en `lib/compiler.mjs`, la CLI, los comandos
del harness y la página de revisión la usan **desde ahí**. Cuando una regla se duplica, la segunda copia
es la que se olvida.

## 3. Las pruebas no tocan nada real

Toda prueba corre contra raíces temporales y `DSH_HOME` redirigido a una caja de arena. La suite hermética
(`npm run test:hermetic`) mide la huella del almacén real **antes y después**: si cambió, la prueba falla.
Es una guarda estructural, no una limpieza: el error que ya se cometió una vez —escribir fixtures en el
store real— no puede repetirse por descuido.

## 4. Nada se activa solo

Lo que un plugin produce para que lo lea el modelo se **propone** y espera aprobación humana. Aprobar no es
una herramienta del modelo: si lo fuera, podría auto-aprobarse y la revisión sería decorativa. Por eso
aprobar vive en `bin/` y en comandos del compositor —superficie humana—, y por eso la puerta de validación
se aplica igual con modo automático: se delega la confirmación, nunca la puerta.

## 5. Robustas y definitivas, no parches

Un arreglo que hace pasar el caso concreto y deja la clase de defecto abierta se rechaza. Cuando aparece un
fallo, la pregunta es qué **clase** de fallo es y dónde se cierra: un contrato que no se valida, un estado
que se puede corromper, una regla que vive en dos sitios. Si algo es provisional, se declara y se dice
cuándo se retira.

## 6. Evidencia antes que adjetivos

- Un número medido vale más que un adjetivo; si no hay medición, se dice que no la hay.
- "Terminado" va acompañado de lo que lo demuestra: pruebas en verde, una medición, el artefacto leído de
  vuelta. Un plan no es un resultado.
- Lo que no se ha podido verificar se declara como no verificado, con el motivo. Un límite escondido es
  peor que un límite escrito.

## 7. Commits y publicación

Un commit = una cosa. El mensaje dice qué cambió y qué lo demuestra. El push se decide y se declara; nunca
`git add -A`. Los ficheros generados por pruebas no se commitean: si aparecen en `git status`, o el
`.gitignore` está mal o la prueba escribió donde no debía.
