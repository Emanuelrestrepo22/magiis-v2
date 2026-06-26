// tests/specs/visual/taxes-fees.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5566 Taxes & Fees Report.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsTaxesFeesPage } from '../../pages/carrier-v2/ReportsTaxesFeesPage.js';

test.describe('@visual @P2 @migration MX-5566 Taxes & Fees Report - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5566' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/taxes-and-fees' });

    const p = new ReportsTaxesFeesPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'taxes-fees.png');
  });
});
