// tests/pages/carrier-v2/DriverListPage.ts
// POM del listado de conductores (Drivers Management) en carrier V2.
/**
 * @jira MX-5711
 * @route /carrier/#/driver/list
 * @priority P1
 * @type functional
 */
import type { Page, Locator } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class DriverListPage extends BaseListPage {
  readonly path = '/carrier/#/driver/list';

  readonly newDriverButton: Locator;

  protected get headingRegex(): RegExp {
    return /^drivers$|^conductores$/i;
  }
  protected get breadcrumbRegex(): RegExp | null {
    // El breadcrumb actual del portal renderiza "Drivers / Drivers Managment" con typo.
    // Aceptamos ambas spellings para tolerar fix futuro.
    return /drivers?\s*\/?\s*drivers (management|managment)|conductores?\s*\/?\s*gesti[oó]n/i;
  }

  constructor(page: Page) {
    super(page);
    this.newDriverButton = page.getByRole('button', {
      name: /new driver|nuevo conductor/i
    });
  }

  async expectListReady(): Promise<void> {
    await this.expectListReadyWithSearch();
  }
}
