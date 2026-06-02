# Backlog de automatización — carrier V2

Snapshot 2026-05-19. Cruza el sidebar discovery del portal deployado (`apps-test.magiis.com/carrier`) con el inventario de 88 branches `feature/MX-*` (`docs/inventory/v2-branches.json`).

## Criterio de priorización

| Prioridad | Criterio                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1**    | Pantallas críticas: login, dashboard principal, listados core de entidades (clients/owners/drivers/vehicles/trips), mapa operativo, settlements financieros. |
| **P2**    | Formularios CRUD (create/edit/detail), pantallas frecuentes pero no críticas, settings de operación, reportes core.                                          |
| **P3**    | Settings auxiliares, reportes secundarios, pantallas de admin, integrations específicas.                                                                     |
| **Out**   | Pantallas no implementadas en V2 todavía o sin entrypoint visible en el sidebar.                                                                             |

## Estado

| Estado             | Significado                                        |
| ------------------ | -------------------------------------------------- |
| ✅ **Done**        | POM + spec funcional + CI verde                    |
| 🟡 **In progress** | POM creado, spec parcial, sin CI                   |
| 🔵 **Next**        | Ready para abrir spec en próxima iteración         |
| ⏸ **Blocked**      | Pantalla no disponible o requiere decisión externa |
| ❌ **Out**         | Fuera de scope (frontend only / no migrado)        |

## Total cobertura actual

| Tier            | Pantallas    | Tests          | Cubierto |
| --------------- | ------------ | -------------- | -------- |
| Done P1         | 7 + 1 visual | 19 + 1 = 20    | ✅       |
| **Próximas P1** | 8            | ~25 (estimado) | 🔵       |
| Próximas P2     | 14           | ~35 (estimado) | 🔵       |
| Próximas P3     | 18           | ~30 (estimado) | 🔵       |
| Out of scope    | 5+           | n/a            | ❌       |

---

## ✅ DONE (sprint actual — `carrier-v2/smoke-foundation`)

| #   | Pantalla                       | URL V2                    | MX                | POM                     | Tests    | Tipo       |
| --- | ------------------------------ | ------------------------- | ----------------- | ----------------------- | -------- | ---------- |
| 1   | Login carrier                  | `/carrier/#/auth/login`   | MX-5711           | `shared/LoginPage`      | 2        | functional |
| 2   | Smoke shell                    | `/carrier/#/dashboard`    | MX-5711           | `shared/ShellPage`      | 1        | functional |
| 3   | Operations Control (dashboard) | `/carrier/#/dashboard`    | MX-5711           | `OperationsControlPage` | 5        | functional |
| 4   | Client list                    | `/carrier/#/client/list`  | MX-5197 + MX-5724 | `ClientListPage`        | 3        | functional |
| 5   | Owner list                     | `/carrier/#/owner/list`   | MX-5604           | `OwnerListPage`         | 2        | functional |
| 6   | Driver list                    | `/carrier/#/driver/list`  | MX-5711           | `DriverListPage`        | 2        | functional |
| 7   | Vehicle list                   | `/carrier/#/vehicle/list` | MX-5711           | `VehicleListPage`       | 3        | functional |
| 8   | Sidebar carrier                | shell                     | MX-5711           | `ShellPage`             | 1        | **visual** |
|     | **TOTAL**                      |                           |                   |                         | **19+1** |            |

---

## 🔵 P1 — Próximas (sprint siguiente)

Pantallas críticas para operación diaria, alto tráfico, valor de regresión alto.

