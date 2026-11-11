// tests/pages/carrier-v2/settlements/SettlementsPassengerListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/passenger/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class SettlementsPassengerListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/passenger/list';
  protected get headingRegex(): RegExp {
    // Breadcrumb h4: "Balances / Individuals"; TEST 11/11 lo renombro a "Settlements / Passengers".
    // Se aceptan ambos mientras UAT/PROD conserven el texto viejo.
    return /balances\s*\/\s*individuals|settlements\s*\/\s*passengers/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
