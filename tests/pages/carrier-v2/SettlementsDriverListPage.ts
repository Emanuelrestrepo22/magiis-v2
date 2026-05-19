// tests/pages/carrier-v2/SettlementsDriverListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/drivers/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class SettlementsDriverListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/drivers/list';
  protected get headingRegex(): RegExp {
    // El portal renderiza solo "Drivers" como h2 (mismo texto que Fleet/DriverList,
    // pero distinto componente y path - el contexto lo da el goto al path correcto).
    return /^drivers?$|^conductores?$/i;
  }
  constructor(page: Page) { super(page); }
}
