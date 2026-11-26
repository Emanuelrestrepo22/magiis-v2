// tests/specs/settings/reference-points-in-use.spec.ts
// MG-1132 · ATP TM-1841 · PK-5 «Híbrido con viaje y cotización» — puntos de referencia USADOS en viajes.
// 3 Tests Xray: TM-1821 (mover el punto por PUT no cambia el viaje ya creado), TM-1823 (baja de un punto usado en
// un viaje agendado: aviso de uso sin identificar viajes, Cancelar no borra, aceptar conserva el origen del
// viaje) y TM-1836 (baja de un punto usado SOLO como parada de un viaje cancelado: sin ningún aviso de uso).
//
// Reglas de viajes (QA lead, no negociables): carrier 1521, alta por UI con «Enviar Manual», NUNCA el botón «A»,
// gate DRIVER_STATUS por DB antes de crear (choferes no OFFLINE => test.skip real), viaje cancelado en la
// limpieza del fixture `flow` y registrado en el ledger `waypoints`.
// Regla de borrado (incidente 18/11): la baja por UI se hace SOLO sobre el punto propio, por nombre exacto Y por
// id: se espera el `usage` de `point.id` antes del diálogo y una guarda de red aborta cualquier DELETE a otro id.
// Gate WAYPOINTS_CREATE_DATA=1. Corrida local (sesión guardada y credenciales Oracle de TEST inyectadas):
//   node <ruta>/with-oracle-test.mjs npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 \
//     npx playwright test tests/specs/settings/reference-points-in-use.spec.ts \
//     --project=carrier-v2-desktop --workers=1 --retries=0
import type { Page } from '@playwright/test';
import { TravelsClient } from '../../api/clients/travels.client.js';
import type { TravelDetail } from '../../api/clients/travels.client.js';
import { hasUsage, WaypointsClient } from '../../api/clients/waypoints.client.js';
import type { WaypointDto } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { POINT_REFERENCE, TRIP_SPOTS } from '../../data/carrier-v2/waypoints/trip-locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/referencePointTripFixture.js';
import { recoverLeakedTrips } from '../../helpers/trip-ledger.js';
import { guardWaypointDeletes } from '../../helpers/waypoint-delete-guard.js';
import { watchWaypointCalls } from '../../helpers/waypoint-network.js';
import { ReferencePointsPage } from '../../pages/carrier-v2/settings/ReferencePointsPage.js';
import {
  driversSkipReason,
  GOOGLE_DESTINATION_TEXT,
  GOOGLE_ORIGIN_TEXT,
  placeSnapshot,
  WAYPOINTS_LEDGER_SCOPE
} from '../../steps/trips/referencePointTrip.steps.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const ROUTE = '/carrier/#/settings/waypoints';
const SCHEDULED_NOTICE = /scheduled trips?|viajes? agendados?/i;
const USED_NOTICE = /used in|se usa en/i;

test.skip(
  process.env.WAYPOINTS_CREATE_DATA !== '1',
  'crea y borra puntos y viajes reales; correr con WAYPOINTS_CREATE_DATA=1'
);
test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
// SIN retries: cada intento crea viajes reales y un reintento taparia la falla del primero.
test.describe.configure({ timeout: 300_000, retries: 0 });

test.beforeAll(async ({ carrierApi, carrierSession }) => {
  await new WaypointsClient(carrierApi, carrierSession, makeRunId()).sweep();
  const recovered = await recoverLeakedTrips(
    new TravelsClient(carrierApi, carrierSession),
    carrierSession.env,
    WAYPOINTS_LEDGER_SCOPE
  );
  if (recovered.failed.length > 0) {
    throw new Error(`[recupero de viajes] no se pudo cancelar: ${recovered.failed.join(' | ')}`);
  }
});

/** Busca el punto en el ABM y pulsa «Delete» esperando el `usage` DE SU ID; devuelve ese `usage`. */
async function openDeleteDialog(
  page: Page,
  abm: ReferencePointsPage,
  point: WaypointDto
): Promise<{ status: number; usage: Awaited<ReturnType<WaypointsClient['usage']>> }> {
  await abm.search(point.name);
  await expect(
    abm.rowByName(point.name),
    'la fila del punto propio está en el listado'
  ).toBeVisible();
  const usageResponse = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().endsWith(`/waypoint/${point.id}/usage`),
    { timeout: 30_000 }
  );
  usageResponse.catch(() => undefined);
  await abm.deleteButtonFor(point.name).click();
  const response = await usageResponse;
  await expect(abm.deleteDialog).toBeVisible();
  return {
    status: response.status(),
    usage: (await response.json()) as Awaited<ReturnType<WaypointsClient['usage']>>
  };
}

