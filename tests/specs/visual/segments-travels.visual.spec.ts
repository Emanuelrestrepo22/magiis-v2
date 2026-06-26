// tests/specs/visual/segments-travels.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5553 Trips Segments.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportSegmentsTravelsPage } from '../../pages/carrier-v2/ReportSegmentsTravelsPage.js';

test.describe('@visual @P2 @migration MX-5553 Trips Segments - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5553' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/segments-travels' });

    const p = new ReportSegmentsTravelsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'segments-travels.png');
  });
});
