// tests/specs/visual/gnet-credit-accounts.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5574 GNET Credit Accounts.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { GnetCreditAccountsPage } from '../../pages/carrier-v2/GnetCreditAccountsPage.js';

test.describe('@visual @P2 @migration MX-5574 GNET Credit Accounts - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5574' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/gnet/credit-accounts' });

    const p = new GnetCreditAccountsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'gnet-credit-accounts.png');
  });
});
