// tests/pages/carrier-v2/ReportsPaymentFlowPage.ts
/**
 * @jira MX-5568
 * @route /carrier/#/reports/payment-flow
 * @priority P2
 * @type functional
 * @note Movimientos de Pagos.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsPaymentFlowPage extends BaseListPage {
  readonly path = '/carrier/#/reports/payment-flow';
  protected get headingRegex(): RegExp { return /payment movements|payment flow|movimientos de pagos|pagos/i; }
  constructor(page: Page) { super(page); }
}
