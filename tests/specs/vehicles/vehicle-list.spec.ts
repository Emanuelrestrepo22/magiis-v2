// tests/specs/vehicles/vehicle-list.spec.ts
// @P1 @functional @migration
import { test, expect } from '../../TestBase.js';
import { VehicleListPage } from '../../pages/carrier-v2/VehicleListPage.js';

test.describe('@P1 @functional @migration Vehicle list', () => {
  test('renderiza heading + search + tabla', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/vehicle/list' });

    const vehicles = new VehicleListPage(page);
    await vehicles.goto();
    await vehicles.expectListReady();
  });

  test('switch "All / Only Active" visible', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    const vehicles = new VehicleListPage(page);
    await vehicles.goto();
    await expect(vehicles.activeFilterSwitch).toBeVisible();
  });

  test('boton New Vehicle visible (no requiere disabled check - depende permisos)', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    const vehicles = new VehicleListPage(page);
    await vehicles.goto();
    await expect(vehicles.newVehicleButton).toBeVisible();
  });
});
