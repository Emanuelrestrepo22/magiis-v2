// tests/pages/carrier-v2/ReportCostCenterPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/cost-center-report
 * @priority P2
 * @type functional
 * @note Reporte Cost Center & Associate (heading: "Client Company Report - Cost Center & Associate").
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportCostCenterPage extends BaseListPage {
  readonly path = '/carrier/#/reports/cost-center-report';
  protected get headingRegex(): RegExp {
    return /(client company.*cost center|cost center.*associate|centro de costos?)/i;
  }
  constructor(page: Page) { super(page); }
}
