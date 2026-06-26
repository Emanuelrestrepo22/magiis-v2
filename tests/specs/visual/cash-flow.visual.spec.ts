// tests/specs/visual/cash-flow.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5562 Collection Movements.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsCashFlowPage } from '../../pages/carrier-v2/ReportsCashFlowPage.js';

test.describe('@visual @P2 @migration MX-5562 Collection Movements - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5562' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/reports/cash-flow' });

    const p = new ReportsCashFlowPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'cash-flow.png');
  });
});
