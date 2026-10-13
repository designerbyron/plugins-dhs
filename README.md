# LifeCode Plugins — plugins de DeepSeek Harness

![Póster de LifeCode Skill-Compiler: la letra L dibujada como una cinta blanca, azul y magenta dentro de un anillo neón, sobre fondo azul oscuro, con el nombre LifeCode y el subtítulo Skill-Compiler for DeepSeek Harness](assets/poster.png)

Colección de plugins propios para DeepSeek Harness, bajo la familia de producto **LifeCode**. Cada plugin
vive en su propia carpeta, con su código, sus pruebas y su documentación, y **se instala por ruta
absoluta** con el gestor de plugins del harness.

> **Marca y titularidad.** *LifeCode* es la familia de producto; el titular del copyright de este
> repositorio es `designerbyron` (ver [`LICENSE`](LICENSE)). Una marca no sustituye a un titular: si algún
> día la familia cambia de manos, la licencia sigue diciendo de quién es el código.

| Plugin | Qué hace | Estado |
|---|---|---|
| [`LifeCode Skill-Compiler`](skill-compiler/README.md) | Aprendizaje progresivo: convierte el conocimiento reutilizable de una tarea en una **skill propuesta**, con ámbito de proyecto; y vendoriza skills de repositorios ajenos como **nuestra versión**, con procedencia. Se decide **dentro** de la sesión: comandos, una fila por pendiente en el menú `/` y tarjetas de resultado que se pueden **cerrar**. Con feedback visual en la interfaz: engranaje mientras analiza, y aviso de skill **nueva** o **actualizada**. | En uso · v1.4.0 · 217 pruebas en verde |

## Por qué está en `htdocs`

Decisión del operador: llevar estos plugins bajo control de versiones en un repositorio propio, junto al
resto de su trabajo. Como `C:\xampp\htdocs` es el docroot de Apache, la carpeta lleva un `.htaccess` que
**deniega todo**:

```apache
Require all denied
```

Ese fichero protege dos cosas que no deberían servirse nunca por HTTP: el código en sí y, sobre todo, el
directorio `.git/` (un `.git/config` accesible es una fuga clásica). `httpd.conf` tiene
`AllowOverride All` para `htdocs`, así que la regla se aplica de verdad; aun así, **la carpeta no debe
publicarse**: si algún día se quiere servir algo desde aquí, ese `.htaccess` es lo primero que hay que
revisar, y la decisión merece su propio acto.

## Instalar un plugin de este repositorio

El gestor de plugins de DSH no lee repositorios: instala un **bundle** por ruta o por dirección git.

### En este equipo (recomendado)

1. **Instala las dependencias del plugin**, que van declaradas en su manifiesto:

   ```sh
   cd C:\xampp\htdocs\plugins-dhs\skill-compiler
   npm install
   node bin/skill-compiler.mjs doctor   # dice si algo falta, y con qué comando se arregla
   ```

   Este paso es obligatorio y no es un detalle: el plugin importa paquetes del harness, y al instalarse
   por ruta el perfil **enlaza** esta carpeta, así que el plugin carga sus dependencias **de aquí**. Sin
   `npm install`, el bundle se instala y después falla al activarse con `failed to import`. El porqué
   completo, en [`skill-compiler/docs/DEPENDENCIAS.md`](skill-compiler/docs/DEPENDENCIAS.md).

2. Abre la página **Plugins** de la barra lateral y pulsa **Add plugin**.
3. En el diálogo, pega la ruta absoluta de la carpeta del plugin:

   ```
   C:\xampp\htdocs\plugins-dhs\skill-compiler
   ```

4. Cuando diga **Installed**, pulsa **Enable now**. Si el resultado pide reiniciar, reinicia el harness.
5. **Recarga la página** para que el navegador cargue la pieza de interfaz del plugin.

### En otra máquina

