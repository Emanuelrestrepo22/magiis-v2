// tests/pages/carrier-v2/MapViewerPage.ts
/**
 * @jira MX-5559
 * @route /carrier/#/map-viewer
 * @priority P1
 * @type functional
 * @note Caso atipico: no es listado con tabla, es mapa Leaflet con filtros de drivers.
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class MapViewerPage extends BasePage {
  readonly heading: Locator;
  readonly driversSectionHeading: Locator;
  /** Filtros por estado de conductor: All / Available / Traveling / On time / Unavailable. */
  readonly driverFilterAll: Locator;
  readonly driverFilterAvailable: Locator;
  readonly driverFilterTraveling: Locator;
  readonly driverFilterUnavailable: Locator;
  /** Boton para identificar conductores en el mapa. */
  readonly identifyDriversButton: Locator;
  /** Controles del mapa Leaflet. */
  readonly zoomInButton: Locator;
  readonly zoomOutButton: Locator;
  readonly fullScreenButton: Locator;
  readonly centerMapButton: Locator;
  readonly leafletContainer: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /^map viewer$|^visor de mapa$/i });
    this.driversSectionHeading = page.getByRole('heading', { name: /^drivers$|^conductores$/i });
    this.driverFilterAll = page.getByRole('button', { name: /^all\s*\(\d+\)/i }).first();
    this.driverFilterAvailable = page.getByRole('button', { name: /available\s*\(\d+\)/i }).first();
    this.driverFilterTraveling = page.getByRole('button', { name: /traveling\s*\(\d+\)/i }).first();
    // "On time / Unavailable (N)" en EN; aceptamos solo "Unavailable" tambien.
    this.driverFilterUnavailable = page.getByRole('button', { name: /unavailable\s*\(\d+\)/i }).first();
    this.identifyDriversButton = page.getByRole('button', { name: /identify drivers|identificar conductores/i });
    this.zoomInButton = page.getByRole('button', { name: /^zoom in$|^acercar$/i });
    this.zoomOutButton = page.getByRole('button', { name: /^zoom out$|^alejar$/i });
    this.fullScreenButton = page.getByRole('button', { name: /^full screen$|pantalla completa/i });
    this.centerMapButton = page.getByRole('button', { name: /center map|centrar mapa/i });
    this.leafletContainer = page.locator('.leaflet-container').first();
  }

  async goto(): Promise<void> {
    await this.navigate('/carrier/#/map-viewer');
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async expectMapReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.driversSectionHeading).toBeVisible();
    await expect(this.leafletContainer).toBeVisible();
  }
}
