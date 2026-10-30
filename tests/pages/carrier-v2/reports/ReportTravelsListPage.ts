// tests/pages/carrier-v2/reports/ReportTravelsListPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/travels-list
 * @priority P2
 * @type functional
 * @note Reporte Trip List - descubierto en routing release/v2.0.4 (Sprint 7).
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class ReportTravelsListPage extends BaseListPage {
  readonly path = '/carrier/#/reports/travels-list';
  protected get headingRegex(): RegExp {
    // v2.0.20: el titulo es el breadcrumb h4 "Reports / Trip List" (carrier.reports.travel_list.breadcrumb).
    return /^((reports|reportes)\s*\/\s*)?(trip list|lista de viajes)$/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
