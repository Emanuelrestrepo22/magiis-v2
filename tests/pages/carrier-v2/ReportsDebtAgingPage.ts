// tests/pages/carrier-v2/ReportsDebtAgingPage.ts
/**
 * @jira MX-5561
 * @route /carrier/#/reports/debt-aging
 * @priority P2
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsDebtAgingPage extends BaseListPage {
  readonly path = '/carrier/#/reports/debt-aging';
  protected get headingRegex(): RegExp { return /aging report|debt aging|antig[uü]edad (de )?deuda/i; }
  constructor(page: Page) { super(page); }
}
