// tests/specs/visual/daily-report.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5438 Daily Report (dashboard de KPIs).
// NOTA: pantalla con widgets/KPI cards de datos diarios -> alta volatilidad.
// Capturamos solo el header (h4 + date picker) y masking del resto.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsDailyPage } from '../../pages/carrier-v2/ReportsDailyPage.js';

test.describe('@visual @P2 @migration MX-5438 Daily Report - visual baseline', () => {
  test('header + date picker estables (KPI widgets masked)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5438' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/reports/daily' });

    const p = new ReportsDailyPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const pageTitle = visualPage.locator('.page-title-box').first();
    await expect(pageTitle).toBeVisible();

    await expect(pageTitle).toHaveScreenshot('daily-report-header.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatioCharts,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('input.flatpickr-input')]
    });
  });
});
