# Handoff — Implementacion de pantallas P2/P3 carrier v2

- Fecha: 2026-06-02
- Autor: Emanuel Restrepo (handoff a colega QA Automation)
- Proposito: dejar a un nuevo QA Automation listo para continuar la implementacion de las pantallas pendientes del portal carrier v2, reproduciendo el mismo entorno, convenciones y flujo orquestado con Claude Code que se uso hasta hoy.

---

## 1. Resumen ejecutivo

El proyecto `magiis-carrier-v2-e2e` automatiza con Playwright + TypeScript la regresion del portal carrier v2 de MAGIIS. Cubre actualmente flujos P1 (login, dashboard, modulos core) y va avanzando sobre P2/P3. Quedan **28 pantallas pendientes** detalladas en la seccion 5: **1 Channels** (nueva, detectada en CI visual 2026-05-31, URL TBD) + **10 P2** (sin POM, requieren discovery) + **17 P3** (todas en `/settings/*`, `/affiliate/*`, `/melita/*`, `/integrations/*`). Las 4 P2 ya cubiertas (Trip Quotes, Recurring Trips, Passenger/Contractor Liquidations) y New Trip/Trip Detail (no desarrolladas) estan listadas como exclusiones explicitas al final de la seccion 5.

El colega va a:

1. Tomar la rama `main` y, por cada pantalla, ejecutar el ciclo `discovery -> POM -> spec -> PR -> merge`.
2. Usar Claude Code como orquestador (con ultracode opt-in para tareas largas) apoyado en las skills MAGIIS (`playwright-magiis`, `qa-magiis`, `magiis-branch-convention`, `magiis-ci-efficiency`) y los MCP servers `gitlab` y `github`.
3. Mantener trazabilidad triple: `docs/backlog/AUTOMATION-BACKLOG.md`, `traceability/tc-map.{md,json}` y `docs/backlog/pantallas-tracking.xlsx`.

Referencias clave:

- Auditorias previas: `docs/audit/`.
- Backlog vivo: `docs/backlog/AUTOMATION-BACKLOG.md`.
- Reglas de scope: `docs/scope-rules.md`.
- Memorias del proyecto: `C:\Users\<user>\.claude\projects\<project>\memory\MEMORY.md`.

---

## 2. Setup del environment — checklist

Marcar cada item al ir completando.

- [ ] Clonar el repo desde GitHub:
  - `git clone https://github.com/Emanuelrestrepo22/magiis-v2.git magiis-carrier-v2-e2e`
  - (Opcional) agregar mirror GitLab: `git remote add gitlab https://gitlab.com/magiis_team/v2-carrier-testing.git`
- [ ] Instalar dependencias del sistema:
  - Node.js 20+ (`node --version` >= v20.0.0).
  - Git 2.40+ (`git --version`).
  - PowerShell 5.1+ (Windows nativo) o PowerShell 7.
  - Chrome/Chromium reciente (para la skill `browse` y debugging visual).
- [ ] Instalar y verificar Claude Code:
  - Seguir https://docs.claude.com/claude-code/install
  - `claude --version` debe responder sin error.
- [ ] Copiar skills MAGIIS a `~/.claude/skills/` (obligatorias):
  - `playwright-magiis/`
  - `qa-magiis/`
  - `magiis-branch-convention/`
  - `magiis-ci-efficiency/`
  - Recomendadas tambien: `code-reviewer/`, `test-fixing/`, `xlsx/`.
- [ ] Configurar `.mcp.json` con tus propios tokens (NUNCA reutilizar los de otro colega; usar `.mcp.json.example` como plantilla):
  - `GITLAB_PERSONAL_ACCESS_TOKEN`: generar en https://gitlab.com/-/user_settings/personal_access_tokens con scopes minimos `api`, `read_repository`, `write_repository`.
  - `GITHUB_PERSONAL_ACCESS_TOKEN` (fine-grained): generar en https://github.com/settings/tokens?type=beta con permisos `Pull requests R/W`, `Contents R/W`, `Workflows R/W`, `Actions R`.
  - Exportar como variables de entorno del sistema (no inline en el JSON).
