// tests/pages/carrier-v2/VehicleListPage.ts
// POM del listado de vehiculos (Vehicles Management) en carrier V2.
/**
 * @jira MX-5711
 * @route /carrier/#/vehicle/list
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class VehicleListPage extends BasePage {
  readonly breadcrumb: Locator;
  readonly heading: Locator;
  readonly searchInput: Locator;
  /** Switch "All / Only Active" - alterna entre mostrar todos los vehiculos o solo activos. */
  readonly activeFilterSwitch: Locator;
  readonly newVehicleButton: Locator;
  readonly pdfButton: Locator;
  readonly table: Locator;
  readonly pageSizeSelector: Locator;
  readonly previousPageLink: Locator;
  readonly nextPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.breadcrumb = page.getByRole('heading', { name: /vehicles?\s*\/?\s*vehicles management|veh[ií]culos?\s*\/?\s*gesti[oó]n/i }).first();
    this.heading = page.getByRole('heading', { name: /^vehicles$|^veh[ií]culos$/i, level: 2 });
    this.searchInput = page.getByPlaceholder(/^search\.?\.?\.?$|^buscar/i).first();
    this.activeFilterSwitch = page.getByRole('switch', { name: /all\s*only active|todos\s*solo activos/i });
    this.newVehicleButton = page.getByRole('button', { name: /new vehicle|nuevo veh[ií]culo/i });
    this.pdfButton = page.getByRole('button', { name: /^pdf$/i });
    this.table = page.getByRole('table').first();
    this.pageSizeSelector = page.getByRole('combobox', { name: /^show \d+/i });
    this.previousPageLink = page.getByRole('link', { name: /^previous$|^anterior$/i });
    this.nextPageLink = page.getByRole('link', { name: /^next$|^siguiente$/i });
  }

  async goto(): Promise<void> {
    await this.navigate('/carrier/#/vehicle/list');
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  async expectListReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.searchInput).toBeVisible();
    await expect(this.table).toBeVisible();
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  async toggleActiveFilter(): Promise<void> {
    await this.activeFilterSwitch.click();
  }
}
