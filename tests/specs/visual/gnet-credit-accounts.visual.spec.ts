// tests/specs/visual/gnet-credit-accounts.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5574 GNET Credit Accounts.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { GnetCreditAccountsPage } from '../../pages/carrier-v2/GnetCreditAccountsPage.js';

test.describe('@visual @P2 @migration MX-5574 GNET Credit Accounts - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5574' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/gnet/credit-accounts' });

    const p = new GnetCreditAccountsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('gnet-credit-accounts.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
