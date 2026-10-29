// tests/pages/carrier-v2/settlements/SettlementsDriverListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/drivers/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class SettlementsDriverListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/drivers/list';
  protected get headingRegex(): RegExp {
    // Breadcrumb h4 real: "Settlements / Driver" (singular). El prefijo "Settlements /"
    // es lo que lo distingue del listado de Fleet, que renderiza "Drivers / Drivers Managment".
    return /settlements\s*\/\s*drivers?/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
