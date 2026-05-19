# Routing carrier V2 — release/v2.0.4 (oficial)

Snapshot: 2026-05-19. Fuente: `refs/v2 origin/release/v2.0.4 src/app/pages/carrier/carrier.routing.ts`.
HEAD release/v2.0.4: `4fce6b9` (arreglo cards owner-report).

## Resumen ejecutivo

| Item | Count |
|---|---|
| Total rutas activas | ~80 |
| Pantallas únicas (sin subrutas con `:id`) | ~70 |
| Pantallas con POM existente | 17 |
| Pantallas pendientes de cubrir | ~53 |
| 5 URLs antes "bloqueadas" — desbloqueadas | 3 (MX-5531, MX-5553, MX-5647) |
| Pantallas confirmadas NO existentes en release/v2.0.4 | 2 (MX-5564, MX-5570) |

## Routing por módulo

### Dashboard / Map (5)
- `/` y `/dashboard` → `CarrierDashboardComponent` (Operations Control)
- `/map-viewer` → `MapViewerComponent` — POM existente
- `/owner-report` → `OwnerReportComponent` (Management Board)
- `/owner-heat-map` → `OwnerHeatMapComponent`

### Travel (7 + CRUD detail)
- `/travel/create` → `NewTripComponent`
- `/travel/detail/:id` → `TravelDetailComponent`
- `/travel/detail-owner/:id` → `TravelDetailComponent`
- `/travel/quotes` → `TripsQuotesComponent` — POM existente
- `/travel/dashboard` → `TripsDashboardComponent` — POM existente
- `/travel/recurring` → `TripsRecurringComponent` — POM existente
- `/travel/mappers` → `TripsMappersComponent`

### Customers / Contractors (6)
- `/client/list` → `ClientListComponent` — POM existente
- `/contractors` → `ContractorListComponent`
- `/contractor/new` → `AddContractorComponent`
- `/contractors/import` → `ImportContractorsComponent`
- `/contractors/management` → `ManagementContractorComponent`
- `/import` → `ImportClientsComponent`

### Daily Clearing (Pay) (4)
- `/pay/travels` → `PayTripsComponent`
- `/pay/travels/confirm` → `PayTravelsConfirmComponent`
- `/pay/surrenders-report` → `PaySurrendersReportComponent`
- `/pay/drivers/advancements/list/:id` → `DriverAdvancesListComponent`

### Settlements (Liquidations) — 4 tipos x flujo CRUD (~20 rutas)

#### Contractors
- `/liquidations/contractors/list` → `SettlementsCorporationListComponent`
- `/liquidations/contractors/create/:contractor-id` → `ContractorLiquidationCreateComponent`
- `/liquidations/contractors/details/:contractor-id/:liquidation-id` → `ContractorLiquidationCreateComponent`
- `/liquidations/contractors/last-liquidation/:contractor-id/:last-liquidation-id`
- `/liquidations/contractors/history/:id` → `ContractorLiquidationHistoryComponent`

#### Passenger / Drivers / Owners (mismo patrón CRUD)
- `/liquidations/passenger/list` → `SettlementsPassengerListComponent`
- `/liquidations/drivers/list` → `SettlementsDriverListComponent`
- `/liquidations/owners/list` → `SettlementsOwnersListComponent`
- + create/:id, details/:id/:liquidation-id, history/:id por cada tipo

### Credit Accounts (Checking Accounts) (7)
- `/checking-accounts/clients` → `CheckingAccountsClientsComponent`
- `/checking-accounts/clients/detail` → `CheckingAccountClientsDetailComponent`
- `/checking-accounts/drivers` → `CheckingAccountsDriversComponent`
- `/checking-accounts/drivers/details` → `CheckingAccountDriverDetailComponent`
- `/checking-accounts/owners` → `CheckingAccountsOwnersComponent`
- `/checking-accounts/owners/details` → `OwnerCheckingAccountDetailComponent`
- `/checking-accounts/magiis` → `CheckingAccountsMagiisComponent`

### Fleet (Vehicle/Owner/Driver) (9)
- `/vehicle/list` — POM existente · `/vehicle/create` · `/vehicle/:id/edit`
- `/owner/list` — POM existente · `/owner/create` · `/owner/edit`
- `/driver/list` — POM existente · `/driver/create` · `/driver/:id/edit`

### Reports (19) — MAYOR módulo del producto
| Path | Componente | Tracking |
|---|---|---|
| `/reports/travels-list` | `ReportTripsListComponent` | nuevo |
| `/reports/unpaid-travels-list` | `ReportUnpaidTripsComponent` | **MX-5531 ⭐** |
| `/reports/ranking-drivers` | `ReportDriversRankingComponent` | nuevo |
| `/reports/tips` | `ReportTipsComponent` | POM existente |
| `/reports/cost-center-report` | `ReportCostCenterEmployeesComponent` | nuevo |
| `/reports/corporate-services-type` | `ReportCostCenterServiceTypesComponent` | nuevo |
| `/reports/individual-ca-travels` | `ReportIndividualCaTravelsComponent` | nuevo |
| `/reports/debt-aging` | `ReportAgingComponent` | POM existente |
| `/reports/ranking-clients` | `ReportCustomersRankingComponent` | nuevo |
| `/reports/ranking-vehicles` | `ReportVehiclesRankingComponent` | nuevo |
| `/reports/segments-travels` | `ReportTripsSegmentsComponent` | **MX-5553 ⭐** |
| `/reports/daily` | `ReportDailyComponent` | POM existente |
| `/reports/documentation` | `ReportExpireDocumentationsComponent` | POM existente |
| `/reports/transaction-tracking` | `ReportElectronicPaymentTransactionsComponent` | POM existente |
| `/reports/agency-commissions` | `ReportCompanyCommissionsComponent` | POM existente |
| `/reports/cash-flow` | `ReportCollectionMovementsComponent` | POM existente |
| `/reports/payment-flow` | `ReportPaymentMovementsComponent` | POM existente |
| `/reports/taxes-and-fees` | `ReportTaxesAndFeesComponent` | POM existente |
| `/reports/configurated-commissions` | `ReportConfiguratedCommissionsComponent` | nuevo |

