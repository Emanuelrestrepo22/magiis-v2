// tests/pages/carrier-v2/settlements/SettlementsOwnerHistoryPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/owners/history/:id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsOwnerHistoryPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // Heading h2 real compartido: "Record Settlements".
    return /record\s+settlements?|settlements?\s+records?|historial/i;
  }
  constructor(page: Page) { super(page); }
}
