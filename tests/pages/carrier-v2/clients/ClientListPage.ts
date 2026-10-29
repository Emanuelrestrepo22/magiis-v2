// tests/pages/carrier-v2/clients/ClientListPage.ts
// POM del listado de clientes (Customers Management) en carrier V2.
/**
 * @jira MX-5197
 * @route /carrier/#/client/list
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class ClientListPage extends BaseListPage {
  readonly path = '/carrier/#/client/list';

  readonly vipFilterCheckbox: Locator;
  readonly importCustomersButton: Locator;
  readonly newCustomerButton: Locator;

  protected get headingRegex(): RegExp {
    return /customer\s*\/\s*passenger management/i;
  }
  protected get breadcrumbRegex(): RegExp | null {
    return /customer\s*\/\s*passenger management/i;
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

    // A diferencia de Drivers/Owners/Vehicles (que usan <input class="search">), la busqueda
    // de Customers Management es un ng-select expuesto como role=combobox con name
    // "Search by name, last name, email or phone" (verificado 2026-07-17). El searchInput
    // heredado (input.search / textbox) no lo matchea; lo reapuntamos al combobox.
    this.searchInput = page.getByRole('combobox', { name: /search|buscar/i }).first();
  }

  /**
   * El search de Customers es un ng-select: el <input> tipeable vive dentro del combobox.
   * fill() sobre el combobox puede no persistir el termino, asi que clickeamos y tipeamos.
   */
  async search(query: string): Promise<void> {
    await this.searchInput.click();
    await this.searchInput.fill(query);
  }

  async expectListReady(): Promise<void> {
    // super.expectListReady() apunta directo a BaseListPage.expectListReady (heading + table).
    // NO usar this.expectListReadyWithSearch() porque su implementacion en Base llama
    // this.expectListReady() y produciria recursion infinita por virtual dispatch.
    await super.expectListReady();
    await expect(this.searchInput).toBeVisible();
  }
}