- [ ] Instalar dependencias Node y browsers:
  - `npm ci`
  - `npx playwright install --with-deps chromium`
- [ ] Crear `.env.test` a partir de `.env.example`:
  - Completar `BASE_URL`, `USER_CARRIER`, `PASS_CARRIER`, `ENV=test`.
  - Si vas a correr regional: `USER_CARRIER_AR/US/MX` + sus `PASS_*`.
- [ ] Validar acceso manual al portal MAGIIS TEST:
  - Abrir `https://<BASE_URL>/carrier/#/auth/login` y loguear con tus credenciales.
  - Confirmar que llegas al dashboard.
- [ ] (Opcional) PAT GitLab si vas a operar el mirror.

---

## 3. Smoke del environment

Copiar y pegar en PowerShell desde la raiz del repo. Cada comando debe devolver el output esperado para considerar el setup correcto.

```powershell
# 1. Auth de CLIs Git
gh auth status        # OK: "Logged in to github.com as <user>"
glab auth status      # OK si se uso, opcional

# 2. Toolchain Node
node --version        # >= v20.0.0
npm --version         # >= 10.0.0

# 3. Calidad estatica
npm run typecheck     # OK: sin errores, exit 0
npm run lint          # OK: 0 errors, 0 warnings bloqueantes

# 4. Configuracion del entorno
npm run validate:env  # OK: imprime "Env <test|uat|prod> valido" sin throw de Zod
npm run traceability  # OK: regenera traceability/tc-map.{md,json} sin error

# 5. Sanity Playwright (sin correr tests reales)
npx playwright --version  # OK: Version >= 1.49
```

Si **cualquiera** de los 5 bloques falla: parar y resolver antes de avanzar. No empezar a implementar pantallas con un setup roto.

---

## 4. Convenciones del proyecto

Resumen ejecutivo de las reglas no negociables. La fuente de verdad detallada vive en las skills referenciadas.

- **Branch naming** (skill `magiis-branch-convention`): `carrier-v2/<feature-corta>`. Ejemplos: `carrier-v2/channels-discovery`, `carrier-v2/client-create-pom`.
- **Commit format** (commitlint enforced): `<tipo>(<scope>): [MX-XXXX] descripcion`.
  - Tipos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
  - `MX-XXXX` obligatorio cuando hay TC. Para infra (ci, chore puro) se permite omitir.
  - Multi-TC: `feat(carrier): [MX-5601][MX-5725] management board + client create POMs`.
- **PR descriptions**: NO incluir el footer "Generated with Claude Code" (memoria `pr-sin-footer-claude`). Resumen + Test plan.
- **Scope**: solo automatizar pantallas YA desarrolladas en el portal (memoria `scope-pantallas-desarrolladas`). New Trip / Trip Detail siguen diferidas.
- **No inventar selectores**: ejecutar discovery (`RUN_DISCOVERY=true`) antes de escribir el POM. Capturar `aria-snapshot` real.
- **Locators (orden de preferencia)**: `getByRole` > `getByLabel` > `getByTestId` > CSS. Evitar XPath y texto dinamico.
- **Snapshots Playwright**: viven en `<spec>-snapshots/`, no en `__screenshots__/` (memoria `playwright-snapshots-path`).
- **POM heredados**: cuidado con virtual dispatch — si una subclase puede override, NO llamar `this.X()` desde el `Base`, usar `super.X()` en la subclase (memoria `pom-virtual-dispatch-trap`).
- **CSS Playwright gotchas**: la flag `i` solo se permite en valores, no selectores. `getByPlaceholder` matchea elementos hidden (memoria `playwright-css-gotchas`).
- **Render visual**: chromium font-render flags + `addInitScript` aplicado (memoria `visual-render-flakiness-fix`).

---

## 5. Pantallas a implementar

Inventario completo (**28 pantallas pendientes**: 1 Channels + 10 P2 + 17 P3) ordenado por esfuerzo ascendente. `URL TBD` significa que la ruta esta en `routing/index.ts` pero requiere discovery para confirmar render real. **No inventar selectores** sobre estas URLs hasta haber corrido discovery.

