// tests/specs/visual/unpaid-travels.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5531 Unpaid Trips Report.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportUnpaidTravelsPage } from '../../pages/carrier-v2/ReportUnpaidTravelsPage.js';

test.describe('@visual @P2 @migration MX-5531 Unpaid Trips Report - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5531' });
    test.info().annotations.push({
      type: 'route_v2',
      description: '/carrier/#/reports/unpaid-travels-list'
    });

    const p = new ReportUnpaidTravelsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'unpaid-travels.png');
  });
});
