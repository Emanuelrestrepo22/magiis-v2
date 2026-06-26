// tests/specs/visual/affiliate-checking-account.visual.spec.ts
// @visual @P1 @migration - Regresion visual MX-5554 Affiliate Credit Accounts.
// NOTA: pantalla sin heading h2 (bug a11y) - anclamos al breadcrumb + .listjs-table.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { AffiliateCheckingAccountPage } from '../../pages/carrier-v2/AffiliateCheckingAccountPage.js';

test.describe('@visual @P1 @migration MX-5554 Affiliate Checking Account - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5554' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/affiliate/checking-account' });

    const p = new AffiliateCheckingAccountPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'affiliate-checking-account.png');
  });
});
