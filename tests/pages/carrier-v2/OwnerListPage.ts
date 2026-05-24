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
import { BaseListPage } from '../shared/BaseListPage.js';

export class OwnerListPage extends BaseListPage {
  readonly path = '/carrier/#/owner/list';

  readonly newOwnerButton: Locator;

  protected get headingRegex(): RegExp {
    return /^owners management$|^gesti[oó]n de propietarios$/i;
  }
  protected get breadcrumbRegex(): RegExp | null {
    return /owners?\s*\/?\s*owners management|propietarios?\s*\/?\s*gesti[oó]n/i;
  }

  constructor(page: Page) {
    super(page);
    this.newOwnerButton = page.getByRole('button', {
      name: /new owner|nuevo propietario/i
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
