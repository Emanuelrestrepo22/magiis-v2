// tests/specs/visual/segments-travels.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5553 Trips Segments.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportSegmentsTravelsPage } from '../../pages/carrier-v2/ReportSegmentsTravelsPage.js';

test.describe('@visual @P2 @migration MX-5553 Trips Segments - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5553' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/segments-travels' });

    const p = new ReportSegmentsTravelsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('segments-travels.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
