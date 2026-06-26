// tests/specs/visual/payment-flow.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5568 Payment Movements.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsPaymentFlowPage } from '../../pages/carrier-v2/ReportsPaymentFlowPage.js';

test.describe('@visual @P2 @migration MX-5568 Payment Movements - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5568' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/payment-flow' });

    const p = new ReportsPaymentFlowPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'payment-flow.png');
  });
});
