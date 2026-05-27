# Framework evolution plan — magiis-carrier-v2-e2e

> Plan de evolucion del framework Playwright + TypeScript. Generado a partir de la auditoria 2026-05-23.
>
> Este documento es **vivo**: cada PR de framework debe actualizar la fila correspondiente del backlog (estado, fecha, link a PR).

---

## Contexto

El repo arranca desde un baseline ya muy maduro (Playwright 1.49, TS strict, ESLint+Prettier+Husky+commitlint, Zod env validation, axe-core, faker, MCP, 4 workflows con Teams notify, 50+ POMs, base classes, factories, region-aware, env multi-target, snapshots junto al spec). La auditoria detecto **brechas focalizadas** mas que problemas estructurales.

**Top 3 riesgos identificados:**

1. Mono-portal estructural — preparado para multi-portal pero sin convencion formal.
2. Sin capa API ni mocks — toda validacion depende de UI + backend, costo CI alto.
3. Trazabilidad TC <-> spec implicita (tags + annotations) sin mapping versionado ni reporter cross-suite.

**Top 3 quick wins ejecutados (esta tanda):**

1. Guardrail anti `--update-snapshots` en `ENV=prod`.
2. Lint + typecheck como gate previo en los 4 workflows.
3. Trazabilidad versionada (`traceability/tc-map.{md,json}`) generada desde el codigo real.

---

## Roadmap por fases

Cada fila lista: ID, descripcion, archivos tocados, criterio de aceptacion, estado.

### Fase 0 — Quick wins (en curso)

| ID     | Item                                             | Archivos / artefactos                                  | Criterio aceptacion                                                  | Estado                                                               |
| ------ | ------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| FW-001 | docs: README + CLAUDE.md del repo                | `README.md`, `docs/architecture/*`                     | Onboarding <= 30 min                                                 | ✅ ya existia                                                        |
| FW-002 | ci: lint + typecheck como gate previo            | `.github/workflows/{smoke,regression,visual,a11y}.yml` | Job `quality-checks` corre antes de tests; bloquea si falla          | ✅ implementado                                                      |
| FW-003 | env: guardrail anti `--update-snapshots` en prod | `playwright.config.ts`                                 | Aborta con mensaje si `ENV=prod && argv contiene --update-snapshots` | ✅ implementado                                                      |
| FW-004 | tsconfig: limpiar alias `@data` huerfano         | `tsconfig.json`                                        | `npm run typecheck` sin warnings                                     | ⏭ NO aplica (alias valido — `tests/data/users.example.json` existe) |

### Fase 1 — Estructura

| ID      | Item                                                                                  | Archivos / artefactos                                                   | Criterio aceptacion                                                  | Estado                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FW-005  | refactor: segmentar specs por suite + dominio                                         | `tests/specs/{regression,exploratory}/<dominio>/`                       | Workflows verdes; tags preservados; `release-v2.0.2/` migrado        | 🟡 auditado (riesgo MEDIO, ver `fw-005-spec-migration-impact.md`; bloqueado por 3 decisiones: B-01, dominio settlements vs liquidations, politica `release-v2.0.2/`) |
| FW-006  | feat: traceability `tc-map.{md,json}` + script extractor                              | `traceability/`, `scripts/extract-tc-map.ts`, `package.json` npm script | `npm run traceability` regenera artefactos; specs orphan listados    | ✅ implementado                                                                                                                                                      |
| FW-007  | feat: locators compartidos extraidos a `tests/locators/<portal>/<screen>.locators.ts` | `tests/locators/carrier-v2/`                                            | Reuso real entre 2+ POMs sin regresion                               | ⏭ NO aplica — veredicto: los 5 duplicados criticos ya estan en `BaseListPage`. Ver `fw-007-locators-duplicate-analysis.md`.                                         |
| FW-007b | refactor: 4 List POMs heredan de `BaseListPage` sin redeclarar                        | `tests/pages/carrier-v2/{Client,Driver,Owner,Vehicle}ListPage.ts`       | 20 lineas duplicadas eliminadas; specs verdes; source-of-truth unico | 🔵 pendiente (sucesor de FW-007, scope acotado)                                                                                                                      |

### Fase 2 — Calidad

