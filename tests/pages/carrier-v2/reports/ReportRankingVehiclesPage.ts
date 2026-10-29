// tests/pages/carrier-v2/reports/ReportRankingVehiclesPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/ranking-vehicles
 * @priority P2
 * @type functional
 * @note Reporte Vehicles Ranking con KPIs Billed / Average per vehicle / Trips.
 */
import type { Page } from '@playwright/test';
import { RankingReportBase } from './RankingReportBase.js';

export class ReportRankingVehiclesPage extends RankingReportBase {
  readonly path = '/carrier/#/reports/ranking-vehicles';
  /** Reporte genérico de filas de vehículos (totales: 001T). */
  readonly reportCode = '001';
  protected get headingRegex(): RegExp {
    return /vehicles? ranking|ranking (de )?veh[ií]culos?/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
