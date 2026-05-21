// tests/specs/visual/gnet-farm-in.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5573 GNET Farm IN.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { GnetFarmInPage } from '../../pages/carrier-v2/GnetFarmInPage.js';

test.describe('@visual @P2 @migration MX-5573 GNET Farm IN - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5573' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/gnet/farm-in' });

    const p = new GnetFarmInPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('gnet-farm-in.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
