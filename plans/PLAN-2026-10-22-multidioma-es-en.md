# Plan · plugin en inglés canónico, con opción de idioma ES/EN (v4.0.0)

**Estado: revisión 3 — incorpora la revisión independiente del 2026-10-22.** Aprobado el rumbo; F0 en curso.

Auditoría: [`docs/AUDITORIA-2026-10-22-multidioma.md`](../docs/AUDITORIA-2026-10-22-multidioma.md).

---

## 0 · Verificación externa previa (obligatoria, hecha)

| Comprobación | Resultado |
|---|---|
| `git fetch origin --prune` | sin novedades |
| `HEAD` / `origin/main` / `main` | **`8f6b25c`** los tres; 0 ficheros sin commitear |
| README remoto vs local | mismo contenido: hash **LF** `b0e82562…` en los tres (remoto, índice git y copia de trabajo sin CR) |
| Plan remoto | `200` |

La vista de GitHub que mostraba «v1.8.0 / 276 pruebas» es **caché de la página renderizada**, no divergencia:
el blob servido por `raw.githubusercontent.com` en `main` ya dice `v3.9.3 · 614 pruebas` y coincide byte a byte
(tras normalizar CRLF, que es lo que fija `.gitattributes`).

---

## 1 · Decisión

**Inglés canónico, español opcional.** Una sola lengua para lo que es contrato —nombres de comando, flags,
códigos, valores persistidos— y dos para lo que lee una persona, elegida con `/skill-compiler --language es|en`.

| Capa | Idioma | ¿Se traduce? |
|---|---|---|
| Nombres de comando, flags, códigos, ids, rutas, `meta.json`, frontmatter | **inglés** | no: contrato |
| Textos de comandos, CLI, errores, panel | inglés por defecto; español si se pide | sí |
| Descripciones de herramientas y protocolo (S-5, lo que lee el modelo) | **inglés fijo** | no: una sola versión |
| `decision` del diario (`aprobada`, `publicada`…) | **español, congelado** | no: evidencia; etiqueta traducida al mostrar |
| Cuerpos de las `SKILL.md` | el que escriba la persona | no |
| Documentación | español; README en inglés + `README.es.md` (F4) | aparte |

### Corrección 1 · S-5 resuelta, sin contradicción

La auditoría dice la verdad: `lib/definitions.mjs` está **en español** (51 descripciones + protocolo). El plan
anterior decía «ya están en inglés» y era falso. **S-5 entra en el alcance**: se normaliza a **inglés fijo**, una
sola versión, sin alternar por preferencia. Se acompaña de una revisión **semántica por herramienta** (mismos
nombres, argumentos, permisos, límites, confirmación humana, auditoría y manejo de errores) con una prueba que
fija la forma del esquema: si cambia un nombre de herramienta o un parámetro, la prueba falla.

---

## 2 · Precedencia del idioma (determinista, sin adivinar)

```
DSH_LANG (override de pruebas/automatización)
  → preferencia persistida en $DSH_HOME/skill-compiler/config.json
    → en
```

**No se detecta el locale del sistema en esta versión.** El diagnóstico lo desaconseja: en Windows suele ser
`en-US` aunque el operador trabaje en español, y sería una elección implícita disfrazada. Si algún día se quiere
autodetección, será un modo explícito (*opt-in*), no una fuente silenciosa.

- Normalización aceptada: `es`, `es-ES`, `es_419`, `ES` → `es`; `en`, `en-US`, `en_GB` → `en`.
- **Opción explícita inválida** (`--language fr`): error claro, **sin escribir** configuración.
- **Variable de entorno inválida**: cae a `en` y `doctor` da **un** diagnóstico con el valor recibido.

---

## 3 · Un ajuste, dos superficies

- **Harness:** comando `skill-compiler` con entrada `--language es|en`; sin argumento, estado. **Se verifica en
  el registro real del host** que acepta esa entrada (prueba con el registro de comandos, no con una suposición):
  los comandos `/` no son un shell.
- **CLI:** `node bin/skill-compiler.mjs lang [es|en]`. Sin argumento informa.
- Ambas muestran: **idioma efectivo**, **fuente** (`env` / `config` / `default`), ámbito y resumen (pendientes).
- La escritura de `config.json` es **atómica** (`.tmp` + `rename`) y **preserva claves desconocidas**: nunca se
  reescribe el fichero con sólo `{lang}`.
- **El panel recibe la preferencia** por la misma resolución; si el cambio no puede aplicarse a la vista abierta,
  se dice («recarga para verlo») en vez de prometer inmediatez.

---

## 4 · Contrato de resultados

`{kind, text, code, params}`; `kind` conserva su significado actual.

- `code` sale de **`lib/i18n/codes.mjs`**, fuente única, igual en ES/EN, con parámetros **documentados y tipados**
  (`id`, `key`, `warnings[]`, `done[]`, `failed[]`…). `params` nunca lleva secretos ni cuerpos de mensaje.
- Cubre **preguntas** (`scope-ask`, `language-ask`), **confirmaciones**, **avisos** (`with-warnings`),
  **fallo parcial** (`batch-partial`), **errores** (`no-proposal`, `unsafe-id`, `no-scope`, `id-conflict`) y
  éxito (`activated`, `already-active`, `published`, `set-aside`, `enabled`, `disabled`, `retired`, `rejected`,
  `updated-disabled`).