| #   | Pantalla                  | URL V2                                    | MX inventario           | POM propuesto                | Tests estimados                                                        | Tipo       | Dependencia           |
| --- | ------------------------- | ----------------------------------------- | ----------------------- | ---------------------------- | ---------------------------------------------------------------------- | ---------- | --------------------- |
| 1   | Map Viewer                | `/carrier/#/map-viewer`                   | MX-?-map-viewer         | `MapViewerPage`              | 3 (render, filtros, leyenda)                                           | both       | leaflet stable        |
| 2   | New Trip                  | `/carrier/#/travel/create`                | MX-?-travel-create      | `NewTripPage`                | 4-5 (form open, validation, addr autocomplete, payment method, submit) | functional | factories/tripFactory |
| 3   | Trips Dashboard (gestion) | `/carrier/#/travel/dashboard`             | MX-?-travel-dashboard   | `TripsDashboardPage`         | 4 (heading, filters, table, paginacion)                                | functional | —                     |
| 4   | Trip Detail               | `/carrier/#/travel/dashboard` + click row | MX-?-travel-detail      | `TripDetailPage`             | 4 (header, datos finales, presupuestados, mapa)                        | functional | TripsDashboard        |
| 5   | Owner Liquidations        | `/carrier/#/liquidations/owners/list`     | MX-?-owner-liquidation  | `OwnerLiquidationsListPage`  | 3 (heading, filtros, totales)                                          | functional | OwnerList             |
| 6   | Driver Liquidations       | `/carrier/#/liquidations/drivers/list`    | MX-?-driver-liquidation | `DriverLiquidationsListPage` | 3 (heading, filtros, totales)                                          | functional | DriverList            |
| 7   | Credit Accounts — Clients | `/carrier/#/checking-accounts/clients`    | MX-?-checking-accounts  | `ClientCreditAccountsPage`   | 3 (heading, search, table)                                             | functional | ClientList            |

> **Hallazgo discovery 2026-05-19**: `/carrier/#/travel/list` y `/carrier/#/travel/detail` rebotan a dashboard. Las pantallas reales son `travel/dashboard` (gestion = lista) y trip detail se abre haciendo click en una row del dashboard. Sprint 2 reducido de 8 a 7 pantallas P1.

### Estado de cobertura real (2026-05-24)

Revision de cobertura efectiva cruzando el plan P1 con los POMs/specs ya existentes:

| #   | Pantalla                  | POM real                                                                      | Spec real                                                                        | Estado     | Nota                                                                                                                                                               |
| --- | ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Map Viewer                | `MapViewerPage`                                                               | `dashboards/map-viewer.spec.ts` (MX-5559)                                        | ✅ Done    | 3 tests @P1                                                                                                                                                        |
| 2   | New Trip                  | —                                                                             | —                                                                                | ⏸ Diferido | **Pantalla de alta complejidad AUN NO DESARROLLADA en el portal V2.** Fuera del scope actual. Sera de las ultimas en automatizarse, cuando dev la implemente.      |
| 3   | Trips Dashboard           | `TravelDashboardPage`                                                         | `dashboards/travel-dashboard.spec.ts` (MX-5529)                                  | ✅ Done    | 3 tests @P1                                                                                                                                                        |
| 4   | Trip Detail               | —                                                                             | —                                                                                | ⏸ Diferido | **Pantalla de alta complejidad AUN NO DESARROLLADA en el portal V2.** Misma razon que New Trip. Fuera del scope actual.                                            |
| 5   | Owner Liquidations        | `SettlementsOwnerListPage`                                                    | `sprint8-detail-flows.spec.ts` + `sprint8-detail-create-flows.spec.ts` (MX-5647) | ✅ Done    | Lista + flujo padre->hijo                                                                                                                                          |
| 6   | Driver Liquidations       | `SettlementsDriverListPage`                                                   | idem                                                                             | ✅ Done    | Lista + flujo padre->hijo                                                                                                                                          |
| 7   | Credit Accounts — Clients | `AffiliateCheckingAccountPage` (MX-5554) + `GnetCreditAccountsPage` (MX-5574) | `affiliate/checking-account-detailed.spec.ts` (10 TCs) + `sprint3-p2.spec.ts`    | ✅ Done    | La URL `/checking-accounts/clients` del snapshot 2026-05-19 nunca se confirmo; la cobertura real vive bajo `/affiliate/checking-account` y `/gnet/credit-accounts` |

**Resumen**: de las 7 pantallas del plan P1, **2 (New Trip, Trip Detail) NO estan desarrolladas aun en el portal V2** y quedan diferidas — alta complejidad, seran las ultimas en automatizarse cuando dev las implemente. De las **5 desarrolladas, las 5 estan cubiertas (100%)**. El scope de automatizacion se limita a pantallas ya implementadas en el backlog.

