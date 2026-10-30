// tests/pages/carrier-v2/reports/ReportUnpaidTravelsPage.ts
/**
 * @jira MX-5531
 * @route /carrier/#/reports/unpaid-travels-list
 * @priority P1
 * @type functional
 * @note Travel unpaid list - antes "bloqueada" porque buscaba /travel/unpaid-list.
 *       La URL real (release/v2.0.4) la ubica bajo /reports/ -> ReportUnpaidTripsComponent.
 */
import type { Locator, Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class ReportUnpaidTravelsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/unpaid-travels-list';

  /**
   * Export PDF de la cabecera. Es icon-only (`ri-file-download-line`): su unico rotulo es el tooltip
   * "PDF" (ngbTooltip, solo en hover), asi que no tiene nombre accesible y el `pdfButton` de la base
   * no lo encuentra. Fuente: report-unpaid-trips.component.html @ v2.0.20.
   */
  readonly pdfExportButton: Locator;

  protected get headingRegex(): RegExp {
    return /unpaid (travels?|trips?)|viajes? (no )?pagados?|viajes? (sin|pendientes? de) pago/i;
  }

  constructor(page: Page) {
    super(page);
    this.pdfExportButton = page
      .locator('.right-group button')
      .filter({ has: page.locator('i.ri-file-download-line') });
  }
}
