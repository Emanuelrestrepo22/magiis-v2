// tests/pages/carrier-v2/ReportsTipsPage.ts
/**
 * @jira MX-5560
 * @route /carrier/#/reports/tips
 * @priority P2
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsTipsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/tips';
  protected get headingRegex(): RegExp { return /tips? report|propinas?/i; }
  constructor(page: Page) { super(page); }
}
