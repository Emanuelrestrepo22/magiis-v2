// tests/pages/carrier-v2/settlements/SettlementsOwnerDetailPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/owners/details/:owner-id/:liquidation-id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsOwnerDetailPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    return /owners?.*(liquidation|settlement|detail|create)|propietarios?|detalle/i;
  }
  constructor(page: Page) { super(page); }
}