- **Si llega un `code` reconocido, el panel no analiza `text`, nunca.**
- **`code` desconocido**: fallo **seguro y visible**; no se activa el parser legacy ni se declara éxito.
- **Ventana legacy**: sin `code` (host o plugin anterior) el parser de prosa sigue funcionando **hasta la 4.1.0**;
  se retira en 4.2.0. La deuda queda escrita en `docs/ANFITRION.md` con la versión exacta.
- **Alias**: comparten **el mismo handler** y el mismo contrato; se declaran con metadatos explícitos
  (`aliasOf`, `deprecatedIn`) y se ocultan del menú por esos metadatos, no por el prefijo del texto.

---

## 5 · Catálogos

- Paridad **bidireccional** de claves ES/EN; mismos nombres y forma de *placeholders*.
- Pruebas de plurales, interpolación, salida multilínea, Unicode, parámetros ausentes y parámetros de más.
- Falta una traducción → se usa el **inglés**; **nunca** la clave cruda. La paridad **falla en CI** y `doctor`
  informa del catálogo incompleto: la reserva protege producción, no sustituye a traducir.
- Se corrige `bulk_ids_hint` (está en el bloque inglés con texto español) y se añade una prueba que detecta
  **texto español en el catálogo inglés** y viceversa (heurística de palabras funcionales, con lista blanca).

---

## 6 · Puerta anti-regresión

`tools/i18n-gate.mjs` no busca acentos: identifica **salidas humanas** en los puntos de salida conocidos
(resultado de comando, salida de CLI, mensaje de error, texto de panel) y exige `t(key, params)` o el contrato
localizado. Excepciones explícitas y declaradas: ids, rutas, ejemplos, claves de datos y contenido del usuario.
Con **pruebas negativas** (un mensaje humano hardcodeado hace fallar la puerta) y **positivas** (un literal de
máquina permitido no la hace fallar).

---

## 7 · Datos históricos

- Los valores de `decision` se **congelan**; no se recalculan ni se reencadenan. Mapa de etiquetas ES/EN
  **separado** de los valores persistidos.
- `security` valida **exactamente la misma cadena** antes y después de la versión: se comprueba con la huella de
  los diarios reales antes de tocar nada y al cerrar la fase.

---

## 8 · Reversión real

- `DSH_LANG=es` restablece **presentación**; no revierte código ni contrato.
- Rollback de código: `git revert <commit de la fase>`, sin `reset --hard` y sin reescribir historia.
- `config.json` se puede borrar o restaurar sin afectar a las skills.
- Cada fase termina en **un commit** cuando la gobernanza lo permita y las pruebas pasen.

---

## 9 · Fases

| Fase | Contenido | Cierre |
|---|---|---|
| **F0** | `lib/i18n/` (resolución determinista, `config.json` aditivo y atómico, catálogo de códigos), `lang` en CLI, `doctor` con idioma y fuente, pruebas de resolución. **Sin cambiar salidas.** | suite verde; `audit`/`security`/`doctor` idénticos; ningún texto visible distinto |
| **F1** | Comandos ingleses + alias con metadatos; textos de servidor y CLI al catálogo; `code`/`params` en **todas** las salidas; **S-5 al inglés fijo** con revisión semántica por herramienta | misma decisión y mismo efecto en ES/EN; 32 asserts de prosa a código; esquema de herramientas fijado por prueba |
| **F2** | Panel: preferencia única, `code`+`params`, paridad, `bulk_ids_hint`; casos pregunta / éxito / aviso / fallo parcial / cancelar / error | cero claves crudas; en host inglés no aparece español |
| **F3** | `tools/i18n-gate.mjs` (sinks humanos), contratos de `codes.mjs`, paridad de catálogo y *placeholders*, alias, diario inmutable; hermética | gate verde y **demostrado en rojo**; `security` con la misma cadena |
| **F4** | README (EN + `README.es.md`), CHANGELOG 4.0.0, OPERACION, ANFITRION; gates completos; `npm pack --dry-run` | sólo entonces `v4.0.0` |

---

## 10 · Criterios de aceptación

1. Ajuste ejecutable desde Harness y CLI, con idioma efectivo y fuente.
2. `en` por defecto incluso con sistema en español; `es` completo al elegirlo.
3. Misma operación en ambos idiomas → mismos `code` y **mismos efectos persistidos**; sólo cambia el texto.
4. Cero claves crudas; paridad de catálogos y *placeholders*.
5. El panel no deduce resultados de prosa si llega `code`; la ventana legacy está probada y fechada.
6. Alias funcionan sin duplicar filas; ids, rutas, diario y almacenes no cambian.
7. S-5 en inglés fijo, con la forma de las herramientas fijada por prueba.
8. Suite original + nuevas y hermética verdes; `audit`, `security`, `doctor`, empaquetado y remoto/local.
9. Nada de `projects/`, `global/`, diarios ni contenido de skills como efecto secundario.
10. Ningún release «estable» con un gate parcial o con una prueba sustituida por una inferencia.

---

## 11 · Lo que no hace

No traduce `SKILL.md`, ni la documentación (salvo README), ni los cuerpos del usuario; no renombra ids, estados
del diario, rutas ni campos de `meta.json`; no añade un tercer idioma.
