// tests/pages/carrier-v2/GnetCreditAccountsPage.ts
/**
 * @jira MX-5574
 * @route /carrier/#/gnet/credit-accounts
 * @priority P2
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class GnetCreditAccountsPage extends BaseListPage {
  readonly path = '/carrier/#/gnet/credit-accounts';
  protected get headingRegex(): RegExp { return /credit accounts|cuentas corrientes/i; }
  constructor(page: Page) { super(page); }
}
