# Prompt de arranque — colega QA Automation

Este es el **prompt operativo** que el colega copia y pega en su **Claude Code** la primera vez que abre el proyecto `magiis-carrier-v2-e2e` clonado en su maquina.

A diferencia del handoff (`colega-implementacion-pantallas.md` — guia de referencia), este archivo es **el mensaje literal** que dispara la primera sesion orquestada: Claude analiza el proyecto, valida el environment, hace discovery del DOM real, y entrega un **plan de pruebas por pantalla** que el colega debe validar manualmente antes de empezar a implementar.

---

## Como usar este prompt

1. Abrir Claude Code en la raiz del repo clonado (`cd magiis-carrier-v2-e2e`).
2. Completar los **3 placeholders** marcados con `<<<...>>>` al final del prompt:
   - Tu nombre.
   - URL del repo GitLab del **frontend** (codigo Angular del portal V2, no este repo de e2e).
   - Bloque YAML con las pantallas a implementar (formato definido al final).
3. Copiar TODO el bloque "PROMPT PARA PEGAR" (entre los `BEGIN` / `END` marcadores).
4. Pegar en Claude Code como primer mensaje de la sesion.
5. Dejar a Claude ejecutar autonomamente hasta que pida tu validacion.

> **Importante**: este prompt **no implementa pantallas todavia**. Solo prepara el terreno (analisis, environment, discovery, plan de pruebas). El desarrollo real arranca cuando vos aprobas el plan de pruebas generado.

---

## PROMPT PARA PEGAR

````text
BEGIN PROMPT — COPIAR DESDE AQUI

# Rol e identidad

Soy <<<TU NOMBRE>>>, QA Automation Engineer en MAGIIS. Continuo el trabajo de
Erika Restrepo en el framework `magiis-carrier-v2-e2e` (Playwright + TypeScript
para el portal carrier V2 Angular 18). Mi sesion va a ser **orquestada con
Claude Code en modalidad ultracode**, usando los MCP servers configurados
(`gitlab`, `github`, `playwright`) y las skills MAGIIS instaladas en
`~/.claude/skills/` (`playwright-magiis`, `qa-magiis`,
`magiis-branch-convention`, `magiis-ci-efficiency`, `code-reviewer`).

# Objetivo de ESTA sesion (analisis + plan, NO implementar)

Antes de implementar la primera pantalla, necesito que orquestes una sesion
de PREPARACION en 6 fases. NO escribas POMs ni specs todavia — el objetivo
es entregarme un **plan de pruebas validable** por cada pantalla del bloque
final, listo para que YO lo apruebe antes de pasar al desarrollo.

# Fase 1 — Lectura del proyecto (orientacion)

Leer en orden:

1. `docs/handoff/colega-implementacion-pantallas.md` (handoff principal — fuente
   de verdad para setup, convenciones, modalidad orquestador).
2. `docs/backlog/AUTOMATION-BACKLOG.md` (backlog vivo, estado por pantalla).
3. `docs/backlog/pantallas-tracking.xlsx` (tracker — leer con pandas o equivalente).
4. `docs/architecture/POM-CONVENTIONS.md` + `BEST-PRACTICES.md` (convenciones POM).
5. `docs/scope-rules.md` (scope frontend-only, exclusiones).
6. Memorias del proyecto en `C:\Users\<user>\.claude\projects\<este-proyecto>\memory\MEMORY.md`
   — leer los archivos que indica (`pom-virtual-dispatch-trap`,
   `scope-pantallas-desarrolladas`, `pr-sin-footer-claude`, `mcp-playwright-status`,
   `playwright-snapshots-path`, `playwright-css-gotchas`,
   `v2-screens-divergencias`, `visual-render-flakiness-fix`).

Salida esperada: confirmacion en 5 lineas de los puntos clave que internalizaste
(convenciones, gotchas, scope, modalidad PR+CI).

