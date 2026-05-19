// tests/pages/carrier-v2/ReportTravelsListPage.ts
/**
 * @jira MX-5711
 * @route /carrier/#/reports/travels-list
 * @priority P2
 * @type functional
 * @note Reporte Trip List - descubierto en routing release/v2.0.4 (Sprint 7).
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportTravelsListPage extends BaseListPage {
  readonly path = '/carrier/#/reports/travels-list';
  protected get headingRegex(): RegExp { return /^trip list$|^lista de viajes$/i; }
  constructor(page: Page) { super(page); }
}
