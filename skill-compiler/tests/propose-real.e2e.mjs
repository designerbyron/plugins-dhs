// Propuesta real de extremo a extremo: el conocimiento de autoría de skills que aprendimos hoy,
// contra la biblioteca curada REAL. No aprueba nada: eso es del humano.
import * as compiler from '../lib/compiler.mjs';

const body = `## When to Use

Antes de crear, editar o importar cualquier skill de la biblioteca de DSH, y cuando una skill
"sencilla" no aparece en el catálogo del modelo.

## Dónde vive cada cosa

| Raíz | Rango | Qué es |
|---|---|---|
| \`<proyecto>/.dsh/skills\` | 100 | Skills del repositorio. Van versionadas con él. |
| \`<proyecto>/.agents/skills\` | 200 | Raíz compartida entre agentes. |
| \`customSkillDirs\` | 300 | Raíces extra declaradas en la configuración. |
| \`$DSH_HOME/skills\` | 400 | **La biblioteca de usuario**: todos los workspaces. Salta su hijo \`.system\`. |
| \`$DSH_HOME/.agents/skills\` | 500 | Raíz compartida de usuario. |

La raíz de proyecto es el ancestro más cercano con \`.git\`. La **profundidad de descubrimiento es uno**:
solo \`<raíz>/<nombre>/SKILL.md\` o \`<raíz>/<nombre>.md\`. Un \`SKILL.md\` anidado en un subdirectorio **no
se descubre, y no avisa**: es el error más silencioso de esta biblioteca.

## Contrato del frontmatter

Obligatorias: \`name\` (kebab-case) y \`description\` (una línea: es lo que el modelo lee para elegir).
Opcionales y reconocidas: \`whenToUse\`, \`metadata\`, \`disable-model-invocation\`, \`user-invocable\`.

- Claves desconocidas (como \`version\`, \`author\` o \`metadata.hermes\`) **se toleran**: por eso la
  sincronización desde Hermes es una copia y no una traducción.
- Las dos claves de invocación son **estrictas**: una grafía no admitida o un valor no booleano
  **descartan la skill entera con un aviso**, y el catálogo del modelo no lo dice. Un \`SKILL.md\` que
  "no aparece" casi siempre es esto, no un problema de ruta.
- \`disable-model-invocation: true\` la saca del catálogo del modelo y la deja para el humano. Es el
  mecanismo para silenciar un duplicado sin borrarlo.

## La regla que evita el solapamiento

**Un tema = un skill que el modelo puede elegir.** Antes de crear uno nuevo:

1. Ejecuta el guardián: \`node "$DSH_HOME/skills/.system/check-skill-overlaps.mjs" --verbose\`.
2. Si tu tema cae en un clúster ya declarado, **mejora el canónico** en vez de añadir otro miembro.
3. Si es un clúster nuevo, decláralo en \`canonical.json\` (canónico, miembros, motivo) y vuelve a pasar
   el guardián: debe salir 0. Un clúster sin declarar es un fallo, no un aviso.

El silenciado de los no canónicos lo aplica la herramienta de importación, no la mano: una edición
manual se pierde en la siguiente sincronización y el catálogo vuelve a tener cinco entradas casi
idénticas sin que nadie recuerde por qué.

## Sincronizado no es lo mismo que nativo

Una skill importada de Hermes y una skill migrada se comportan distinto:

- **Sincronizada**: Hermes es su maestro. Las correcciones de ruta se declaran como reglas de
  adaptación en \`sync-hermes-skills.mjs\`; editarla a mano produce \`DEST-DRIFT\`.
- **Nativa** (en \`native.json\`): DSH es su maestro. Cambió su *procedimiento*, no su ruta. El
  importador no la toca.

Regla para decidir: **procedimiento → nativa; ruta → regla de adaptación.**

## Verificación antes de dar una skill por buena

\`\`\`sh
node "$DSH_HOME/skills/.system/check-skill-overlaps.mjs"        # exit 0 = sin solapes sin declarar
node "$DSH_HOME/skills/.system/tests/recovery-recipe.test.mjs"  # si la skill documenta una receta
\`\`\`

Una skill es un **procedimiento**, no un titular: si no dice qué hacer, en qué orden y qué trampas ya
están pagadas, no ahorra trabajo a nadie.

## Pitfalls

- Un \`SKILL.md\` anidado no se descubre y no avisa. Comprueba la profundidad, no la ruta entera.
- Una clave de invocación mal escrita descarta la skill en silencio.
- Los scripts de una skill importan la librería compartida de forma **relativa**
  (\`../../.system/lib/...\`): un import dinámico de una ruta absoluta de Windows necesita \`file://\`.
- Duplicar el mismo procedimiento en dos skills garantiza que se separen: una se arregla y la otra no.
- \`\`~/.dsh/skills/.system\`\` no se escanea: es el sitio para herramientas, no para skills.`;

const result = compiler.propose({
  id: 'dsh-skill-library-authoring',
  description: 'Author, scope and de-duplicate skills in the DSH library without breaking discovery.',
  whenToUse: 'Antes de crear, editar o importar una skill de DSH, o cuando una skill no aparece en el catálogo.',
  tags: ['skills', 'authoring', 'library', 'frontmatter', 'canonical'],
  evidence: ['docs/README.md'],
  body,
}, { cwd: process.cwd(), project: 'saas-corporative' });

console.log(JSON.stringify(result, null, 2));
