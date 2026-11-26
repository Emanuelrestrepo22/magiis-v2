// tests/specs/trips/new-trip-quick-reference-point.spec.ts
// MG-1132 · ATP TM-1841 · PK-3 — puntero de mapa y popover «Guardar como punto de referencia» de Nuevo
// Viaje (MG-1761 alta rápida; MG-1757 vía rural y sin país). Acredita TM-1773 (+ TM-1774, TM-1775),
// TM-1777, TM-1778 (+ TM-1779), TM-1797, TM-1862 (+ TM-1865) y TM-1864.
// Ambiente TEST, carrier 1521 (decisión D2). NO crea viajes: solo `POST carriers/{id}/waypoint` desde el
// popover. Los puntos que crea la UI se registran por nombre exacto (`UiCreatedWaypoints`, PK-4) y se
// borran en afterEach por id leído de la lista. El mapa de Nuevo Viaje es Google Maps: el click va por
// `NewTripPage.armPointerAndClick` (tests/utils/googleMap.ts); el del modal del ABM es Leaflet
// (POM de PK-4). Textos de UI en EN (locale en-US del repo).
// Corrida local (sesión guardada, sin login con contraseña):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/trips/new-trip-quick-reference-point.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import type { Page } from '@playwright/test';
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import {
  LOCATIONS,
  MIAMI,
  toWaypointCoords,
  type Coordinate
} from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { UiCreatedWaypoints } from '../../helpers/waypoint-ui-cleanup.js';
import { watchWaypointCalls, type WaypointCallWatch } from '../../helpers/waypoint-network.js';
import { attachXrayEvidence } from '../../helpers/xray-evidence.js';
import { ReferencePointFormModalPage } from '../../pages/carrier-v2/settings/ReferencePointFormModalPage.js';
import { ReferencePointsPage } from '../../pages/carrier-v2/settings/ReferencePointsPage.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import {
  QuickReferencePointPopoverPage,
  WAYPOINT_CREATE_URL
} from '../../pages/carrier-v2/trips/QuickReferencePointPopoverPage.js';
import { installGoogleMapHook } from '../../utils/googleMap.js';
import { installMapHook } from '../../utils/leafletMap.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);

const SAVED_TOAST = /saved\. You can now type it in pick-up\/drop-off/i;
const INVALID_ADDRESS_TOAST = /Invalid Address/i;
const NO_COUNTRY_TOAST = /couldn.t identify the country/i;
/** El popover abre tras getPlace + checkPlace del click (geocode de Google): con 5 s por defecto hubo un rojo aislado. */
const POPOVER_OPEN_TIMEOUT_MS = 20_000;
/** Tolerancia de la coordenada del click (~5 m): el POST lleva la coordenada exacta del pixel clickeado. */
const COORD_DIGITS = 4;
/** Tercera coordenada propia (entre las dos de MIAMI, ~200 m de cada una): la parada no se marca sobre el pin del Origen (F-25). */
const STOP_POINT = { lat: 25.7683, lng: -80.1905 } as const;
/** Isla Martín García: tierra firme sin calles de un país identificado (TM-1865, fila a). */
const ISLAND: Coordinate = { lat: -34.1825, lng: -58.2497 };
/** Tolerancia entre la coordenada pedida y la que vio el servidor (ack ligado al click). */
const ACK_TOLERANCE_DEG = 0.001;

/** Calle del `formattedAddress` de checkPlace (antes de la primera coma): el campo debe mostrarla. */
function streetOf(formattedAddress: string): string {
  return formattedAddress.split(',')[0].trim();
}

type AckLike = {
  body: {
    lat: number;
    lng: number;
    routable: boolean;
    reasons: string[];
    formattedAddress: string;
  };
};

/** Mensaje de diagnóstico del ack (pedido vs. lo que vio el servidor). */
function ackDiag(label: string, asked: Coordinate, ack: AckLike): string {
  return `${label}: pedido ${asked.lat},${asked.lng}; checkPlace lat=${ack.body.lat} lng=${ack.body.lng} routable=${ack.body.routable} reasons=[${ack.body.reasons.join(',')}] «${ack.body.formattedAddress}»`;
}

/** El ack debe ser del click: lat/lng devueltos a menos de `ACK_TOLERANCE_DEG` de lo pedido. */
function expectAckAtClick(label: string, asked: Coordinate, ack: AckLike): void {
  const diag = ackDiag(label, asked, ack);
  expect(Math.abs(ack.body.lat - asked.lat), diag).toBeLessThan(ACK_TOLERANCE_DEG);
  expect(Math.abs(ack.body.lng - asked.lng), diag).toBeLessThan(ACK_TOLERANCE_DEG);
}

/**
 * Para caminos rurales `checkPlace` devuelve la coordenada del lugar ajustado por Google (medido: ~750 m del
 * click), no la del click. El click se liga por el `getPlace?latitude=&longitude=` que dispara (tolerancia
 * 0,0005°, la de la precondición 5 del Test).
 */
