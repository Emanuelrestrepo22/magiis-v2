// tests/specs/trips/new-trip-reference-point-origin.spec.ts
// MG-1132 · ATP TM-1841 · PK-5 «Híbrido con viaje y cotización» — Nuevo Viaje con puntos de referencia propios.
// 4 Tests Xray: TM-1760 (punto con referencia en Origen + parada; acredita TM-1791 y TM-1792), TM-1790
// (punto rural sin calle como origen; contrato abierto Q2), TM-1802 (huso horario del pickup; no crea viaje) y
// TM-1838 (cotización por distancia con dos puntos rurales; no crea viaje).
//
// Reglas de viajes (QA lead, no negociables): carrier 1521, alta por UI con «Enviar Manual», NUNCA el botón «A»,
// gate DRIVER_STATUS por DB antes de crear (choferes no OFFLINE => test.skip real), viaje cancelado en la
// limpieza del fixture `flow` y registrado en el ledger `waypoints`.
// Oráculos: red (cuerpos de simulateAll y del alta), API (`GET travels/{id}`) y DB (solo SELECT).
// Gate WAYPOINTS_CREATE_DATA=1. Corrida local (sesión guardada y credenciales Oracle de TEST inyectadas):
//   node <ruta>/with-oracle-test.mjs npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 \
//     npx playwright test tests/specs/trips/new-trip-reference-point-origin.spec.ts \
//     --project=carrier-v2-desktop --workers=1 --retries=0
import { TravelsClient } from '../../api/clients/travels.client.js';
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import {
  PENSACOLA,
  PENSACOLA_DESTINATION_TEXT,
  POINT_REFERENCE,
  RURAL_CHRISTMAS,
  RURAL_PAMPA_A,
  RURAL_PAMPA_B,
  TRIP_SPOTS
} from '../../data/carrier-v2/waypoints/trip-locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/referencePointTripFixture.js';
import { recoverLeakedTrips } from '../../helpers/trip-ledger.js';
import {
  futureTripDate,
  driversSkipReason,
  GOOGLE_DESTINATION_TEXT,
  WAYPOINTS_LEDGER_SCOPE,
  zonedWallTimeToUtcIso
} from '../../steps/trips/referencePointTrip.steps.js';
import { coordinateInArea } from '../../helpers/zone-coverage.js';
import { splitOwnGetPlace } from '../../utils/networkWatch.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const ROUTE = '/carrier/#/travel/create';
const NO_DB_REASON =
  'sin ORACLE_*_TEST no se evalúa el oráculo de base (solo SELECT); el Test no puede darse por completo';

test.skip(
  process.env.WAYPOINTS_CREATE_DATA !== '1',
  'crea y borra puntos y viajes reales; correr con WAYPOINTS_CREATE_DATA=1'
);
test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
// SIN retries: cada intento crea viajes reales y un reintento taparia la falla del primero.
test.describe.configure({ timeout: 300_000, retries: 0 });

// Barrido de corridas anteriores: puntos «QA AUTO <runId>» con mas de 24 h y viajes anotados en el ledger.
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

const near = (value: unknown, expected: number): boolean =>
  Math.abs(Number(value) - expected) < 1e-9;

