// tests/pages/carrier-v2/TravelQuotesPage.ts
/**
 * @jira MX-5572
 * @route /carrier/#/travel/quotes
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class TravelQuotesPage extends BaseListPage {
  readonly path = '/carrier/#/travel/quotes';

  protected get headingRegex(): RegExp {
    return /^quotes$|cotizaciones/i;
  }

  constructor(page: Page) {
    super(page);
  }
}
