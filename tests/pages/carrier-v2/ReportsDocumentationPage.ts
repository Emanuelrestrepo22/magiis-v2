// tests/pages/carrier-v2/ReportsDocumentationPage.ts
/**
 * @jira MX-5569
 * @route /carrier/#/reports/documentation
 * @priority P1
 * @type functional
 * @note Documentacion Vencida y por Vencer.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsDocumentationPage extends BaseListPage {
  readonly path = '/carrier/#/reports/documentation';

  protected get headingRegex(): RegExp {
    return /documentation|documentaci[oó]n/i;
  }

  constructor(page: Page) {
    super(page);
  }
}
