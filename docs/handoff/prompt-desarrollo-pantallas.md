# Prompt de DESARROLLO — colega QA Automation

Segundo prompt operativo. Este se pega **despues** del `prompt-arranque-colega.md` y de **validar el plan de pruebas** que generaron las 6 fases preparatorias. Dispara el ciclo real de implementacion: por cada pantalla del plan validado, ejecuta el workflow completo del entorno (branch -> POM -> spec -> CI -> merge -> backlog).

> **No pegar este prompt sin antes haber:**
>
> 1. Pegado `prompt-arranque-colega.md` y dejado a Claude correr las 6 fases.
> 2. Recibido el plan de pruebas en YAML.
> 3. Validado vos los TCs propuestos (modificado lo que haga falta).
> 4. Confirmado el orden de implementacion (cual pantalla primero, segunda, etc.).
>
> Si saltas la validacion, vas a implementar a ciegas — y eso viola el criterio de no inventar selectores.

---

## Como usar este prompt

1. Tomar el plan de pruebas YAML que Claude genero en la Fase 5 del arranque.
2. Pegarlo en el placeholder `<<<PEGAR PLAN DE PRUEBAS VALIDADO>>>` del bloque BEGIN/END.
3. Completar `<<<TU NOMBRE>>>` (mismo de la sesion anterior).
4. Copiar TODO el bloque entre `BEGIN PROMPT` / `END PROMPT`.
5. Pegar en Claude Code como siguiente mensaje (misma sesion que el arranque o nueva si reseteaste).

---

## PROMPT PARA PEGAR

````text
BEGIN PROMPT — DESARROLLO

# Identidad y contexto

Soy <<<TU NOMBRE>>>. Vengo de la sesion preparatoria con `prompt-arranque-colega.md`
donde validamos environment + DOM real + plan de pruebas. Ya aprobe el plan tal
como esta y arrancamos el ciclo de implementacion real, siguiendo el workflow
estandar del entorno (branch -> POM -> spec -> PR -> CI gate -> merge -> backlog).

# Plan de pruebas APROBADO (orden de implementacion)

<<<PEGAR PLAN DE PRUEBAS VALIDADO — el YAML que Claude genero en Fase 5 del arranque,
con los TCs que vos aprobaste, en el orden que decidiste>>>

# Workflow por pantalla — loop hasta terminar el bloque

Por cada pantalla del plan, ejecutar los 15 pasos en orden estricto. NO pasar
a la siguiente pantalla hasta tener PR mergeado y backlog actualizado de la
actual.

## Paso 1 — Branch dedicada

```powershell
git checkout main
git pull --ff-only origin main
git checkout -b carrier-v2/<dominio>-<nombre-pantalla-kebab>
````

Naming: `carrier-v2/pay-travels-pom`, `carrier-v2/client-create`, etc.
(skill `magiis-branch-convention`).

## Paso 2 — Discovery (si no fue ya capturado)

Si el plan validado YA incluye el aria-snapshot (capturado en Fase 4 del
arranque): saltar a Paso 3.

Si NO (pantalla nueva detectada en el medio, URL TBD que se confirma ahora):

```powershell
# Opcion A — Spec exploratorio reproducible:
cross-env ENV=test RUN_DISCOVERY=true npx playwright test tests/specs/exploratory/p2-p3-discovery.spec.ts --project=carrier-v2-desktop --workers=1

