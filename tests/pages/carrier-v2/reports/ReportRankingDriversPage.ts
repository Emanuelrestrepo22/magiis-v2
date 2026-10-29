// tests/pages/carrier-v2/reports/ReportRankingDriversPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/ranking-drivers
 * @priority P2
 * @type functional
 * @note Reporte Drivers Ranking con KPIs (Billed / Average / Trips).
 */
import type { Page } from '@playwright/test';
import { RankingReportBase } from './RankingReportBase.js';

export class ReportRankingDriversPage extends RankingReportBase {
  readonly path = '/carrier/#/reports/ranking-drivers';
  /** Reporte genérico de filas de choferes (totales: 002T). */
  readonly reportCode = '002';
  protected get headingRegex(): RegExp {
    return /drivers? ranking|ranking (de )?conductores?/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
