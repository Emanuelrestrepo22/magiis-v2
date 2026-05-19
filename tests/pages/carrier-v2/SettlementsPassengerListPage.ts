// tests/pages/carrier-v2/SettlementsPassengerListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/passenger/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class SettlementsPassengerListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/passenger/list';
  protected get headingRegex(): RegExp {
    // El portal renderiza "Individuals" como h2 (Settlements / Balances / Individuals).
    return /^individuals?$|^passengers?$|^pasajeros?$/i;
  }
  constructor(page: Page) { super(page); }
}
