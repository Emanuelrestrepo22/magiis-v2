// tests/pages/carrier-v2/ClientListPage.ts
// POM del listado de clientes (Customers Management) en carrier V2.
/**
 * @jira MX-5197
 * @route /carrier/#/client/list
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class ClientListPage extends BasePage {
  readonly breadcrumb: Locator;
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly vipFilterCheckbox: Locator;
  readonly importCustomersButton: Locator;
  readonly newCustomerButton: Locator;
  readonly pdfButton: Locator;
  readonly table: Locator;
  readonly pageSizeSelector: Locator;
  readonly previousPageLink: Locator;
  readonly nextPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.breadcrumb = page.getByRole('heading', { name: /customers management|gesti[oó]n de clientes/i }).first();
    this.heading = page.getByRole('heading', { name: /^customers management$|^gesti[oó]n de clientes$/i, level: 2 });
    this.searchInput = page.getByPlaceholder(/search name|buscar nombre/i);
    this.vipFilterCheckbox = page.getByRole('checkbox', { name: /^vip$/i });
    this.importCustomersButton = page.getByRole('button', { name: /import customers|importar clientes/i });
    this.newCustomerButton = page.getByRole('button', { name: /new customer|nuevo cliente/i });
    this.pdfButton = page.getByRole('button', { name: /^pdf$/i });
    this.table = page.getByRole('table').first();
    this.pageSizeSelector = page.getByRole('combobox', { name: /^show \d+/i });
    this.previousPageLink = page.getByRole('link', { name: /^previous$|^anterior$/i });
    this.nextPageLink = page.getByRole('link', { name: /^next$|^siguiente$/i });
  }

  async goto(): Promise<void> {
    await this.navigate('/carrier/#/client/list');
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
