// tests/specs/trips/trip-edit-reference-points.spec.ts
// MG-1132 · ATP TM-1841 · PK-5 «Híbrido con viaje y cotización» — edición de un viaje programado con puntos de
// referencia (Trips Management > Scheduled > lápiz, modo edición del detalle). 2 Tests Xray:
// TM-1795 (abrir la edición sin cambios y luego cambiar solo la hora: el origen-punto se conserva) y TM-1830
// (elegir un punto en Destino durante la edición; luego reemplazarlo por una dirección de Google: ROJO CONOCIDO
// H-AP-01, la indicación del punto anterior queda grabada en el destino nuevo).
//
// Reglas de viajes (QA lead, no negociables): carrier 1521, alta por UI con «Enviar Manual», NUNCA el botón «A»,
// gate DRIVER_STATUS por DB antes de crear (choferes no OFFLINE => test.skip real), viaje cancelado en la
// limpieza del fixture `flow` y registrado en el ledger `waypoints`.
// Gate WAYPOINTS_CREATE_DATA=1. Corrida local (sesión guardada y credenciales Oracle de TEST inyectadas):
//   node <ruta>/with-oracle-test.mjs npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 \
//     npx playwright test tests/specs/trips/trip-edit-reference-points.spec.ts \
//     --project=carrier-v2-desktop --workers=1 --retries=0
import { TravelsClient } from '../../api/clients/travels.client.js';
import type { TravelDetail } from '../../api/clients/travels.client.js';
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { POINT_REFERENCE, TRIP_SPOTS } from '../../data/carrier-v2/waypoints/trip-locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/referencePointTripFixture.js';
import { recordKnownIssue } from '../../helpers/known-issue.js';
import { recoverLeakedTrips } from '../../helpers/trip-ledger.js';
import { TravelDetailEditPage } from '../../pages/carrier-v2/trips/TravelDetailEditPage.js';
import {
  driversSkipReason,
  GOOGLE_DESTINATION_TEXT,
  GOOGLE_ORIGIN_TEXT,
  placeSnapshot,
  searchTextFor,
  WAYPOINTS_LEDGER_SCOPE
} from '../../steps/trips/referencePointTrip.steps.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const ROUTE = '/carrier/#/travel/detail/{id}?mode=Edit';
const GOOGLE_REPLACEMENT_TEXT = '1200 Brickell Ave';

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

