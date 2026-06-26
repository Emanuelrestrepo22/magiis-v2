// tests/specs/visual/agency-commissions.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5571 Company Commissions.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsAgencyCommissionsPage } from '../../pages/carrier-v2/ReportsAgencyCommissionsPage.js';

test.describe('@visual @P2 @migration MX-5571 Company Commissions - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5571' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/agency-commissions' });

    const p = new ReportsAgencyCommissionsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'agency-commissions.png');
  });
});
