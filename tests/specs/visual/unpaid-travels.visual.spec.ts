// tests/specs/visual/unpaid-travels.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5531 Unpaid Trips Report.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportUnpaidTravelsPage } from '../../pages/carrier-v2/ReportUnpaidTravelsPage.js';

test.describe('@visual @P2 @migration MX-5531 Unpaid Trips Report - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5531' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/reports/unpaid-travels-list'
    });

    const p = new ReportUnpaidTravelsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('unpaid-travels.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
