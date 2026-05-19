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
export { DashboardCarrierPage } from './DashboardCarrierPage.js';
export { OperationsControlPage } from './OperationsControlPage.js';
export type { DriverStatusFilter } from './OperationsControlPage.js';
export { ClientListPage } from './ClientListPage.js';
export { OwnerListPage } from './OwnerListPage.js';
export { DriverListPage } from './DriverListPage.js';
export { VehicleListPage } from './VehicleListPage.js';

// Release V2.0.2 - Sprint 2 (P1)
export { MapViewerPage } from './MapViewerPage.js';
export { TravelDashboardPage } from './TravelDashboardPage.js';
export type { TravelTab } from './TravelDashboardPage.js';
export { TravelQuotesPage } from './TravelQuotesPage.js';
export { TravelRecurringPage } from './TravelRecurringPage.js';
export { ReportsDailyPage } from './ReportsDailyPage.js';
export { AffiliateCheckingAccountPage } from './AffiliateCheckingAccountPage.js';
export { ReportsDocumentationPage } from './ReportsDocumentationPage.js';

// Release V2.0.2 - Sprint 3 (P2)
export { ReportsTipsPage } from './ReportsTipsPage.js';
export { ReportsDebtAgingPage } from './ReportsDebtAgingPage.js';
export { ReportsCashFlowPage } from './ReportsCashFlowPage.js';
export { ReportsTransactionTrackingPage } from './ReportsTransactionTrackingPage.js';
export { ReportsTaxesFeesPage } from './ReportsTaxesFeesPage.js';
export { ReportsPaymentFlowPage } from './ReportsPaymentFlowPage.js';
export { ReportsAgencyCommissionsPage } from './ReportsAgencyCommissionsPage.js';
export { GnetFarmInPage } from './GnetFarmInPage.js';
export { GnetCreditAccountsPage } from './GnetCreditAccountsPage.js';

// Release V2.0.2 - Sprint 4 (P3)
export { SettingsOtherCostsPage } from './SettingsOtherCostsPage.js';
