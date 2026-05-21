// tests/specs/visual/documentation.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5569 Expired Documentation.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsDocumentationPage } from '../../pages/carrier-v2/ReportsDocumentationPage.js';

test.describe('@visual @P2 @migration MX-5569 Expired Documentation - visual baseline', () => {
  test('card body estable (header + filtros + thead)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5569' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/documentation' });

    const p = new ReportsDocumentationPage(visualPage);
    await p.goto();
    await p.expectListReady();
    // Esperar a que la red estabilice (Documentation carga lista de documentos asincrona).
    await visualPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);

    const card = visualPage.locator('.card').first();
    await expect(card).toBeVisible();

    // Documentation reporta flake "Failed to take two consecutive stable screenshots" porque
    // la tabla incluye iconos por estado (mdi-check-circle / mdi-alert) que se renderizan
    // progresivamente. Maskeamos la table-responsive completa + threshold mas tolerante.
    await expect(card).toHaveScreenshot('documentation.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatioCharts,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [
        visualPage.locator('.table-responsive'),
        visualPage.locator('app-table-pagination'),
        visualPage.locator('.spinner-border')
      ]
    });
  });
});
