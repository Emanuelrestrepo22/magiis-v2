// tests/pages/carrier-v2/SettlementsContractorListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/contractors/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class SettlementsContractorListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/contractors/list';
  protected get headingRegex(): RegExp {
    // El portal renderiza solo "Corporations" como h2; "Contractor Liquidations" no aparece literal.
    return /^corporations?$|^contractors?$|^empresas?$/i;
  }
  constructor(page: Page) { super(page); }
}
