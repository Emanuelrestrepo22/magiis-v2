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
    // Heading real validado contra i18n V2:
    // EN: "Affiliate Credit Accounts Details"
    // ES: "Detalle de Cuenta Corriente Afiliado"
    // Tolerante a singular/plural y al badge "IN"/"OUT" que comparte el h2.
    return /affiliate\s+credit\s+accounts?\s+details?|detalle\s+de\s+cuenta\s+corriente\s+afiliad/i;
  }
  constructor(page: Page) {
    super(page);
  }
}
