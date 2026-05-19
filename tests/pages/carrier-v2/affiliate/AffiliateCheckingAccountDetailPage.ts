// tests/pages/carrier-v2/affiliate/AffiliateCheckingAccountDetailPage.ts
/**
 * @jira MX-5648
 * @route /carrier/#/affiliate/checking-account-detail/:checkingAccountId/:typeView
 * @priority P1
 * @type functional
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class AffiliateCheckingAccountDetailPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // TODO: verificar heading real cuando backend restaure.
    return /affiliate.*(checking account|cuenta corriente)|cuenta corriente.*afiliado|account detail/i;
  }
  constructor(page: Page) { super(page); }
}
