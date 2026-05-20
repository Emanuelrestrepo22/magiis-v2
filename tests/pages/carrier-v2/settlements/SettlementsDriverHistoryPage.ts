// tests/pages/carrier-v2/settlements/SettlementsDriverHistoryPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/drivers/history/:id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsDriverHistoryPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // Heading h2 real compartido: "Record Settlements".
    return /record\s+settlements?|settlements?\s+records?|historial/i;
  }
  constructor(page: Page) { super(page); }
}
