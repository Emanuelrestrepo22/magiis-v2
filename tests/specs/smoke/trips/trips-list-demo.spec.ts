// tests/specs/trips/trips-list-demo.spec.ts
// Spec demo que muestra el patron completo:
// - Factories con faker para generar datos unicos.
// - Identidad de datos (prefijo qa_e2e_) para distinguirlos en UAT/PROD.
// - Trazabilidad MX-XXXX en annotations.
// - Tags @P1 @functional @migration.
// NOTA: este spec sirve de plantilla; la pantalla TripsList real se cubre cuando llegue
// el inventario MX-4820 y se cree TripsListPage.ts.
import { test, expect } from '../../../TestBase.js';
import { makeTrip, makeDriver, makeVehicle } from '../../../fixtures/factories/index.js';

test.describe('@P1 @functional @migration Trips List (demo de patron)', () => {
  test('factories generan datos unicos y trazables', async () => {
    test.info().annotations.push({ type: 'jira', description: 'MX-PENDING-trips-demo' });
    test
      .info()
      .annotations.push({ type: 'note', description: 'Demo del uso de factories - no toca DOM' });

    // 1. Trip simple (sin driver asignado).
    const newTrip = makeTrip({ region: 'AR', passengerCount: 3 });
    expect(newTrip.id).toMatch(/^qa_e2e_/);
    expect(newTrip.reference).toMatch(/^TRIP-\d{8}$/);
    expect(newTrip.passengerCount).toBe(3);
    expect(newTrip.status).toBe('pending');
    expect(newTrip.driver).toBeNull();

    // 2. Driver + vehicle por separado (composicion).
    const driver = makeDriver({ region: 'AR', status: 'active' });
    const vehicle = makeVehicle({ region: 'AR', type: 'van', capacity: 8 });
    expect(driver.id).toMatch(/^qa_e2e_/);
    expect(vehicle.plate).toMatch(/^[A-Z0-9]{7}$/);
    expect(vehicle.type).toBe('van');

    // 3. Trip asignado (driver + vehicle inyectados).
    const assignedTrip = makeTrip({
      region: 'AR',
      status: 'in_progress',
      driver,
      vehicle
    });
    expect(assignedTrip.driver?.id).toBe(driver.id);
    expect(assignedTrip.vehicle?.plate).toBe(vehicle.plate);
  });
});
