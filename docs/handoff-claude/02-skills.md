# 02 — Skills usadas y desde dónde se llaman

## Dónde viven y cómo se invocan

- **Ubicación:** `~/.claude/skills/<nombre>/SKILL.md` → son **globales (nivel
  usuario)**, NO viven en el repo. El colega **ya las instaló** en su
  `~/.claude/skills/`, así que aquí solo resta **verificarlas** (no copiarlas).
- **Invocación:** se escribe `/<nombre-skill>` en Claude Code, o el modelo las
  activa solo (tool `Skill`) cuando la tarea coincide con su `description`.
- **Estructura de cada skill:** `SKILL.md` (frontmatter `name` + `description`)
  y opcionalmente `scripts/`, `references/`, `assets/`.
- **Índice maestro:** `~/.claude/skills/INDEX.md`.

## Skills propias MAGIIS (núcleo del proyecto)

| Skill                      | Para qué se llama en este repo                                    |
| -------------------------- | ----------------------------------------------------------------- |
| `playwright-magiis`        | Escribir/debuggear/planear specs Playwright+TS, POM, fixtures, CI |
| `qa-magiis`                | QA funcional: test cases, bugs, entregables MAGIIS                |
| `magiis-branch-convention` | Nombrar ramas, decidir dónde commitear, convención de commits TC  |
| `magiis-ci-efficiency`     | Auditar/optimizar workflows CI (GitHub Actions), quality gates    |
| `skill-creator`            | Crear o actualizar skills nuevas                                  |

## Skills de soporte (externas, también activas)

| Skill                       | Origen            | Uso típico aquí                            |
| --------------------------- | ----------------- | ------------------------------------------ |
| `code-reviewer`             | wshobson/agents   | Review de seguridad/perf/calidad pre-merge |
| `typescript-advanced-types` | wshobson/agents   | Tipos avanzados en utils/fixtures TS       |
| `test-fixing`               | mhattingpete      | Reparar specs fallidos con agrupación      |
| `xlsx`                      | anthropics/skills | Generar/leer matrices QA en Excel          |

> El `INDEX.md` global lista más skills instaladas (webapp-testing-py,
> pict-test-designer, n8n-workflow-automation, test-driven-development,
> csv-data-summarizer, google-workspace-skills). No son centrales para este repo
> pero el colega las hereda si copia la carpeta `skills/` completa.

## Cómo se conectan con el repo

Las skills no se referencian dentro del código del repo: son contexto del
agente. La trazabilidad real vive en convenciones que las skills aplican:

- Commits con `[TC-ID]` → `magiis-branch-convention` + `commitlint.config.js`.
- Specs/POM bajo `tests/` → `playwright-magiis`.
- Workflows en `.github/workflows/*.yml` → `magiis-ci-efficiency`.
- Matrices QA en `docs/qa/**` → `qa-magiis` + `xlsx`.
