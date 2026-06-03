# 04 — Prompt de seteo del environment (VS Code)

Pegar este prompt en **Claude Code dentro de VS Code**, con el repo
`magiis-carrier-v2-e2e` ya abierto como workspace. Claude verificará e instalará
lo necesario paso a paso.

---

```text
Soy un nuevo integrante del equipo QA Automation de MAGIIS. Trabajo en VS Code
con la extensión Claude Code y acabo de clonar el repo `magiis-carrier-v2-e2e`
(framework Playwright + TypeScript para el portal carrier, migración Angular 8 → 18).

Quiero que me ayudes a dejar mi entorno agéntico igual al del equipo. Hacelo en
este orden, parando a confirmar antes de cualquier paso destructivo o que
exponga credenciales:

1. VERIFICAR BASE
   - Node >= 20 (`node -v`).
   - Que el repo tenga `package.json`, `playwright.config.ts` y `.mcp.json`.
   - Correr `npm ci` y `npx playwright install`.

2. SKILLS (nivel usuario, en ~/.claude/skills/) — YA INSTALADAS
   - Solo VERIFICAR: que existan en ~/.claude/skills/ las usadas en este proyecto:
     playwright-magiis, qa-magiis, magiis-branch-convention, magiis-ci-efficiency,
     skill-creator, code-reviewer, typescript-advanced-types, test-fixing, xlsx.
   - Listame con `/help` o el tool Skill cuáles aparecen disponibles.
   - Si por algo falta alguna, decime cuál; NO inventes el contenido.

3. MCP SERVERS (gitlab + github, definidos en .mcp.json del repo)
   - Recordame exportar mis PROPIOS tokens como variables de entorno
     (GITLAB_PERSONAL_ACCESS_TOKEN, GITHUB_PERSONAL_ACCESS_TOKEN). En Windows uso
     PowerShell: `$env:VAR = "..."`.
   - NO leas ni copies tokens de ningún archivo; cada quien usa los suyos.
   - Verificá que `enabledMcpjsonServers` incluya gitlab.

4. PLUGINS
   - Plugin activo del equipo: prompt-improver@severity1-marketplace.
   - Decime cómo habilitarlo si no lo tengo.

5. ENV DEL PROYECTO
   - Copiar `.env.example` a `.env.test` y guiarme para completar credenciales
     (no me pidas las reales; usá placeholders).

6. SMOKE FINAL
   - Correr `npm run typecheck` y `npm run test:smoke` para confirmar que todo
     levanta. Reportame qué pasó.

Convenciones que debo respetar desde ya:
- Commits: `<tipo>(<scope>): [TC-ID] descripción`.
- Responder en español; código/comandos en inglés.
- No exponer secretos en commits ni ejemplos.

Al final, dame un checklist de lo que quedó configurado y lo que falta de mi lado.
```

---

## Nota para quien comparte el paquete

El colega **ya instaló** las mismas skills globales en su `~/.claude/skills/`, así
que el paso de skills es solo verificación. Lo que falta de su lado es:
**MCP (sus propios tokens), plugin prompt-improver, `.env.test` y smoke final.**
Este paquete no incluye secretos.
