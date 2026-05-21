// tests/specs/visual/tips-report.visual.spec.ts
// @visual @P1 @migration
// Regresion visual MX-5560 Tips Report. Captura del card body con masking del tbody
// (datos volatiles) para detectar regresiones de layout/filtros/header sin flake por datos.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsTipsPage } from '../../pages/carrier-v2/ReportsTipsPage.js';

test.describe('@visual @P1 @migration MX-5560 Tips Report - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5560' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/reports/tips' });

    const p = new ReportsTipsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    await expect(card).toHaveScreenshot('tips-report.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatio,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('tbody'), visualPage.locator('app-table-pagination')]
    });
  });
});