# Fase 2 — Check del environment (organigrama de validacion)

Ejecutar el smoke del environment del handoff seccion 3 + checks adicionales
del organigrama abajo. **Reportar tabla con OK / FALLA / ACCION por cada item.**
No avanzar a Fase 3 si hay items en FALLA criticos.

## Organigrama de check (en orden, dependencia top-down)

### Bloque A — Sistema base
- [ ] Node.js >= 20.0.0 (`node --version`).
- [ ] npm >= 10.0.0 (`npm --version`).
- [ ] Git >= 2.40 (`git --version`).
- [ ] PowerShell 5.1+ o 7+ (`$PSVersionTable.PSVersion`).
- [ ] Python 3.10+ con `openpyxl` y `pandas` (para leer/escribir el tracker xlsx).

### Bloque B — Claude Code y skills
- [ ] Claude Code instalado (`claude --version`).
- [ ] `~/.claude/skills/` contiene minimo: `playwright-magiis`, `qa-magiis`,
      `magiis-branch-convention`, `magiis-ci-efficiency`. Listar con `ls`.
- [ ] (Recomendado) tambien: `code-reviewer`, `test-fixing`, `xlsx`, `verify`.
- [ ] `~/.claude/projects/<este-proyecto>/memory/MEMORY.md` existe (o se va a
      crear con las primeras sesiones).

### Bloque C — MCP servers (`.mcp.json`)
- [ ] `.mcp.json` existe en la raiz del repo (gitignored por `.mcp*`).
- [ ] Server `github` con `GITHUB_PERSONAL_ACCESS_TOKEN` configurado. Scopes
      minimos: `Pull requests R/W`, `Contents R/W`, `Workflows R/W`, `Actions R`.
      Verificar: `gh auth status` con `GH_TOKEN=<token>`.
- [ ] Server `gitlab` con `GITLAB_PERSONAL_ACCESS_TOKEN`. Scope: `api`,
      `read_repository`, `write_repository`. Verificar: `glab auth status`.
- [ ] Server `playwright` (mcp-server-playwright). Verificar que las tools
      `mcp__playwright__browser_navigate`, `browser_snapshot` etc. estan
      disponibles en Claude Code (probar con `/mcp` o intentar invocar una tool).
- [ ] (Opcional) Server `atlassian` si vas a tocar tickets Jira/Confluence.

### Bloque D — Repo y dependencias del proyecto
- [ ] Clon limpio del repo. `git status` debe estar `clean`.
- [ ] `git remote -v` muestra:
      - `origin → github.com/Emanuelrestrepo22/magiis-v2`
      - (Opcional) `gitlab → gitlab.com/magiis_team/v2-carrier-testing`
- [ ] `npm ci` corre sin errores.
- [ ] `npx playwright install --with-deps chromium` instala Chromium.
- [ ] `npm run typecheck` → exit 0.
- [ ] `npm run lint` → 0 errors (warnings preexistentes OK).
- [ ] `npm run validate:env` → imprime "Env <env> valido" sin throw de Zod.
- [ ] `npm run traceability` → regenera `traceability/tc-map.{md,json}`.

### Bloque E — Acceso al portal MAGIIS
- [ ] `.env.test` creado con `BASE_URL`, `USER_CARRIER`, `PASS_CARRIER`,
      `USER_CARRIER_AR/US/MX` segun region.
- [ ] Login manual al portal TEST en browser: navegar a `https://<BASE_URL>/carrier/#/auth/login`,
      validar acceso al dashboard.
- [ ] Smoke `npm run test:smoke` corre y la mayoria pasa (algunos fixme tolerados —
      ver `sprint8-detail-create-flows.spec.ts`).

### Bloque F — Repo GitLab del frontend (codigo Angular del portal V2)
- [ ] Acceso de lectura al repo: `<<<URL DEL REPO GITLAB FRONTEND>>>` (vos
      completas el placeholder antes de pegar este prompt).