> **Criterio de scope (2026-05-24)**: solo se automatizan pantallas ya desarrolladas/disponibles en el portal V2. Pantallas no desarrolladas (como New Trip y Trip Detail) se difieren hasta que dev las implemente — no se crean POMs con selectores inventados.

---

## 🔵 P2 — Formularios CRUD + reportes operativos

| #   | Pantalla                     | URL V2                                     | MX inventario                         | POM propuesto                    | Tests estimados                       | Tipo       |
| --- | ---------------------------- | ------------------------------------------ | ------------------------------------- | -------------------------------- | ------------------------------------- | ---------- |
| 1   | Client Create                | `/carrier/#/client/create`                 | MX-5725 + MX-?-client-create          | `ClientCreatePage`               | 5 (form validation, regions, submit)  | functional |
| 2   | Client Edit                  | `/carrier/#/client/edit/:id`               | MX-?-client-edit                      | `ClientEditPage`                 | 3 (load, edit, save)                  | functional |
| 3   | Client Contractors list      | `/carrier/#/client/contractors`            | MX-5727 + MX-?-client-contractor-list | `ClientContractorListPage`       | 3 (heading, search, table)            | functional |
| 4   | Owner Add                    | `/carrier/#/owner/add`                     | MX-?-owner-add                        | `OwnerAddPage`                   | 5 (form, vehicles assignment, submit) | functional |
| 5   | Owner Edit                   | `/carrier/#/owner/edit/:id`                | MX-?-owner-edit                       | `OwnerEditPage`                  | 3 (load, edit, save)                  | functional |
| 6   | Trip Quotes                  | `/carrier/#/travel/quotes`                 | MX-?-travel-quotes                    | `TripQuotesPage`                 | 3 (heading, list, convert to trip)    | functional |
| 7   | Recurring Trips              | `/carrier/#/travel/recurring`              | MX-?-travel-recurring                 | `RecurringTripsPage`             | 3 (heading, list, schedule)           | functional |
| 8   | Mappers                      | `/carrier/#/travel/mappers`                | MX-?-travel-mapper                    | `MappersPage`                    | 2 (heading, mapping rules)            | functional |
| 9   | Pay travels (Daily Clearing) | `/carrier/#/pay/travels`                   | MX-?-pay-travels                      | `PayTravelsPage`                 | 3 (heading, filters, batch action)    | functional |
| 10  | Surrenders Report            | `/carrier/#/pay/surrenders-report`         | MX-?-surrenders-report                | `SurrendersReportPage`           | 2 (heading, filtros, totales)         | functional |
| 11  | Passenger Liquidations       | `/carrier/#/liquidations/passenger/list`   | MX-?-passenger-liquidation            | `PassengerLiquidationsListPage`  | 2 (heading, filtros)                  | functional |
| 12  | Contractor Liquidations      | `/carrier/#/liquidations/contractors/list` | MX-?-contractor-liquidation           | `ContractorLiquidationsListPage` | 2 (heading, filtros)                  | functional |
| 13  | Management Board             | `/carrier/#/owner-report`                  | MX-5601 + MX-?-owner-report           | `ManagementBoardPage`            | 3 (heading, KPI cards, top routes)    | both       |
| 14  | Heat Map                     | `/carrier/#/owner-heat-map`                | MX-?-owner-heat-map                   | `HeatMapPage`                    | 2 (heading, mapa render)              | both       |

---

## 🔵 P3 — Settings + reportes secundarios + admin

