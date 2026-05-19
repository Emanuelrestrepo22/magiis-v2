# Backlog de automatización — carrier V2

Snapshot 2026-05-19. Cruza el sidebar discovery del portal deployado (`apps-test.magiis.com/carrier`) con el inventario de 88 branches `feature/MX-*` (`docs/inventory/v2-branches.json`).

## Criterio de priorización

| Prioridad | Criterio |
|---|---|
| **P1** | Pantallas críticas: login, dashboard principal, listados core de entidades (clients/owners/drivers/vehicles/trips), mapa operativo, settlements financieros. |
| **P2** | Formularios CRUD (create/edit/detail), pantallas frecuentes pero no críticas, settings de operación, reportes core. |
| **P3** | Settings auxiliares, reportes secundarios, pantallas de admin, integrations específicas. |
| **Out** | Pantallas no implementadas en V2 todavía o sin entrypoint visible en el sidebar. |

## Estado

| Estado | Significado |
|---|---|
| ✅ **Done** | POM + spec funcional + CI verde |
| 🟡 **In progress** | POM creado, spec parcial, sin CI |
| 🔵 **Next** | Ready para abrir spec en próxima iteración |
| ⏸ **Blocked** | Pantalla no disponible o requiere decisión externa |
| ❌ **Out** | Fuera de scope (frontend only / no migrado) |

## Total cobertura actual

| Tier | Pantallas | Tests | Cubierto |
|---|---|---|---|
| Done P1 | 7 + 1 visual | 19 + 1 = 20 | ✅ |
| **Próximas P1** | 8 | ~25 (estimado) | 🔵 |
| Próximas P2 | 14 | ~35 (estimado) | 🔵 |
| Próximas P3 | 18 | ~30 (estimado) | 🔵 |
| Out of scope | 5+ | n/a | ❌ |

---

## ✅ DONE (sprint actual — `carrier-v2/smoke-foundation`)

| # | Pantalla | URL V2 | MX | POM | Tests | Tipo |
|---|---|---|---|---|---|---|
| 1 | Login carrier | `/carrier/#/auth/login` | MX-5711 | `shared/LoginPage` | 2 | functional |
| 2 | Smoke shell | `/carrier/#/dashboard` | MX-5711 | `shared/ShellPage` | 1 | functional |
| 3 | Operations Control (dashboard) | `/carrier/#/dashboard` | MX-5711 | `OperationsControlPage` | 5 | functional |
| 4 | Client list | `/carrier/#/client/list` | MX-5197 + MX-5724 | `ClientListPage` | 3 | functional |
| 5 | Owner list | `/carrier/#/owner/list` | MX-5604 | `OwnerListPage` | 2 | functional |
| 6 | Driver list | `/carrier/#/driver/list` | MX-5711 | `DriverListPage` | 2 | functional |
| 7 | Vehicle list | `/carrier/#/vehicle/list` | MX-5711 | `VehicleListPage` | 3 | functional |
| 8 | Sidebar carrier | shell | MX-5711 | `ShellPage` | 1 | **visual** |
| | **TOTAL** | | | | **19+1** | |

---

## 🔵 P1 — Próximas (sprint siguiente)

Pantallas críticas para operación diaria, alto tráfico, valor de regresión alto.

| # | Pantalla | URL V2 | MX inventario | POM propuesto | Tests estimados | Tipo | Dependencia |
|---|---|---|---|---|---|---|---|
| 1 | Map Viewer | `/carrier/#/map-viewer` | MX-?-map-viewer | `MapViewerPage` | 3 (render, filtros, leyenda) | both | leaflet stable |
| 2 | New Trip | `/carrier/#/travel/create` | MX-?-travel-create | `NewTripPage` | 4-5 (form open, validation, addr autocomplete, payment method, submit) | functional | factories/tripFactory |
| 3 | Trips Dashboard (gestion) | `/carrier/#/travel/dashboard` | MX-?-travel-dashboard | `TripsDashboardPage` | 4 (heading, filters, table, paginacion) | functional | — |
| 4 | Trip Detail | `/carrier/#/travel/dashboard` + click row | MX-?-travel-detail | `TripDetailPage` | 4 (header, datos finales, presupuestados, mapa) | functional | TripsDashboard |
| 5 | Owner Liquidations | `/carrier/#/liquidations/owners/list` | MX-?-owner-liquidation | `OwnerLiquidationsListPage` | 3 (heading, filtros, totales) | functional | OwnerList |
| 6 | Driver Liquidations | `/carrier/#/liquidations/drivers/list` | MX-?-driver-liquidation | `DriverLiquidationsListPage` | 3 (heading, filtros, totales) | functional | DriverList |
| 7 | Credit Accounts — Clients | `/carrier/#/checking-accounts/clients` | MX-?-checking-accounts | `ClientCreditAccountsPage` | 3 (heading, search, table) | functional | ClientList |

