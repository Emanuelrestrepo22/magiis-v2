// tests/pages/carrier-v2/ReportRankingVehiclesPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/ranking-vehicles
 * @priority P2
 * @type functional
 * @note Reporte Vehicles Ranking con KPIs Billed / Average per vehicle / Trips.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportRankingVehiclesPage extends BaseListPage {
  readonly path = '/carrier/#/reports/ranking-vehicles';
  protected get headingRegex(): RegExp { return /vehicles? ranking|ranking (de )?veh[ií]culos?/i; }
  constructor(page: Page) { super(page); }
}
