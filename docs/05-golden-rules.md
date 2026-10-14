# Reglas de oro

No negociables. Cada una nació de un defecto real o de una decisión que costó tomar; cuando alguna se
rompió, se notó.

## Datos

1. **Los datos del usuario no se tocan sin su OK explícito.** Copias, borrados, restauración, publicación y
   cualquier cambio en la biblioteca compartida (`~/.dsh/`) se confirman antes, se hacen con respaldo y se
   verifican después.
2. **Copiar antes de mover.** Una operación destructiva sobre un almacén se apoya en una copia con hash y
   con los conteos comparados contra el origen.
3. **El ámbito es sagrado.** Una skill aprendida en un proyecto no se carga en otro. Si algo aparece donde
   no le corresponde, es un defecto, no una comodidad.

## Código

4. **Nada se activa solo.** Lo que el modelo lee se propone y espera aprobación humana; aprobar nunca es una
   herramienta del modelo.
5. **Robusto y definitivo, no parche.** Se arregla la clase de defecto, no el caso. Lo provisional se declara
   como provisional.
6. **Una regla, una implementación.** Si una validación vive en dos sitios, el segundo se olvida. La puerta
   se comparte; las superficies sólo la invocan.
7. **Un fallo se dice con el motivo.** Nada de planes B silenciosos: si no se pudo hacer, se explica y se
   ofrece la vía alternativa. Un adorno nunca puede estropear el trabajo principal.
8. **Un defecto que aparece se convierte en contrato probado.** La prueba se demuestra **roja** antes del
   arreglo: si no se vio fallar, no se sabe qué arregló.
9. **La interfaz no miente.** Un resultado que quedó atrás de una decisión se marca; el texto de un
   resultado es un registro y no se reescribe.
10. **Un solo estado vivo por dato.** El estado de la sesión se pliega del log; el de la interfaz, del
    almacén del navegador **persistente** (nunca de sesión, que muere con la pestaña).

16. **Toda acción que cambia un estado lo dice, se ve y ofrece la vuelta.** Mutar sin avisar deja al agente
    y a la interfaz con la versión vieja delante: una skill apagada que el modelo sigue teniendo en su
    catálogo es peor que un error, porque parece que funcionó. Cada acción tiene que (1) **avisar** a quien
    sirve el dato de que cambió, (2) **reflejar** el estado nuevo donde el humano mira, y (3) ofrecer el
    **gesto inverso** en el mismo mensaje. Y una acción que no movió nada no avisa: si el aviso se da
    siempre, deja de significar algo.

## Proceso

11. **Medir antes de afirmar.** Un número medido antes que un adjetivo; lo no verificado se declara no
    verificado, con el motivo.
12. **Las pruebas no tocan nada real**, y la suite hermética lo demuestra midiendo la huella del almacén.
13. **Un commit = una cosa**, con lo que lo demuestra en el mensaje. El push se declara.
14. **No se ensucia lo ajeno**: ni el repositorio del proyecto, ni la biblioteca global con cosas que son de
    un proyecto, ni el home del harness con artefactos de prueba.
15. **El trabajo se deja reapuntable.** Lo que depende de algo que aún no existe queda documentado y con el
    enganche preparado, para no rehacerlo después.
