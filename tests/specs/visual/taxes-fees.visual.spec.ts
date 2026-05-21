// tests/specs/visual/taxes-fees.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5566 Taxes & Fees Report.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsTaxesFeesPage } from '../../pages/carrier-v2/ReportsTaxesFeesPage.js';

test.describe('@visual @P2 @migration MX-5566 Taxes & Fees Report - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5566' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/taxes-and-fees' });

    const p = new ReportsTaxesFeesPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('taxes-fees.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
