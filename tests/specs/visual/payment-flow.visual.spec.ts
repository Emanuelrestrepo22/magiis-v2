// tests/specs/visual/payment-flow.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5568 Payment Movements.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsPaymentFlowPage } from '../../pages/carrier-v2/ReportsPaymentFlowPage.js';

test.describe('@visual @P2 @migration MX-5568 Payment Movements - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5568' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/payment-flow' });

    const p = new ReportsPaymentFlowPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('payment-flow.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
