// tests/specs/release-v2.0.2/sprint2-p1.spec.ts
// Sprint 2 - Release V2.0.2 - 7 pantallas P1 con URL confirmada.
// Cubre el checklist QA Task (base): acceso desde menu/URL + heading visible +
// estructura principal de la pantalla (tabla o mapa segun el caso).
import { test, expect } from '../../../TestBase.js';
import { MapViewerPage } from '../../../pages/carrier-v2/MapViewerPage.js';
import { TravelDashboardPage } from '../../../pages/carrier-v2/TravelDashboardPage.js';
import { TravelQuotesPage } from '../../../pages/carrier-v2/TravelQuotesPage.js';
import { TravelRecurringPage } from '../../../pages/carrier-v2/TravelRecurringPage.js';
import { ReportsDailyPage } from '../../../pages/carrier-v2/ReportsDailyPage.js';
import { AffiliateCheckingAccountPage } from '../../../pages/carrier-v2/AffiliateCheckingAccountPage.js';
import { ReportsDocumentationPage } from '../../../pages/carrier-v2/ReportsDocumentationPage.js';

test.describe('@P1 @functional @migration Sprint 2 - Release V2.0.2', () => {
  test('MX-5559 Map Viewer - heading + mapa Leaflet + filtros drivers visibles', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5559' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/map-viewer' });

    const map = new MapViewerPage(page);
    await map.goto();
    await map.expectMapReady();
    await expect(map.driverFilterAll).toBeVisible();
    await expect(map.zoomInButton).toBeVisible();
  });

  // fixme: expectTabsReady() falla en V2 - tabs Assign/InProgress/Finalized no matchean POM heuristico
  test.fixme('MX-5529 Listado de Viajes - heading + tabs por estado + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5529' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/travel/dashboard' });

    const dashboard = new TravelDashboardPage(page);
    await dashboard.goto();
    await dashboard.expectTabsReady();
    await expect(dashboard.table).toBeVisible();
  });

  test('MX-5572 Cotizaciones - heading + search + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5572' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/travel/quotes' });

    const quotes = new TravelQuotesPage(page);
    await quotes.goto();
    await quotes.expectListReady();
  });

  test('MX-5537 Viajes Recurrentes - heading + search + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5537' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/travel/recurring' });

    const recurring = new TravelRecurringPage(page);
    await recurring.goto();
    await recurring.expectListReady();
  });

  test('MX-5438 Reporte Resumen Diario - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5438' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/reports/daily' });

    const daily = new ReportsDailyPage(page);
    await daily.goto();
    await daily.expectListReady();
  });

  test('MX-5554 CC Con Afiliados - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5554' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/affiliate/checking-account' });

    const cc = new AffiliateCheckingAccountPage(page);
    await cc.goto();
    await cc.expectListReady();
  });

  test('MX-5569 Documentacion Vencida - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5569' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/documentation' });

    const docs = new ReportsDocumentationPage(page);
    await docs.goto();
    await docs.expectListReady();
  });
});
