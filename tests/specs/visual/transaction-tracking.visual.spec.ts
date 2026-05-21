// tests/specs/visual/transaction-tracking.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5565 Electronic Payment Transactions.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsTransactionTrackingPage } from '../../pages/carrier-v2/ReportsTransactionTrackingPage.js';

test.describe('@visual @P2 @migration MX-5565 Electronic Payment Transactions - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5565' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/reports/transaction-tracking'
    });

    const p = new ReportsTransactionTrackingPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('transaction-tracking.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
