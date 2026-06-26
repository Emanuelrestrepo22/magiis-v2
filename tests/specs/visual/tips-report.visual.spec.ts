// tests/specs/visual/tips-report.visual.spec.ts
// @visual @P1 @migration
// Regresion visual MX-5560 Tips Report. Captura del card body con masking del tbody
// (datos volatiles) para detectar regresiones de layout/filtros/header sin flake por datos.
import { test, captureCardAboveTheFold } from '../../fixtures/visualBaseline.js';
import { ReportsTipsPage } from '../../pages/carrier-v2/ReportsTipsPage.js';

test.describe('@visual @P1 @migration MX-5560 Tips Report - visual baseline', () => {
  test('card above-the-fold estable (header + filtros + thead, excluye tbody)', async ({
    visualPage
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5560' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/reports/tips' });

    const p = new ReportsTipsPage(visualPage);
    await p.goto();
    await p.expectListReady();

    await captureCardAboveTheFold(visualPage, 'tips-report.png');
  });
});
