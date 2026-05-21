// tests/specs/visual/aging-report.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5561 Aging Report.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsDebtAgingPage } from '../../pages/carrier-v2/ReportsDebtAgingPage.js';

test.describe('@visual @P2 @migration MX-5561 Aging Report - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5561' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/debt-aging' });

    const p = new ReportsDebtAgingPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('aging-report.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
