# Handoff Claude Code — magiis-carrier-v2-e2e

Paquete para que un colega replique el entorno agéntico (Claude Code) usado en
este proyecto. Aplica a quien trabaja con **VS Code + extensión Claude Code**.

> El proyecto es un framework **Playwright + TypeScript** para automatizar el
> frontend de la migración del portal **carrier** MAGIIS (Angular 8 → Angular 18).

## Contenido

| Archivo                                  | Qué cubre                                             |
| ---------------------------------------- | ----------------------------------------------------- |
| [01-agentes.md](01-agentes.md)           | Agentes empleados (estado real) y built-in usados     |
| [02-skills.md](02-skills.md)             | Skills usadas, qué hacen y desde dónde se llaman      |
| [03-mcp-y-config.md](03-mcp-y-config.md) | MCP servers, plugins, settings y variables de entorno |
| [04-setup-prompt.md](04-setup-prompt.md) | Prompt listo para pegar en Claude Code (VS Code)      |

## Orden de lectura sugerido

1. `03-mcp-y-config.md` → entender qué hay que instalar/configurar.
2. `02-skills.md` → copiar las skills a `~/.claude/skills/`.
3. `01-agentes.md` → saber qué agentes existen (y cuáles aún no).
4. `04-setup-prompt.md` → pegar el prompt en Claude Code y dejar que verifique el setup.

## ⚠️ Seguridad

- **No** se incluye ningún `.env*` ni `.mcp.json.bak` en este paquete: contienen
  secretos. Los tokens se inyectan por variables de entorno (ver `03-mcp-y-config.md`).
- Cada quien usa **sus propios** tokens (GitLab/GitHub PAT). No compartirlos.
