// tests/pages/carrier-v2/settlements/SettlementsDriverDetailPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/drivers/details/:driver-id/:liquidation-id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsDriverDetailPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    return /drivers?.*(liquidation|settlement|detail|create)|conductores?|detalle/i;
  }
  constructor(page: Page) { super(page); }
}