### Affiliate (9 — incluye desbloqueada MX-5647)
- `/affiliate/atc-profile` → `AffiliateATCProfileComponent`
- `/affiliate/offering` → `AffiliateOfferingComponent`
- `/affiliate/request` → `AffiliateRequestComponent`
- `/affiliate/os-agreement-requested` → `AffiliateOSAgreeRequestComponent`
- `/affiliate/os-agreement-received` → `AffiliateOSAgreeReceivedComponent`
- `/affiliate/checking-account` → `AffiliateCheckingAccountComponent` — POM existente
- `/affiliate/liquidation-detail/:id/:editMode` → `AffiliateLiquidationDetailComponent` (MX-5646)
- `/affiliate/checking-account/:checkingAccountId/liquidations/list/:typeView` → `AffiliateLiquidationsListComponent` ⭐ **MX-5647**
- `/affiliate/checking-account-detail/:checkingAccountId/:typeView` → `AffiliateCheckingAccountDetailComponent` (MX-5648)

### GNET (5)
- `/gnet/farm-out` · `/gnet/farm-out/request`
- `/gnet/farm-in` — POM existente
- `/gnet/credit-accounts` — POM existente · `/gnet/credit-accounts/detail`

### Integrations (Apps Store) (10)
- `/integrations/list` → `IntegrationListAppStoreComponent`
- `/integrations/{plugin-web-reservation, social-media, whatsapp, signal, mailchimp, csv, whatsapp-business, ivr, view}`

### Settings (Configuration) (17)
- `/settings/parameters`, `/transportTypes`, `/taxesAndFees`, `/otherCosts` (POM existente)
- `/settings/servicesType/{list, new}`
- `/settings/email-templates`, `/help`
- `/settings/branches/list` · `/settings/zones/{list, create, edit}` · `/settings/areas/list`
- `/settings/travel-fare-{list, rules}`
- `/settings/profiles-access` · `/settings/profiles` · `/settings/preferences`

### Melita (AI) (1)
- `/melita/ai-branches` → `MelitaIABranchesComponent`

## Cambios de status para Release V2.0.2

| MX | Estado anterior | Estado actualizado | URL real |
|---|---|---|---|
| MX-5531 | ❌ BLOQUEADO | ✅ **CUBRIBLE** | `/carrier/#/reports/unpaid-travels-list` |
| MX-5553 | ❌ BLOQUEADO | ✅ **CUBRIBLE** | `/carrier/#/reports/segments-travels` |
| MX-5647 | ❌ BLOQUEADO | ⚠️ **CUBRIBLE con dependencias** | `/carrier/#/affiliate/checking-account/:id/liquidations/list/:typeView` (requiere `:id` desde lista padre) |
| MX-5564 | ❌ BLOQUEADO | ❌ Confirmado: NO existe en release/v2.0.4 | (futuro) |
| MX-5570 | ❌ BLOQUEADO | ❌ Confirmado: NO existe en release/v2.0.4 | (futuro) |

## Sprints actualizados

### Sprint 5 — Release V2.0.2 desbloqueadas (2 nuevos POMs)
- **MX-5531** `ReportUnpaidTravelsPage` → `/carrier/#/reports/unpaid-travels-list`
- **MX-5553** `ReportSegmentsTravelsPage` → `/carrier/#/reports/segments-travels`

### Sprint 6 — Settlements + Affiliate liquidations
- 4x `Settlements*ListPage` (Contractor, Passenger, Driver, Owner)
- `AffiliateLiquidationsListPage` (con flujo desde lista padre)

### Sprint 7 — Reports adicionales descubiertos (7 nuevos)
- TravelsListReport, RankingDrivers, CostCenter, CorporateServices, IndividualCaTravels, RankingClients, RankingVehicles

### Sprint 8+ — Resto del catálogo
- Affiliate (5 sublistas), GNET farm-out, Integrations (10), Settings (17), Customers/Contractors CRUD, Travel detail con :id, Fleet form CRUD.

## Backlog general estimado

| Sprint | Items | Tests acumulados |
|---|---|---|
| Sprint 1 (DONE) | 8 | 20 |
| Sprint 2-4 Release V2.0.2 (DONE) | 17 | 53 |
| Sprint 5 desbloqueadas | 2 | ~57 |
| Sprint 6 Settlements + Affiliate liq | 5 | ~67 |
| Sprint 7 Reports adicionales | 7 | ~81 |
| Sprint 8+ resto | ~45 | ~170 |
| **TOTAL backlog** | **~70 pantallas** | **~170 tests** |
