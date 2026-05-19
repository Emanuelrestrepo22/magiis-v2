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
    return /history.*drivers?|drivers?.*history|historial/i;
  }
  constructor(page: Page) { super(page); }
}