> **Hallazgo discovery 2026-05-19**: `/carrier/#/travel/list` y `/carrier/#/travel/detail` rebotan a dashboard. Las pantallas reales son `travel/dashboard` (gestion = lista) y trip detail se abre haciendo click en una row del dashboard. Sprint 2 reducido de 8 a 7 pantallas P1.

---

## 🔵 P2 — Formularios CRUD + reportes operativos

| # | Pantalla | URL V2 | MX inventario | POM propuesto | Tests estimados | Tipo |
|---|---|---|---|---|---|---|
| 1 | Client Create | `/carrier/#/client/create` | MX-5725 + MX-?-client-create | `ClientCreatePage` | 5 (form validation, regions, submit) | functional |
| 2 | Client Edit | `/carrier/#/client/edit/:id` | MX-?-client-edit | `ClientEditPage` | 3 (load, edit, save) | functional |
| 3 | Client Contractors list | `/carrier/#/client/contractors` | MX-5727 + MX-?-client-contractor-list | `ClientContractorListPage` | 3 (heading, search, table) | functional |
| 4 | Owner Add | `/carrier/#/owner/add` | MX-?-owner-add | `OwnerAddPage` | 5 (form, vehicles assignment, submit) | functional |
| 5 | Owner Edit | `/carrier/#/owner/edit/:id` | MX-?-owner-edit | `OwnerEditPage` | 3 (load, edit, save) | functional |
| 6 | Trip Quotes | `/carrier/#/travel/quotes` | MX-?-travel-quotes | `TripQuotesPage` | 3 (heading, list, convert to trip) | functional |
| 7 | Recurring Trips | `/carrier/#/travel/recurring` | MX-?-travel-recurring | `RecurringTripsPage` | 3 (heading, list, schedule) | functional |
| 8 | Mappers | `/carrier/#/travel/mappers` | MX-?-travel-mapper | `MappersPage` | 2 (heading, mapping rules) | functional |
| 9 | Pay travels (Daily Clearing) | `/carrier/#/pay/travels` | MX-?-pay-travels | `PayTravelsPage` | 3 (heading, filters, batch action) | functional |
| 10 | Surrenders Report | `/carrier/#/pay/surrenders-report` | MX-?-surrenders-report | `SurrendersReportPage` | 2 (heading, filtros, totales) | functional |
| 11 | Passenger Liquidations | `/carrier/#/liquidations/passenger/list` | MX-?-passenger-liquidation | `PassengerLiquidationsListPage` | 2 (heading, filtros) | functional |
| 12 | Contractor Liquidations | `/carrier/#/liquidations/contractors/list` | MX-?-contractor-liquidation | `ContractorLiquidationsListPage` | 2 (heading, filtros) | functional |
| 13 | Management Board | `/carrier/#/owner-report` | MX-5601 + MX-?-owner-report | `ManagementBoardPage` | 3 (heading, KPI cards, top routes) | both |
| 14 | Heat Map | `/carrier/#/owner-heat-map` | MX-?-owner-heat-map | `HeatMapPage` | 2 (heading, mapa render) | both |

---

## 🔵 P3 — Settings + reportes secundarios + admin

| # | Pantalla | URL V2 | MX inventario | POM propuesto | Tests | Tipo |
|---|---|---|---|---|---|---|
| 1 | Settings — Parameters | `/carrier/#/settings/parameters` | MX-?-settings-parameters | `SettingsParametersPage` | 2 | functional |
| 2 | Settings — Transport Types | `/carrier/#/settings/transportTypes` | MX-?-settings-transport-types | `TransportTypesPage` | 2 | functional |
| 3 | Settings — Services Type | `/carrier/#/settings/servicesType/list` | MX-?-settings-services-type | `ServicesTypePage` | 2 | functional |
| 4 | Settings — Taxes & Fees | `/carrier/#/settings/taxesAndFees` | MX-?-reports-taxes-and-fees | `TaxesAndFeesPage` | 2 | functional |
| 5 | Settings — Other Costs | `/carrier/#/settings/otherCosts` | MX-?-settings-other-costs | `OtherCostsPage` | 2 | functional |
| 6 | Settings — Email Templates | `/carrier/#/settings/email-templates` | MX-?-email-templates | `EmailTemplatesPage` | 2 | functional |
| 7 | Settings — Branches | `/carrier/#/settings/branches/list` | MX-?-branches | `BranchesListPage` | 2 | functional |
| 8 | Settings — Travel Fare List | `/carrier/#/settings/travel-fare-list` | MX-?-travel-fare-list | `TravelFareListPage` | 2 | functional |
| 9 | Settings — Travel Fare Rules | `/carrier/#/settings/travel-fare-rules` | MX-?-settings-travel-fare-rules | `TravelFareRulesPage` | 2 | functional |
| 10 | Settings — Profile Access | `/carrier/#/settings/profiles-access` | MX-?-settings-profiles-access | `ProfilesAccessPage` | 2 | functional |
| 11 | Settings — Profiles | `/carrier/#/settings/profiles` | MX-?-settings-profiles | `ProfilesPage` | 2 | functional |
| 12 | Settings — Preferences | `/carrier/#/settings/preferences` | MX-?-settings-preferences | `PreferencesPage` | 1 | functional |
| 13 | AI Branches (Melita) | `/carrier/#/melita/ai-branches` | MX-?-melita-ai-branches | `MelitaAiBranchesPage` | 2 | functional |
| 14 | eAfiliates — Profile | `/carrier/#/affiliate/atc-profile` | MX-?-atc-profile | `AffiliateProfilePage` | 2 | functional |
| 15 | eAfiliates — Offering | `/carrier/#/affiliate/offering` | MX-?-affiliate-offering | `AffiliateOfferingPage` | 2 | functional |
| 16 | eAfiliates — Request | `/carrier/#/affiliate/request` | MX-?-affiliate-request | `AffiliateRequestPage` | 2 | functional |
| 17 | eAfiliates — Agreements requested | `/carrier/#/affiliate/os-agreement-requested` | MX-?-affiliate-os-agreement-requested | `AffiliateAgreementsRequestedPage` | 2 | functional |
| 18 | Magiis Apps Store (integrations) | `/carrier/#/integrations/list` | MX-5717 + MX-?-integrations-* | `IntegrationsListPage` | 2 | functional |

