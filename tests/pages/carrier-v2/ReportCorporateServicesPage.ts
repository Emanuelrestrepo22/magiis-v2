// tests/pages/carrier-v2/ReportCorporateServicesPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/corporate-services-type
 * @priority P2
 * @type functional
 * @note Heading real: "Corporate - Services Type & Cost Center".
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportCorporateServicesPage extends BaseListPage {
  readonly path = '/carrier/#/reports/corporate-services-type';
  protected get headingRegex(): RegExp {
    return /corporate.*services? type|services? type.*corporate|servicios? corporativos?/i;
  }
  constructor(page: Page) { super(page); }

  /** Override: este reporte NO tiene tabla (estructura dashboard con filtros + KPIs). */
  async expectListReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }
}
