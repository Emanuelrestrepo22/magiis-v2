// tests/pages/carrier-v2/ReportUnpaidTravelsPage.ts
/**
 * @jira MX-5531
 * @route /carrier/#/reports/unpaid-travels-list
 * @priority P1
 * @type functional
 * @note Travel unpaid list - antes "bloqueada" porque buscaba /travel/unpaid-list.
 *       La URL real (release/v2.0.4) la ubica bajo /reports/ -> ReportUnpaidTripsComponent.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportUnpaidTravelsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/unpaid-travels-list';

  protected get headingRegex(): RegExp {
    return /unpaid (travels?|trips?)|viajes? (no )?pagados?|viajes? (sin|pendientes? de) pago/i;
  }

  constructor(page: Page) {
    super(page);
  }
}
