// tests/pages/carrier-v2/DriverListPage.ts
// POM del listado de conductores (Drivers Management) en carrier V2.
/**
 * @jira MX-5711
 * @route /carrier/#/driver/list
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class DriverListPage extends BasePage {
  readonly breadcrumb: Locator;
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly newDriverButton: Locator;
  readonly pdfButton: Locator;
  readonly table: Locator;
  readonly pageSizeSelector: Locator;
  readonly previousPageLink: Locator;
  readonly nextPageLink: Locator;

  constructor(page: Page) {
    super(page);
    // El breadcrumb actual del portal renderiza "Drivers / Drivers Managment" con typo.
    // Aceptamos ambas spellings para tolerar fix futuro.
    this.breadcrumb = page.getByRole('heading', { name: /drivers?\s*\/?\s*drivers (management|managment)|conductores?\s*\/?\s*gesti[oó]n/i }).first();
    this.heading = page.getByRole('heading', { name: /^drivers$|^conductores$/i, level: 2 });
    this.searchInput = page.getByPlaceholder(/search name|buscar nombre/i);
    this.newDriverButton = page.getByRole('button', { name: /new driver|nuevo conductor/i });
    this.pdfButton = page.getByRole('button', { name: /^pdf$/i });
    this.table = page.getByRole('table').first();
    this.pageSizeSelector = page.getByRole('combobox', { name: /^show \d+/i });
    this.previousPageLink = page.getByRole('link', { name: /^previous$|^anterior$/i });
    this.nextPageLink = page.getByRole('link', { name: /^next$|^siguiente$/i });
  }

  async goto(): Promise<void> {
    await this.navigate('/carrier/#/driver/list');
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
}