> ⚠️ **Item #1 (Channels)**: URL NO confirmada — solo se sabe que existe el item en el sidebar V2 (detectado por drift del baseline visual 2026-05-31, 424px diff). La ruta `/carrier/#/channels` es hipotesis. Antes de cualquier scaffold, ejecutar discovery navegando el sidebar real para confirmar URL exacta. Si la URL real difiere, actualizar este handoff + backlog.

| #   | Pantalla                         | URL                                                   | Tier | MX Ticket                             | Dependencia      | Patron POM      | Esfuerzo | Notas                                                                           |
| --- | -------------------------------- | ----------------------------------------------------- | ---- | ------------------------------------- | ---------------- | --------------- | -------- | ------------------------------------------------------------------------------- |
| 1   | Channels                         | `/carrier/#/channels` (TBD discovery)                 | P3   | TBD                                   | integrations     | BasePage custom | S        | Detectado en CI visual 2026-05-31, rompio baseline sidebar 424px. Nuevo modulo. |
| 2   | Pay Travels (Daily Clearing)     | `/carrier/#/pay/travels`                              | P2   | MX-?                                  | —                | BaseListPage    | S        | Lista filtros + batch actions.                                                  |
| 3   | Surrenders Report                | `/carrier/#/pay/surrenders-report`                    | P2   | MX-?                                  | Pay Travels      | BaseListPage    | S        | Lista + totales. URL declarada, confirmar render.                               |
| 4   | Settings — Parameters            | `/carrier/#/settings/parameters`                      | P3   | MX-?                                  | Configuration    | BaseListPage    | S        | Lista config.                                                                   |
| 5   | Settings — Transport Types       | `/carrier/#/settings/transportTypes`                  | P3   | MX-?                                  | Configuration    | BaseListPage    | S        | Lista config.                                                                   |
| 6   | Settings — Services Type         | `/carrier/#/settings/servicesType/list`               | P3   | MX-?                                  | Configuration    | BaseListPage    | S        | Lista config.                                                                   |
| 7   | Settings — Taxes & Fees          | `/carrier/#/settings/taxesAndFees`                    | P3   | MX-?                                  | Configuration    | BaseListPage    | S        | Similar a MX-5575 (Other Costs).                                                |
| 8   | Settings — Profiles              | `/carrier/#/settings/profiles`                        | P3   | MX-?                                  | Configuration    | BaseListPage    | S        | Lista perfiles CRUD.                                                            |
| 9   | Settings — Preferences           | `/carrier/#/settings/preferences`                     | P3   | MX-?                                  | Configuration    | BasePage        | S        | Form settings usuario.                                                          |
| 10  | Affiliate — Request              | `/carrier/#/affiliate/request`                        | P3   | MX-?                                  | Affiliate module | BaseListPage    | S        | Lista requests CRUD.                                                            |
| 11  | Heat Map                         | `/carrier/#/owner-heat-map`                           | P2   | MX-?                                  | MapViewer        | MapViewerPage   | M        | Leaflet map. Reutiliza patron MX-5559.                                          |
| 12  | Management Board                 | `/carrier/#/owner-report`                             | P2   | MX-5601                               | —                | BaseListPage    | M        | KPI cards + tabla.                                                              |
| 13  | Client Create                    | `/carrier/#/client/create`                            | P2   | MX-5725                               | ClientList       | BaseDetailPage  | M        | Form validacion + regions submit.                                               |
| 14  | Client Edit                      | `/carrier/#/client/edit/:id`                          | P2   | MX-?                                  | Client Create    | BaseDetailPage  | M        | Load edit save.                                                                 |
| 15  | Owner Add                        | `/carrier/#/owner/add` (confirmar vs `/owner/create`) | P2   | MX-?                                  | OwnerList        | BaseDetailPage  | M        | Form + vehicle assignment.                                                      |
| 16  | Owner Edit                       | `/carrier/#/owner/edit/:id`                           | P2   | MX-?                                  | Owner Add        | BaseDetailPage  | M        | Load edit save.                                                                 |
| 17  | Mappers                          | `/carrier/#/travel/mappers`                           | P2   | MX-?                                  | TravelDashboard  | BaseListPage    | M        | Tabla reglas mapping. URL sin confirmar.                                        |
| 18  | Client Contractors list          | `/carrier/#/client/contractors` (URL TBD)             | P2   | MX-5727                               | ClientList       | BaseListPage    | M        | Search + tabla. Requiere discovery.                                             |
| 19  | Settings — Branches              | `/carrier/#/settings/branches/list`                   | P3   | MX-?                                  | Configuration    | BaseListPage    | M        | Posible nested/expand.                                                          |
| 20  | Settings — Email Templates       | `/carrier/#/settings/email-templates`                 | P3   | MX-?                                  | Configuration    | BaseListPage    | M        | Editor HTML/text probable.                                                      |
| 21  | Settings — Travel Fare List      | `/carrier/#/settings/travel-fare-list`                | P3   | MX-?                                  | Configuration    | BaseListPage    | M        | Tabla tarifas, posible edit inline.                                             |
| 22  | Affiliate — Offering             | `/carrier/#/affiliate/offering`                       | P3   | MX-?                                  | Affiliate module | BaseListPage    | M        | Catalogo afiliado.                                                              |
| 23  | Affiliate — Profile              | `/carrier/#/affiliate/atc-profile`                    | P3   | MX-?                                  | Affiliate module | BaseDetailPage  | M        | Perfil usuario afiliado.                                                        |
| 24  | Integrations (Apps Store)        | `/carrier/#/integrations/list`                        | P3   | MX-5717                               | Configuration    | BaseListPage    | M        | Cards layout probable.                                                          |
| 25  | Melita — AI Branches             | `/carrier/#/melita/ai-branches`                       | P3   | MX-?                                  | Configuration    | BaseListPage    | M        | Integracion IA.                                                                 |
| 26  | Settings — Travel Fare Rules     | `/carrier/#/settings/travel-fare-rules`               | P3   | MX-?                                  | Configuration    | BaseDetailPage  | L        | Editor reglas logica.                                                           |
| 27  | Settings — Profile Access        | `/carrier/#/settings/profiles-access`                 | P3   | MX-?                                  | Configuration    | BasePage        | L        | Matriz permisos grid.                                                           |
| 28  | Affiliate — Agreements requested | `/carrier/#/affiliate/os-agreement-requested`         | P3   | MX-?-affiliate-os-agreement-requested | Affiliate module | BaseListPage    | M        | Solicitudes de acuerdos OS afiliado.                                            |

