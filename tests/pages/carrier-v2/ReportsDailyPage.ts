// tests/pages/carrier-v2/ReportsDailyPage.ts
/**
 * @jira MX-5438
 * @route /carrier/#/reports/daily
 * @priority P1
 * @type functional
 * @note Viajes - Resumen Diario.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class ReportsDailyPage extends BaseListPage {
  readonly path = '/carrier/#/reports/daily';

  protected get headingRegex(): RegExp {
    return /daily|diario|resumen diario/i;
  }

  constructor(page: Page) {
    super(page);
  }
}
