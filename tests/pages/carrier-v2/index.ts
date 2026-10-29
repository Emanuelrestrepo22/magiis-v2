// Barrel export de pages del portal carrier V2 (Angular 18).
// Convencion: un archivo por pantalla migrada, nombrado <Pantalla>Page.ts.
//
// Estado actual de la migracion (refs/v2/main @ 86b31cc):
// - LoginCarrier: cubierto via shared/LoginPage (login carrier es el unico login de V2).
// - DashboardCarrier: skeleton, breadcrumb-only.
//
// Pantallas previstas (se sumaran conforme dev migre):
// - TripsListPage, TripDetailPage, DriversListPage, VehiclesListPage, etc.
// Sprint 1 - foundation
export { OperationsControlPage } from './operations/OperationsControlPage.js';
export type { DriverStatusFilter } from './operations/OperationsControlPage.js';
export { ClientListPage } from './clients/ClientListPage.js';
export { OwnerListPage } from './owners/OwnerListPage.js';
export { DriverListPage } from './drivers/DriverListPage.js';
export { VehicleListPage } from './vehicles/VehicleListPage.js';

// Release V2.0.2 - Sprint 2 (P1)
export { MapViewerPage } from './operations/MapViewerPage.js';
export { TravelDashboardPage } from './trips/TravelDashboardPage.js';
export type { TravelTab, DashboardRow } from './trips/TravelDashboardPage.js';
export { TravelQuotesPage } from './trips/TravelQuotesPage.js';
export { TravelRecurringPage } from './trips/TravelRecurringPage.js';
export { ReportsDailyPage } from './reports/ReportsDailyPage.js';
export type { DistanceRatio, RatioReading } from './reports/ReportsDailyPage.js';
export { AffiliateCheckingAccountPage } from './affiliate/AffiliateCheckingAccountPage.js';
export { ReportsDocumentationPage } from './reports/ReportsDocumentationPage.js';

// Release V2.0.2 - Sprint 3 (P2)
export { ReportsTipsPage } from './reports/ReportsTipsPage.js';
export { ReportsDebtAgingPage } from './reports/ReportsDebtAgingPage.js';
export { ReportsCashFlowPage } from './reports/ReportsCashFlowPage.js';
export { ReportsTransactionTrackingPage } from './reports/ReportsTransactionTrackingPage.js';
export { ReportsTaxesFeesPage } from './reports/ReportsTaxesFeesPage.js';
export { ReportsPaymentFlowPage } from './reports/ReportsPaymentFlowPage.js';
export { ReportsAgencyCommissionsPage } from './reports/ReportsAgencyCommissionsPage.js';
export { GnetFarmInPage } from './gnet/GnetFarmInPage.js';
export { GnetCreditAccountsPage } from './gnet/GnetCreditAccountsPage.js';

// Release V2.0.2 - Sprint 4 (P3)
export { SettingsOtherCostsPage } from './settings/SettingsOtherCostsPage.js';
export { OtherCostFormModalPage } from './settings/OtherCostFormModalPage.js';

// Release V2.0.2 - Sprint 5 (desbloqueadas tras analisis release/v2.0.4)
export { ReportUnpaidTravelsPage } from './reports/ReportUnpaidTravelsPage.js';
export { ReportSegmentsTravelsPage } from './reports/ReportSegmentsTravelsPage.js';

// Release V2.0.2 - Sprint 6 (Settlements - 4 sublistas de liquidaciones)
export { SettlementsContractorListPage } from './settlements/SettlementsContractorListPage.js';
export { SettlementsPassengerListPage } from './settlements/SettlementsPassengerListPage.js';
export { SettlementsDriverListPage } from './settlements/SettlementsDriverListPage.js';
export { SettlementsOwnerListPage } from './settlements/SettlementsOwnerListPage.js';

// Sprint 7 - 7 reportes adicionales descubiertos en routing release/v2.0.4
export { ReportTravelsListPage } from './reports/ReportTravelsListPage.js';
export { ReportRankingDriversPage } from './reports/ReportRankingDriversPage.js';
export { ReportCostCenterPage } from './reports/ReportCostCenterPage.js';
export { ReportCorporateServicesPage } from './reports/ReportCorporateServicesPage.js';
export { ReportIndividualCATravelsPage } from './reports/ReportIndividualCATravelsPage.js';
export { ReportRankingClientsPage } from './reports/ReportRankingClientsPage.js';
export { ReportRankingVehiclesPage } from './reports/ReportRankingVehiclesPage.js';

// Sprint 8 - Settlements + Affiliate detail flows (con :id)
export { SettlementsContractorDetailPage } from './settlements/SettlementsContractorDetailPage.js';
export { SettlementsContractorHistoryPage } from './settlements/SettlementsContractorHistoryPage.js';
export { SettlementsPassengerDetailPage } from './settlements/SettlementsPassengerDetailPage.js';
export { SettlementsPassengerHistoryPage } from './settlements/SettlementsPassengerHistoryPage.js';
export { SettlementsDriverDetailPage } from './settlements/SettlementsDriverDetailPage.js';
export { SettlementsDriverHistoryPage } from './settlements/SettlementsDriverHistoryPage.js';
export { SettlementsOwnerDetailPage } from './settlements/SettlementsOwnerDetailPage.js';
export { SettlementsOwnerHistoryPage } from './settlements/SettlementsOwnerHistoryPage.js';
export { AffiliateLiquidationDetailPage } from './affiliate/AffiliateLiquidationDetailPage.js';
export { AffiliateCheckingAccountDetailPage } from './affiliate/AffiliateCheckingAccountDetailPage.js';
export { AffiliateLiquidationsListWithIdPage } from './affiliate/AffiliateLiquidationsListWithIdPage.js';

// Sprint 9 - Tickets P2 (MX-5570)
export { TicketsClosedPage } from './tickets/TicketsClosedPage.js';

// MG-19 - New Trip (primera ronda de 10 TCs)
export { NewTripPage } from './trips/NewTripPage.js';
// MG-682 - New Trip: destino frecuente y flags de ruta (TM-945)
export { FrequentDestinationsModalPage } from './trips/FrequentDestinationsModalPage.js';
// MG-995/MG-996 - Otros costos en Nuevo Viaje y detalle del viaje (ATR TM-1280)
export { AddOtherCostModalPage } from './trips/AddOtherCostModalPage.js';
export { TravelDetailPage } from './trips/TravelDetailPage.js';

// Wave 03 - migracion V1->V2 (ronda A): App Store / integraciones (MU-002)
export { IntegrationsAppStorePage } from './integrations/IntegrationsAppStorePage.js';
export type { CarrierPreferences } from './integrations/IntegrationsAppStorePage.js';

// MG-1189 - unidades de medida metrico/imperial (ronda 1)
export { OwnerReportPage } from './reports/OwnerReportPage.js';
export { BranchesListPage } from './settings/BranchesListPage.js';
export { SettingsParametersPage } from './settings/SettingsParametersPage.js';
