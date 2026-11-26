// tests/specs/settings/waypoints-base.api.spec.ts
// MG-1132 · ATP TM-1841 — smoke de la BASE de automatizacion (clientes waypoints/places, fixture,
// datos, evidencia imagen). NO acredita ningun Test de Xray (sin clave TM en el titulo): prueba que
// los modulos compartidos funcionan antes de que PK-1..PK-4 los usen. Ambiente TEST (decision D2).
// Gate WAYPOINTS_CREATE_DATA=1: crea y borra puntos de referencia reales con el prefijo «QA AUTO <runId>».
// Corrida local (sesion guardada, sin login con contrasena):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/settings/waypoints-base.api.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { LOCATIONS, MIAMI, toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { attachApiEvidence } from '../../helpers/api-evidence.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);

test.describe('@P3 @functional @migration MG-1132 base de automatizacion de puntos de referencia (API)', () => {
  test.skip(
    process.env.WAYPOINTS_CREATE_DATA !== '1',
    'crea y borra puntos de referencia reales; correr con WAYPOINTS_CREATE_DATA=1'
  );
  test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);

  // SIN retries: cada intento crea datos reales y un reintento taparia la falla del primero.
  test.describe.configure({ timeout: 120_000, retries: 0 });

  // Barrido de corridas anteriores: solo puntos «QA AUTO <runId>» con mas de 24 h.
  test.beforeAll(async ({ carrierApi, carrierSession }) => {
    await new WaypointsClient(carrierApi, carrierSession, makeRunId()).sweep();
  });

  test('BASE-WP-01: debería crear, listar, consultar uso y dar de baja un punto propio', async ({
    waypointsApi,
    nameFor,
    browser
  }, testInfo) => {
    const name = nameFor('base');
    const created = await waypointsApi.create({
      name,
      reference: 'Referencia de la base',
      ...toWaypointCoords(MIAMI.downtown)
    });
    expect(created.waypoint.placeId).toMatch(/^MGWP-\d+-1$/);

    const listed = (await waypointsApi.list()).find((w) => w.id === created.waypoint.id);
    expect(listed?.name).toBe(name);
    expect(listed?.reference).toBe('Referencia de la base');

    const usage = await waypointsApi.usage(created.waypoint.id);
    expect(usage.scheduledTravelIds).toEqual([]);

    const removed = await waypointsApi.remove(created.waypoint.id);
    expect(removed).not.toBeNull();
    expect((await waypointsApi.list()).some((w) => w.id === created.waypoint.id)).toBe(false);
    expect(waypointsApi.ownIds).toEqual([]);

    await attachApiEvidence(testInfo, browser, {
      name: 'waypoints-round-trip',
      comment:
        `Alta, listado, uso y baja por API en ${ENV} del punto «${name}» (id ${created.waypoint.id}, ` +
        `placeId ${created.waypoint.placeId}); el listado lo devolvio con su referencia, el uso vino vacio ` +
        'y tras la baja ya no figura en el listado.',
      measurement: {
        id: created.waypoint.id,
        placeId: created.waypoint.placeId,
        warnings: created.warnings,
        usage,
        listedAfterDelete: false
      }
    });
  });

  test('BASE-WP-02: debería medir checkPlace de un camino rural y del mar con y sin waypoint=true', async ({
    placesApi,
    browser
  }, testInfo) => {
    const rural = LOCATIONS.F2;
    const sea = LOCATIONS.F5a;
    const ruralPlace = await placesApi.getPlaceByCoords(rural.lat, rural.lng);
    const seaPlace = await placesApi.getPlaceByCoords(sea.lat, sea.lng);

    const ruralWith = await placesApi.checkPlace(ruralPlace.placeId, { waypoint: true });
    const ruralWithout = await placesApi.checkPlace(ruralPlace.placeId);
    const seaWith = await placesApi.checkPlace(seaPlace.placeId, { waypoint: true });
    const seaWithout = await placesApi.checkPlace(seaPlace.placeId);

    expect(ruralWith.routable).toBe(rural.routableWithWaypoint);
    expect(ruralWithout.routable).toBe(rural.routableWithoutWaypoint);
    expect(seaWith.routable).toBe(sea.routableWithWaypoint);
    expect(seaWith.reasons).toEqual(sea.reasonsWithWaypoint);
    expect(seaWithout.routable).toBe(sea.routableWithoutWaypoint);

    await attachApiEvidence(testInfo, browser, {
      name: 'waypoints-check-place',
      comment:
        `checkPlace en ${ENV}: camino rural sin localidad routable=${ruralWith.routable} con waypoint=true y ` +
        `${ruralWithout.routable} sin el parametro; mar abierto routable=${seaWith.routable} ` +
        `(reasons ${JSON.stringify(seaWith.reasons)}) con waypoint=true y ${seaWithout.routable} sin el parametro.`,
      measurement: {
        ruralConWaypoint: { routable: ruralWith.routable, reasons: ruralWith.reasons },
        ruralSinWaypoint: { routable: ruralWithout.routable, reasons: ruralWithout.reasons },
        marConWaypoint: { routable: seaWith.routable, reasons: seaWith.reasons },
        marSinWaypoint: { routable: seaWithout.routable, reasons: seaWithout.reasons }
      }
    });
  });

  test('BASE-WP-03: debería aislar los puntos de la segunda sesión (carrier 1040) de los de la primera', async ({
    waypointsApi,
    otherCarrierWaypointsApi,
    nameFor,
    browser
  }, testInfo) => {
    const name = nameFor('otro');
    const created = await otherCarrierWaypointsApi.create({
      name,
      ...toWaypointCoords(MIAMI.brickell)
    });
    expect((await otherCarrierWaypointsApi.list()).some((w) => w.id === created.waypoint.id)).toBe(
      true
    );
    const seenByPrimary = (await waypointsApi.list()).some((w) => w.name === name);
    expect(seenByPrimary).toBe(false);

    await otherCarrierWaypointsApi.remove(created.waypoint.id);
    await attachApiEvidence(testInfo, browser, {
      name: 'waypoints-aislamiento',
      comment:
        `El punto «${name}» creado con la sesion secundaria (id ${created.waypoint.id}) figura en su ` +
        'listado y no figura en el listado de la sesion primaria; se dio de baja por id propio.',
      measurement: { idSecundario: created.waypoint.id, visibleEnPrimaria: seenByPrimary }
    });
  });
});