---

## ⏸ Reportes detallados (descubrir entrypoint)

El módulo Reports no expone submenus visibles desde el sidebar discovery. Branches con prefijo `reports-*` existen pero las URLs no se resolvieron. Pendiente: confirmar con dev el path correcto antes de automatizar.

| Branch suffix | Probable URL | Estado |
|---|---|---|
| `reports-agency-commissions` | `/reports/agency-commissions` ? | ⏸ |
| `reports-cash-flow` | `/reports/cash-flow` ? | ⏸ |
| `reports-corporate-services` | `/reports/corporate-services` ? | ⏸ |
| `reports-cost-center` | `/reports/cost-center` ? | ⏸ |
| `reports-daily` | `/reports/daily` ? | ⏸ |
| `reports-debt-aging` | `/reports/debt-aging` ? | ⏸ |
| `reports-documentation` | `/reports/documentation` ? | ⏸ |
| `reports-individual-ca-travels` | `/reports/individual-ca-travels` ? | ⏸ |
| `reports-payment-flow` | `/reports/payment-flow` ? | ⏸ |
| `reports-ranking-clients` | `/reports/ranking-clients` ? | ⏸ |
| `reports-tips` | `/reports/tips` ? | ⏸ |
| `reports-transaction-tracking` | `/reports/transaction-tracking` ? | ⏸ |
| `report-vehicles-ranking` | `/reports/vehicles-ranking` ? | ⏸ |

---

## ❌ Out of scope / blockers

| Tema | Razón |
|---|---|
| Stripe / Mercado Pago / payment gateways | Por reglas de proyecto (`scope-rules.md`). |
| Mobile pax/driver | Appium fuera de scope. |
| Backend asserts | API testing fuera de scope; solo UI. |
| MAGIIS Book submenus (3 URLs vacías) | Sidebar muestra `/url: "#/"` — no implementado aún. |
| Vehicles submenus extra (3 URLs vacías) | Idem MAGIIS Book — solo `Vehicles Management` (`/vehicle/list`) navega real. |
| Trips: 2 últimos items del submenu (URLs vacías) | No implementados. |
| GNET submenu | Es un agregado redundante de items de otros módulos (no aporta pantalla nueva). |

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

## Roadmap propuesto por sprint

| Sprint | Foco | Pantallas | Tests acumulados |
|---|---|---|---|
| **Sprint 1 (DONE)** | Smoke foundation + listas core | 7 + 1 visual | 20 |
| **Sprint 2** | Trips end-to-end | Map Viewer, New Trip, Trip List, Trip Detail, Trips Dashboard | +20 (~40 total) |
| **Sprint 3** | Settlements + Credit Accounts | Owner/Driver liquidations + Clients credit accounts | +15 (~55 total) |
| **Sprint 4** | CRUD clientes / propietarios | Client create/edit, Owner add/edit, Contractors | +20 (~75 total) |
| **Sprint 5** | Daily Clearing + Reports core | Pay travels, Surrenders, Reports priorizados | +15 (~90 total) |
| **Sprint 6** | Settings + integrations | Configuration submenus + Apps Store | +25 (~115 total) |
| **Sprint 7+** | Reportes detallados + eAfiliates | Backlog restante | +20 (~135 total) |

> Cada sprint tambien suma 1 spec visual por pantalla P1 cuando el equipo apruebe baseline.
