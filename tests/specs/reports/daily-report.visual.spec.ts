// tests/specs/reports/daily-report.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5438 Daily Report (dashboard de KPIs).
// NOTA: pantalla con widgets/KPI cards de datos diarios -> alta volatilidad.
// Capturamos solo el header y masking del resto.
// v2.0.20: el header pasa a <app-breadcrumbs> (titulo "DAILY") y el date picker sale de
// .page-title-box a su propia fila: el snapshot cubre el header y el picker se valida funcional.
import { test, expect } from '../../fixtures/visualBaseline.js';
import { VISUAL_DEFAULTS } from '../../config/visualConfig.js';
import { ReportsDailyPage } from '../../pages/carrier-v2/reports/ReportsDailyPage.js';

test.describe('@visual @P2 @migration MX-5438 Daily Report - visual baseline', () => {
  test('header + date picker estables (KPI widgets masked)', async ({ visualPage }) => {
    test.info().annotations.push({ type: 'tms', description: 'MX-5438' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/reports/daily' });

    const p = new ReportsDailyPage(visualPage);
    await p.goto();
    await p.expectListReady();

    const pageTitle = visualPage.locator('.page-title-box').first();
    await expect(pageTitle).toBeVisible();
    await expect(p.datePickerInput).toBeVisible();

    await expect(pageTitle).toHaveScreenshot('daily-report-header.png', {
      maxDiffPixelRatio: VISUAL_DEFAULTS.maxDiffPixelRatioCharts,
      animations: VISUAL_DEFAULTS.animations,
      caret: VISUAL_DEFAULTS.caret,
      mask: [visualPage.locator('input.flatpickr-input')]
    });
  });
});
