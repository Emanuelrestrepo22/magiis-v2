// tests/pages/carrier-v2/affiliate/AffiliateLiquidationDetailPage.ts
/**
 * @jira MX-5646
 * @route /carrier/#/affiliate/liquidation-detail/:id/:editMode
 * @priority P1
 * @type functional
 * @note Liquidacion de cuenta corriente afiliado - requiere `:id` y `:editMode`.
 */
import type { Page } from '@playwright/test';
import { BaseDetailPage } from '../../shared/BaseDetailPage.js';

export class AffiliateLiquidationDetailPage extends BaseDetailPage {
  protected get headingRegex(): RegExp {
    // TODO: verificar heading real cuando backend restaure.
    return /affiliate.*liquidation|liquidation.*affiliate|liquidaci[oó]n.*afiliado/i;
  }
  constructor(page: Page) { super(page); }
}
