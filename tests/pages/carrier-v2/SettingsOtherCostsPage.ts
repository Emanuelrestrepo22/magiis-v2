// tests/pages/carrier-v2/SettingsOtherCostsPage.ts
/**
 * @jira MX-5575
 * @route /carrier/#/settings/otherCosts
 * @priority P3
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class SettingsOtherCostsPage extends BaseListPage {
  readonly path = '/carrier/#/settings/otherCosts';
  protected get headingRegex(): RegExp { return /other costs|otros costos/i; }
  constructor(page: Page) { super(page); }
}