# Opcion B — MCP Playwright en vivo (si esta el server conectado):
# usar mcp__playwright__browser_navigate + browser_snapshot
```

Capturar selectores reales. NUNCA inventar.

## Paso 3 — Scaffold POM

```powershell
npm run scaffold:page -- --name <Name>Page --route /carrier/#/<route> --jira MX-<XXXX> --priority <P1|P2|P3>
```

Output: `tests/pages/carrier-v2/<Name>Page.ts` con esqueleto.

## Paso 4 — Implementar POM real

Abrir el archivo recien creado. Reglas:

- **Heredar de `BaseListPage` / `BaseDetailPage` / `BasePage`** segun el patron
  del plan (no inventar herencia).
- **NO redeclarar locators que ya estan en Base** (memoria
  `pom-virtual-dispatch-trap` + auditoria FW-007). Solo override de
  `headingRegex` + `path` + locators ESPECIFICOS de la pantalla.
- **Si override `expectListReady` o `expectDetailReady`**: usar
  `super.expectListReady()` en la subclase, NUNCA `this.expectListReadyWithSearch()`
  (causa recursion infinita por virtual dispatch — bug real detectado en CI).
- **Locators**: derivados del aria-snapshot del Paso 2.
  Orden: `getByRole > getByLabel > getByTestId > CSS`.
- **Sin selectores inventados**: si no aparece en el snapshot, no existe.
- **Comentarios**: solo si el WHY no es obvio. Sin docstrings largos.
- **Snapshots Playwright**: viven en `<spec>-snapshots/`, NUNCA en `__screenshots__/`.

## Paso 5 — Scaffold spec

```powershell
npm run scaffold:spec -- --name <Name>Page --route /carrier/#/<route> --jira MX-<XXXX> --priority <P1|P2|P3> --domain <smoke|regression>
```

Output: `tests/specs/<smoke|regression>/<dominio>/<name-kebab>.spec.ts`.

## Paso 6 — Implementar spec real

Una funcion `test()` por cada TC del plan validado. Reglas:

```typescript
test('TC01 <descripcion del plan>', async ({ page }) => {
  test.info().annotations.push({ type: 'jira', description: 'MX-XXXX' });
  test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/<route>' });

  const screen = new <Name>Page(page);
  await screen.goto();
  await screen.expectListReady();   // o expectDetailReady, segun aplique

  // Aciones del TC.
  await screen.search('zz_qa_e2e_no_match');

  // Assertions FUNCIONALES (no solo toBeVisible).
  await expect(screen.searchInput).toHaveValue('zz_qa_e2e_no_match');
});
```

Reglas adicionales:

- **NO `waitForTimeout`** (lint rule + skill `playwright-magiis`).
- **NO `waitForLoadState('networkidle')`** (lint rule activa `playwright/no-networkidle`).
- **Esperar por estado observable**: `expect(...).toHaveText(...)`,
  `await page.waitForURL(...)`, `await locator.waitFor({ state: 'visible' })`.
- **Si el test requiere datos backend que pueden no estar**:
  `test.skip(condicion, 'razon clara')` o `test.fixme` con motivo documentado
  (bug real ya detectado en `sprint8-detail-create-flows.spec.ts`).
- **1 test = 1 TC del plan**. No empaquetar varios TCs en un solo test.
- **Tags consistentes**: `@P1 @functional @migration MX-XXXX <Name>` en el describe.

## Paso 7 — Validacion local

```powershell
npm run typecheck     # debe ser exit 0
npm run lint          # 0 errors (warnings pre-existentes OK)
```

Si typecheck rojo: ajustar imports/tipos del POM. Si lint rojo: corregir
violacion.

(Opcional si `.env.test` cargado y backend TEST disponible):

```powershell
cross-env ENV=test npx playwright test tests/specs/<dominio>/<spec>.spec.ts --project=carrier-v2-desktop --workers=1 --headed
```

Si pasa local: bonus, mas confianza. Si falla por backend caido o intermitente:
documentar y dejar que el CI valide despues.

## Paso 8 — Regenerar trazabilidad

```powershell
npm run traceability
```

Actualiza `traceability/tc-map.{md,json}` con el nuevo spec.

## Paso 9 — Update backlog + xlsx tracker

### docs/backlog/AUTOMATION-BACKLOG.md

- Buscar la fila de la pantalla en su tier (P2/P3/Channels).
- Cambiar el Estado de `🔵 pendiente` a `🟡 In progress (PR abierto)`.

### docs/backlog/pantallas-tracking.xlsx

Opcion A — Python ad-hoc:

```python
import openpyxl
from datetime import date

wb = openpyxl.load_workbook('docs/backlog/pantallas-tracking.xlsx')
ws = wb['Pantallas']
# Buscar la fila por nombre o MX y actualizar:
for row in ws.iter_rows(min_row=2, values_only=False):
    if row[4].value == 'MX-XXXX':   # columna E = MX Ticket
        row[8].value = 'PR abierto'              # Estado
        row[9].value = 'tests/pages/carrier-v2/<Name>Page.ts'  # POM path
        row[10].value = 'tests/specs/<dom>/<name>.spec.ts'     # Spec path
        row[12].value = '<<TU_USUARIO>>'         # Owner
        break
wb.save('docs/backlog/pantallas-tracking.xlsx')
```

Opcion B — Pedir a Claude que invoque la skill `xlsx` con args claros.

## Paso 10 — Commit

```powershell
git add tests/pages/carrier-v2/<Name>Page.ts tests/specs/<dom>/<name>.spec.ts traceability/ docs/backlog/
git commit -m "feat(carrier-v2): [MX-XXXX] <Name>Page POM + spec smoke"
```

Formato OBLIGATORIO (commitlint enforced): `<tipo>(<scope>): [MX-XXXX] desc`.

- Tipos validos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- Husky correra typecheck + lint-staged en pre-commit (puede fallar si dejaste
  algo roto — corregir y re-commit).

## Paso 11 — Push + PR

```powershell
git push -u origin carrier-v2/<dominio>-<nombre-pantalla>
gh pr create --base main --head carrier-v2/<dominio>-<nombre-pantalla> --title "feat(carrier-v2): [MX-XXXX] <Name>Page" --body "$(cat <<'EOF'
## Resumen

