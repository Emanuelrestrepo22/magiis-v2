// tests/specs/visual/documentation.visual.spec.ts
// @visual @P2 @migration - Regresion visual MX-5569 Expired Documentation.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsDocumentationPage } from '../../pages/carrier-v2/ReportsDocumentationPage.js';

test.describe('@visual @P2 @migration MX-5569 Expired Documentation - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5569' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/documentation' });

    const p = new ReportsDocumentationPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'documentation.png');
  });
});