**Exclusiones explicitas (no automatizar hasta nuevo aviso):**

- New Trip / Trip Detail: pantallas marcadas como "no desarrolladas" en `AUTOMATION-BACKLOG.md` p.76-77.
- Pantallas ya cubiertas: `SettingsOtherCostsPage` (MX-5575), `TravelQuotesPage`, `TravelRecurringPage`, Settlements (Owner/Driver/Passenger/Contractor).

---

## 6. Template repetible por pantalla

Ejemplo concreto: **Client Create** (#13, MX-5725, P2, M). Replicar este flujo paso a paso para cada pantalla del inventario, ajustando nombre, ruta, MX y dominio.

### 6.1. Crear branch

```powershell
git checkout main
git pull --ff-only
git checkout -b carrier-v2/client-create-pom
```

### 6.2. Discovery del DOM real

```powershell
cross-env ENV=test RUN_DISCOVERY=true npx playwright test tests/specs/exploratory/p2-p3-discovery.spec.ts --project=carrier-v2-desktop --workers=1
```

Outputs esperados:

- Screenshot en `evidence/test/discovery/client-create.png`.
- `aria-snapshot` impreso en consola con roles, labels y testids reales.
- Si la pantalla rebota a otra URL: marcar como "no desarrollada" en backlog y saltar.

### 6.3. Scaffold del POM

```powershell
npm run scaffold:page -- --name ClientCreatePage --route "/carrier/#/client/create" --jira MX-5725 --priority P2
```

Esto genera `tests/pages/client/ClientCreatePage.ts` con el esqueleto. Editarlo con los locators capturados en discovery.

### 6.4. Implementar POM (locators reales)

Ejemplo de patron a respetar:

```typescript
import { Page, expect } from '@playwright/test';
import { BaseDetailPage } from '@pages/base/BaseDetailPage';

export class ClientCreatePage extends BaseDetailPage {
  readonly nameInput = this.page.getByLabel(/name/i);
  readonly submitBtn = this.page.getByRole('button', { name: /save|create/i });

  constructor(page: Page) {
    super(page, '/carrier/#/client/create');
  }

  async fillRequired(data: { name: string }) {
    await this.nameInput.fill(data.name);
  }
}
```

Reglas:

- `getByRole`/`getByLabel` primero. CSS solo como ultimo recurso.
- NO override de metodos del Base sin leer la memoria `pom-virtual-dispatch-trap`.

### 6.5. Scaffold del spec

```powershell
npm run scaffold:spec -- --name client-create --route "/carrier/#/client/create" --jira MX-5725 --priority P2 --domain client
```

Genera `tests/specs/client/client-create.spec.ts` con boilerplate de tags y fixtures.

### 6.6. Implementar spec con assertions funcionales

```typescript
test('@P2 @client crea cliente con datos minimos requeridos', async ({ carrierPage }) => {
  const page = new ClientCreatePage(carrierPage);
  await page.goto();
  await page.fillRequired({ name: `QA-${Date.now()}` });
  await page.submitBtn.click();
  await expect(carrierPage).toHaveURL(/\/client\/(list|edit)/);
});
```

### 6.7. Validacion local

```powershell
npm run typecheck
npm run lint
npm run traceability   # regenera tc-map con la nueva ruta MX-5725
```

Todo verde antes de commitear.

### 6.8. Commit con formato TC-ID

```powershell
git add tests/pages/client/ClientCreatePage.ts tests/specs/client/client-create.spec.ts traceability/
git commit -m "feat(client): [MX-5725] ClientCreatePage POM + spec happy path"
```

### 6.9. PR a `main`

```powershell
git push -u origin carrier-v2/client-create-pom
gh pr create --base main --title "feat(client): [MX-5725] ClientCreatePage POM + spec" --body @'
## Summary
- Discovery + POM `ClientCreatePage` con locators reales (getByRole/getByLabel).
- Spec happy path P2: crea cliente con datos minimos y valida redireccion.
- Trazabilidad actualizada (`tc-map`).

## Test plan
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npx playwright test tests/specs/client/client-create.spec.ts --project=carrier-v2-desktop`
- [ ] Quality-checks + smoke verdes en CI
'@
```

(Sin footer "Generated with Claude Code".)

### 6.10. Merge y limpieza

- Esperar `quality-checks` + `smoke` verdes.
- `gh pr merge --squash --delete-branch`.
- `git checkout main && git pull --ff-only`.

### 6.11. Actualizar trazabilidad

- Marcar la pantalla como `Done` en `docs/backlog/AUTOMATION-BACKLOG.md`.
- Confirmar que `traceability/tc-map.md` ya tiene la nueva entrada.
- Actualizar fila en `docs/backlog/pantallas-tracking.xlsx` (skill `xlsx` disponible).

---

## 7. Modalidad orquestador (ultracode + Workflow)

Claude Code se usa en dos modos sobre este repo:

| Modo                           | Cuando usarlo                                                      | Ejemplo concreto                                                              |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **Agent individual** (default) | Tareas atomicas: leer un archivo, scaffold de un POM, abrir un PR. | "Generame el POM de Client Create con los locators capturados."               |
| **Workflow / fan-out**         | Cuando hay N items independientes y querras paralelizar.           | Auditoria a11y sobre 16 pantallas a la vez, o discovery masivo P3.            |
| **Workflow / pipeline**        | Cuando hay etapas secuenciales que se repiten por item.            | `discovery -> POM -> spec -> PR` por pantalla, en serie con commit por etapa. |

Ultracode (modelo extendido) es opt-in:

- Por turno: incluir la keyword `ultracode` en el prompt del turno.
- Por session: configurarlo en `~/.claude/settings.json` (`alwaysUseUltracode: true`).

Usarlo solo cuando:

- El razonamiento requiere lectura amplia (auditoria cross-modulo, refactor de Base\*).
- Hay muchas decisiones encadenadas (planificacion de 5+ pantallas seguidas).

Para tareas simples (un commit, un scaffold) NO encender ultracode: gasta mas y no aporta.

---

## 8. Prompt inicial para la sesion Claude del colega

Pegar literalmente al abrir Claude Code en el clone, reemplazando `<nombre>`, `<pantalla>` y `<MX>`:

```
Soy <nombre>, QA Automation. Voy a continuar la implementacion de pantallas
P2/P3 del proyecto magiis-carrier-v2-e2e siguiendo el handoff en
docs/handoff/colega-implementacion-pantallas.md.

Mi entorno esta validado segun el smoke del handoff (seccion 3). Empezamos
con la pantalla <pantalla> (<MX>) — ¿podes orquestar el flujo
discovery -> POM -> spec -> PR -> merge siguiendo el template repetible
de la seccion 6?

Convenciones que respeto: branch carrier-v2/<feature>, commits
<tipo>(<scope>): [<MX>] <desc>, sin footer "Generated with Claude Code"
en los PRs.
```

---

## 9. Documentacion Excel paralela

Ademas del backlog markdown se mantiene un tracker en spreadsheet para vista ejecutiva:

- Ruta: `docs/backlog/pantallas-tracking.xlsx`
- Columnas obligatorias:
  - `pantalla` — nombre canonico (igual al backlog).
  - `URL` — ruta confirmada post-discovery, o `TBD` si pendiente.
  - `MX` — ticket Jira (`MX-XXXX`).
  - `tier` — P1/P2/P3.
  - `estado` — `pending` / `in-progress` / `blocked` / `done`.
  - `POM_path` — `tests/pages/<dominio>/<Name>Page.ts` cuando exista.
  - `spec_path` — `tests/specs/<dominio>/<name>.spec.ts` cuando exista.
  - `fecha_done` — ISO `YYYY-MM-DD`.
  - `owner` — alias del QA que la cerro.

La skill `xlsx` esta disponible globalmente. Invocarla con: "Actualiza pantallas-tracking.xlsx: marca <pantalla> como done, owner <nombre>, fecha hoy."

---

## 10. Trazabilidad y reportes que actualizar en cada PR

Lista de archivos que deben moverse en CADA PR de pantalla. Si falta alguno, el PR no esta completo.

1. `docs/backlog/AUTOMATION-BACKLOG.md` — cambiar estado de la pantalla.
2. `traceability/tc-map.md` y `traceability/tc-map.json` — regenerados via `npm run traceability`.
3. `docs/backlog/pantallas-tracking.xlsx` — estado + fecha + owner.
4. Si el PR introduce override en una POM heredada: revisar memoria `pom-virtual-dispatch-trap` y dejarlo comentado en el codigo.

---

## 11. Recursos y enlaces

- Repo GitHub (origin): https://github.com/Emanuelrestrepo22/magiis-v2.git
- Repo GitLab (mirror): https://gitlab.com/magiis_team/v2-carrier-testing.git
- Backlog vivo: `docs/backlog/AUTOMATION-BACKLOG.md`
- JSON backlog (consumido por dashboard): `docs/backlog/automation-backlog.json`
- Auditorias: `docs/audit/`
- Reglas de scope: `docs/scope-rules.md`
- Handoff Claude previo (skills/MCP/setup): `docs/handoff-claude/README.md`
- Memorias del proyecto: `C:\Users\<user>\.claude\projects\<project>\memory\MEMORY.md`
  - `scope-pantallas-desarrolladas`
  - `pom-virtual-dispatch-trap`
  - `playwright-snapshots-path`
  - `playwright-css-gotchas`
  - `visual-render-flakiness-fix`
  - `pr-sin-footer-claude`
  - `github-actions-gotchas`
  - `mcp-playwright-status`
  - `v2-screens-divergencias`
  - `a11y-audit-findings-2026-05-21`
- Skills MAGIIS: `~/.claude/skills/{playwright-magiis,qa-magiis,magiis-branch-convention,magiis-ci-efficiency}/`
- `.mcp.json.example` (plantilla, NO commitear tokens reales): raiz del repo.