- [ ] (Si tenes acceso) `glab repo clone <<<grupo>>>/<<<repo>>>` en una carpeta
      hermana, para que puedas leer routing/components al construir POMs.
- [ ] Branch a leer: `main` o `release/v2.0.4` (la version actualmente en
      produccion).

## Output esperado de la Fase 2

Tabla markdown con 1 fila por item del organigrama:

| Bloque | Item | Estado | Comando ejecutado | Output observado | Accion si FALLA |
|---|---|---|---|---|---|
| A | Node >= 20 | OK / FALLA | `node --version` | `v20.x.y` | ... |
| ... | ... | ... | ... | ... | ... |

Si **algun item del Bloque B/C/D esta en FALLA**, parar la sesion y reportar
al final con plan de remediacion (links, comandos, persona a contactar).

# Fase 3 — Visita al codigo GitLab del frontend (contexto Angular)

Solo si el Bloque F del organigrama esta OK.

Por cada pantalla del bloque "Pantallas a implementar" del final del prompt:

1. Identificar el directorio probable en el repo GitLab frontend (ej. `src/app/pages/carrier/<modulo>/`).
2. Listar los archivos `.component.ts`, `.component.html`, `.component.scss` y
   `routing.module.ts` relacionados.
3. Extraer del HTML:
   - El selector raiz (`<app-x>` o equivalente).
   - Los `[id]`, `[name]`, `aria-label`, `data-testid` declarados.
   - Los formControlName (formularios Angular reactivos).
   - Las llaves i18n usadas (`{{ 'modulo.titulo' | translate }}`).
4. Extraer del routing:
   - URL real con `hash` (recordar que V2 usa hash routing).
   - Guards activos.
   - Parametros (`:id`, `:typeView`, etc.).

Salida: un breve reporte por pantalla con los selectores candidatos (sin
inventar — solo lo que aparece en el codigo real). Esto se vuelve la **fuente
de verdad** para el POM, antes incluso del discovery con MCP.

# Fase 4 — Discovery del DOM real con MCP Playwright

Solo si el Bloque C (MCP playwright) y el Bloque E (acceso portal) estan OK.

Por cada pantalla:

1. `mcp__playwright__browser_navigate` a `https://<BASE_URL>/carrier/#/auth/login`.
2. Login automatico (llenar form con `USER_CARRIER`/`PASS_CARRIER`) o usar el
   `storageState` existente si esta cacheado en `storage/state-carrier-test.json`.
3. Navegar a la URL de la pantalla (la del bloque final + lo confirmado en Fase 3).
4. `mcp__playwright__browser_snapshot` para capturar el aria-snapshot del main
   content.
5. `mcp__playwright__browser_take_screenshot` para evidencia visual (guardar en
   `evidence/discovery/<pantalla>.png`).
6. Detectar rebotes: si la URL final difiere de la pedida, marcar la pantalla
   como `URL no confirmada — reportar a dev`.
7. Cerrar el browser al final (`mcp__playwright__browser_close`).

Salida: reporte por pantalla con:
- URL confirmada (o "rebote a X").
- Heading h2 real (texto y atributos).
- Tabla presente (si / no, cantidad de columnas).
- Search input presente (si / no, placeholder real).
- Botones de accion visibles (texto + role).
- Form fields (si aplica).
- Cualquier widget atipico (mapa, drag-drop, ng-select multinivel).

# Fase 5 — Plan de pruebas por pantalla (entregable principal)

Tomando el codigo Angular (Fase 3) + el DOM real (Fase 4), generar **un plan
de pruebas por pantalla** con esta estructura:

