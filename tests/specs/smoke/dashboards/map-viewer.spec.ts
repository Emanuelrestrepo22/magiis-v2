// tests/specs/dashboards/map-viewer.spec.ts
// @P1 @functional @migration
// Sprint 2 P1 - Map Viewer (mapa operativo con filtros de conductores).
// POM: tests/pages/carrier-v2/MapViewerPage.ts
// Cobertura backlog: AUTOMATION-BACKLOG.md sprint 2 P1 #1 (MX-5559).
//
// NOTA: pantalla atipica (no es listado con tabla). Hereda de BasePage por usar
// Leaflet container + filtros de drivers como pills.
import { test, expect } from '../../../TestBase.js';
import { MapViewerPage } from '../../../pages/carrier-v2/MapViewerPage.js';

test.describe('@P1 @functional @migration MX-5559 Map Viewer', () => {
  // Leaflet + backend de geolocalizacion pueden tener latencia variable.
  test.describe.configure({ retries: 2 });

  test('mapa carga con heading + drivers section + leaflet container', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5559' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/map-viewer' });

    const map = new MapViewerPage(page);
    await map.goto();
    await map.expectMapReady();
  });

  test('filtros de driver visibles (All / Available / Traveling / Unavailable)', async ({
    page
  }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5559' });

    const map = new MapViewerPage(page);
    await map.goto();
    await expect(map.driverFilterAll).toBeVisible();
    await expect(map.driverFilterAvailable).toBeVisible();
    await expect(map.driverFilterTraveling).toBeVisible();
    await expect(map.driverFilterUnavailable).toBeVisible();
  });

  test('boton Identify Drivers visible', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5559' });

    const map = new MapViewerPage(page);
    await map.goto();
    await expect(map.identifyDriversButton).toBeVisible();
  });
});
