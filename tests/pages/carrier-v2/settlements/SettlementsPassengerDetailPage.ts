// tests/pages/carrier-v2/settlements/SettlementsPassengerDetailPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/liquidations/passenger/details/:passenger-id/:liquidation-id
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class SettlementsPassengerDetailPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    return /(individual|passenger).*(liquidation|settlement|detail|create)|pasajeros?|detalle/i;
  }
  constructor(page: Page) { super(page); }
}
