// tests/specs/trips/places-check-place.api.spec.ts
// MG-1132 · ATP TM-1841 · PK-1 «Contrato API» — `places/checkPlace/{placeId}[?waypoint=true]`, el
// endpoint del flujo de viaje/puntero. 1 Test Xray: TM-1869 (tabla de decision F1..F7 con y sin el
// parametro, parametrizada: las particiones de igual comportamiento comparten el cuerpo del test).
// API pura (excepcion D1 del ADR-0003). Ambiente TEST (D2). El placeId de Google se resuelve por
// coordenadas en runtime (nunca se hardcodea) y el texto de formattedAddress no se asevera (Google
// cambia el plus_code): se asevera `routable` y `reasons`. F7 es un punto propio MGWP-… dado de alta
// y borrado por el fixture.
// Regla (MG-1757 DISENO.md): con `waypoint=true` solo bloquean NO_GEOCODE_RESULTS y NO_COUNTRY; sin el
// parametro el comportamiento previo no cambia.
// Gate WAYPOINTS_CREATE_DATA=1 (F7 crea un punto). Corrida local (sesion guardada):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/trips/places-check-place.api.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import {
  LOCATIONS,
  MIAMI,
  toWaypointCoords,
  type LocationCase
} from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { attachApiEvidence } from '../../helpers/api-evidence.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const ROUTE = 'places/checkPlace/{placeId}';

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

test.describe('@P1 @functional @migration MG-1132 checkPlace con waypoint=true (API)', () => {
  test('TM-1869: debería aplicar la tabla de decisión de checkPlace con y sin waypoint=true', async ({
    waypointsApi,
    placesApi,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1869', ROUTE)('TC11', 'DT');

    // Filas de la tabla medida (locations.ts): veredicto Y motivos con y sin el parametro.
    const rows = Object.entries(LOCATIONS).map(([code, loc]) => ({
      code,
      label: loc.label,
      lat: loc.lat,
      lng: loc.lng,
      withWaypoint: loc.routableWithWaypoint as boolean,
      withoutWaypoint: loc.routableWithoutWaypoint as boolean,
      reasonsWithWaypoint: (loc as LocationCase).reasonsWithWaypoint,
      reasonsWithoutWaypoint: (loc as LocationCase).reasonsWithoutWaypoint
    }));

    const measured: Record<string, unknown> = {};
    for (const row of rows) {
      const place = await placesApi.getPlaceByCoords(row.lat, row.lng);
      const withParam = await placesApi.checkPlace(place.placeId, { waypoint: true });
      const withoutParam = await placesApi.checkPlace(place.placeId);
      measured[`${row.code} ${row.label}`] = {
        tiposGoogle: place.types,
        direccion: place.formattedAddress,
        conWaypoint: { routable: withParam.routable, reasons: withParam.reasons },
        sinWaypoint: { routable: withoutParam.routable, reasons: withoutParam.reasons }
      };

      expect.soft(withParam.routable, `${row.code} con waypoint=true`).toBe(row.withWaypoint);
      expect.soft(withoutParam.routable, `${row.code} sin el parametro`).toBe(row.withoutWaypoint);
      if (row.reasonsWithWaypoint) {
        expect
          .soft(withParam.reasons, `${row.code} con waypoint=true: motivos exactos`)
          .toEqual(row.reasonsWithWaypoint);
      }
      if (row.reasonsWithoutWaypoint) {
        expect
          .soft(withoutParam.reasons, `${row.code} sin el parametro: motivos`)
          .toEqual(expect.arrayContaining(row.reasonsWithoutWaypoint));
      }
      if (row.withoutWaypoint === false) {
        expect
          .soft(withoutParam.reasons.length, `${row.code} sin el parametro: informa sus reasons`)
          .toBeGreaterThan(0);
      }
      if (row.code.startsWith('F5')) {
        expect
          .soft(withoutParam.reasons, `${row.code} sin el parametro tambien NO_COUNTRY`)
          .toContain('NO_COUNTRY');
      }
    }

    // F7: punto propio de referencia (placeId MGWP-…): ruteable con y sin el parametro.
    const own = (
      await waypointsApi.create({ name: nameFor('F7 propio'), ...toWaypointCoords(MIAMI.brickell) })
    ).waypoint;
    const f7With = await placesApi.checkPlace(own.placeId, { waypoint: true });
    const f7Without = await placesApi.checkPlace(own.placeId);
    measured[`F7 punto propio ${own.placeId}`] = {
      conWaypoint: { routable: f7With.routable, reasons: f7With.reasons },
      sinWaypoint: { routable: f7Without.routable, reasons: f7Without.reasons }
    };
    expect.soft(f7With.routable, 'F7 con waypoint=true').toBe(true);
    expect.soft(f7Without.routable, 'F7 sin el parametro').toBe(true);

    await attachApiEvidence(testInfo, browser, {
      name: 'checkplace-tabla-de-decision',
      comment:
        `GET ${ROUTE} en ${ENV} sobre ${rows.length} coordenadas medidas (F1..F6) y un punto propio (F7) con y sin ` +
        'waypoint=true: con el parametro solo el mar abierto y el canal del Parana (F5) quedan routable=false con ' +
        '[NO_COUNTRY]; el resto es routable=true; sin el parametro camino sin localidad, campo, agua con pais y plaza ' +
        '(F2, F3, F4, F6) siguen routable=false con sus reasons; el punto propio es routable=true en ambas.',
      measurement: measured
    });
  });
});
