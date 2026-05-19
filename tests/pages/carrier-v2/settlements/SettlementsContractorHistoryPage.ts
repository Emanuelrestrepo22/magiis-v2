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
    // TODO: verificar heading real (probable "History" / "Historial" + "Corporation").
    return /history.*(corporation|contractor)|(corporation|contractor).*history|historial|liquidations? history/i;
  }
  constructor(page: Page) { super(page); }
}
