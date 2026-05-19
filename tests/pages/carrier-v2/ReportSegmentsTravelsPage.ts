// tests/pages/carrier-v2/ReportSegmentsTravelsPage.ts
/**
 * @jira MX-5553
 * @route /carrier/#/reports/segments-travels
 * @priority P1
 * @type functional
 * @note Viajes por Segmentos - antes "bloqueada", desbloqueada en release/v2.0.4.
 *       Componente real V2: ReportTripsSegmentsComponent.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportSegmentsTravelsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/segments-travels';

  protected get headingRegex(): RegExp {
    return /trips? segments?|segments?\s*(travels?|trips?)|viajes? por segmentos?|segmentos? de viajes?/i;
  }

  constructor(page: Page) {
    super(page);
  }
}
