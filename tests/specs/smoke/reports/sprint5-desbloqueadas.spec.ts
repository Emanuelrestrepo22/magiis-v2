// tests/specs/release-v2.0.2/sprint5-desbloqueadas.spec.ts
// Sprint 5 - Release V2.0.2 - Pantallas antes bloqueadas, desbloqueadas tras analisis
// del routing oficial release/v2.0.4 (ver docs/inventory/ROUTING-V2.0.4.md).
import { test } from '../../../TestBase.js';
import { ReportUnpaidTravelsPage } from '../../../pages/carrier-v2/ReportUnpaidTravelsPage.js';
import { ReportSegmentsTravelsPage } from '../../../pages/carrier-v2/ReportSegmentsTravelsPage.js';

test.describe('@P1 @functional @migration Sprint 5 - Release V2.0.2 desbloqueadas', () => {
  test('MX-5531 Travel unpaid list - URL real /reports/unpaid-travels-list', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5531' });
    test
      .info()
      .annotations.push({
        type: 'route_v2',
        description: '/carrier/#/reports/unpaid-travels-list'
      });
    test.info().annotations.push({
      type: 'note',
      description:
        'URL desbloqueada vs lo que estaba bajo /travel/ - el componente vive en /reports/.'
    });

    const p = new ReportUnpaidTravelsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('MX-5553 Viajes por Segmentos - URL real /reports/segments-travels', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5553' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/segments-travels' });

    const p = new ReportSegmentsTravelsPage(page);
    await p.goto();
    await p.expectListReady();
  });
});
