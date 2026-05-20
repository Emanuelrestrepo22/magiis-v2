// tests/pages/carrier-v2/settlements/SettlementsContractorHistoryPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/contractors/history/:id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsContractorHistoryPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // Contractor (Corporations) usa terminologia "Balance Record" en lugar de "Record
    // Settlements" como los otros tipos. Breadcrumb h4: "Balances / Corporations / Record".
    return /balance\s+records?|balances?\s+records?|historial/i;
  }
  constructor(page: Page) { super(page); }
}
