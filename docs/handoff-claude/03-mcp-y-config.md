# 03 — MCP, plugins y configuración

## MCP servers (definidos en `.mcp.json` del repo)

| Server   | Comando                                      | Token (env var)                |
| -------- | -------------------------------------------- | ------------------------------ |
| `gitlab` | `npx -y @modelcontextprotocol/server-gitlab` | `GITLAB_PERSONAL_ACCESS_TOKEN` |
| `github` | `npx -y @modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` |

- `.claude/settings.json` (versionado) tiene `enableAllProjectMcpServers: true` y
  habilita `gitlab` + `github` en `enabledMcpjsonServers`.
- **`.mcp.json` NO se versiona** (regla de secretos). El repo trae
  **`.mcp.json.example`**: copialo a `.mcp.json` en tu raíz local:
  `Copy-Item .mcp.json.example .mcp.json` (PowerShell). Los tokens van por env vars,
  no dentro del archivo.
- **Playwright MCP** está como devDependency (`@playwright/mcp`). Si el firewall
  corporativo bloquea el registry, levantarlo con:
  `node ./node_modules/@playwright/mcp/cli.js`.

> ⚠️ Los tokens **no** se ponen en `.mcp.json` (usa `${...}`). Cada quien exporta
> sus propios PAT como variables de entorno. **Nunca** commitear tokens reales.

## Plugins / marketplaces (en `.claude/settings.json`)

- `prompt-improver@severity1-marketplace` → **activo**.
- `caveman@caveman` → desactivado.
- Marketplaces: `severity1/severity1-marketplace`, `JuliusBrussee/caveman`.

## Settings relevantes

```jsonc
{
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": ["gitlab"],
  "autoUpdatesChannel": "latest",
  "theme": "auto",
  "effortLevel": "max"
}
```

## Variables de entorno del proyecto

El repo usa archivos `.env*` por ambiente (`.env.test`, `.env.uat`, `.env.prod`).
**No** se comparten: el colega parte de `.env.example` y completa sus credenciales.

```bash
# tokens para MCP (ejemplo, usar los propios)
export GITLAB_PERSONAL_ACCESS_TOKEN="glpat-xxxxxxxx"
export GITHUB_PERSONAL_ACCESS_TOKEN="github_pat_xxxxxxxx"
```

En Windows/PowerShell:

```powershell
$env:GITLAB_PERSONAL_ACCESS_TOKEN = "glpat-xxxxxxxx"
$env:GITHUB_PERSONAL_ACCESS_TOKEN = "github_pat_xxxxxxxx"
```

## Requisitos base

- Node.js **>= 20**.
- VS Code + extensión **Claude Code**.
- `npm ci` para instalar dependencias del repo.
- `npx playwright install` para los navegadores.
