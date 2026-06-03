# 01 — Agentes empleados

## Estado real en este proyecto

**No hay agentes custom implementados.** Verificado en:

- `.claude/agents/` (repo) → **vacío**.
- `~/.claude/agents/` (global) → solo `INDEX.md` + un directorio vacío
  `playwright-excel-architect/` (sin archivo de definición).

Por lo tanto, hoy el trabajo agéntico se hace con los **agentes built-in** de
Claude Code, invocados con el tool `Agent` (Task), no con agentes propios.

## Agentes built-in que sí se usan

| Agente            | Para qué                                                    |
| ----------------- | ----------------------------------------------------------- |
| `Explore`         | Búsqueda read-only amplia (barridos por múltiples archivos) |
| `Plan`            | Diseño de plan de implementación antes de tocar código      |
| `code-reviewer`   | Review de calidad/seguridad antes de merge                  |
| `general-purpose` | Tareas multi-paso y búsquedas no triviales                  |

> El colega los obtiene automáticamente con Claude Code; no hay que instalar nada.

## Agentes planificados (NO implementados aún)

Listados en `~/.claude/agents/INDEX.md` como futuro:

| Nombre            | Estado      | Descripción                                       |
| ----------------- | ----------- | ------------------------------------------------- |
| qa-reporter       | Planificado | Reporte de ejecución QA desde logs/Jira           |
| regression-runner | Planificado | Ejecuta suite de regresión y consolida resultados |

Si en el futuro se crean, irán en `~/.claude/agents/<nombre>/` (global) o en
`.claude/agents/` (por repo, para que viajen con el proyecto).

## Criterio agente vs skill

| Situación                                          | Usar  |
| -------------------------------------------------- | ----- |
| Procedimiento con pasos fijos y recursos estáticos | Skill |
| Tarea con decisiones autónomas iterativas          | Agent |
| Investigación larga con múltiples herramientas     | Agent |
| Plantilla o flujo de documentación                 | Skill |