test.describe('@P1 @functional @migration MG-1132 Nuevo Viaje con puntos de referencia (viaje real)', () => {
  test('TM-1760: debería crear el viaje con el punto de referencia como origen y una parada, conservando placeId, coordenadas e indicación', async ({
    flow,
    waypointsApi,
    travelsApi,
    nameFor
  }, testInfo) => {
    makeAnnotate(['TM-1760', 'TM-1791', 'TM-1792'], ROUTE)('TC35', 'HP');
    const gate = await flow.driversGate();
    test.skip(gate.nonOffline > 0, driversSkipReason(gate));

    const origin = (
      await waypointsApi.create({
        name: nameFor('origen'),
        reference: POINT_REFERENCE,
        ...toWaypointCoords(TRIP_SPOTS.origin)
      })
    ).waypoint;
    const stop = (
      await waypointsApi.create({ name: nameFor('parada'), ...toWaypointCoords(TRIP_SPOTS.stop) })
    ).waypoint;

    await flow.openNewTrip();
    const originCalls = await flow.fillPlace('origin', { kind: 'point', point: origin });
    expect(originCalls, 'elegir el punto de Origen no resuelve por getPlace ni Google').toEqual([]);
    await flow.fillPlace('destination', { kind: 'google', text: GOOGLE_DESTINATION_TEXT });
    await flow.newTrip.addStop();
    const stopCalls = await flow.fillPlace({ stop: 1 }, { kind: 'point', point: stop });
    expect(stopCalls, 'elegir el punto de la parada no resuelve por getPlace ni Google').toEqual(
      []
    );
    expect(
      await flow.places.readInstruction('origin'),
      'la indicación del Origen se copia de la referencia del punto'
    ).toBe(POINT_REFERENCE);
    await flow.setDate(futureTripDate());

    const quote = await flow.quote();
    expect(quote.status, 'simulateAll responde 200').toBe(200);
    expect(quote.uiQuoted, 'la cotización deja vehículo elegido y botones de envío').toBe(true);
    const simOrigin = quote.requestBody.origin as Record<string, unknown>;
    expect(simOrigin.placeId, 'simulateAll: placeId del origen').toBe(origin.placeId);

    const saved = await flow.saveManually();
    expect(saved.status, 'POST travels responde 200').toBe(200);
    const postOrigin = saved.requestBody.origin as Record<string, unknown>;
    const postDestination = saved.requestBody.destination as Record<string, unknown>;
    expect(postOrigin.placeId, 'POST travels: origin.placeId = punto').toBe(origin.placeId);
    expect(near(postOrigin.latitude, origin.latitude), 'POST travels: latitud exacta').toBe(true);
    expect(near(postOrigin.longitude, origin.longitude), 'POST travels: longitud exacta').toBe(
      true
    );
    expect(postOrigin.specialInstruction, 'POST travels: specialInstruction = referencia').toBe(
      POINT_REFERENCE
    );
    expect(
      String(postDestination.placeId).startsWith('MGWP-'),
      'POST travels: el destino de Google no es un punto propio'
    ).toBe(false);
    const postStops = (saved.requestBody.waypoints ?? []) as Array<Record<string, unknown>>;
    const postStop = postStops.find((w) => w.placeId === stop.placeId);
    expect(
      postStop,
      'POST travels: la parada viaja en waypoints con el placeId del punto propio'
    ).toBeDefined();
    expect(near(postStop?.latitude, stop.latitude), 'POST travels: latitud de la parada').toBe(
      true
    );
    expect(near(postStop?.longitude, stop.longitude), 'POST travels: longitud de la parada').toBe(
      true
    );

    // API: el detalle conserva el origen del punto (TM-1760) con las coordenadas exactas (TM-1791).
    const detail = await travelsApi.getDetail(saved.travelId);
    const dOrigin = detail.origin as Record<string, unknown>;
    const dDestination = detail.destination as Record<string, unknown>;
    expect(dOrigin.mapPlaceId, 'detalle: origin.mapPlaceId = punto').toBe(origin.placeId);
    expect(String(dOrigin.latitude), 'detalle: latitud exacta del origen').toBe(
      String(origin.latitude)
    );
    expect(String(dOrigin.longitude), 'detalle: longitud exacta del origen').toBe(
      String(origin.longitude)
    );
    expect(dOrigin.specialInstruction, 'detalle: indicación del origen').toBe(POINT_REFERENCE);
    expect(
      String(dDestination.mapPlaceId).startsWith('MGWP-'),
      'detalle: el destino de Google no es un punto propio'
    ).toBe(false);
    // TM-1792: la parada conserva el placeId y las coordenadas del punto propio.
    const detailStops = (detail.waypoints ?? []) as Array<Record<string, unknown>>;
    const detailStop = detailStops.find((w) => w.placeId === stop.placeId);
    expect(detailStop, 'detalle: la parada del punto propio existe en waypoints').toBeDefined();
    expect(String(detailStop?.latitude), 'detalle: latitud de la parada').toBe(
      String(stop.latitude)
    );
    expect(String(detailStop?.longitude), 'detalle: longitud de la parada').toBe(
      String(stop.longitude)
    );

    // DB (solo SELECT): origen y destino por la cotizacion; parada por TRAVELID.
    const dbPlaces = await flow.dbOriginDestination(saved.travelId);
    expect(dbPlaces.origin, 'DB: existe el lugar de origen del viaje').toBeDefined();
    expect(dbPlaces.origin?.MAPPLACEID, 'DB: MAPPLACEID del origen').toBe(origin.placeId);
    expect(Number(dbPlaces.origin?.LATITUDE), 'DB: latitud del origen').toBe(origin.latitude);
    expect(Number(dbPlaces.origin?.LONGITUDE), 'DB: longitud del origen').toBe(origin.longitude);
    expect(dbPlaces.origin?.SHORTNAME, 'DB: SHORTNAME del origen').toBe(origin.name);
    expect(dbPlaces.origin?.SPECIAL_INSTRUCTION, 'DB: indicación del origen').toBe(POINT_REFERENCE);
    expect(dbPlaces.destination, 'DB: existe el lugar de destino del viaje').toBeDefined();
    expect(
      String(dbPlaces.destination?.MAPPLACEID).startsWith('MGWP-'),
      'DB: el destino de Google no es un punto propio'
    ).toBe(false);
    const dbStops = await flow.dbStopRows(saved.travelId, stop.placeId);
    expect(dbStops, 'DB: una fila de la parada ligada al viaje por TRAVELID').toHaveLength(1);
    expect(
      dbStops[0].ORDER_IDX_WAYPOINT,
      'DB: ORDER_IDX_WAYPOINT informado (no NULL)'
    ).not.toBeNull();
    expect(
      Number(dbStops[0].ORDER_IDX_WAYPOINT),
      'DB: orden de la parada (la única: índice 0)'
    ).toBe(0);
    expect(Number(dbStops[0].LATITUDE), 'DB: latitud de la parada').toBe(stop.latitude);
    expect(Number(dbStops[0].LONGITUDE), 'DB: longitud de la parada').toBe(stop.longitude);
    expect(
      dbStops[0].SPECIAL_INSTRUCTION,
      'DB: la parada sin referencia no lleva indicación'
    ).toBeNull();
    const assignment = await flow.dbTravelAssignment(saved.travelId);
    expect(assignment, 'DB: existe el viaje').toBeDefined();
    expect(
      {
        state: Number(assignment?.STATE),
        special: Number(assignment?.SPECIAL_ASSIGN),
        driver: assignment?.DRIVER_ID
      },
      'DB: viaje programado, Enviar Manual (SPECIAL_ASSIGN=1) y sin chofer'
    ).toEqual({ state: 9, special: 1, driver: null });

    await flow.evidence(
      'tm-1760-viaje-creado',
      `Nuevo Viaje (carrier 1521, ${ENV}): punto propio «${origin.name}» (${origin.placeId}) con referencia en Origen y punto «${stop.name}» (${stop.placeId}) como parada; destino de Google. ` +
        `POST travels 200, viaje ${saved.travelId}: origin.placeId, coordenadas (${origin.latitude}, ${origin.longitude}) y specialInstruction idénticos al punto; destino sin MGWP-. ` +
        `GET travels/${saved.travelId}: origen y parada con el placeId y las coordenadas del punto. DB: origen MAPPLACEID=${origin.placeId}, parada ORDER_IDX_WAYPOINT=0 sin indicación, STATE 9, SPECIAL_ASSIGN 1, sin chofer. ` +
        'Elegir los puntos no emitió getPlace ni Google. Viaje cancelado en la limpieza.'
    );
    testInfo.annotations.push({
      type: 'observation',
      description:
        'TM-1791 y TM-1792 se acreditan por PERSISTENCIA (POST, API y DB con las coordenadas exactas): el alta del punto por el puntero del mapa la cubre PK-3 y el marcador del detalle en pantalla (paso 6 de TM-1791) no se evalúa'
    });
  });
});

