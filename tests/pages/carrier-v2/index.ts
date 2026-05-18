// Barrel export de pages del portal carrier V2 (Angular 18).
// Convencion: un archivo por pantalla migrada, nombrado <Pantalla>Page.ts.
//
// Estado actual de la migracion (refs/v2/main @ 86b31cc):
// - LoginCarrier: cubierto via shared/LoginPage (login carrier es el unico login de V2).
// - DashboardCarrier: skeleton, breadcrumb-only.
//
// Pantallas previstas (se sumaran conforme dev migre):
// - TripsListPage, TripDetailPage, DriversListPage, VehiclesListPage, etc.
export { DashboardCarrierPage } from './DashboardCarrierPage.js';