| #   | Pantalla                          | URL V2                                        | MX inventario                         | POM propuesto                      | Tests | Tipo       |
| --- | --------------------------------- | --------------------------------------------- | ------------------------------------- | ---------------------------------- | ----- | ---------- |
| 1   | Settings — Parameters             | `/carrier/#/settings/parameters`              | MX-?-settings-parameters              | `SettingsParametersPage`           | 2     | functional |
| 2   | Settings — Transport Types        | `/carrier/#/settings/transportTypes`          | MX-?-settings-transport-types         | `TransportTypesPage`               | 2     | functional |
| 3   | Settings — Services Type          | `/carrier/#/settings/servicesType/list`       | MX-?-settings-services-type           | `ServicesTypePage`                 | 2     | functional |
| 4   | Settings — Taxes & Fees           | `/carrier/#/settings/taxesAndFees`            | MX-?-reports-taxes-and-fees           | `TaxesAndFeesPage`                 | 2     | functional |
| 5   | Settings — Other Costs            | `/carrier/#/settings/otherCosts`              | MX-?-settings-other-costs             | `OtherCostsPage`                   | 2     | functional |
| 6   | Settings — Email Templates        | `/carrier/#/settings/email-templates`         | MX-?-email-templates                  | `EmailTemplatesPage`               | 2     | functional |
| 7   | Settings — Branches               | `/carrier/#/settings/branches/list`           | MX-?-branches                         | `BranchesListPage`                 | 2     | functional |
| 8   | Settings — Travel Fare List       | `/carrier/#/settings/travel-fare-list`        | MX-?-travel-fare-list                 | `TravelFareListPage`               | 2     | functional |
| 9   | Settings — Travel Fare Rules      | `/carrier/#/settings/travel-fare-rules`       | MX-?-settings-travel-fare-rules       | `TravelFareRulesPage`              | 2     | functional |
| 10  | Settings — Profile Access         | `/carrier/#/settings/profiles-access`         | MX-?-settings-profiles-access         | `ProfilesAccessPage`               | 2     | functional |
| 11  | Settings — Profiles               | `/carrier/#/settings/profiles`                | MX-?-settings-profiles                | `ProfilesPage`                     | 2     | functional |
| 12  | Settings — Preferences            | `/carrier/#/settings/preferences`             | MX-?-settings-preferences             | `PreferencesPage`                  | 1     | functional |
| 13  | AI Branches (Melita)              | `/carrier/#/melita/ai-branches`               | MX-?-melita-ai-branches               | `MelitaAiBranchesPage`             | 2     | functional |
| 14  | eAfiliates — Profile              | `/carrier/#/affiliate/atc-profile`            | MX-?-atc-profile                      | `AffiliateProfilePage`             | 2     | functional |
| 15  | eAfiliates — Offering             | `/carrier/#/affiliate/offering`               | MX-?-affiliate-offering               | `AffiliateOfferingPage`            | 2     | functional |
| 16  | eAfiliates — Request              | `/carrier/#/affiliate/request`                | MX-?-affiliate-request                | `AffiliateRequestPage`             | 2     | functional |
| 17  | eAfiliates — Agreements requested | `/carrier/#/affiliate/os-agreement-requested` | MX-?-affiliate-os-agreement-requested | `AffiliateAgreementsRequestedPage` | 2     | functional |
| 18  | Magiis Apps Store (integrations)  | `/carrier/#/integrations/list`                | MX-5717 + MX-?-integrations-\*        | `IntegrationsListPage`             | 2     | functional |

### Estado de cobertura real P3 (2026-05-27)

Auditoria completa en [`docs/audit/p3-coverage-analysis.md`](../audit/p3-coverage-analysis.md). De las 18 P3:

- ✅ **1 cubierta**: Settings — Other Costs (`SettingsOtherCostsPage`, MX-5575) con specs detailed + a11y + visual.
- 🟡 **0 falta-spec**: ningun POM P3 sin spec → cero trabajo inmediato.
- ⏸ **17 no desarrolladas**: declaradas en `ROUTING-V2.0.4.md` pero sin render confirmado en discovery. Diferidas por criterio de scope.

**Cierre de auditoria de cobertura (3 tiers)**: P1 5/5 desarrolladas cubiertas; P2 4 cubiertas + 10 sin POM (bloqueadas por DOM); P3 1 cubierta + 17 no desarrolladas. **El cronograma de cobertura esta agotado para lo ejecutable sin acceso a DOM/discovery/backend.** Desbloqueo: sesion de discovery con backend TEST o MCP Playwright para confirmar cuales de las 27 pendientes (10 P2 + 17 P3) renderizan, y recien ahi crear POMs con selectores reales.

---

## ⏸ Reportes detallados (descubrir entrypoint)