test.describe('@P2 @functional @migration MG-1132 edición de viaje programado con puntos de referencia', () => {
  test('TM-1795: debería conservar el origen-punto al abrir la edición sin cambios y al cambiar solo la hora', async ({
    page,
    flow,
    waypointsApi,
    travelsApi,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1795', ROUTE)('TC24', 'HP');
    const gate = await flow.driversGate();
    test.skip(gate.nonOffline > 0, driversSkipReason(gate));

    const origin = (
      await waypointsApi.create({
        name: nameFor('origen'),
        reference: POINT_REFERENCE,
        ...toWaypointCoords(TRIP_SPOTS.origin)
      })
    ).waypoint;
    const saved = await flow.seedTrip({
      origin: { kind: 'point', point: origin },
      destination: { kind: 'google', text: GOOGLE_DESTINATION_TEXT }
    });

    const before: TravelDetail = await travelsApi.getDetail(saved.travelId);
    const snapshot = placeSnapshot(before.origin);
    expect(snapshot.mapPlaceId, 'precondición: el viaje nace con el origen = punto').toBe(
      origin.placeId
    );
    expect(
      snapshot.specialInstruction,
      'precondición: el origen lleva la indicación del punto'
    ).toBe(POINT_REFERENCE);

    // Parte a: abrir la edición como el operador (lápiz de Scheduled) y no cambiar nada.
    const edit = new TravelDetailEditPage(page);
    await edit.openFromScheduledList(flow.tripCode(before));
    expect(await edit.placeValue('origin'), 'edición: el origen muestra el nombre del punto').toBe(
      origin.name
    );
    expect(
      (await edit.places.readNoteCard('origin')).trim(),
      'edición: la tarjeta NOTE muestra la indicación del origen'
    ).toBe(POINT_REFERENCE);
    await expect(edit.saveButton, 'parte a: «Save» deshabilitado sin cambios').toBeDisabled();
    expect(edit.updateRequestCount, 'parte a: 0 PUT de actualización').toBe(0);
    const afterA = await travelsApi.getDetail(saved.travelId);
    expect(placeSnapshot(afterA.origin), 'parte a: el origen no cambió').toEqual(snapshot);
    const dbA = await flow.dbOriginDestination(saved.travelId);
    expect(dbA.origin, 'DB (parte a): existe el lugar de origen').toBeDefined();
    expect(dbA.origin?.MAPPLACEID, 'DB (parte a): MAPPLACEID del origen').toBe(origin.placeId);
    expect(dbA.origin?.SPECIAL_INSTRUCTION, 'DB (parte a): indicación del origen').toBe(
      POINT_REFERENCE
    );

    // Parte b: cambiar SOLO la hora, recalcular y guardar.
    const currentTime = await edit.timeValue();
    const newTime = currentTime === '10:30 AM' ? '11:00 AM' : '10:30 AM';
    await edit.selectTime(newTime);
    expect((await edit.recalculate()).status(), 'Recalculate: travels/simulate responde 200').toBe(
      200
    );
    await testInfo.attach('tm-1795-edicion-recalculada', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
    const put = await edit.save();
    expect(put.status, 'parte b: PUT …/update responde 200').toBe(200);
    const putOrigin = put.body.origin as Record<string, unknown>;
    expect(putOrigin.placeId, 'parte b: el PUT conserva el placeId del punto').toBe(
      snapshot.mapPlaceId
    );
    expect(putOrigin.specialInstruction, 'parte b: el PUT conserva la indicación').toBe(
      POINT_REFERENCE
    );
    expect(edit.updateRequestCount, 'parte b: un único PUT').toBe(1);

    const afterB = await travelsApi.getDetail(saved.travelId);
    expect(placeSnapshot(afterB.origin), 'parte b: el origen es idéntico al snapshot').toEqual(
      snapshot
    );
    expect(afterB.travelDate, 'parte b: la hora sí cambió').not.toBe(before.travelDate);
    const dbPlaces = await flow.dbOriginDestination(saved.travelId);
    expect(dbPlaces.origin, 'DB: existe el lugar de origen del viaje').toBeDefined();
    expect(
      {
        mapPlaceId: dbPlaces.origin?.MAPPLACEID,
        latitude: Number(dbPlaces.origin?.LATITUDE),
        longitude: Number(dbPlaces.origin?.LONGITUDE),
        shortName: dbPlaces.origin?.SHORTNAME,
        specialInstruction: dbPlaces.origin?.SPECIAL_INSTRUCTION
      },
      'DB: los cinco valores del origen idénticos a los anotados (el id de fila puede cambiar)'
    ).toEqual({
      mapPlaceId: origin.placeId,
      latitude: origin.latitude,
      longitude: origin.longitude,
      shortName: origin.name,
      specialInstruction: POINT_REFERENCE
    });

    await flow.evidence(
      'tm-1795-edicion-guardada',
      `Viaje ${saved.travelId} (carrier 1521, ${ENV}) con origen = punto «${origin.name}» (${origin.placeId}). Parte a: edición abierta con el lápiz de Scheduled, «Save» deshabilitado y 0 PUT; origen idéntico por API. ` +
        `Parte b: solo la hora (${currentTime} → ${newTime}), Recalculate (simulate 200) y Save: PUT …/update 200 con origin.placeId=${origin.placeId} e indicación «${POINT_REFERENCE}». ` +
        'GET travels y DB: mapPlaceId, coordenadas, nombre e indicación del origen idénticos al snapshot; travelDate cambió. Viaje cancelado en la limpieza.'
    );
  });

  test('TM-1830: debería copiar la indicación del punto elegido en el destino y vaciarla al reemplazarlo por una dirección de Google', async ({
    page,
    flow,
    waypointsApi,
    travelsApi,
    carrierSession,
    nameFor,
    runId
  }, testInfo) => {
    // Dos ediciones sobre un viaje real: con TEST lento llegó a 264 s; margen propio solo para este Test.
    test.setTimeout(480_000);
    makeAnnotate('TM-1830', ROUTE)('TC26', 'DT');
    const gate = await flow.driversGate();
    test.skip(gate.nonOffline > 0, driversSkipReason(gate));

    const point = (
      await waypointsApi.create({
        name: nameFor('destino'),
        reference: POINT_REFERENCE,
        ...toWaypointCoords(TRIP_SPOTS.second)
      })
    ).waypoint;
    // Viaje de precondición: origen y destino de Google (el punto se elige después, en la edición).
    const saved = await flow.seedTrip({
      origin: { kind: 'google', text: GOOGLE_ORIGIN_TEXT },
      destination: { kind: 'google', text: GOOGLE_DESTINATION_TEXT }
    });
    const edit = new TravelDetailEditPage(page);
    await edit.open(saved.travelId);

    // Selección del punto en Destino durante la edición.
    const typed = await edit.places.pickReferencePoint(
      'destination',
      searchTextFor(runId),
      point.placeId
    );
    expect(
      new URL(typed.requestUrl).searchParams.get('carrierId'),
      'autocomplete de la edición: carrierId del carrier'
    ).toBe(String(carrierSession.carrierId));
    const own = typed.autocomplete.findIndex((item) => item.placeId === point.placeId);
    expect(own, 'el punto propio está en la respuesta de autocomplete').toBeGreaterThanOrEqual(0);
    const sources = typed.autocomplete.map((item) => item.source === 'CARRIER');
    expect(
      sources,
      'la lista pone primero los puntos del carrier (ningún CARRIER después de uno que no lo es)'
    ).toEqual([...sources].sort((a, b) => Number(b) - Number(a)));
    expect(typed.options[own], 'UI: la opción propia lleva su nombre y el badge').toEqual({
      text: point.name,
      hasBadge: true
    });
    expect(
      typed.outboundCalls,
      'elegir el punto en la edición no emite getPlace ni Google'
    ).toEqual([]);
    expect(
      await edit.places.readInstruction('destination'),
      'la indicación del destino se copia de la referencia del punto'
    ).toBe(POINT_REFERENCE);
    expect(
      (await edit.places.readNoteCard('destination')).trim(),
      'la tarjeta NOTE muestra la indicación copiada'
    ).toBe(POINT_REFERENCE);
    // Control positivo del lector del modal de Notas (paso 4 de la definición): en la primera edición lee la indicación.
    await edit.openNotes();
    expect(
      await edit.noteValue('dropoff'),
      'modal de Notas: Drop-Off con la indicación copiada'
    ).toBe(POINT_REFERENCE);
    await edit.cancelNotes();

    // Se guarda la edición con el punto como destino (precondición del reemplazo, pasos 5 y 6 del Test).
    expect((await edit.recalculate()).status(), 'Recalculate: travels/simulate responde 200').toBe(
      200
    );
    const putPoint = await edit.save();
    expect(putPoint.status, 'PUT …/update con el punto como destino responde 200').toBe(200);
    const savedPoint = await travelsApi.getDetail(saved.travelId);
    const savedPointDestination = savedPoint.destination as Record<string, unknown>;
    expect(savedPointDestination.mapPlaceId, 'el destino guardado es el punto').toBe(point.placeId);
    expect(
      savedPointDestination.specialInstruction,
      'el destino guardado lleva la indicación copiada'
    ).toBe(POINT_REFERENCE);
    const dbSaved = await flow.dbOriginDestination(saved.travelId);
    expect(dbSaved.destination, 'DB: existe el lugar de destino del viaje').toBeDefined();
    expect(dbSaved.destination?.MAPPLACEID, 'DB: MAPPLACEID del destino = punto').toBe(
      point.placeId
    );
    expect(Number(dbSaved.destination?.LATITUDE), 'DB: latitud del destino = punto').toBe(
      point.latitude
    );
    expect(Number(dbSaved.destination?.LONGITUDE), 'DB: longitud del destino = punto').toBe(
      point.longitude
    );
    expect(
      dbSaved.destination?.SPECIAL_INSTRUCTION,
      'DB: indicación del destino = referencia'
    ).toBe(POINT_REFERENCE);

    // Segunda edición: reemplazo por una dirección de Google y aceptación de las notas. La AC es que la
    // indicación del destino nuevo quede vacía.
    const editAgain = new TravelDetailEditPage(page);
    await editAgain.open(saved.travelId);
    expect(await editAgain.placeValue('destination'), 'precondición: el destino es el punto').toBe(
      point.name
    );
    await editAgain.places.pickGoogleAddress('destination', GOOGLE_REPLACEMENT_TEXT);
    await editAgain.openNotes();
    const noteInModal = await editAgain.noteValue('dropoff');
    await editAgain.acceptNotes();
    expect(
      (await editAgain.recalculate()).status(),
      'Recalculate: travels/simulate responde 200'
    ).toBe(200);
    const put = await editAgain.save();
    expect(put.status, 'PUT …/update del reemplazo responde 200').toBe(200);
    const after = await travelsApi.getDetail(saved.travelId);
    const destination = after.destination as Record<string, unknown>;
    expect(
      String(destination.mapPlaceId).startsWith('MGWP-'),
      'el destino guardado es la dirección de Google, no un punto propio'
    ).toBe(false);
    const putDestination = put.body.destination as Record<string, unknown>;
    expect(
      putDestination.placeId,
      'el PUT del reemplazo lleva el placeId de Google que quedó guardado'
    ).toBe(destination.mapPlaceId);
    const persisted = String(destination.specialInstruction ?? '');

    const stale = noteInModal === POINT_REFERENCE || persisted === POINT_REFERENCE;
    if (stale) {
      // H-AP-01 (Media, Introducido, decisión del TL pendiente): se afirma la AC y, si el valor medido es el
      // del defecto, se registra sin lanzar (Playwright verde, Xray FAILED); al corregirse esta rama no corre.
      // Cada valor es vacío (corregido) o el del punto anterior (defecto); un tercer valor es otra falla.
      expect(
        ['', POINT_REFERENCE],
        'modal de Notas: vacío o el valor del punto anterior'
      ).toContain(noteInModal);
      expect(
        ['', POINT_REFERENCE],
        'destino guardado: vacío o el valor del punto anterior'
      ).toContain(persisted);
      recordKnownIssue(
        testInfo,
        'H-AP-01',
        `viaje ${saved.travelId}: tras reemplazar el destino-punto «${point.name}» por la dirección de Google «${String(destination.shortName)}» y aceptar Notas, ` +
          `el modal mostró «${noteInModal}» y el destino guardado quedó con specialInstruction «${persisted}» (esperado: vacío)`
      );
    } else {
      expect(noteInModal, 'la indicación del destino nuevo en el modal de Notas está vacía').toBe(
        ''
      );
      expect(persisted, 'la indicación del destino nuevo guardado está vacía').toBe('');
    }

    await flow.evidence(
      'tm-1830-edicion-reemplazo-destino',
      `Viaje ${saved.travelId} (carrier 1521, ${ENV}) en edición: se eligió el punto «${point.name}» (${point.placeId}) en Destino: autocomplete con carrierId=${carrierSession.carrierId}, lista con los puntos primero, badge, 0 getPlace/Google y la indicación «${POINT_REFERENCE}» copiada (modal y tarjeta NOTE). ` +
        `Se guardó la edición (PUT 200; GET y DB: destino = punto con la indicación). En una segunda edición se reemplazó por la dirección de Google «${String(destination.shortName)}», se aceptaron Notas, Recalculate y Save (PUT 200): modal de Notas «${noteInModal}», specialInstruction guardado «${persisted}». ` +
        (stale
          ? 'ROJO CONOCIDO H-AP-01: la indicación del punto anterior quedó en el destino nuevo (la AC pide vacío).'
          : 'La indicación del destino nuevo quedó vacía.')
    );
  });
});