```yaml
pantalla: <<<TITULO>>>
mx: <<<MX-XXXX o TBD>>>
url_final: /carrier/#/<ruta-confirmada>
patron_pom: BaseListPage | BaseDetailPage | BasePage custom
selectores_clave:
  - heading: getByRole('heading', { name: /<regex-real>/i })
  - tabla:   getByRole('table').first()  # si aplica
  - search:  ...                          # si aplica
  - botones_accion: [...]
test_cases_propuestos:
  - id: TC01
    titulo: "Acceso desde menu Reports -> X y carga sin error"
    prioridad: P1
    pasos:
      - "navegar a URL"
      - "esperar heading"
      - "verificar tabla visible"
    criterio_aceptacion: "heading + tabla visibles en <10s"
  - id: TC02
    titulo: "Search filtra resultados por <campo>"
    ...
gotchas_detectados:
  - "Heading aparece DENTRO de tab activo, no en main → ajustar locator."
  - "Tabla usa virtual scroll → no asumir cantidad de rows."
estimacion: S | M | L
dependencias: [ClientList, OwnerList, MapViewer]
exclusiones:
  - "Submit del form: requiere datos backend, fuera de scope smoke."
````

Entregar como bloque YAML por pantalla. NO empezar a escribir POMs todavia.

# Fase 6 — Espera de validacion humana

Al terminar la Fase 5, **detenerte y preguntarme** explicitamente:

> "Plan de pruebas generado para N pantallas. ¿Lo apruebas tal como esta,
> queres modificar algun TC, o priorizar otro orden? Cuando confirmes,
> empiezo con la primera pantalla siguiendo el template repetible del handoff
> seccion 6."

NO avanzar a implementar sin mi OK explicito por pantalla.

# Convenciones que tengo que respetar (recordatorio)

- Branch: `carrier-v2/<feature-corta>` (skill `magiis-branch-convention`).
- Commit: `<tipo>(<scope>): [MX-XXXX] desc` (commitlint enforced).
- **PR descriptions sin footer "Generated with Claude Code"** (memoria
  `pr-sin-footer-claude`).
- Scope: solo pantallas DESARROLLADAS en el portal (memoria
  `scope-pantallas-desarrolladas`).
- NO inventar selectores — usar Fase 3 + Fase 4.
- Locators: `getByRole > getByLabel > getByTestId > CSS`.
- Snapshots Playwright en `<spec>-snapshots/`.
- Virtual dispatch trap en POMs heredados (memoria `pom-virtual-dispatch-trap`).
- Por cada pantalla terminada: actualizar
  `docs/backlog/AUTOMATION-BACKLOG.md` + `docs/backlog/pantallas-tracking.xlsx` +
  regenerar `traceability/tc-map.{md,json}`.

# Modalidad ultracode

Si una tarea es claramente extensa (auditoria multi-pantalla, refactor masivo,
discovery masivo en paralelo), invocar el Workflow tool con multi-agente.
Para tareas puntuales, agente individual o trabajo solo. Los inventarios y
auditorias del proyecto (P1/P2/P3/FW-005/FW-007\*) son ejemplos de cuando
usar Workflow.

# Repositorios

- E2E (este repo): https://github.com/Emanuelrestrepo22/magiis-v2 (GitHub, donde
  vive CI/CD) y https://gitlab.com/magiis_team/v2-carrier-testing (GitLab,
  espejo del codigo).
- Frontend Angular (codigo del portal V2):
  <<<URL DEL REPO GITLAB FRONTEND>>>

---

# Pantallas a implementar (pegar tu bloque YAML aqui)

Formato esperado (al menos 1, hasta N pantallas):

```yaml
pantallas:
  - id: MX-XXXX
    titulo: 'Nombre de la pantalla tal como aparece en el sidebar/breadcrumb'
    url_hipotesis: /carrier/#/<modulo>/<segmento>
    tier: P2 | P3 | Channels
    prioridad_implementacion: 1 # 1 = primero, N = ultimo
    notas: 'cualquier dato de contexto (formulario complejo, mapa Leaflet,
      depende de pantalla X, etc.)'

  - id: MX-YYYY
    titulo: '...'
    url_hipotesis: /carrier/#/...
    tier: P2
    prioridad_implementacion: 2
    notas: '...'
