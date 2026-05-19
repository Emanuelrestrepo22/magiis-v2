// tests/pages/carrier-v2/ReportsTaxesFeesPage.ts
/**
 * @jira MX-5566
 * @route /carrier/#/reports/taxes-and-fees
 * @priority P2
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsTaxesFeesPage extends BaseListPage {
  readonly path = '/carrier/#/reports/taxes-and-fees';
  protected get headingRegex(): RegExp { return /taxes (and|&) fees|impuestos y cargos/i; }
  constructor(page: Page) { super(page); }
}
