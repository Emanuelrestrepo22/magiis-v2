// tests/pages/carrier-v2/OwnerListPage.ts
// POM del listado de propietarios (Owners Management) en carrier V2.
/**
 * @jira MX-5604
 * @route /carrier/#/owner/list
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../shared/BasePage.js';

export class OwnerListPage extends BasePage {
  readonly breadcrumb: Locator;
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly newOwnerButton: Locator;
  readonly pdfButton: Locator;
  readonly table: Locator;
  readonly pageSizeSelector: Locator;
  readonly previousPageLink: Locator;
  readonly nextPageLink: Locator;

  constructor(page: Page) {
    super(page);
    this.breadcrumb = page.getByRole('heading', { name: /owners?\s*\/?\s*owners management|propietarios?\s*\/?\s*gesti[oó]n/i }).first();
    this.heading = page.getByRole('heading', { name: /^owners management$|^gesti[oó]n de propietarios$/i, level: 2 });
    this.searchInput = page.getByPlaceholder(/^search\.?\.?\.?$|^buscar/i).first();
    this.newOwnerButton = page.getByRole('button', { name: /new owner|nuevo propietario/i });
    this.pdfButton = page.getByRole('button', { name: /^pdf$/i });
    this.table = page.getByRole('table').first();
    this.pageSizeSelector = page.getByRole('combobox', { name: /^show \d+/i });
    this.previousPageLink = page.getByRole('link', { name: /^previous$|^anterior$/i });
    this.nextPageLink = page.getByRole('link', { name: /^next$|^siguiente$/i });
  }

  async goto(): Promise<void> {
    await this.navigate('/carrier/#/owner/list');
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
