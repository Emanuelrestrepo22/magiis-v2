// tests/pages/carrier-v2/ReportsAgencyCommissionsPage.ts
/**
 * @jira MX-5571
 * @route /carrier/#/reports/agency-commissions
 * @priority P2
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsAgencyCommissionsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/agency-commissions';
  protected get headingRegex(): RegExp { return /company commissions|agency commissions|comisiones (agencia|de empresa)/i; }
  constructor(page: Page) { super(page); }
}
