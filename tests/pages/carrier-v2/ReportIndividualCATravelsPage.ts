// tests/pages/carrier-v2/ReportIndividualCATravelsPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/individual-ca-travels
 * @priority P2
 * @type functional
 * @note Heading real: "Report Customers - Trips Credit Account" (Individual CA = Customer Credit Account).
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportIndividualCATravelsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/individual-ca-travels';
  protected get headingRegex(): RegExp {
    return /customers?.*trips? credit account|credit account.*customers?|cuenta corriente.*viajes?/i;
  }
  constructor(page: Page) { super(page); }

  /** Override: este reporte NO tiene tabla (estructura dashboard con filtros + KPIs). */
  async expectListReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }
}