| ID     | Item                                                    | Archivos / artefactos                                               | Criterio aceptacion                                       | Estado                                                          |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| FW-008 | feat: capa API tipada con request context               | `tests/api/clients/<dominio>.client.ts`                             | Al menos 1 spec usa API para precondicion en vez de UI    | 🔵 pendiente (necesita endpoints)                               |
| FW-009 | feat: mocks deterministas via `route.fulfill`           | `tests/api/mocks/` (listMock.ts + README)                           | Helpers `mockListResponse`/`mockErrorResponse` listos     | 🟡 scaffold (helpers listos; ningun spec los consume aun)       |
| FW-010 | feat: `test-data/<portal>/` JSON fixtures deterministas | `tests/data/carrier-v2/<dominio>/*.json` + README + ejemplo         | Estructura + ejemplo qa*e2e* + README de uso              | 🟡 scaffold (estructura lista; fixtures se agregan por demanda) |
| FW-011 | feat: a11y thresholds + reporter agregado               | `tests/fixtures/a11yFixture.ts`, `scripts/generate-a11y-report.cjs` | Workflow falla si violations > baseline +X% (X a definir) | 🔵 pendiente (necesita baseline negociado)                      |

### Fase 3 — CI/CD y DX

| ID     | Item                                                        | Archivos / artefactos                 | Criterio aceptacion                                                   | Estado                                                |
| ------ | ----------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| FW-012 | ci: composite action `setup-pw`                             | `.github/actions/setup-pw/action.yml` | 4 workflows usan el composite; ~ -50% lineas duplicadas               | ✅ implementado                                       |
| FW-013 | ci: sharding 4-way en regression                            | `.github/workflows/regression.yml`    | Runtime regression < 30 min                                           | ✅ implementado (esperando ejecucion real para medir) |
| FW-014 | feat: scaffolding `npm run scaffold:page` / `scaffold:spec` | `scripts/scaffold/`                   | Generador en dry-run produce archivos alineados a POM-CONVENTIONS     | ✅ implementado                                       |
| FW-015 | feat: dashboard agregado (Allure o JUnit consolidado)       | `reports/`, workflows                 | Un link unico por release con resultados smoke+regression+visual+a11y | 🔵 pendiente (decision: Allure vs HTML consolidado)   |

---

## Lo que NO se hizo en esta tanda y por que

| Item                                          | Por que                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Mover specs `release-v2.0.2/` a `regression/` | Riesgo alto sin coordinacion: rompe paths en CI, imports cruzados con `explore/`, baselines visuales. Mejor en PR dedicada. |
| Extraer locators compartidos                  | Requiere auditoria previa real (grep + diff) para identificar duplicados — no se hace a ciegas.                             |
| api/clients tipados                           | Necesita endpoints reales y permisos de read-only de QA en backend.                                                         |
| api/mocks                                     | Depende de identificar primero los specs con datos volatiles.                                                               |
| a11y thresholds                               | Necesita acuerdo con stakeholders sobre baseline numerico aceptable (memoria: 478 nodos 2026-05-21).                        |
| Dashboard agregado                            | Decision pendiente: Allure (deps extras + setup CI) vs HTML consolidado con script propio.                                  |
| Touch `README.md`                             | El README existente ya es completo (313 lineas); cambios irian de la mano de Fase 1 cuando se reubiquen specs.              |

---

## Como continuar este plan

1. Tomar un item con estado 🔵 y abrir branch `carrier-v2/fw-<id>-<slug>`.
2. Marcar el item como 🟡 en este documento + asignar PR link.
3. Cuando merge, marcar ✅ con fecha y commit hash.
4. Si surge un item nuevo, agregar fila al final con ID `FW-016+` y descripcion + criterio.

## Trazabilidad de esta auditoria

- Auditoria base: 2026-05-23 (sesion Claude Code).
- Branch de implementacion inicial: `carrier-v2/teams-notifications` (working tree, no commiteado).
- PRs aplicadas en working tree: FW-002, FW-003, FW-006, FW-012, FW-013, FW-014.
- Memoria global referenciada:
  - `a11y-audit-findings-2026-05-21.md` (baseline 478 nodos para FW-011).
  - `playwright-snapshots-path.md` (baselines junto al spec, alineado).
  - `playwright-css-gotchas.md` (flag `i` + getByPlaceholder hidden).
  - `github-actions-gotchas.md` (workflow_dispatch default branch + git add sin globstar).
