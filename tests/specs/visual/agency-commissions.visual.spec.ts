// tests/specs/visual/agency-commissions.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5571 Company Commissions.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsAgencyCommissionsPage } from '../../pages/carrier-v2/ReportsAgencyCommissionsPage.js';

test.describe('@visual @P2 @migration MX-5571 Company Commissions - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5571' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/agency-commissions' });

    const p = new ReportsAgencyCommissionsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('agency-commissions.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
