// tests/pages/carrier-v2/TravelRecurringPage.ts
/**
 * @jira MX-5537
 * @route /carrier/#/travel/recurring
 * @priority P1
 * @type functional
 * @note Gestion de Viajes Recurrentes - en curso de migracion segun la QA Task.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class TravelRecurringPage extends BaseListPage {
  readonly path = '/carrier/#/travel/recurring';

  protected get headingRegex(): RegExp {
    return /recurring|recurrentes/i;
  }

  constructor(page: Page) {
    super(page);
  }
}
