// tests/specs/visual/other-costs.visual.spec.ts
// @visual @P3 @migration - Regresion visual MX-5575 Settings Other Costs.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { SettingsOtherCostsPage } from '../../pages/carrier-v2/SettingsOtherCostsPage.js';

test.describe('@visual @P3 @migration MX-5575 Settings Other Costs - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5575' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/settings/otherCosts' });

    const p = new SettingsOtherCostsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('other-costs.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
