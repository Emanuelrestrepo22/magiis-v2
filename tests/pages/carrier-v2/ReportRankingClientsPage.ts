// tests/pages/carrier-v2/ReportRankingClientsPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/ranking-clients
 * @priority P2
 * @type functional
 * @note Reporte Customers Ranking con KPIs Billed / Average per client / Trips.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportRankingClientsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/ranking-clients';
  protected get headingRegex(): RegExp { return /customers? ranking|ranking (de )?clientes?/i; }
  constructor(page: Page) { super(page); }
}
