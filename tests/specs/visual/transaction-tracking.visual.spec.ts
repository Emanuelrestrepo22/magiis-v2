// tests/specs/visual/transaction-tracking.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5565 Electronic Payment Transactions.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsTransactionTrackingPage } from '../../pages/carrier-v2/ReportsTransactionTrackingPage.js';

test.describe('@visual @P2 @migration MX-5565 Electronic Payment Transactions - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5565' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/reports/transaction-tracking'
    });

    const p = new ReportsTransactionTrackingPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'transaction-tracking.png');
  });
});
