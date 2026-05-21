// tests/specs/visual/cash-flow.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5562 Collection Movements.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsCashFlowPage } from '../../pages/carrier-v2/ReportsCashFlowPage.js';

test.describe('@visual @P2 @migration MX-5562 Collection Movements - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5562' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/reports/cash-flow' });

    const p = new ReportsCashFlowPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('cash-flow.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