El módulo Reports no expone submenus visibles desde el sidebar discovery. Branches con prefijo `reports-*` existen pero las URLs no se resolvieron. Pendiente: confirmar con dev el path correcto antes de automatizar.

| Branch suffix                   | Probable URL                       | Estado |
| ------------------------------- | ---------------------------------- | ------ |
| `reports-agency-commissions`    | `/reports/agency-commissions` ?    | ⏸      |
| `reports-cash-flow`             | `/reports/cash-flow` ?             | ⏸      |
| `reports-corporate-services`    | `/reports/corporate-services` ?    | ⏸      |
| `reports-cost-center`           | `/reports/cost-center` ?           | ⏸      |
| `reports-daily`                 | `/reports/daily` ?                 | ⏸      |
| `reports-debt-aging`            | `/reports/debt-aging` ?            | ⏸      |
| `reports-documentation`         | `/reports/documentation` ?         | ⏸      |
| `reports-individual-ca-travels` | `/reports/individual-ca-travels` ? | ⏸      |
| `reports-payment-flow`          | `/reports/payment-flow` ?          | ⏸      |
| `reports-ranking-clients`       | `/reports/ranking-clients` ?       | ⏸      |
| `reports-tips`                  | `/reports/tips` ?                  | ⏸      |
| `reports-transaction-tracking`  | `/reports/transaction-tracking` ?  | ⏸      |
| `report-vehicles-ranking`       | `/reports/vehicles-ranking` ?      | ⏸      |

---

## ⏸ Pantallas nuevas detectadas en CI visual (post-snapshot)

Hallazgos cuando el nightly visual reporta drift por items de sidebar agregados por dev despues del ultimo snapshot del backlog. Pendientes de discovery (URL + tier + MX) antes de crear POM.

