// tests/pages/carrier-v2/ReportsTransactionTrackingPage.ts
/**
 * @jira MX-5565
 * @route /carrier/#/reports/transaction-tracking
 * @priority P2
 * @type functional
 * @note Transacciones con Tarjeta.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsTransactionTrackingPage extends BaseListPage {
  readonly path = '/carrier/#/reports/transaction-tracking';
  protected get headingRegex(): RegExp { return /electronic payment transactions|transaction tracking|transacciones (con )?tarjeta/i; }
  constructor(page: Page) { super(page); }
}
