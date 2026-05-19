// tests/pages/carrier-v2/ReportRankingDriversPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/ranking-drivers
 * @priority P2
 * @type functional
 * @note Reporte Drivers Ranking con KPIs (Billed / Average / Trips).
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportRankingDriversPage extends BaseListPage {
  readonly path = '/carrier/#/reports/ranking-drivers';
  protected get headingRegex(): RegExp { return /drivers? ranking|ranking (de )?conductores?/i; }
  constructor(page: Page) { super(page); }
}
