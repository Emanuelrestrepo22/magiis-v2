// tests/pages/carrier-v2/GnetFarmInPage.ts
/**
 * @jira MX-5573
 * @route /carrier/#/gnet/farm-in
 * @priority P2
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class GnetFarmInPage extends BaseListPage {
  readonly path = '/carrier/#/gnet/farm-in';
  protected get headingRegex(): RegExp { return /farm in|farm-in/i; }
  constructor(page: Page) { super(page); }
}
