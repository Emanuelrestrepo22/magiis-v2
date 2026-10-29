// tests/pages/carrier-v2/settlements/SettlementsOwnerListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/owners/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class SettlementsOwnerListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/owners/list';
  protected get headingRegex(): RegExp {
    // Breadcrumb h4 real: "Settlements / Owners". El prefijo "Settlements /" es lo que lo
    // distingue del listado de Fleet, que renderiza "Owners / Owners Management".
    return /settlements\s*\/\s*owners/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
