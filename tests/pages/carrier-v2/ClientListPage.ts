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
import { BaseListPage } from '../shared/BaseListPage.js';

export class ClientListPage extends BaseListPage {
  readonly path = '/carrier/#/client/list';

  readonly vipFilterCheckbox: Locator;
  readonly importCustomersButton: Locator;
  readonly newCustomerButton: Locator;

  protected get headingRegex(): RegExp {
    return /^customers management$|^gesti[oó]n de clientes$/i;
  }
  protected get breadcrumbRegex(): RegExp | null {
    return /customers management|gesti[oó]n de clientes/i;
  }

  constructor(page: Page) {
    super(page);
    this.vipFilterCheckbox = page.getByRole('checkbox', { name: /^vip$/i });
    this.importCustomersButton = page.getByRole('button', {
      name: /import customers|importar clientes/i
    });
    this.newCustomerButton = page.getByRole('button', {
      name: /new customer|nuevo cliente/i
    });
  }

  async expectListReady(): Promise<void> {
    // super.expectListReady() apunta directo a BaseListPage.expectListReady (heading + table).
    // NO usar this.expectListReadyWithSearch() porque su implementacion en Base llama
    // this.expectListReady() y produciria recursion infinita por virtual dispatch.
    await super.expectListReady();
    await expect(this.searchInput).toBeVisible();
  }
}
