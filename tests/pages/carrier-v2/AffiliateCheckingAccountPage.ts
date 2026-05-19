// tests/pages/carrier-v2/AffiliateCheckingAccountPage.ts
/**
 * @jira MX-5554
 * @route /carrier/#/affiliate/checking-account
 * @priority P1
 * @type functional
 * @note Cuentas Corrientes Con Afiliados.
 *       El portal V2 deployado de esta pantalla NO renderiza heading h2/h4 visible
 *       (bug a11y a levantar con dev). Override goto/expectListReady para anclar a tabla.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export class AffiliateCheckingAccountPage extends BaseListPage {
  readonly path = '/carrier/#/affiliate/checking-account';

  protected get headingRegex(): RegExp {
    return /checking account|cuenta corriente|afiliados?/i;
  }

  constructor(page: Page) {
    super(page);
  }

  /** Override: la pantalla no expone heading visible, anclamos a tabla. */
  async goto(): Promise<void> {
    await this.navigate(this.path);
    await expect(this.table).toBeVisible({ timeout: 15_000 });
  }

  async expectListReady(): Promise<void> {
    await expect(this.table).toBeVisible();
  }
}