function expectPlaceAtClick(
  label: string,
  asked: Coordinate,
  place: { lat: number | null; lng: number | null } | null
): void {
  const diag = `${label}: pedido ${asked.lat},${asked.lng}; getPlace del click ${place ? `${place.lat},${place.lng}` : 'no llegó'}`;
  expect(place, diag).not.toBeNull();
  expect(Math.abs((place?.lat ?? Infinity) - asked.lat), diag).toBeLessThan(0.0005);
  expect(Math.abs((place?.lng ?? Infinity) - asked.lng), diag).toBeLessThan(0.0005);
}

/** Abre Nuevo Viaje con el hook del mapa de Google y el cliente de prueba elegido. */
async function openNewTrip(page: Page): Promise<NewTripPage> {
  await installGoogleMapHook(page);
  const trip = new NewTripPage(page);
  await trip.goto();
  await trip.selectClient('Stripe', 'Stripe, Cliente');
  // El cliente autocompleta el Origen de forma asíncrona (y el ack del puntero podría ser el de esa
  // dirección): se espera el Origen resuelto y sin spinners antes de operar.
  await expect(trip.placeChip('origin')).toBeVisible({ timeout: 20_000 });
  await expect(trip.fieldSpinners).toHaveCount(0);
  return trip;
}

/**
 * Compuerta de red para el alta del popover: retiene el `POST …/waypoint` real hasta que el test
 * la libera (no altera petición ni respuesta). Permite aseverar el estado «guardando» sin depender
 * de un retardo fijo (TM-1797).
 */
async function installCreateGate(page: Page): Promise<{ hold: () => () => void }> {
  let gate: Promise<void> = Promise.resolve();
  await page.route(WAYPOINT_CREATE_URL, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await gate;
    await route.continue();
  });
  return {
    /** Cierra la compuerta para el próximo POST; devuelve la función que la libera. */
    hold: () => {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    }
  };
}

