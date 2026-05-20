// tests/pages/carrier-v2/affiliate/AffiliateLiquidationsListWithIdPage.ts
/**
 * @jira MX-5647
 * @route /carrier/#/affiliate/checking-account/:checkingAccountId/liquidations/list/:typeView
 * @priority P1
 * @type functional
 * @note Variante de la lista de liquidaciones con :id padre (ChechingAccount) y :typeView.
 *       Se navega desde el detail de AffiliateCheckingAccount, no directo.
 */
import type { Page } from '@playwright/test';
import { BaseListPage } from '../../shared/BaseListPage.js';

export class AffiliateLiquidationsListWithIdPage extends BaseListPage {
  /** Path con placeholders - el spec debe completarlo con :checkingAccountId y :typeView reales. */
  readonly path = '/carrier/#/affiliate/checking-account/PLACEHOLDER/liquidations/list/PLACEHOLDER';

  protected get headingRegex(): RegExp {
    // TODO: verificar heading real cuando backend restaure.
    return /affiliate.*liquidations?|liquidations?.*affiliate|liquidaciones?.*afiliado/i;
  }

  constructor(page: Page) {
    super(page);
  }

  /**
   * Override del goto() para construir la URL con :id y :typeView reales.
   * No usar goto() heredado de BaseListPage (que apunta al placeholder).
   */
  async gotoWithIds(checkingAccountId: string, typeView: string): Promise<void> {
    const realPath = `/carrier/#/affiliate/checking-account/${checkingAccountId}/liquidations/list/${typeView}`;
    await this.navigate(realPath);
  }
}