1. Clona el repositorio donde quieras, entra en la carpeta del plugin y ejecuta **`npm install`** —sin
   ese paso el bundle se instala y falla al activarse, porque sus dependencias del harness no están.
2. **Desde ese clon** instala por ruta absoluta (o por la dirección git del repositorio, si el gestor la
   acepta).
3. Si el plugin referencia rutas de este equipo (el caso de `skill-compiler` con su CLI), exporta la
   variable que corresponda: cada plugin la documenta en su README.

### Desinstalar

Desde la misma página **Plugins**: deselecciona el bundle. El plugin no escribe nada fuera de
`$DSH_HOME/<nombre-del-plugin>/` (sus datos), así que desinstalarlo no deja restos en el perfil más allá
de la dependencia, que el gestor retira.

## Trabajar en un plugin

```sh
cd skill-compiler
npm test              # las pruebas automáticas
npm run test:hermetic # las pruebas + huella del almacén real antes y después
```

Reglas de la casa, que valen para cualquier plugin de esta colección:

1. **Núcleo puro, adaptador fino.** Lo que decide algo vive en `lib/`, sin dependencias del harness, y
   se prueba con `node --test`. Lo que se registra en el harness (`index.js`) es lo más corto posible,
   porque es la única parte que no se puede probar antes de instalar.
2. **Las pruebas no tocan nada real.** Cada plugin con estado en disco debe redirigir su raíz a una caja
   de arena, y tener una puerta que **mida** que el almacén real no cambió.
3. **Nada se activa solo.** Si un plugin produce algo que el modelo va a leer, lo propone y espera
   aprobación humana.
4. **Un commit = una cosa**, y el push se decide y se declara. Nunca `git add -A`.

## Licencia

[MIT](LICENSE) — uso, modificación, redistribución y uso comercial libres, conservando el aviso de
copyright. Texto estándar, sin añadidos: una licencia con cláusulas propias deja de ser estándar, y
GitHub y las herramientas de cumplimiento dejan de reconocerla.

### Atribución: una petición, no una condición

Si este código te sirve, **te pedimos** que referencies el repositorio original:

```
https://github.com/designerbyron/plugins-dhs
```

Y decimos «petición» con precisión: MIT **no** obliga a ello, y por eso esta línea vive aquí y no en el
`LICENSE`. Lo que sí obliga MIT es a conservar el aviso de copyright al redistribuir. Si algún día
quieres que la referencia sea **exigible**, la vía estándar no es añadir una cláusula a MIT —eso la saca
del estándar— sino cambiar a Apache-2.0 con un fichero `NOTICE`, que sí obliga a conservarlo y a declarar
los cambios.

Es la misma regla que aplica el propio plugin con las skills que vendoriza: guarda de dónde vinieron, con
su hash y su fecha, para que nadie tenga que creerse nada de memoria.

## Estado del repositorio

- Rama `main`. El remoto se configura con `git remote add origin <url>` (ver más abajo).
- Licencia **MIT** (ver arriba), con la referencia al repositorio como petición destacada.
- Identidad de autor configurada **solo en este repositorio** (`git config user.name/user.email`), no en
  el global de la máquina: así no condiciona otros proyectos.
- **Publicado** en `https://github.com/designerbyron/plugins-dhs` (rama `main`), con el remoto y el local
  sincronizados. El push sigue siendo un acto declarado: un commit se decide, y el envío se dice.

## Publicar en GitHub

El remoto ya está configurado en este clon. Para el primer envío:

```sh
cd C:\xampp\htdocs\plugins-dhs
git remote -v                 # comprobar a dónde apunta
git push -u origin main       # el primer envío; después basta `git push`
```

Si el repositorio se llama distinto de `plugins-dhs`, corrige el remoto antes:

```sh
git remote set-url origin https://github.com/designerbyron/<nombre>.git
```

**El push no se ha ejecutado.** Es una decisión del operador, como manda la gobernanza de este puesto.