test.describe('MG-1132 puntero y popover de punto de referencia en Nuevo Viaje', () => {
  test.skip(
    process.env.WAYPOINTS_CREATE_DATA !== '1',
    'crea y borra puntos de referencia reales; correr con WAYPOINTS_CREATE_DATA=1'
  );
  test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
  // SIN retries: cada intento crea datos reales y un reintento taparía la falla del primero.
  test.describe.configure({ timeout: 180_000, retries: 0 });

  let uiCreated: UiCreatedWaypoints | undefined;
  let calls: WaypointCallWatch;
  /** Altas de punto observadas en la página principal. */
  const posts = (): number => calls.count('POST', WAYPOINT_CREATE_URL);

  // Barrido de corridas anteriores: solo puntos «QA AUTO <runId>» con más de 24 h.
  test.beforeAll(async ({ carrierApi, carrierSession }) => {
    await new WaypointsClient(carrierApi, carrierSession, makeRunId())
      .sweep()
      .catch((error: unknown) => {
        console.warn(
          `[new-trip-quick-reference-point] sweep omitido: ${String(error).slice(0, 200)}`
        );
      });
  });

  test.beforeEach(async ({ page, waypointsApi, carrierSession, runId }) => {
    uiCreated = new UiCreatedWaypoints(waypointsApi, carrierSession.carrierId, runId);
    calls = watchWaypointCalls(page);
  });

  test.afterEach(async () => {
    await uiCreated?.cleanup();
  });

  test.describe('@P1 @functional @migration MG-1132 alta rápida desde el puntero', () => {
    test('TM-1773: debería abrir el popover al marcar un punto válido con el puntero, guardar el punto con nombre propio y cargarlo en el campo (Origen, Destino y parada)', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate(['TM-1773', 'TM-1774', 'TM-1775'], ROUTE)('TC01', 'HP');
      const trip = await openNewTrip(page);
      const quick = new QuickReferencePointPopoverPage(page);

      // Fila 1 · Origen con Nombre + Referencia (TM-1773).
      const nameOrigin = uiCreated!.track(nameFor('origen'));
      const referenceOrigin = 'Portón azul, ingreso por la calle lateral';
      const ack = await trip.armPointerAndClick('origin', MIAMI.downtown);
      expect(ack.url).toContain('waypoint=true');
      expect(ack.body.routable).toBe(true);
      await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
      await expect(quick.title).toHaveText(/Save as reference point/i);
      await expect(quick.saveButton).toBeEnabled();
      await testInfo.attach('popover-abierto-origen', {
        body: await page.screenshot(),
        contentType: 'image/png'
      });
      // Espera del toast armada ANTES de guardar (dura ~3 s: no se puede mirar después de leer el POST).
      const seenOrigin = quick
        .toast(SAVED_TOAST)
        .filter({ hasText: nameOrigin })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      seenOrigin.catch(() => undefined);
      const savedOrigin = await quick.fillAndSave({ name: nameOrigin, reference: referenceOrigin });
      expect(savedOrigin.status).toBe(200);
      expect(Object.keys(savedOrigin.requestBody).sort()).toEqual([
        'latitude',
        'longitude',
        'name',
        'reference'
      ]);
      expect(savedOrigin.requestBody.name).toBe(nameOrigin);
      expect(savedOrigin.requestBody.reference).toBe(referenceOrigin);
      expect(savedOrigin.requestBody.latitude).toBeCloseTo(MIAMI.downtown.lat, COORD_DIGITS);
      expect(savedOrigin.requestBody.longitude).toBeCloseTo(MIAMI.downtown.lng, COORD_DIGITS);
      expect(savedOrigin.body.waypoint.placeId).toMatch(/^MGWP-\d+-1$/);
      await seenOrigin;
      await quick.expectClosed();
      await expect(trip.placeChip('origin')).toContainText(nameOrigin);
      expect(posts()).toBe(1);
      const listedOrigin = (await waypointsApi.list()).filter((w) => w.name === nameOrigin);
      expect(listedOrigin).toHaveLength(1);
      expect(listedOrigin[0].id).toBe(savedOrigin.body.waypoint.id);
      expect(listedOrigin[0].reference).toBe(referenceOrigin);
      expect(listedOrigin[0].latitude).toBeCloseTo(savedOrigin.requestBody.latitude, 6);
      expect(listedOrigin[0].longitude).toBeCloseTo(savedOrigin.requestBody.longitude, 6);
      // AC7: la Referencia pasa a las indicaciones del Origen (modal del reloj y tarjeta de notas).
      await trip.expectInstruction('origin', referenceOrigin);
      await trip.expectNoteCard('origin', referenceOrigin);

      // Fila 2 · Destino con Referencia vacía (acredita TM-1774).
      const nameDestination = uiCreated!.track(nameFor('destino'));
      await trip.armPointerAndClick('destination', MIAMI.brickell);
      await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
      const seenDestination = quick
        .toast(SAVED_TOAST)
        .filter({ hasText: nameDestination })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      seenDestination.catch(() => undefined);
      const savedDestination = await quick.fillAndSave({ name: nameDestination });
      expect(savedDestination.status).toBe(200);
      expect(savedDestination.requestBody.name).toBe(nameDestination);
      expect(savedDestination.requestBody.reference).toBeNull();
      expect(savedDestination.requestBody.latitude).toBeCloseTo(MIAMI.brickell.lat, COORD_DIGITS);
      expect(savedDestination.requestBody.longitude).toBeCloseTo(MIAMI.brickell.lng, COORD_DIGITS);
      expect(savedDestination.body.waypoint.placeId).toMatch(/^MGWP-\d+-1$/);
      await seenDestination;
      await quick.expectClosed();
      await expect(trip.placeChip('destination')).toContainText(nameDestination);
      // El Origen no cambia al guardar el Destino.
      await expect(trip.placeChip('origin')).toContainText(nameOrigin);
      const listedDestination = (await waypointsApi.list()).filter(
        (w) => w.id === savedDestination.body.waypoint.id
      );
      expect(listedDestination).toHaveLength(1);
      expect(listedDestination[0].name).toBe(nameDestination);
      expect(listedDestination[0].reference).toBeNull();
      // AC7 (sin referencia): la indicación del Destino queda vacía. Control: la tarjeta SÍ existe
      // porque la fila del Origen muestra su referencia.
      await trip.expectNoteCard('origin', referenceOrigin);
      await expect(trip.noteCardRow('destination')).toHaveCount(0);
      await trip.expectInstruction('destination', '');

      // Fila 3 · parada (acredita TM-1775): `addStop()` inserta una parada VACÍA entre Origen y
      // Destino; el puntero de «Stop 1» se marca en una tercera coordenada propia.
      await trip.addStop();
      const nameStop = uiCreated!.track(nameFor('parada'));
      const referenceStop = 'Parada intermedia';
      const ackStop = await trip.armPointerAndClick({ stop: 1 }, STOP_POINT);
      expect(ackStop.body.routable).toBe(true);
      await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
      const seenStop = quick
        .toast(SAVED_TOAST)
        .filter({ hasText: nameStop })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      seenStop.catch(() => undefined);
      const savedStop = await quick.fillAndSave({ name: nameStop, reference: referenceStop });
      expect(savedStop.status).toBe(200);
      expect(savedStop.requestBody.name).toBe(nameStop);
      expect(savedStop.requestBody.reference).toBe(referenceStop);
      expect(savedStop.requestBody.latitude).toBeCloseTo(STOP_POINT.lat, COORD_DIGITS);
      expect(savedStop.requestBody.longitude).toBeCloseTo(STOP_POINT.lng, COORD_DIGITS);
      expect(savedStop.body.waypoint.placeId).toMatch(/^MGWP-\d+-1$/);
      await seenStop;
      await quick.expectClosed();
      await expect(trip.placeChip({ stop: 1 })).toContainText(nameStop);
      // Origen y Destino no cambian al guardar la parada.
      await expect(trip.placeChip('origin')).toContainText(nameOrigin);
      await expect(trip.placeChip('destination')).toContainText(nameDestination);
      const listedStop = (await waypointsApi.list()).filter(
        (w) => w.id === savedStop.body.waypoint.id
      );
      expect(listedStop).toHaveLength(1);
      expect(listedStop[0].name).toBe(nameStop);
      expect(listedStop[0].reference).toBe(referenceStop);
      // AC7 (parada): la Referencia pasa a la indicación de Stop 1 y las otras filas no cambian.
      await trip.expectInstruction({ stop: 1 }, referenceStop);
      await trip.expectNoteCard({ stop: 1 }, referenceStop);
      await trip.expectNoteCard('origin', referenceOrigin);
      await expect(trip.noteCardRow('destination')).toHaveCount(0);

      // Tres altas, tres POST, tres filas propias en el listado.
      expect(posts()).toBe(3);
      const names = [nameOrigin, nameDestination, nameStop];
      const listed = (await waypointsApi.list()).filter((w) => names.includes(w.name));
      expect(listed.map((w) => w.name).sort()).toEqual([...names].sort());

      await attachXrayEvidence(testInfo, page, {
        name: 'tm1773-puntos-guardados',
        comment:
          `Nuevo Viaje (${ENV}, carrier ${DATA?.primary.carrierId}): puntero de Origen sobre ` +
          `${MIAMI.downtown.lat},${MIAMI.downtown.lng}; checkPlace?waypoint=true routable=${ack.body.routable}; ` +
          `popover «Save as reference point»; POST 200 con {name, reference, latitude ${savedOrigin.requestBody.latitude}, ` +
          `longitude ${savedOrigin.requestBody.longitude}} y placeId ${savedOrigin.body.waypoint.placeId}; toast «saved»; ` +
          `el campo Origen muestra «${nameOrigin}» y su indicación = la Referencia (tarjeta de notas). ` +
          `Destino (referencia null, placeId ${savedDestination.body.waypoint.placeId}, indicación vacía) y ` +
          `Stop 1 (placeId ${savedStop.body.waypoint.placeId}, indicación «${referenceStop}») repiten el flujo. ` +
          '3 POST, 3 filas propias en list(); sin viajes.'
      });
    });

    test('TM-1862: debería aceptar el click sobre un camino rural sin nombre, con y sin localidad, con checkPlace?waypoint=true ruteable, y guardarlo como punto', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate(['TM-1862', 'TM-1865'], ROUTE)('TC04', 'HP');
      const trip = await openNewTrip(page);
      const quick = new QuickReferencePointPopoverPage(page);
      const rows = [
        {
          label: 'F1 rural con localidad',
          field: 'origin',
          location: LOCATIONS.F1,
          requiredWarnings: [] as string[]
        },
        {
          label: 'F2 rural sin localidad',
          field: 'origin',
          location: LOCATIONS.F2,
          requiredWarnings: ['NO_CITY'] as string[]
        },
        // TM-1865 (MG-1757 TC7): tierra firme sin calles y plaza, sobre Destino.
        {
          label: 'isla sin calles',
          field: 'destination',
          location: ISLAND,
          requiredWarnings: [] as string[]
        },
        {
          label: 'plaza',
          field: 'destination',
          location: LOCATIONS.F6,
          requiredWarnings: [] as string[]
        }
      ] as const;
      const measured: string[] = [];

      for (const row of rows) {
        const name = uiCreated!.track(nameFor(row.label));
        const ack = await trip.armPointerAndClick(row.field, row.location);
        expectPlaceAtClick(row.label, row.location, ack.clicked);
        // Con waypoint=true solo bloquean NO_GEOCODE_RESULTS y NO_COUNTRY (MG-1757 etapa 14).
        expect(ack.url, `${row.label}: checkPlace con waypoint=true`).toContain('waypoint=true');
        expect(ack.status).toBe(200);
        expect(ack.body.routable, `${row.label}: ruteable`).toBe(true);
        expect(ack.body.reasons).toEqual([]);
        await expect(quick.popover, `${row.label}: se abre el popover`).toBeVisible({
          timeout: POPOVER_OPEN_TIMEOUT_MS
        });
        await expect(quick.toast(INVALID_ADDRESS_TOAST)).toHaveCount(0);
        await expect(quick.saveButton).toBeEnabled();

        // Esperas de los avisos del alta armadas ANTES de guardar (los toasts duran ~3 s).
        const seenAnyWarning = quick
          .toast(/Save as reference point/i)
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        const seenNoCity = quick
          .toast(/no address in Google/i)
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        seenAnyWarning.catch(() => undefined);
        seenNoCity.catch(() => undefined);
        const saved = await quick.fillAndSave({ name });
        expect(saved.status).toBe(200);
        expect(saved.body.waypoint.placeId).toMatch(/^MGWP-\d+-1$/);
        expect(saved.requestBody.latitude).toBeCloseTo(row.location.lat, COORD_DIGITS);
        expect(saved.requestBody.longitude).toBeCloseTo(row.location.lng, COORD_DIGITS);
        // F2: el backend avisa que Google no identifica la localidad (`NO_CITY`); el aviso no impide
        // guardar. Las demás filas no exigen avisos (medido 18/11).
        expect(saved.body.warnings).toEqual(expect.arrayContaining(row.requiredWarnings));
        // Por cada warning del POST, una advertencia en pantalla (copy medido de NO_CITY).
        if (saved.body.warnings.length > 0) await seenAnyWarning;
        if (saved.body.warnings.includes('NO_CITY')) await seenNoCity;
        await quick.expectClosed();
        await expect(trip.placeChip(row.field)).toContainText(name);
        const listed = (await waypointsApi.list()).filter((w) => w.id === saved.body.waypoint.id);
        expect(listed).toHaveLength(1);
        expect(listed[0].name).toBe(name);
        measured.push(
          `${row.label} (${row.location.lat},${row.location.lng}): checkPlace?waypoint=true routable=${ack.body.routable} ` +
            `reasons=[${ack.body.reasons.join(',')}]; POST 200 ${saved.body.waypoint.placeId} warnings=[${saved.body.warnings.join(',')}]`
        );
      }
      expect(posts()).toBe(rows.length);

      await attachXrayEvidence(testInfo, page, {
        name: 'tm1862-camino-rural-guardado',
        comment:
          `Nuevo Viaje (${ENV}): click con el puntero sobre caminos rurales sin nombre (Origen) y sobre tierra firme sin calles y plaza (Destino). ` +
          `${measured.join(' | ')}. Sin toast «Invalid Address», popover abierto en las 4 filas, punto presente en list().`
      });
    });
  });

  test.describe('@P2 @functional @migration MG-1132 alta rápida desde el puntero', () => {
    test('TM-1777: debería ofrecer en Destino, sin recargar el formulario, el punto recién guardado con y sin tilde ni mayúsculas', async ({
      page,
      carrierSession,
      runId,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1777', ROUTE)('TC05', 'HP');
      const trip = await openNewTrip(page);
      const quick = new QuickReferencePointPopoverPage(page);
      const name = uiCreated!.track(nameFor('Añelo'));
      const carrierParam = String(carrierSession.carrierId);

      // Antes de guardar: el token único del run no existe como punto propio.
      const before = await trip.typeInPlaceField('destination', runId);
      expect(new URL(before.requestUrl).searchParams.get('carrierId')).toBe(carrierParam);
      expect(before.autocomplete.filter((i) => i.source === 'CARRIER')).toEqual([]);
      await page.keyboard.press('Escape');

      await trip.armPointerAndClick('origin', MIAMI.downtown);
      await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
      const saved = await quick.fillAndSave({ name });
      expect(saved.status).toBe(200);
      const placeId = saved.body.waypoint.placeId;
      await quick.expectClosed();

      // Sin recargar: variantes con y sin tilde / mayúsculas del mismo nombre propio.
      const queries = [`${runId} Añelo`, `${runId.toLowerCase()} anelo`, `${runId} AÑELO`];
      const measured: string[] = [];
      for (const query of queries) {
        const capture = await trip.typeInPlaceField('destination', query);
        expect(
          new URL(capture.requestUrl).searchParams.get('carrierId'),
          `«${query}»: el request lleva carrierId`
        ).toBe(carrierParam);
        const own = capture.autocomplete.filter((i) => i.placeId === placeId);
        expect(own, `«${query}»: el punto recién guardado aparece una vez`).toHaveLength(1);
        expect(own[0].source).toBe('CARRIER');
        expect(
          capture.options.filter((o) => o.text.includes(name) && o.hasBadge),
          `«${query}»: la opción propia se ve con su badge`
        ).toHaveLength(1);
        measured.push(`«${query}» -> CARRIER ${placeId}`);
      }

      await attachXrayEvidence(testInfo, page, {
        name: 'tm1777-destino-ofrece-el-punto',
        comment:
          `Nuevo Viaje (${ENV}): antes de guardar, autocomplete de «${runId}» con carrierId=${carrierSession.carrierId} ` +
          `devolvió 0 ítems CARRIER. Tras guardar «${name}» (${placeId}) sin recargar, Destino ofreció el punto ` +
          `para ${measured.join('; ')}.`
      });
    });

    test('TM-1778: debería cerrar el popover con Cancelar, conservar la dirección de Google en el campo y no crear el punto (y lo mismo con Escape)', async ({
      page,
      waypointsApi,
      placesApi,
      carrierSession,
      runId,
      nameFor
    }, testInfo) => {
      makeAnnotate(['TM-1778', 'TM-1779'], ROUTE)('TC06', 'HP');
      const trip = await openNewTrip(page);
      const quick = new QuickReferencePointPopoverPage(page);
      const ownRows = async (): Promise<string[]> =>
        (await waypointsApi.list()).map((w) => w.name).filter((n) => n.includes(runId));
      const measured: string[] = [];

      // Cancelar (TM-1778).
      const nameCancel = uiCreated!.track(nameFor('cancelar'));
      const ackCancel = await trip.armPointerAndClick('origin', MIAMI.downtown);
      expect(ackCancel.body.routable).toBe(true);
      await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
      await quick.nameInput.fill(nameCancel);
      await quick.cancelButton.click();
      await quick.expectClosed();
      const streetCancel = streetOf(ackCancel.body.formattedAddress);
      await expect(trip.placeChip('origin')).toContainText(streetCancel);
      await expect(trip.placeChip('origin')).not.toContainText(nameCancel);
      expect(posts()).toBe(0);
      expect(await ownRows()).toEqual([]);
      const found = await placesApi.autocomplete({
        address: runId,
        carrierId: carrierSession.carrierId
      });
      expect(found.filter((i) => i.source === 'CARRIER')).toEqual([]);
      measured.push(
        `Cancelar: popover cerrado, campo Origen con «${streetCancel}», 0 POST, 0 filas «${runId}» en list(), autocomplete sin ítems CARRIER`
      );
      await testInfo.attach('tras-cancelar', {
        body: await page.screenshot(),
        contentType: 'image/png'
      });

      // Escape (acredita TM-1779): mismo resultado con otro punto válido.
      const nameEscape = uiCreated!.track(nameFor('escape'));
      const ackEscape = await trip.armPointerAndClick('origin', MIAMI.brickell);
      expect(ackEscape.body.routable).toBe(true);
      await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
      await quick.nameInput.fill(nameEscape);
      await page.keyboard.press('Escape');
      await quick.expectClosed();
      const streetEscape = streetOf(ackEscape.body.formattedAddress);
      await expect(trip.placeChip('origin')).toContainText(streetEscape);
      await expect(trip.placeChip('origin')).not.toContainText(nameEscape);
      expect(posts()).toBe(0);
      expect(await ownRows()).toEqual([]);
      measured.push(
        `Escape (ejecutado sobre Origen; el Test lo define sobre la parada): popover cerrado, campo Origen con «${streetEscape}», 0 POST, 0 filas «${runId}» en list()`
      );

      // Condición de P1 (#38220): el paso 2 («el campo conserva la dirección de Google») sigue sin
      // confirmación de Dev; el expect coincide con el esperado escrito del Test, pero se deja registro.
      const p1Note =
        'TM-1779 paso 2 condicionado a la pregunta P1 de #38220 (sin confirmación de Dev al 17/11)';
      testInfo.annotations.push({ type: 'observation', description: p1Note });
      measured.push(p1Note);

      // Control positivo (X7): un punto de control sí es encontrable por la misma vía, así que la
      // ausencia de los nombres cancelados no se debe a una búsqueda que no encuentra nada.
      const control = await waypointsApi.create({
        name: nameFor('control'),
        ...toWaypointCoords(MIAMI.downtown)
      });
      const afterControl = await placesApi.autocomplete({
        address: runId,
        carrierId: carrierSession.carrierId
      });
      expect(
        afterControl.filter((i) => i.source === 'CARRIER').map((i) => i.placeId),
        'solo el punto de control es encontrable; los cancelados no existen'
      ).toEqual([control.waypoint.placeId]);
      measured.push(
        `Control: el punto ${control.waypoint.placeId} sí aparece en autocomplete («${runId}»)`
      );

      await attachXrayEvidence(testInfo, page, {
        name: 'tm1778-cancelar-y-escape',
        comment: `Nuevo Viaje (${ENV}): ${measured.join('. ')}.`
      });
    });

    test('TM-1797: debería enviar un solo alta al guardar con doble clic rápido y con Enter repetido en Nombre', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1797', ROUTE)('TC27', 'HP');
      const createGate = await installCreateGate(page);
      const trip = await openNewTrip(page);
      const quick = new QuickReferencePointPopoverPage(page);
      const measured: string[] = [];

      const scenarios = [
        {
          label: 'doble clic en Guardar',
          name: uiCreated!.track(nameFor('doble clic')),
          point: MIAMI.downtown,
          submit: async (): Promise<void> => {
            await quick.saveButton.dblclick();
          }
        },
        {
          label: 'Enter repetido en Nombre',
          name: uiCreated!.track(nameFor('enter')),
          point: MIAMI.brickell,
          submit: async (): Promise<void> => {
            await quick.nameInput.press('Enter');
            // Sin esperar el popover: el segundo Enter llega mientras el alta sigue en vuelo.
            await page.keyboard.press('Enter');
          }
        }
      ] as const;

      for (const scenario of scenarios) {
        const postsBefore = posts();
        await trip.armPointerAndClick('origin', scenario.point);
        await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
        await quick.fill({ name: scenario.name });
        // El POST queda retenido hasta que el test asevera el estado «guardando».
        const release = createGate.hold();
        let saved;
        try {
          saved = await quick.captureCreate(async () => {
            await scenario.submit();
            await expect(quick.saveButton).toBeDisabled();
            await expect(quick.cancelButton).toBeDisabled();
            await expect(quick.saveSpinner).toBeVisible();
            expect(posts() - postsBefore, `${scenario.label}: un solo POST en vuelo`).toBe(1);
            release();
          });
        } finally {
          release();
        }
        expect(saved.status).toBe(200);
        await quick.expectClosed();
        expect(posts() - postsBefore, `${scenario.label}: un solo POST`).toBe(1);
        const rows = (await waypointsApi.list()).filter((w) => w.name === scenario.name);
        expect(rows, `${scenario.label}: una sola fila propia`).toHaveLength(1);
        expect(rows[0].id).toBe(saved.body.waypoint.id);
        measured.push(
          `${scenario.label}: 1 POST 200 (${saved.body.waypoint.placeId}), 1 fila «${scenario.name}» en list()`
        );
      }
      expect(posts(), 'total de POST de los dos escenarios').toBe(2);
      await expect(trip.placeChip('origin')).toContainText(scenarios[1].name);

      await attachXrayEvidence(testInfo, page, {
        name: 'tm1797-un-solo-alta',
        comment:
          `Nuevo Viaje (${ENV}): con el POST retenido por una compuerta de red hasta aseverar el estado, tras el primer envío Guardar y Cancelar quedaron deshabilitados, con el spinner de Guardar y 1 solo POST en vuelo. ` +
          `${measured.join('; ')}.`
      });
    });

    test('TM-1864: debería rechazar el click sobre mar abierto y canal sin país con el aviso de dirección inválida, sin popover ni alta, y pedir marcar el punto en el ABM', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      test.setTimeout(300_000);
      makeAnnotate('TM-1864', ROUTE)('TC06', 'NEG');
      await installMapHook(page);
      const trip = await openNewTrip(page);
      const quick = new QuickReferencePointPopoverPage(page);
      const originBefore = await trip.placeValue('origin');
      expect(originBefore, 'el cliente deja un Origen cargado').not.toBe('');
      const measured: string[] = [];
      const evaluatedNv: string[] = [];

      for (const row of [
        { id: 'F5a', label: 'F5a mar abierto', location: LOCATIONS.F5a },
        { id: 'F5b', label: 'F5b canal del Paraná', location: LOCATIONS.F5b }
      ] as const) {
        // Sin toasts previos: el toast que se asevera es el de ESTE clic.
        await expect(quick.swalToasts).toHaveCount(0, { timeout: 15_000 });
        // Toast y getPlace del click armados ANTES del click (el toast dura ~3 s).
        const seen = quick
          .toast(INVALID_ADDRESS_TOAST)
          .filter({ hasText: NO_COUNTRY_TOAST })
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        seen.catch(() => undefined);
        const ack = await trip.armPointerAndClick('origin', row.location);
        const place = ack.clicked;
        if (row.id === 'F5b' && place.country !== '') {
          // La fila solo se saltea si el getPlace es el del clic pedido (si no, el clic cayó en otro lado).
          expectPlaceAtClick(row.label, row.location, place);
          // Google informó país: la fila deja de ser «sin país» (agua con país, Q1 abierta): se mide, no se asevera.
          const note = `F5b: Google informó país «${place.country}» en ${row.location.lat},${row.location.lng}; fila no evaluada en Nuevo Viaje`;
          testInfo.annotations.push({ type: 'observation', description: note });
          measured.push(note);
          // El punto es válido: si abrió el popover se cierra sin guardar.
          await quick.popover
            .waitFor({ state: 'visible', timeout: POPOVER_OPEN_TIMEOUT_MS })
            .then(() => quick.cancelButton.click())
            .catch(() => undefined);
          continue;
        }
        evaluatedNv.push(row.id);
        expect(ack.url, `${row.label}: checkPlace con waypoint=true`).toContain('waypoint=true');
        expect(ack.status).toBe(200);
        expectAckAtClick(row.label, row.location, ack);
        expect(ack.body.routable, ackDiag(row.label, row.location, ack)).toBe(false);
        expect(ack.body.reasons).toEqual(['NO_COUNTRY']);
        await seen;
        // Recién con el toast de ESTE click a la vista, el popover (que en el camino positivo tarda en abrir) debe seguir cerrado.
        await expect(quick.popover).toBeHidden();
        expect(posts()).toBe(0);
        await expect(trip.placeChip('origin')).toHaveText(originBefore);
        await expect(trip.placeRow('destination')).toHaveCount(1);
        await expect(trip.placeChip('destination')).toHaveCount(0);
        measured.push(
          `${row.label} (${row.location.lat},${row.location.lng}): checkPlace?waypoint=true routable=false reasons=[${ack.body.reasons.join(',')}]`
        );
      }
      expect(evaluatedNv, 'F5a (mar abierto) se evalúa siempre').toContain('F5a');
      await testInfo.attach('nuevo-viaje-sin-pais', {
        body: await page.screenshot(),
        contentType: 'image/png'
      });
      // Control positivo (X7): un punto válido por el mismo puntero SÍ abre el popover (cierra con Cancelar).
      await expect(quick.swalToasts).toHaveCount(0, { timeout: 15_000 });
      const controlAck = await trip.armPointerAndClick('origin', MIAMI.downtown);
      expect(controlAck.body.routable).toBe(true);
      await expect(quick.popover).toBeVisible({ timeout: POPOVER_OPEN_TIMEOUT_MS });
      await quick.cancelButton.click();
      await quick.expectClosed();
      expect(posts()).toBe(0);

      // Mismas coordenadas en el modal del ABM (pantalla nueva del mismo contexto: el formulario de
      // viaje queda intacto y sin guardas de salida).
      const abmPage = await page.context().newPage();
      const abmCalls = watchWaypointCalls(abmPage);
      const list = new ReferencePointsPage(abmPage);
      const form = new ReferencePointFormModalPage(abmPage);
      const pins = form.map.locator('.leaflet-marker-icon');
      await list.goto();
      const evaluatedAbm: string[] = [];
      for (const row of [
        { id: 'F5a', label: 'F5a mar abierto', location: LOCATIONS.F5a },
        { id: 'F5b', label: 'F5b canal del Paraná', location: LOCATIONS.F5b }
      ] as const) {
        const abmName = uiCreated!.track(nameFor(`sin país ${row.id}`));
        await list.newButton.click();
        await form.expectOpen();
        await expect(list.toast(/\S/)).toHaveCount(0, { timeout: 15_000 });
        // Toast y getPlace del click armados ANTES del click.
        const seen = list
          .toast(INVALID_ADDRESS_TOAST)
          .filter({ hasText: NO_COUNTRY_TOAST })
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        seen.catch(() => undefined);
        const abmAck = await form.placePin(row.location.lat, row.location.lng);
        const place = abmAck.clicked;
        if (row.id === 'F5b' && place.country !== '') {
          // La fila solo se saltea si el getPlace es el del clic pedido (si no, el clic cayó en otro lado).
          expectPlaceAtClick(row.label, row.location, place);
          const note = `F5b: Google informó país «${place.country}» en ${row.location.lat},${row.location.lng}; fila no evaluada en el ABM`;
          testInfo.annotations.push({ type: 'observation', description: note });
          measured.push(note);
          await form.cancel();
          continue;
        }
        evaluatedAbm.push(row.id);
        expect(abmAck.url).toContain('waypoint=true');
        const abmDiag = ackDiag(`ABM ${row.label}`, row.location, abmAck);
        expectAckAtClick(`ABM ${row.label}`, row.location, abmAck);
        expect(abmAck.body.routable, abmDiag).toBe(false);
        expect(abmAck.body.reasons, abmDiag).toEqual(['NO_COUNTRY']);
        await seen;
        // Sin pin en el mapa del modal y sin el aviso de «marcar el punto» antes de Guardar.
        await expect(pins).toHaveCount(0);
        await expect(form.pinRequiredMessage).toHaveCount(0);
        await form.fillName(abmName);
        await form.save();
        await expect(form.pinRequiredMessage).toBeVisible();
        await expect(form.dialog).toBeVisible();
        expect(abmCalls.count('POST'), `${row.label}: 0 POST en el ABM`).toBe(0);
        expect((await waypointsApi.list()).filter((w) => w.name === abmName)).toEqual([]);
        measured.push(
          `ABM ${row.label} (${row.location.lat},${row.location.lng}): mismo rechazo, 0 pines; «Save» sin pin muestra «Mark the point on the map», 0 POST, 0 filas «${abmName}»`
        );
        await form.cancel();
      }
      expect(evaluatedAbm, 'F5a (mar abierto) se evalúa siempre en el ABM').toContain('F5a');

      // Control positivo (X7), independiente de F5b: guardar sin pin muestra el aviso; un punto válido en
      // el mismo mapa se acepta, aparece el pin y se va el aviso.
      const controlName = uiCreated!.track(nameFor('control abm'));
      await list.newButton.click();
      await form.expectOpen();
      await form.fillName(controlName);
      await form.save();
      await expect(form.pinRequiredMessage).toBeVisible();
      const abmControl = await form.placePin(MIAMI.downtown.lat, MIAMI.downtown.lng);
      expect(abmControl.body.routable).toBe(true);
      await expect(pins).toHaveCount(1);
      await expect(form.pinRequiredMessage).toHaveCount(0);
      expect(abmCalls.count('POST')).toBe(0);
      await form.cancel();
      measured.push(
        `Filas evaluadas: Nuevo Viaje [${evaluatedNv.join(',')}], ABM [${evaluatedAbm.join(',')}]; control positivo del ABM: pin válido aceptado`
      );

      await attachXrayEvidence(testInfo, abmPage, {
        name: 'tm1864-abm-pide-marcar-el-punto',
        comment: `Nuevo Viaje (${ENV}): ${measured.join('. ')}. Origen sin cambios («${originBefore}»), 0 POST a waypoint en las dos superficies.`
      });
    });
  });
});