POM + spec smoke para <Name> (MX-XXXX), siguiendo el plan de pruebas validado
en la sesion preparatoria.

Patron: extends <BaseListPage|BaseDetailPage|BasePage>.

## Cobertura

- TC01 <titulo del TC>
- TC02 <titulo del TC>
- TC03 <titulo del TC>

## Discovery

- URL confirmada: /carrier/#/<route>
- Selectores derivados de aria-snapshot capturado el <fecha>.
- (Opcional) Screenshot evidence: evidence/discovery/<name>.png

## Validacion local

- [x] npm run typecheck verde
- [x] npm run lint 0 errors
- [ ] CI quality-checks verde tras push
- [ ] CI smoke verde tras push (depende de backend TEST)

## Trazabilidad

- traceability/tc-map.{md,json} regenerado.
- docs/backlog/AUTOMATION-BACKLOG.md actualizado (estado: PR abierto).
- docs/backlog/pantallas-tracking.xlsx actualizado.
EOF
)"
```

**REGLA CRITICA**: NO incluir el footer `🤖 Generated with Claude Code` en
ningun PR body. Preferencia del proyecto (memoria `pr-sin-footer-claude`).

## Paso 12 — Esperar CI + Merge

```powershell
gh pr checks <num>   # ver estado live (puede tardar 1-10 min)
```

Verde minimo requerido:

- `quality-checks` (lint + typecheck en CI) — siempre debe pasar si paso local.
- `GitGuardian Security` — debe pasar (no commiteamos secrets).
- `smoke-test` — depende de backend TEST + de los tests nuevos. Si falla:
  - Diagnosticar con `gh run view <run-id> --log-failed`.
  - Si es bug del spec: corregir, push fix, esperar de nuevo.
  - Si es flakey del backend: re-run del job.

Cuando todo verde:

```powershell
gh pr merge <num> --squash --delete-branch
```

## Paso 13 — Sync main + cleanup

```powershell
git checkout main
git pull origin main
git fetch origin --prune
```

Tu branch local ya esta borrada; el `--prune` limpia la referencia remota
stale.

## Paso 14 — Cerrar la fila del xlsx

Actualizar `docs/backlog/pantallas-tracking.xlsx`:

- Estado: `Done`.
- Fecha_done: fecha de hoy (formato YYYY-MM-DD).

Esto va en un PR separado al final (acumular varios xlsx updates) o en el
mismo PR de la pantalla si lo agregaste antes del Paso 10. Recomendado:
acumular y abrir un PR `docs(backlog): update tracker xlsx (N pantallas done)`
cada 3-5 pantallas.

## Paso 15 — Reporte y siguiente pantalla

Reportarme antes de pasar a la siguiente:

```
Pantalla <N> completada:
- URL del PR mergeado: https://github.com/Emanuelrestrepo22/magiis-v2/pull/<num>
- Tiempo total: <horas> (estimado <S/M/L>).
- TCs implementados: <count> (de <total planeado>).
- Gotchas / aprendizajes: <texto> (si hubo).
- Memorias a sumar al proyecto: <texto> (si descubri una regla nueva).

