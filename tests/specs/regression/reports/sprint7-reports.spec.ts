// tests/specs/release-v2.0.2/sprint7-reports.spec.ts
// Sprint 7 - 7 reportes adicionales descubiertos en routing oficial release/v2.0.4.
// No estan listados en la QA Task original V2.0.2 pero existen en produccion y deben
// quedar bajo cobertura QA para evitar regresiones.
import { test } from '../../../TestBase.js';
import { ReportTravelsListPage } from '../../../pages/carrier-v2/ReportTravelsListPage.js';
import { ReportRankingDriversPage } from '../../../pages/carrier-v2/ReportRankingDriversPage.js';
import { ReportCostCenterPage } from '../../../pages/carrier-v2/ReportCostCenterPage.js';
import { ReportCorporateServicesPage } from '../../../pages/carrier-v2/ReportCorporateServicesPage.js';
import { ReportIndividualCATravelsPage } from '../../../pages/carrier-v2/ReportIndividualCATravelsPage.js';
import { ReportRankingClientsPage } from '../../../pages/carrier-v2/ReportRankingClientsPage.js';
import { ReportRankingVehiclesPage } from '../../../pages/carrier-v2/ReportRankingVehiclesPage.js';

test.describe('@P2 @functional @migration Sprint 7 - reportes adicionales release/v2.0.4', () => {
  test('Travels List Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/travels-list' });
    const p = new ReportTravelsListPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('Drivers Ranking Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/ranking-drivers' });
    const p = new ReportRankingDriversPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('Cost Center Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/cost-center-report' });
    const p = new ReportCostCenterPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('Corporate Services Type Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test
      .info()
      .annotations.push({
        type: 'route_v2',
        description: '/carrier/#/reports/corporate-services-type'
      });
    const p = new ReportCorporateServicesPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('Individual CA Travels Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test
      .info()
      .annotations.push({
        type: 'route_v2',
        description: '/carrier/#/reports/individual-ca-travels'
      });
    const p = new ReportIndividualCATravelsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('Customers Ranking Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/ranking-clients' });
    const p = new ReportRankingClientsPage(page);
    await p.goto();
    await p.expectListReady();
  });

  test('Vehicles Ranking Report - heading + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test
      .info()
      .annotations.push({ type: 'route_v2', description: '/carrier/#/reports/ranking-vehicles' });
    const p = new ReportRankingVehiclesPage(page);
    await p.goto();
    await p.expectListReady();
  });
});
