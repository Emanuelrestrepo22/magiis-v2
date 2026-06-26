// tests/specs/visual/aging-report.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5561 Aging Report.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsDebtAgingPage } from '../../pages/carrier-v2/ReportsDebtAgingPage.js';

test.describe('@visual @P2 @migration MX-5561 Aging Report - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5561' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/debt-aging' });

    const p = new ReportsDebtAgingPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'aging-report.png');
  });
});
