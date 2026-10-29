// tests/pages/carrier-v2/settlements/SettlementsContractorListPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/contractors/list
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class SettlementsContractorListPage extends BaseListPage {
  readonly path = '/carrier/#/liquidations/contractors/list';
  protected get headingRegex(): RegExp {
    // Breadcrumb h4 real: "Settlements / Corporations". No hay h2 ni el literal "Contractor".
    return /settlements\s*\/\s*corporations/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
