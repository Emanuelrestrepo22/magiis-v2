// tests/pages/carrier-v2/ReportsCashFlowPage.ts
/**
 * @jira MX-5562
 * @route /carrier/#/reports/cash-flow
 * @priority P2
 * @type functional
 * @note Movimientos de Cobros.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsCashFlowPage extends BaseListPage {
  readonly path = '/carrier/#/reports/cash-flow';
  protected get headingRegex(): RegExp { return /collection movements|cash flow|movimientos de cobros|cobros/i; }
  constructor(page: Page) { super(page); }
}
