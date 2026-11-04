// tests/pages/carrier-v2/settlements/SettlementsPassengerHistoryPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/passenger/history/:id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsPassengerHistoryPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // Heading h2 real compartido: "Record Settlements".
    // v2.0.20: el h2 ya no se renderiza; el titulo es el breadcrumb h4 "Settlements / Individuals / Record".
    return /settlements?\s*\/\s*individuals\s*\/\s*record|record\s+settlements?|settlements?\s+records?|historial/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
