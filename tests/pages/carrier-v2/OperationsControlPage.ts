// tests/pages/carrier-v2/OperationsControlPage.ts
// POM del dashboard principal del portal carrier V2: Operations Control.
// Es la pantalla por defecto post-login del rol carrier en el portal deployado
// (apps-test.magiis.com/carrier/#/dashboard).
//
// Selectores anclados a textos i18n estables (regex bilingue EN/ES) y roles ARIA.
// Validado contra el portal real deployado (snapshot 2026-05-18, locale EN).
/**
 * @jira MX-5711
 * @route /carrier/#/dashboard
 * @priority P1
 * @type both
 * @note Es la pantalla migrada con mayor trafico esperado.
 *       Cubre KPIs de viajes/vehiculos/conductores + distribucion por canal + lista de drivers.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export type DriverStatusFilter = 'all' | 'available' | 'traveling' | 'unavailable';

export class OperationsControlPage extends BasePage {
  /** Titulo de la pantalla (heading principal). */
  readonly heading: Locator;
  /** Breadcrumb / section label superior. */
  readonly sectionLabel: Locator;
  /** Boton de top-bar para crear viaje nuevo. */
  readonly newTripButton: Locator;
  /** Boton de gestion de viajes en top-bar. */
  readonly tripsManagementButton: Locator;
  /** Boton de historico de viajes en top-bar. */
  readonly tripsHistoryButton: Locator;

  // === KPI cards (la metrica visible en cada card es un counter numerico) ===
  readonly kpiTripsMade: Locator;
  readonly kpiKmTotal: Locator;
  readonly kpiActiveVehicles: Locator;
  readonly kpiTripsPerVehicle: Locator;
  readonly kpiActiveDrivers: Locator;
  readonly kpiTripsPerDriver: Locator;
  readonly kpiKmPerTrip: Locator;
  readonly kpiKmPerVehicle: Locator;
  readonly kpiTodaysClients: Locator;
  readonly kpiTotalClients: Locator;
  readonly kpiMarketingUnsubscribes: Locator;

  // === Distribution by Channel ===
  readonly distributionSection: Locator;
  readonly channelApps: Locator;
  readonly channelWaIvr: Locator;
  readonly channelWeb: Locator;

  // === Drivers Status table ===
  readonly driversStatusSection: Locator;
  readonly driversSearchInput: Locator;
  readonly driversShowDisabledToggle: Locator;
  readonly driversTable: Locator;
  readonly driverFilterAll: Locator;
  readonly driverFilterAvailable: Locator;
  readonly driverFilterTraveling: Locator;
  readonly driverFilterUnavailable: Locator;

  constructor(page: Page) {
    super(page);

    // V2 renderiza 2 headings "Operations Control": breadcrumb (h4 mb-sm-0) y
    // section title con icon (h4 text-primary). Usamos el primero (breadcrumb).
    this.heading = page.getByRole('heading', { name: /operations control|control operaciones/i }).first();
    // OPERATIONS CONTROL uppercase visible arriba del shell de contenido.
    this.sectionLabel = page.getByText(/^operations control$|^control operaciones$/i).first();

    // Topbar acciones: V2 expone "Trips Management" (gestion) y "New Trip" (verde) con
    // accessible name. Tambien hay un boton "Trips" (dropdown) sin etiqueta secundaria, que
    // tratamos como historico de viajes (fallback con regex permisiva).
    this.newTripButton = page
      .getByRole('button', { name: /^new trip$|nuevo viaje/i })
      .or(page.getByRole('link', { name: /^new trip$|nuevo viaje/i }));
    this.tripsManagementButton = page.getByRole('button', { name: /trips management|gesti[oó]n de viajes/i });
    // "Trips" sin sufijo abre dropdown con historico; lo usamos como ancla.
    this.tripsHistoryButton = page.getByRole('button', { name: /^trips$|trips history|hist[oó]rico de viajes/i });

    // Cada KPI esta dentro de una card que muestra label + numero. El label es el ancla estable.
    this.kpiTripsMade = this.kpiCardByLabel(/trips made|viajes realizados/i);
    this.kpiKmTotal = this.kpiCardByLabel(/^mi$|^km$/i);
    this.kpiActiveVehicles = this.kpiCardByLabel(/active vehicles|veh[ií]culos activos/i);
    this.kpiTripsPerVehicle = this.kpiCardByLabel(/trips\s*\/\s*vehicle|viajes\s*\/\s*veh[ií]culo/i);
    this.kpiActiveDrivers = this.kpiCardByLabel(/active drivers|conductores activos/i);
    this.kpiTripsPerDriver = this.kpiCardByLabel(/trips\s*\/\s*driver|viajes\s*\/\s*conductor/i);
    this.kpiKmPerTrip = this.kpiCardByLabel(/km\s*\/\s*trip|km\s*\/\s*viaje/i);
    this.kpiKmPerVehicle = this.kpiCardByLabel(/km\s*\/\s*vehicle|km\s*\/\s*veh[ií]culo/i);
    this.kpiTodaysClients = this.kpiCardByLabel(/today.?s clients|clientes de hoy/i);
    this.kpiTotalClients = this.kpiCardByLabel(/total clients|total de clientes/i);
    this.kpiMarketingUnsubscribes = this.kpiCardByLabel(/marketing unsubscribes|desuscripciones marketing/i);

    this.distributionSection = page
      .locator('section, div')
      .filter({ has: page.getByText(/distribution by channel|distribuci[oó]n por canal/i) })
      .first();
    this.channelApps = this.distributionSection.getByText(/apps/i).first();
    this.channelWaIvr = this.distributionSection.getByText(/wa\s*\/\s*ivr/i).first();
    this.channelWeb = this.distributionSection.getByText(/^web$/i).first();

    this.driversStatusSection = page
      .locator('section, div')
      .filter({ has: page.getByText(/drivers status|estado de conductores/i) })
      .first();
    this.driversSearchInput = this.driversStatusSection.getByPlaceholder(/search|buscar/i).first();
    this.driversShowDisabledToggle = this.driversStatusSection
      .getByText(/show disabled drivers|mostrar conductores deshabilitados/i)
      .first();
    this.driversTable = this.driversStatusSection.locator('table, .ngx-datatable, .table').first();
    // Los filtros son <button> con accessible name "All (13)", "Available (3)", etc.
    // Anclamos por role+name con regex que exige el counter entre parentesis para
    // distinguir del segundo set de filtros del mapa Leaflet (sin count, all disabled).
    this.driverFilterAll = page.getByRole('button', { name: /all\s*\(\d+\)/i }).first();
    this.driverFilterAvailable = page.getByRole('button', { name: /available\s*\(\d+\)/i }).first();
    this.driverFilterTraveling = page.getByRole('button', { name: /traveling\s*\(\d+\)/i }).first();
    this.driverFilterUnavailable = page.getByRole('button', { name: /unavailable\s*\(\d+\)/i }).first();
  }

  /**
   * Navega al dashboard. Asume sesion activa via storageState.
   */
  async goto(): Promise<void> {
    await this.navigate('/carrier/#/dashboard');
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  /** Verifica que las secciones principales esten visibles. Util como smoke. */
  async expectMainSectionsReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.kpiTripsMade).toBeVisible();
    await expect(this.distributionSection).toBeVisible();
    await expect(this.driversStatusSection).toBeVisible();
  }

  async applyDriverFilter(filter: DriverStatusFilter): Promise<void> {
    const map: Record<DriverStatusFilter, Locator> = {
      all: this.driverFilterAll,
      available: this.driverFilterAvailable,
      traveling: this.driverFilterTraveling,
      unavailable: this.driverFilterUnavailable
    };
    await map[filter].click();
  }

  async searchDriver(query: string): Promise<void> {
    await this.driversSearchInput.fill(query);
  }

  async openNewTrip(): Promise<void> {
    await this.newTripButton.first().click();
  }

  /**
   * Devuelve el locator del valor (counter) dentro de una card de KPI.
   * Util cuando necesitamos validar que el numero rendered cumple una regla.
   */
  kpiValue(kpi: Locator): Locator {
    return kpi.locator('h1, h2, h3, h4, .counter, .display-6').first();
  }

  /**
   * Locator generico para una "card de KPI" anclada por su label de texto.
   * Hace fallback entre `card`, `section` y `div` para tolerar variaciones de markup.
   */
  private kpiCardByLabel(label: RegExp): Locator {
    return this.page
      .locator('.card, section, div')
      .filter({ has: this.page.getByText(label) })
      .first();
  }
}