test.describe('@P2 @functional @migration MG-1132 Nuevo Viaje con puntos de referencia (casos de borde)', () => {
  test('TM-1790: debería cotizar y crear el viaje con un punto rural sin calle como origen (contrato Q2 abierto)', async ({
    flow,
    waypointsApi,
    travelsApi,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1790', ROUTE)('TC19', 'EP');
    const gate = await flow.driversGate();
    test.skip(gate.nonOffline > 0, driversSkipReason(gate));

    const rural = (
      await waypointsApi.create({ name: nameFor('rural'), ...toWaypointCoords(RURAL_CHRISTMAS) })
    ).waypoint;
    await flow.openNewTrip();
    await flow.fillPlace('origin', { kind: 'point', point: rural });
    await flow.fillPlace('destination', { kind: 'google', text: 'Orlando International Airport' });
    await flow.setDate(futureTripDate());

    const quote = await flow.quote();
    // Q2 (P3 del PO, #38220): si un viaje debe poder cotizarse y crearse con un punto sin calle sigue ABIERTO.
    // Se mide y se informa; NO se asevera como esperado (X8).
    expect(
      quote.status,
      'simulateAll no debe fallar por error de servidor (5xx no es una respuesta posible a Q2)'
    ).toBeLessThan(500);
    testInfo.annotations.push({
      type: 'observation',
      description: `Q2 abierta (¿debe cotizarse/crearse un viaje con origen en un punto sin calle?): simulateAll respondió ${quote.status} con ${quote.options.length} opciones de vehículo`
    });
    if (!quote.uiQuoted) {
      await flow.evidence(
        'tm-1790-sin-cotizacion',
        `Nuevo Viaje (carrier 1521, ${ENV}) con origen = punto rural «${rural.name}» (${rural.placeId}): simulateAll respondió ${quote.status} con ${quote.options.length} opciones; la UI no quedó cotizada. No se creó viaje. Contrato Q2 abierto.`
      );
      test.skip(
        true,
        'Q2 abierta: la cotización no devolvió opciones con el punto rural como origen; sin cotización no se crea el viaje y el oráculo principal (viaje creado con las coordenadas del punto) no corrió'
      );
    }
    const simOrigin = quote.requestBody.origin as Record<string, unknown>;
    expect(simOrigin.placeId, 'simulateAll: placeId del origen = punto rural').toBe(rural.placeId);

    const saved = await flow.saveManually();
    expect(saved.status, 'POST travels responde 200').toBe(200);
    const detail = await travelsApi.getDetail(saved.travelId);
    const dOrigin = detail.origin as Record<string, unknown>;
    expect(dOrigin.mapPlaceId, 'detalle: origin.mapPlaceId = punto rural').toBe(rural.placeId);
    expect(String(dOrigin.latitude), 'detalle: latitud exacta').toBe(String(rural.latitude));
    expect(String(dOrigin.longitude), 'detalle: longitud exacta').toBe(String(rural.longitude));
    const dbPlaces = await flow.dbOriginDestination(saved.travelId);
    expect(dbPlaces.origin, 'DB: existe el lugar de origen del viaje').toBeDefined();
    expect(dbPlaces.origin?.MAPPLACEID, 'DB: MAPPLACEID del origen').toBe(rural.placeId);
    expect(Number(dbPlaces.origin?.LATITUDE), 'DB: latitud del origen').toBe(rural.latitude);
    expect(Number(dbPlaces.origin?.LONGITUDE), 'DB: longitud del origen').toBe(rural.longitude);
    const assignment = await flow.dbTravelAssignment(saved.travelId);
    expect(assignment, 'DB: existe el viaje').toBeDefined();
    expect(
      { special: Number(assignment?.SPECIAL_ASSIGN), driver: assignment?.DRIVER_ID },
      'DB: Enviar Manual (SPECIAL_ASSIGN=1) y sin chofer'
    ).toEqual({ special: 1, driver: null });

    await flow.evidence(
      'tm-1790-viaje-creado',
      `Nuevo Viaje (carrier 1521, ${ENV}) con origen = punto rural «${rural.name}» (${rural.placeId}, ${rural.latitude}, ${rural.longitude}) y destino de Google: simulateAll 200 con ${quote.options.length} opciones, POST travels 200, viaje ${saved.travelId}. ` +
        `GET travels y DB: origen con el MGWP- y las coordenadas del punto; STATE 9, SPECIAL_ASSIGN 1, sin chofer. Q2 sigue abierta (se informa, no se asevera). Viaje cancelado en la limpieza.`
    );
  });

  test.describe('huso horario del pickup', () => {
    // Navegador emulado en un huso ajeno al del punto (Chicago) y al del carrier (Nueva York).
    test.use({ timezoneId: 'Asia/Tokyo' });

    test('TM-1802: debería tomar el huso horario del punto de origen para el pickup, no el del navegador ni el del carrier', async ({
      page,
      flow,
      waypointsApi,
      db,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1802', ROUTE)('TC35', 'EP');
      const point = (
        await waypointsApi.create({ name: nameFor('huso'), ...toWaypointCoords(PENSACOLA) })
      ).waypoint;
      // Control: el navegador de la prueba está de verdad en un huso ajeno.
      expect(
        await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
        'control: huso del navegador emulado'
      ).toBe('Asia/Tokyo');

      if (db) {
        const rows = await db.query<{ TIME_ZONE: string | null; SOURCE_TYPE: string | null }>(
          'SELECT TIME_ZONE, SOURCE_TYPE FROM MAGIIS.MAGIIS_PLACE WHERE PLACE_ID = :p',
          { p: point.placeId }
        );
        expect(rows, 'DB: existe MAGIIS_PLACE del punto').toHaveLength(1);
        expect(rows[0].TIME_ZONE, 'DB: TIME_ZONE del punto informada y de su ubicación').toBe(
          PENSACOLA.timeZone
        );
      } else {
        testInfo.annotations.push({ type: 'observation', description: NO_DB_REASON });
      }

      await flow.openNewTrip();
      await flow.fillPlace('origin', { kind: 'point', point });
      await flow.fillPlace('destination', { kind: 'google', text: PENSACOLA_DESTINATION_TEXT });
      const date = futureTripDate();
      await flow.setDate(date);
      await flow.setTime('10:00 AM');
      const quote = await flow.quote();
      expect(quote.status, 'simulateAll responde 200').toBe(200);
      expect(quote.uiQuoted, 'la cotización deja vehículo elegido').toBe(true);
      expect(
        quote.requestBody.pickupGmt,
        'simulateAll: pickupGmt = huso del punto (no Asia/Tokyo del navegador ni America/New_York del carrier)'
      ).toBe(PENSACOLA.timeZone);
      const [month, day, year] = date.split('/');
      const expectedUtc = zonedWallTimeToUtcIso(
        { date: `${year}-${month}-${day}`, hour: 10, minute: 0 },
        PENSACOLA.timeZone
      );
      expect(
        new Date(String(quote.requestBody.dateProgrammed)).toISOString(),
        'simulateAll: dateProgrammed = 10:00 AM de la hora del punto, en UTC'
      ).toBe(expectedUtc);
      expect(flow.createTravelRequestCount, 'el Test no crea viaje').toBe(0);

      await flow.evidence(
        'tm-1802-huso-del-pickup',
        `Nuevo Viaje (carrier 1521 en America/New_York, ${ENV}) con el navegador en Asia/Tokyo y origen = punto propio «${point.name}» (${point.placeId}, Pensacola, ${PENSACOLA.timeZone}): ` +
          `simulateAll pickupGmt=${String(quote.requestBody.pickupGmt)} y dateProgrammed=${String(quote.requestBody.dateProgrammed)} (10:00 AM del ${date} en la hora del punto = ${expectedUtc}). ` +
          `DB MAGIIS_PLACE.TIME_ZONE=${PENSACOLA.timeZone}. No se creó viaje (0 POST de alta).`
      );
      testInfo.annotations.push({
        type: 'observation',
        description:
          'TM-762 y TM-763 (zona del navegador) NO se acreditan: sus pasos exigen un viaje creado y reabierto con otra zona. Cobertura parcial de TM-1802: el paso 3 de la definición (alta del viaje) no se ejecuta; pickupGmt y dateProgrammed se aseveran sobre simulateAll, no sobre TRAVEL.PICKUP_GMT / TRAVEL_DATE'
      });
      await flow.leaveWithoutSaving();
    });
  });

  test('TM-1838: debería cotizar por distancia con dos puntos rurales propios sin llamadas a getPlace ni a Google al elegirlos', async ({
    flow,
    waypointsApi,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1838', ROUTE)('TC3', 'HP');
    const from = (
      await waypointsApi.create({ name: nameFor('rural A'), ...toWaypointCoords(RURAL_PAMPA_A) })
    ).waypoint;
    const to = (
      await waypointsApi.create({ name: nameFor('rural B'), ...toWaypointCoords(RURAL_PAMPA_B) })
    ).waypoint;

    // «Fuera de toda zona»: ninguna de las dos coordenadas cae en una zona de cotización ACTIVA del 1521 (DB,
    // solo SELECT). Las áreas por código postal no tienen geometría evaluable y se declaran.
    const areas = await flow.dbCarrierAreas();
    expect(
      areas.length,
      'DB: el 1521 tiene zonas de cotización activas (control del SELECT)'
    ).toBeGreaterThan(0);
    const covered: string[] = [];
    let notEvaluable = 0;
    for (const [label, point] of [
      ['A', RURAL_PAMPA_A],
      ['B', RURAL_PAMPA_B]
    ] as const) {
      for (const area of areas) {
        const inside = coordinateInArea(point, area, 3);
        if (inside === null) notEvaluable += 1;
        if (inside === true) covered.push(`${label} en área ${area.AREA_TYPE ?? '?'}`);
      }
    }
    expect(covered, 'las dos coordenadas rurales no pertenecen a ninguna zona del 1521').toEqual(
      []
    );
    testInfo.annotations.push({
      type: 'observation',
      description: `zonas del 1521: ${areas.length} áreas activas (círculo con el radio en km ×3 de margen de seguridad (puntos a más de 250 km del círculo) y polígono evaluados; ${notEvaluable / 2} por código postal sin geometría evaluable)`
    });

    await flow.openNewTrip();
    // Un único observador de red a nivel de test, desde ANTES de la primera selección hasta después de simulateAll.
    const trafficMark = flow.traffic.mark();
    const originCalls = await flow.fillPlace('origin', { kind: 'point', point: from });
    const destinationCalls = await flow.fillPlace('destination', { kind: 'point', point: to });
    expect(originCalls, 'elegir el punto de Origen no emite getPlace ni Google').toEqual([]);
    expect(destinationCalls, 'elegir el punto de Destino no emite getPlace ni Google').toEqual([]);
    expect(
      await flow.places.placeValue('origin'),
      'el campo Origen muestra el nombre del punto'
    ).toBe(from.name);
    expect(
      await flow.places.placeValue('destination'),
      'el campo Destino muestra el nombre del punto'
    ).toBe(to.name);

    const quote = await flow.quote();
    expect(quote.status, 'simulateAll responde 200').toBe(200);
    expect(quote.uiQuoted, 'la cotización deja vehículo elegido y botones de envío').toBe(true);
    const simOrigin = quote.requestBody.origin as Record<string, unknown>;
    const simDestination = quote.requestBody.destination as Record<string, unknown>;
    expect(simOrigin.placeId, 'simulateAll: placeId del origen').toBe(from.placeId);
    expect(simDestination.placeId, 'simulateAll: placeId del destino').toBe(to.placeId);
    expect(quote.options.length, 'simulateAll: opciones de vehículo').toBeGreaterThan(0);
    const option = quote.options[0];
    testInfo.annotations.push({
      type: 'observation',
      description: `claves de cada opción de simulateAll: ${Object.keys(option).join(',')}`
    });
    // Cotización POR DISTANCIA (AC4): importe y distancia mayores que 0 (no una cotización vacía ni por zona).
    expect(
      Number(option.distance),
      `opción: distancia > 0 (claves: ${Object.keys(option).join(',')})`
    ).toBeGreaterThan(0);
    expect(Number(option.pricePointToPoint), 'opción: importe > 0').toBeGreaterThan(0);

    // Ninguna llamada a getPlace ni a Google desde la primera selección hasta después de simulateAll, salvo la
    // resolución backend del placeId MGWP- propio (medido por PK-2: el FE lo resuelve al cotizar; no es Google).
    const split = splitOwnGetPlace(flow.traffic.sinceUrls(trafficMark), [from.placeId, to.placeId]);
    expect(split.other, 'tramo completo: sin getPlace ajeno ni Google').toEqual([]);
    testInfo.annotations.push({
      type: 'observation',
      description: `al cotizar el FE emitió ${split.own.length} places/getPlace?placeId=MGWP-… (resolución del punto propio por el backend, no Google); en las selecciones hubo 0`
    });
    expect(flow.createTravelRequestCount, 'el Test no crea viaje').toBe(0);

    await flow.evidence(
      'tm-1838-cotizacion-puntos-rurales',
      `Nuevo Viaje (carrier 1521, ${ENV}) con Origen «${from.name}» (${from.placeId}) y Destino «${to.name}» (${to.placeId}), ambos puntos propios rurales de la pampa húmeda, fuera de toda zona activa del 1521 (DB: ${areas.length} áreas, ninguna los contiene): ambos campos muestran el nombre; ` +
        `0 getPlace/Google desde la primera selección hasta después de simulateAll (salvo ${split.own.length} getPlace del MGWP propio); simulateAll ${quote.status} con ${quote.options.length} opciones, MGWP- en origen y destino, distancia ${String(option.distance)} e importe ${String(option.pricePointToPoint)}. No se creó viaje.`
    );

    // Control positivo (X7): elegir una dirección de Google SÍ emite getPlace; prueba que el observador funciona.
    const control = await flow.places.pickGoogleAddress('destination', GOOGLE_DESTINATION_TEXT);
    expect(
      control.outboundCalls.some((call) => /\/places\/getPlace/.test(call)),
      'control: elegir una dirección de Google debe emitir places/getPlace'
    ).toBe(true);
    expect(flow.createTravelRequestCount, 'el Test sale sin guardar').toBe(0);
    await flow.leaveWithoutSaving();
  });
});