```

## TU BLOQUE (completar antes de pegar este prompt):

<<<PEGAR AQUI EL YAML DE PANTALLAS>>>

END PROMPT — TERMINA AQUI

````

---

## Ejemplo completo (con placeholders rellenados)

A modo de referencia, asi se ve el final del prompt cuando esta listo para pegar
(reemplaza los datos por los tuyos):

```yaml
pantallas:
  - id: MX-5601
    titulo: "Management Board"
    url_hipotesis: /carrier/#/owner-report
    tier: P2
    prioridad_implementacion: 1
    notas: "KPI cards + tabla top routes. Patron BaseListPage. Dep: ninguna."

  - id: MX-5725
    titulo: "Client Create"
    url_hipotesis: /carrier/#/client/create
    tier: P2
    prioridad_implementacion: 2
    notas: "Formulario con validacion + region selector. Patron BaseDetailPage.
            Submit fuera de smoke (requiere data backend)."

  - id: TBD-channels
    titulo: "Channels"
    url_hipotesis: /carrier/#/channels
    tier: Channels
    prioridad_implementacion: 3
    notas: "URL TBD — confirmar primero con discovery (Fase 4). Detectado en
            CI visual 2026-05-31. Nuevo modulo del sidebar V2."
````

---

## Que esperar tras pegar el prompt

Claude ejecutara las 6 fases en secuencia y se detendra al terminar la Fase 5
preguntandote si aprobas el plan. Tiempo estimado:

- Fase 1 (lectura): 2-3 min.
- Fase 2 (organigrama): 3-5 min — depende de cuantos checks fallen.
- Fase 3 (codigo GitLab frontend): 5-10 min por pantalla.
- Fase 4 (discovery MCP): 3-5 min por pantalla.
- Fase 5 (plan de pruebas): 5-10 min por pantalla.

Para 3 pantallas: aprox 45-60 min de sesion preparatoria. Despues, cada
implementacion (POM + spec + PR + merge) es otros 30-90 min segun complejidad.

---

## Checklist previo (antes de pegar el prompt)

- [ ] Repo clonado y `git status` clean.
- [ ] `.env.test` creado y validado.
- [ ] `.mcp.json` configurado con tus PATs (no reutilizar los de Erika).
- [ ] Claude Code abierto en la raiz del proyecto.
- [ ] Reemplazaste los 3 placeholders `<<<...>>>` del prompt:
  - Tu nombre.
  - URL del repo GitLab frontend.
  - YAML de pantallas a implementar (al menos 1).

---

## Que hacer si algo del organigrama (Fase 2) falla

| Falla                             | Probable causa                    | Accion                                                        |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| Claude Code no responde           | No instalado / version vieja      | `https://docs.claude.com/claude-code/install`                 |
| Skills MAGIIS faltan              | No copiadas a `~/.claude/skills/` | Pedir a Erika el zip o copiar manualmente                     |
| MCP playwright no aparece         | MCP server no arranco             | Revisar `.mcp.json` config + reiniciar Claude Code            |
| `gh auth status` falla            | PAT no exportado                  | `setx GH_TOKEN "<tu PAT>"` + reiniciar PowerShell             |
| `npm ci` falla                    | Node/registry SSL                 | Ver memoria `mcp-playwright-status` (workaround SSL firewall) |
| `npm run typecheck` rojo          | Codigo roto en main               | Avisar a Erika — bug en main                                  |
| Login portal falla                | Credenciales / backend caido      | Verificar `.env.test` + intentar manual en browser            |
| Repo GitLab frontend no accesible | Sin permisos                      | Pedir acceso a Tech Lead / Owner del repo                     |

Si tras intentos razonables algo no se resuelve: **parar y avisar** antes de
empezar a implementar con setup roto.
