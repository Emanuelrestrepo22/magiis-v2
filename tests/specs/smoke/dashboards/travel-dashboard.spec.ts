// tests/specs/dashboards/travel-dashboard.spec.ts
// @P1 @functional @migration
// Sprint 2 P1 - Trips Dashboard (gestion de viajes).
// POM: tests/pages/carrier-v2/TravelDashboardPage.ts
// Cobertura backlog: AUTOMATION-BACKLOG.md sprint 2 P1 #3 (MX-5529).
import { test, expect } from '../../../TestBase.js';
import { TravelDashboardPage } from '../../../pages/carrier-v2/TravelDashboardPage.js';

test.describe('@P1 @functional @migration MX-5529 Travel Dashboard', () => {
  // Backend de listas con latencia variable; retries=2 absorbe timeouts puntuales.
  test.describe.configure({ retries: 2 });

  test('renderiza heading + tabla + paginacion', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5529' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/travel/dashboard' });

    const dashboard = new TravelDashboardPage(page);
    await dashboard.goto();
    await dashboard.expectListReady();
    await dashboard.expectPaginationReady();
  });

  test('tabs por estado visibles (Assign / In Progress / Finalized)', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5529' });

    const dashboard = new TravelDashboardPage(page);
    await dashboard.goto();
    await dashboard.expectTabsReady();
  });

  test('checkboxes de filtro visibles (Automatic Assignment + VIP)', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5529' });

    const dashboard = new TravelDashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.automaticAssignmentCheckbox).toBeVisible();
    await expect(dashboard.vipCheckbox).toBeVisible();
  });
});
