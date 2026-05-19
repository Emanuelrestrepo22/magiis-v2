// tests/specs/dashboards/operations-control.spec.ts
// @P1 @functional @migration
// Operations Control: dashboard principal post-login del carrier V2.
// Trazabilidad: MX-5711 (esfuerzo migracion).
import { test, expect } from '../../TestBase.js';
import { OperationsControlPage } from '../../pages/carrier-v2/OperationsControlPage.js';

test.describe('@P1 @functional @migration Operations Control', () => {
  test('renderiza heading + secciones principales tras login', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({ type: 'route_v2', description: '/carrier/#/dashboard' });

    const ops = new OperationsControlPage(page);
    await ops.goto();
    await ops.expectMainSectionsReady();
  });

  test('KPIs principales visibles (trips made, active vehicles, active drivers)', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    const ops = new OperationsControlPage(page);
    await ops.goto();

    await expect(ops.kpiTripsMade).toBeVisible();
    await expect(ops.kpiActiveVehicles).toBeVisible();
    await expect(ops.kpiActiveDrivers).toBeVisible();
    await expect(ops.kpiTotalClients).toBeVisible();
  });

  test('Distribution by Channel expone APPs / WA-IVR / WEB', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    const ops = new OperationsControlPage(page);
    await ops.goto();

    await expect(ops.distributionSection).toBeVisible();
    await expect(ops.channelApps).toBeVisible();
    await expect(ops.channelWaIvr).toBeVisible();
    await expect(ops.channelWeb).toBeVisible();
  });

  test('Drivers Status muestra tabla + filtros (all/available/traveling/unavailable)', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({
      type: 'note',
      description: 'Solo verifica visibilidad. El conteo por filtro depende de datos del ambiente.'
    });

    const ops = new OperationsControlPage(page);
    await ops.goto();

    await expect(ops.driversStatusSection).toBeVisible();
    await expect(ops.driversTable).toBeVisible();
    await expect(ops.driverFilterAll).toBeVisible();
    await expect(ops.driverFilterAvailable).toBeVisible();
    await expect(ops.driverFilterTraveling).toBeVisible();
    await expect(ops.driverFilterUnavailable).toBeVisible();
  });

  test('topbar expone accion de nuevo viaje', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });
    test.info().annotations.push({
      type: 'note',
      description: 'Solo "Trip" tiene texto visible. Los iconos de historico/gestion son icon-only sin aria-label - bug de a11y a levantar con dev.'
    });

    const ops = new OperationsControlPage(page);
    await ops.goto();

    await expect(ops.newTripButton).toBeVisible();
  });
});