Paso a la pantalla <N+1>: <nombre>. Continuo o necesitas validar algo?
```

Si descubrieras una pantalla NUEVA en el camino (no estaba en el plan
validado): NO la implementes ahora — agregarla al backlog + xlsx como
`Pendiente discovery` y avisarme.

# Modalidad ultracode

Activar incluyendo la palabra `ultracode` en el mensaje cuando:

- La pantalla tiene muchos sub-elementos (form complejo con N campos +
  validaciones cruzadas + N TCs).
- Es un refactor (cambiar herencia de varios POMs a la vez).
- Necesitas auditar varios archivos en paralelo.
- Vas a procesar varias pantallas en pipeline.

Para pantallas simples (1 POM + 3-5 TCs) no hace falta. Sin Workflow, agent
individual o trabajo directo.

# Convenciones (recordatorio fuerte)

- Commit: `<tipo>(<scope>): [MX-XXXX] desc`.
- PR body **SIN** footer "Generated with Claude Code".
- Locators: `getByRole > getByLabel > getByTestId > CSS`.
- POM heredados: `super.X()` en subclase, no `this.X()` que loopea.
- Sin `waitForTimeout` ni `waitForLoadState('networkidle')`.
- Snapshots en `<spec>-snapshots/`.
- Scope: solo pantallas desarrolladas (memoria `scope-pantallas-desarrolladas`).
- Trazabilidad: cada PR debe regenerar tc-map y actualizar backlog + xlsx.
- Asignar reviewer: vos (auto-merge si checks verdes) o un colega humano si
  pedis review.

# Que esperar de Claude (yo)

Por cada pantalla:

- Si el Paso 4 (POM) es trivial: implemento directo y muestro diff.
- Si es complejo: pido confirmacion del approach antes de escribir.
- Reporto outputs de cada `npm run` y comando `git` o `gh`.
- Si CI falla: investigo el log, propongo fix, espero tu OK antes de pushear.
- NO mergeo PRs sin tu OK explicito (`merge ya?` o similar) salvo que el plan
  validado lo haya autorizado de antemano.

# Empezamos

Pantalla #1 del plan validado: arrancar con el Paso 1.

END PROMPT — TERMINA AQUI

````

---

## Ejemplo de plan validado para pegar (referencia)

Asi se ve el bloque `<<<PEGAR PLAN DE PRUEBAS VALIDADO>>>` cuando esta listo:

```yaml
plan_validado:
  fecha_aprobacion: 2026-06-04
  aprobado_por: <Tu nombre>
  pantallas:
    - id: MX-5601
      pantalla: "Management Board"
      url_final: /carrier/#/owner-report
      patron_pom: BaseListPage
      selectores:
        heading: getByRole('heading', { name: /management board/i })
        tabla:   getByRole('table').first()
        search:  getByPlaceholder(/search/i).first()
      test_cases:
        - id: TC01
          titulo: "Acceso desde menu y carga sin error"
          prioridad: P1
        - id: TC02
          titulo: "Heading y breadcrumb visibles"
          prioridad: P1
        - id: TC03
          titulo: "Tabla renderiza al menos 1 row de KPI"
          prioridad: P1
      estimacion: M
      orden_implementacion: 1

    - id: MX-5725
      pantalla: "Client Create"
      url_final: /carrier/#/client/create
      patron_pom: BaseDetailPage
      # ... etc
      orden_implementacion: 2
````

---

## Ritmo esperado

| Pantalla esfuerzo                           | Tiempo estimado por loop (Pasos 1-15) |
| ------------------------------------------- | ------------------------------------- |
| S (lista simple, 3-4 TCs)                   | 30-60 min                             |
| M (form CRUD o lista con filtros, 5-8 TCs)  | 1-2 hs                                |
| L (mapa, drag-drop, form complejo, 10+ TCs) | 2-4 hs                                |

Sumando CI (typecheck + lint + smoke ~10 min por iteracion), una pantalla S
puede cerrarse en una sesion. Las L valen partir en sub-PRs si superan 4 hs.

## Que hacer si te trabas

| Sintoma                                                 | Accion                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Selector inventado funciona en mi maquina pero falla CI | Re-discovery + ajustar (no inventar)                                                             |
| CI smoke rojo solo en 1 test pero pasa local            | Investigar log, agregar `retries: 1` si es backend flakey real, NO comitear `--retries=N` global |
| `npm run typecheck` rojo tras paste de codigo           | Revisar imports, paths alias (`@pages/*`, `@fixtures/*`)                                         |
| Commit rechazado por commitlint                         | Cambiar mensaje a `<tipo>(<scope>): [MX-XXXX] desc`                                              |
| Husky rechaza por lint                                  | `npm run lint:fix` + re-commit                                                                   |
| PR description trae footer "Claude Code"                | Editar PR description en GitHub UI y borrar el footer                                            |
| Pantalla no esta en backlog                             | Agregarla a `AUTOMATION-BACKLOG.md` + xlsx con estado `🔵 pendiente` antes de implementar        |
| El plan validado tiene un TC que no aplica al DOM real  | Documentar la divergencia en el PR + actualizar plan antes de seguir                             |

## Checklist final antes de marcar pantalla como Done

- [ ] PR mergeado a main.
- [ ] CI verde (quality-checks + smoke).
- [ ] Branch local borrada (`git branch -d`).
- [ ] Branch remota borrada (`--delete-branch` en el merge).
- [ ] `docs/backlog/AUTOMATION-BACKLOG.md` actualizado (estado Done).
- [ ] `docs/backlog/pantallas-tracking.xlsx` actualizado (estado Done + fecha).
- [ ] `traceability/tc-map.md` muestra el nuevo spec en la tabla.
- [ ] Reporte al humano (vos) con metrics + gotchas.

Cuando los 8 checks esten OK, pasar a la siguiente pantalla.