| Item sidebar | Posicion en V2                                                | Detectado en                                                                                                                                                                                                       | URL probable                                                              | Estado | Nota                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Channels** | entre `Magiis Apps Store` y `Configuration` (sidebar pos #17) | nightly visual 2026-05-31 / 06-01 / 06-02 (run [26817693522](https://github.com/Emanuelrestrepo22/magiis-v2/actions/runs/26817693522)); rompio el baseline `sidebar-desktop-visual-linux.png` con 424 px diff (1%) | sin confirmar — posible `/carrier/#/channels` o subitem de `integrations` | ⏸      | Modulo nuevo agregado por dev al portal V2 sin actualizar `ROUTING-V2.0.4.md`. Tier probable: P3 (admin/integration por proximidad a `Magiis Apps Store` y `Configuration`). Discovery: navegar el item en `tests/specs/exploratory/p2-p3-discovery.spec.ts` con `RUN_DISCOVERY=true` agregando la ruta cuando dev la confirme. |

> El baseline visual del sidebar se regenero (workflow_dispatch + update_baselines=true). Si aparece otro item nuevo en futuros runs, anotarlo aca con el mismo patron.

---

## ❌ Out of scope / blockers

| Tema                                             | Razón                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Stripe / Mercado Pago / payment gateways         | Por reglas de proyecto (`scope-rules.md`).                                      |
| Mobile pax/driver                                | Appium fuera de scope.                                                          |
| Backend asserts                                  | API testing fuera de scope; solo UI.                                            |
| MAGIIS Book submenus (3 URLs vacías)             | Sidebar muestra `/url: "#/"` — no implementado aún.                             |
| Vehicles submenus extra (3 URLs vacías)          | Idem MAGIIS Book — solo `Vehicles Management` (`/vehicle/list`) navega real.    |
| Trips: 2 últimos items del submenu (URLs vacías) | No implementados.                                                               |
| GNET submenu                                     | Es un agregado redundante de items de otros módulos (no aporta pantalla nueva). |

---

## Convenciones para nuevos POMs

Cuando se tome una pantalla del backlog para automatizar:

1. **Discovery**: si la URL no está confirmada, agregar al spec exploratorio `tests/specs/explore/sidebar-discovery.spec.ts`.
2. **POM**: crear en `tests/pages/carrier-v2/<Nombre>Page.ts` extendiendo `BasePage`, con JSDoc `@jira MX-XXXX @route ... @priority P1|P2|P3 @type functional|visual|both`.
3. **Selectores**: priorizar `getByRole > getByLabel > getByTestId > formcontrolname` (ver `docs/analysis/canonical-selectors.md`).
4. **Spec**: en `tests/specs/<modulo>/<pantalla>.spec.ts` con tags `@P1|@P2|@P3 @functional|@visual|@both @migration` + `test.info().annotations.push({ type: 'jira', description: 'MX-XXXX' })`.
5. **Barrel**: exportar el POM desde `tests/pages/carrier-v2/index.ts`.
6. **Validar local**: `npx playwright test tests/specs/<modulo> --project=carrier-v2-desktop --headed --workers=1`.
7. **Commit trazable**: `feat(carrier-v2/<modulo>): [MX-XXXX] <pantalla> POM + spec P1`.

## 🔵 Iniciativas de infraestructura / visibilidad

### REPORT-TEAMS-001 — Publicar reportes QA en Microsoft Teams

**Objetivo**: que el equipo vea sin esfuerzo el resultado de cada run de CI (smoke / regression / visual / a11y) sin tener que entrar a GitHub Actions.

**Alcance propuesto:**

| Item                                                        | Descripcion                                                                                                                                               | Esfuerzo                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1. Incoming Webhook en canal Teams del equipo QA            | Configurar webhook URL en canal. PM/Tech Lead lo provee.                                                                                                  | S (10 min config)            |
| 2. Step en workflow `smoke.yml` que postea resumen tras run | Usar action `simenandre/microsoft-teams@v3` o curl directo. Posteo trae: branch, commit, status (verde/rojo), # tests passed/failed, link al HTML report. | M (1h por workflow)          |
| 3. Idem para `regression.yml`, `visual.yml`, `a11y.yml`     | Aplicar mismo patron a los 4 workflows.                                                                                                                   | M (replicar)                 |
| 4. Reporte semanal consolidado                              | Schedule weekly que postea metricas: cobertura, tendencia de flakes, top 3 bugs a11y.                                                                     | M-L                          |
| 5. Link a HTML reports embebido                             | GitHub Pages publica el HTML report de Playwright tras cada run. Mensaje en Teams incluye link.                                                           | L (necesita gh-pages branch) |

**Trazabilidad**: cuando el reporte de Teams haga link al HTML report, este expone los `MX-XXXX-TCNN` annotations -> directo al ticket Jira.

**Dependencias:**

- Webhook URL del canal Teams del equipo (provista por PM/Tech Lead).
- Decision: HTML report en GitHub Pages publico, o solo accesible vía artifact (requiere login). Lo segundo limita visibilidad externa.

**Cuando hacer**: cuando se quiera maxima visibilidad para stakeholders y reducir el switch GitHub <-> Teams. Util tambien para QA Manual que no tiene cuenta GitHub.

**Estado actual (2026-05-23)**: implementado para los 4 workflows (smoke / regression / visual / a11y) via `scripts/notify-teams.sh` + step `Notify Teams` con `if: always()`. El webhook vive en GitHub Environment `TEST` como secret `TEAMS_WEBHOOK_URL`.

**Nota tecnica — contrato del flow de Power Automate**:

- El flow debe usar el trigger `When a Teams webhook request is received` + accion `Post card in a chat or channel` (no `Post message`).
- El body del POST debe ser una `AdaptiveCard` valida (schema `http://adaptivecards.io/schemas/adaptive-card.json`, `version: 1.5`), **no** `MessageCard` legacy ni `text` plano.
- El endpoint responde `202 Accepted` cuando el payload es valido. Cualquier otro codigo se loguea con body completo y marca el step como fallido (pero `continue-on-error: true` impide que tumbe el job).

---

### FW-001..FW-015 — Evolucion del framework

Auditoria 2026-05-23. Detalle por item (archivos, criterio de aceptacion, dependencias) en [docs/audit/framework-evolution-plan.md](../audit/framework-evolution-plan.md).

| ID      | Item                                              | Fase | Estado                                 |
| ------- | ------------------------------------------------- | ---- | -------------------------------------- |
| FW-001  | README + docs de convenciones del repo            | 0    | ✅ ya existia                          |
| FW-002  | Lint + typecheck como gate previo en CI           | 0    | ✅ implementado                        |
| FW-003  | Guardrail anti `--update-snapshots` en `ENV=prod` | 0    | ✅ implementado                        |
| FW-004  | Limpiar alias `@data` huerfano                    | 0    | ⏭ NO aplica                           |
| FW-005  | Segmentar specs por suite + dominio               | 1    | 🟡 auditado (3 decisiones bloqueantes) |
| FW-006  | Trazabilidad `tc-map.{md,json}` + extractor       | 1    | ✅ implementado                        |
| FW-007  | Locators compartidos `tests/locators/carrier-v2/` | 1    | ⏭ NO aplica (ya cubierto por Base)    |
| FW-007b | Refactor 4 List POMs heredan de `BaseListPage`    | 1    | ✅ implementado (-87 lineas)           |
| FW-007c | Auditoria 4 Settlements ListPage POMs             | 1    | ⏭ NO aplica (ya estaban limpios)      |
| FW-007d | Auditoria 10 POMs Detail + History                | 1    | ⏭ NO aplica (ya estaban limpios)      |
| FW-008  | Capa API tipada (`tests/api/clients/`)            | 2    | 🔵 pendiente                           |
| FW-009  | Mocks deterministas via `route.fulfill`           | 2    | 🔵 pendiente                           |
| FW-010  | Test-data JSON fixtures deterministas             | 2    | 🔵 pendiente                           |
| FW-011  | A11y thresholds + reporter agregado               | 2    | 🔵 pendiente                           |
| FW-012  | Composite action `setup-pw`                       | 3    | ✅ implementado                        |
| FW-013  | Sharding 4-way en regression                      | 3    | ✅ implementado                        |
| FW-014  | Scaffolding `scaffold:page` / `scaffold:spec`     | 3    | ✅ implementado                        |
| FW-015  | Dashboard agregado (Allure o HTML consolidado)    | 3    | 🔵 pendiente                           |

**Snapshot trazabilidad inicial (FW-006)**: 69 specs analizados, 37 con TC (54%), 32 huerfanos detectados — revisar y agregar annotations `jira`.

**Auditorias preparatorias** (2026-05-24): [`docs/audit/fw-005-spec-migration-impact.md`](../audit/fw-005-spec-migration-impact.md) y [`docs/audit/fw-007-locators-duplicate-analysis.md`](../audit/fw-007-locators-duplicate-analysis.md). FW-005 listo para ejecucion una vez resueltos: (1) destino de `release-v2.0.2/sprint2-p1.spec.ts` multi-dominio, (2) nombre dominio `settlements` vs `liquidations`, (3) politica `release-v2.0.2/`.

---

## Roadmap propuesto por sprint

| Sprint              | Foco                             | Pantallas                                                     | Tests acumulados |
| ------------------- | -------------------------------- | ------------------------------------------------------------- | ---------------- |
| **Sprint 1 (DONE)** | Smoke foundation + listas core   | 7 + 1 visual                                                  | 20               |
| **Sprint 2**        | Trips end-to-end                 | Map Viewer, New Trip, Trip List, Trip Detail, Trips Dashboard | +20 (~40 total)  |
| **Sprint 3**        | Settlements + Credit Accounts    | Owner/Driver liquidations + Clients credit accounts           | +15 (~55 total)  |
| **Sprint 4**        | CRUD clientes / propietarios     | Client create/edit, Owner add/edit, Contractors               | +20 (~75 total)  |
| **Sprint 5**        | Daily Clearing + Reports core    | Pay travels, Surrenders, Reports priorizados                  | +15 (~90 total)  |
| **Sprint 6**        | Settings + integrations          | Configuration submenus + Apps Store                           | +25 (~115 total) |
| **Sprint 7+**       | Reportes detallados + eAfiliates | Backlog restante                                              | +20 (~135 total) |

> Cada sprint tambien suma 1 spec visual por pantalla P1 cuando el equipo apruebe baseline.