/** Acepta la baja y devuelve el status del DELETE DEL ID PROPIO (con el toast armado antes). */
async function acceptDelete(
  page: Page,
  abm: ReferencePointsPage,
  pointId: number
): Promise<number> {
  const removal = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().endsWith(`/waypoint/${pointId}`),
    { timeout: 30_000 }
  );
  removal.catch(() => undefined);
  await abm.expectToastAfter(/Reference point deleted/i, () => abm.deleteAcceptButton.click());
  return (await removal).status();
}

test.describe('@P2 @functional @migration MG-1132 puntos de referencia usados en viajes', () => {
  test('TM-1821: debería conservar el origen del viaje ya creado cuando se mueve el punto de referencia', async ({
    page,
    flow,
    waypointsApi,
    placesApi,
    carrierSession,
    travelsApi,
    nameFor
  }) => {
    makeAnnotate('TM-1821', '/carrier/#/travel/detail/{id}')('TC16', 'HP');
    const gate = await flow.driversGate();
    test.skip(gate.nonOffline > 0, driversSkipReason(gate));

    const point = (
      await waypointsApi.create({
        name: nameFor('mover'),
        reference: POINT_REFERENCE,
        ...toWaypointCoords(TRIP_SPOTS.origin)
      })
    ).waypoint;
    const { travelId } = await flow.seedTrip({
      origin: { kind: 'point', point },
      destination: { kind: 'google', text: GOOGLE_DESTINATION_TEXT }
    });
    const before = await travelsApi.getDetail(travelId);
    const snapshot = placeSnapshot(before.origin);
    expect(snapshot.mapPlaceId, 'precondición: el viaje nace con el origen = punto v1').toBe(
      point.placeId
    );

    // Se mueve el punto por API (v2): el cambio no debe alcanzar al viaje ya creado.
    const movedLat = point.latitude + 0.003;
    const movedLng = point.longitude + 0.003;
    const moved = (
      await waypointsApi.update(point.id, {
        name: point.name,
        reference: POINT_REFERENCE,
        latitude: movedLat,
        longitude: movedLng
      })
    ).waypoint;
    const v2PlaceId = point.placeId.replace(/-1$/, '-2');
    expect(moved.placeId, 'el punto movido sube a la versión 2').toBe(v2PlaceId);

    const after: TravelDetail = await travelsApi.getDetail(travelId);
    expect(
      placeSnapshot(after.origin),
      'el origen del viaje sigue con las coordenadas y el placeId v1'
    ).toEqual(snapshot);
    const listed = (await waypointsApi.list()).find((p) => p.id === point.id);
    expect(listed, 'el punto sigue en el listado').toBeDefined();
    expect(listed?.placeId, 'el listado muestra la versión 2').toBe(v2PlaceId);
    expect(listed?.latitude, 'el listado muestra la latitud nueva').toBe(movedLat);
    expect(listed?.longitude, 'el listado muestra la longitud nueva').toBe(movedLng);
    // Un Nuevo Viaje nuevo (buscador) ofrece el punto en la posición NUEVA (paso 6).
    const offered = (
      await placesApi.autocomplete({ address: point.name, carrierId: carrierSession.carrierId })
    ).find((item) => item.source === 'CARRIER' && item.placeId === v2PlaceId);
    expect(offered, 'el buscador ofrece la versión 2 del punto').toBeDefined();
    expect(Number(offered?.latitude), 'el buscador: latitud nueva').toBe(movedLat);
    expect(Number(offered?.longitude), 'el buscador: longitud nueva').toBe(movedLng);

    const dbPlaces = await flow.dbOriginDestination(travelId);
    expect(dbPlaces.origin, 'DB: existe el lugar de origen del viaje').toBeDefined();
    expect(
      {
        mapPlaceId: dbPlaces.origin?.MAPPLACEID,
        latitude: Number(dbPlaces.origin?.LATITUDE),
        longitude: Number(dbPlaces.origin?.LONGITUDE),
        shortName: dbPlaces.origin?.SHORTNAME
      },
      'DB: el origen del viaje conserva MAPPLACEID, coordenadas y nombre de la versión 1'
    ).toEqual({
      mapPlaceId: point.placeId,
      latitude: point.latitude,
      longitude: point.longitude,
      shortName: point.name
    });
    // Paso 3: existen las dos versiones del punto en MAGIIS_PLACE, cada una con sus coordenadas.
    const versions = await flow.dbMagiisPlaces([point.placeId, v2PlaceId]);
    expect(
      versions.map((v) => ({ id: v.PLACE_ID, lat: Number(v.LATITUDE), lng: Number(v.LONGITUDE) })),
      'DB: MAGIIS_PLACE con la versión 1 (original) y la 2 (movida)'
    ).toEqual(
      [
        { id: point.placeId, lat: point.latitude, lng: point.longitude },
        { id: v2PlaceId, lat: movedLat, lng: movedLng }
      ].sort((a, b) => a.id.localeCompare(b.id))
    );

    // UI: el detalle del viaje muestra el origen con el nombre del punto.
    await page.goto(`/carrier/#/travel/detail/${travelId}`);
    await expect(
      page.getByText(point.name).first(),
      'detalle: el origen muestra el nombre del punto'
    ).toBeVisible({
      timeout: 45_000
    });
    await flow.evidence(
      'tm-1821-origen-sin-cambio',
      `Viaje ${travelId} (carrier 1521, ${ENV}) con origen = punto «${point.name}» (${point.placeId}, ${point.latitude}, ${point.longitude}). Se movió el punto por PUT a (${movedLat}, ${movedLng}): placeId ${moved.placeId}. ` +
        `GET travels/${travelId}, DB (PLACE por la cotización) y el detalle en pantalla siguen con ${point.placeId} y las coordenadas originales; MAGIIS_PLACE tiene ${point.placeId} y ${v2PlaceId}; el listado y el buscador muestran ${v2PlaceId} con las nuevas. Viaje cancelado en la limpieza.`
    );
  });

  test('TM-1823: debería avisar del uso en un viaje agendado al dar de baja el punto, sin identificarlo, y conservar el origen del viaje', async ({
    page,
    flow,
    waypointsApi,
    placesApi,
    carrierSession,
    travelsApi,
    nameFor
  }) => {
    makeAnnotate('TM-1823', ROUTE)('TC18', 'HP');
    const gate = await flow.driversGate();
    test.skip(gate.nonOffline > 0, driversSkipReason(gate));

    const point = (
      await waypointsApi.create({
        name: nameFor('agendado'),
        reference: POINT_REFERENCE,
        ...toWaypointCoords(TRIP_SPOTS.origin)
      })
    ).waypoint;
    const { travelId } = await flow.seedTrip({
      origin: { kind: 'point', point },
      destination: { kind: 'google', text: GOOGLE_DESTINATION_TEXT }
    });
    const before = await travelsApi.getDetail(travelId);
    const snapshot = placeSnapshot(before.origin);
    const code = flow.tripCode(before);
    const dbBefore = await flow.dbOriginDestination(travelId);
    expect(dbBefore.origin, 'DB: existe el lugar de origen del viaje').toBeDefined();

    await guardWaypointDeletes(page, point.id);
    const abm = new ReferencePointsPage(page);
    const calls = watchWaypointCalls(page);
    await abm.goto();
    const opened = await openDeleteDialog(page, abm, point);
    expect(opened.status, 'GET …/usage del id propio responde 200 antes de cualquier DELETE').toBe(
      200
    );
    expect(calls.count('DELETE'), 'ningún DELETE antes de aceptar').toBe(0);
    expect(opened.usage.scheduledTravelIds, 'usage: incluye el viaje agendado').toContain(travelId);
    const notice = await abm.usageNotice.innerText();
    expect(notice, 'el diálogo avisa del uso en un viaje agendado').toMatch(SCHEDULED_NOTICE);
    expect(notice, 'el aviso no identifica el viaje (id)').not.toContain(String(travelId));
    expect(notice, 'el aviso no identifica el viaje (código)').not.toContain(code);
    // Control positivo del buscador (paso 6): antes de la baja el punto se ofrece.
    const offeredBefore = await placesApi.autocomplete({
      address: point.name,
      carrierId: carrierSession.carrierId
    });
    expect(
      offeredBefore.some((item) => item.placeId === point.placeId),
      'control: antes de la baja el buscador ofrece el punto'
    ).toBe(true);

    // Cancelar: el punto sigue y no hubo DELETE.
    await abm.deleteCancelButton.click();
    await expect(abm.deleteDialog).toBeHidden();
    expect(calls.count('DELETE'), 'Cancelar no emite DELETE').toBe(0);
    await expect(abm.rowByName(point.name), 'Cancelar deja la fila en el listado').toHaveCount(1);
    expect(
      (await waypointsApi.list()).some((p) => p.id === point.id),
      'Cancelar: el punto sigue en el servicio'
    ).toBe(true);

    // Eliminar de nuevo y aceptar.
    await abm.deleteButtonFor(point.name).click();
    await expect(abm.deleteDialog).toBeVisible();
    expect(await acceptDelete(page, abm, point.id), 'DELETE del id propio responde 200').toBe(200);
    expect(calls.count('DELETE'), 'un único DELETE en todo el Test').toBe(1);
    await expect(abm.rowByName(point.name), 'la fila desaparece').toHaveCount(0, {
      timeout: 15_000
    });
    expect(
      (await waypointsApi.list()).some((p) => p.id === point.id),
      'el servicio ya no lista el punto'
    ).toBe(false);
    const offeredAfter = await placesApi.autocomplete({
      address: point.name,
      carrierId: carrierSession.carrierId
    });
    expect(
      offeredAfter.some((item) => item.placeId === point.placeId),
      'tras la baja el buscador ya no ofrece el punto'
    ).toBe(false);
    const after = await travelsApi.getDetail(travelId);
    expect(
      placeSnapshot(after.origin),
      'el viaje agendado conserva el origen tras la baja'
    ).toEqual(snapshot);
    const dbAfter = await flow.dbOriginDestination(travelId);
    expect(dbAfter.origin, 'DB: el origen del viaje sigue igual tras la baja').toEqual(
      dbBefore.origin
    );
    await flow.evidence(
      'tm-1823-baja-punto-en-uso',
      `Configuración > Puntos de referencia (carrier 1521, ${ENV}): «Delete» en «${point.name}» (id ${point.id}, usado en el viaje agendado ${travelId}): GET …/usage del id propio 200 con scheduledTravelIds ⊇ [${travelId}] y el diálogo avisa «${notice.replace(/\s+/g, ' ').slice(0, 160)}» sin ids ni código. ` +
        `Cancelar: 0 DELETE y la fila sigue. Aceptar: un único DELETE al id ${point.id} (200), toast, fila y listado sin el punto; el buscador ya no lo ofrece. GET travels/${travelId} y DB: origen con ${String(snapshot.mapPlaceId)} y las mismas coordenadas. Viaje cancelado en la limpieza.`
    );
  });

  test('TM-1836: debería dar de baja sin aviso de uso un punto usado solo como parada de un viaje cancelado y conservar la parada', async ({
    page,
    flow,
    waypointsApi,
    placesApi,
    carrierSession,
    travelsApi,
    nameFor
  }) => {
    makeAnnotate('TM-1836', ROUTE)('TC3', 'HP');
    const gate = await flow.driversGate();
    test.skip(gate.nonOffline > 0, driversSkipReason(gate));

    // El punto va como PARADA (no como origen): el alta de un viaje crea un destino frecuente del pasajero con el
    // origen/destino, pero no con una parada; así «solo usado en un viaje cancelado» es alcanzable.
    const point = (
      await waypointsApi.create({ name: nameFor('parada'), ...toWaypointCoords(TRIP_SPOTS.stop) })
    ).waypoint;
    const { travelId } = await flow.seedTrip({
      origin: { kind: 'google', text: GOOGLE_ORIGIN_TEXT },
      destination: { kind: 'google', text: GOOGLE_DESTINATION_TEXT },
      stop: { kind: 'point', point }
    });
    const stopBefore = await flow.dbStopRows(travelId, point.placeId);
    expect(stopBefore, 'DB: una fila de la parada ligada al viaje (Q-PARADA, antes)').toHaveLength(
      1
    );
    // Control positivo: mientras el viaje está agendado, el punto figura en uso por ese viaje.
    expect(
      (await waypointsApi.usage(point.id)).scheduledTravelIds,
      'control: el viaje agendado figura en el uso del punto antes de cancelarlo'
    ).toContain(travelId);

    // Precondición: el único viaje que usa el punto queda cancelado.
    await travelsApi.cancel(travelId, `QA AUTO ${flow.runId} precondicion cancelado`);
    expect(
      (await travelsApi.getDetail(travelId)).state,
      'precondición: el viaje queda cancelado'
    ).toBe('CANCELLED');
    const assignment = await flow.dbTravelAssignment(travelId);
    expect(Number(assignment?.STATE), 'DB: TRAVEL.STATE = 7 (cancelado)').toBe(7);
    const usageAfter = await waypointsApi.usage(point.id);
    expect(
      hasUsage(usageAfter),
      'sin ningún uso tras cancelar (ni viajes agendados ni destinos frecuentes)'
    ).toBe(false);

    await guardWaypointDeletes(page, point.id);
    const abm = new ReferencePointsPage(page);
    const calls = watchWaypointCalls(page);
    await abm.goto();
    const opened = await openDeleteDialog(page, abm, point);
    expect(opened.status, 'GET …/usage del id propio responde 200').toBe(200);
    expect(hasUsage(opened.usage), 'usage de la pantalla: sin ningún uso').toBe(false);
    const notice = (await abm.usageNotice.innerText()).trim();
    expect(notice, 'el diálogo solo trae la pregunta de eliminación').toMatch(
      /^Are you sure you want to delete/i
    );
    expect(notice, 'el diálogo no trae aviso de uso').not.toMatch(USED_NOTICE);
    expect(notice, 'el diálogo no avisa de viajes agendados').not.toMatch(SCHEDULED_NOTICE);
    expect(calls.count('DELETE'), 'ningún DELETE antes de aceptar').toBe(0);

    expect(await acceptDelete(page, abm, point.id), 'DELETE del id propio responde 200').toBe(200);
    expect(calls.count('DELETE'), 'un único DELETE en todo el Test').toBe(1);
    await expect(abm.rowByName(point.name), 'la fila desaparece').toHaveCount(0, {
      timeout: 15_000
    });
    expect(
      (await waypointsApi.list()).some((p) => p.id === point.id),
      'el punto queda fuera del listado tras la baja'
    ).toBe(false);
    const offeredAfter = await placesApi.autocomplete({
      address: point.name,
      carrierId: carrierSession.carrierId
    });
    expect(
      offeredAfter.some((item) => item.placeId === point.placeId),
      'tras la baja el buscador ya no ofrece el punto'
    ).toBe(false);

    // La parada del viaje cancelado queda idéntica (Q-PARADA, después) y el viaje sigue cancelado.
    const stopAfter = await flow.dbStopRows(travelId, point.placeId);
    expect(stopAfter, 'DB: la parada del viaje cancelado idéntica tras la baja').toEqual(
      stopBefore
    );
    const detail = await travelsApi.getDetail(travelId);
    expect(detail.state, 'el viaje sigue cancelado').toBe('CANCELLED');
    const detailStop = ((detail.waypoints ?? []) as Array<Record<string, unknown>>).find(
      (w) => w.placeId === point.placeId
    );
    expect(
      detailStop,
      'API: el viaje cancelado conserva la parada con el placeId del punto'
    ).toBeDefined();
    expect(Number(detailStop?.latitude), 'API: latitud de la parada').toBe(point.latitude);
    expect(Number(detailStop?.longitude), 'API: longitud de la parada').toBe(point.longitude);
    expect(
      Number((await flow.dbTravelAssignment(travelId))?.STATE),
      'DB: el viaje sigue cancelado'
    ).toBe(7);

    await flow.evidence(
      'tm-1836-baja-punto-viaje-cancelado',
      `Configuración > Puntos de referencia (carrier 1521, ${ENV}): «${point.name}» (id ${point.id}) usado solo como parada del viaje ${travelId}, cancelado por API (control previo: scheduledTravelIds ⊇ [${travelId}]). ` +
        `Tras cancelar, GET …/usage 200 sin ningún uso y el diálogo solo dice «${notice.slice(0, 120)}», sin aviso de uso. Un único DELETE al id ${point.id} (200), toast, fila y listado sin el punto; el buscador ya no lo ofrece. ` +
        `DB: la parada (PLACE por TRAVELID, ORDER_IDX_WAYPOINT ${String(stopBefore[0].ORDER_IDX_WAYPOINT)}) idéntica antes y después, TRAVEL.STATE 7; GET travels/${travelId}: CANCELLED con la parada y sus coordenadas.`
    );
  });
});
