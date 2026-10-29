// tests/specs/trips/new-trip-route-flags.spec.ts
// MG-682: "normalizacion ya vigente" en el body de `travels/simulateAll` que arma la pantalla
// Nuevo Viaje. Cada test protege que la pantalla siga enviando los tres flags de ruta
// (avoidTolls/avoidHighways/fastestRoute) como booleano explicito, nunca ausente/string/null,
// sea que el operador los deje en su valor por defecto (parametro del carrier) o los alterne
// manualmente -- Y que el POST de alta del viaje (`POST /carriers/:id/travels`, ver
// new-trip-happy-path.spec.ts) los reciba con el MISMO valor que se cotizo, no un valor
// recalculado o perdido entre simulateAll y el alta. No reproduce el defecto de TC02/TC04/TC24
// (ese vive en el endpoint de edicion de destino frecuente, no en Nuevo Viaje).
//
// TC16 (TM-945, cobertura de persistencia en TRAVEL/MAGIIS_ROUTES) vive en `magiis-api-e2e` --
// V2 no tiene acceso a DB. Cada test de aca es su propio caso Xray, con su propia trazabilidad.
//
// Apagado por defecto (MG682_CREATE_TRIP): igual que new-trip-happy-path.spec.ts, cada corrida
// crea un viaje real en estado SEARCHING_DRIVER que el afterEach cancela por API
// (TravelsClient). Variable propia, independiente de la familia `trips` (cuyo gate MG19_CREATE_TRIP fue retirado el 2026-09-30).
import { test, expect } from '../../fixtures/carrierApiFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { TravelsClient } from '../../api/clients/travels.client.js';
import {
  cancelCreatedTrip,
  recordCreatedTrip,
  sweepMg682Trips
} from '../../helpers/trip-cleanup.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { TravelDashboardPage } from '../../pages/carrier-v2/trips/TravelDashboardPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

// Mismos datos de la suite smoke MG-19 (new-trip.spec.ts): reusa el par cliente/origen/destino
// ya validado, no genera uno nuevo para este ATC.
const CLIENT_QUERY = process.env.MG19_CLIENT_QUERY ?? 'test';
const ORIGIN_QUERY = process.env.MG19_ORIGIN_QUERY ?? 'John Glenn Columbus International Airport';
const DESTINATION_QUERY = process.env.MG19_DESTINATION_QUERY ?? 'Columbus, OH';

test.describe('@functional @e2e MG-682 Nuevo Viaje - flags de ruta en simulateAll y en el alta', () => {
  // Crea datos: solo corre cuando se pide explicitamente (ver nota de cabecera).
  test.skip(
    !process.env.MG682_CREATE_TRIP,
    'crea un viaje real en el entorno; correr con MG682_CREATE_TRIP=1'
  );

  // Google Places + calculo de tarifas dependen de servicios externos (mismo timeout que
  // new-trip-happy-path.spec.ts).
  test.describe.configure({ timeout: 180_000 });

  // Viaje creado por el test en curso (los tests del describe corren en serie dentro del worker).
  let createdTravelId: number | undefined;

  // Barrido de viajes anotados por corridas previas de estos specs (solo los del registro MG-682).
  test.beforeAll(async ({ carrierApi, carrierSession }) => {
    await sweepMg682Trips(new TravelsClient(carrierApi, carrierSession));
  });

  test.beforeEach(() => {
    createdTravelId = undefined;
  });

  test.afterEach(async ({ playwright }, testInfo) => {
    await cancelCreatedTrip({
      playwright,
      travelId: createdTravelId,
      testInfo,
      logTag: 'MG-682'
    });
  });

  test('TM-1139: debería mantener sin cambios la normalización ya vigente al enviar simulateAll y el alta del viaje desde Nuevo Viaje, con los flags por defecto', async ({
    page
  }, testInfo) => {
    makeAnnotate('TM-1139', ROUTE)('TC26', 'HP');
    const p = new NewTripPage(page);
    const tripsManagement = new TravelDashboardPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillOrigin(ORIGIN_QUERY);
    await p.fillFirstDestination(DESTINATION_QUERY);

    const togglesAntes = await p.readRouteToggles();
    const simulateAllBody = await p.selectVehicleAndCaptureSimulateAllBody();

    for (const flag of ['avoidTolls', 'avoidHighways', 'fastestRoute'] as const) {
      expect(
        typeof simulateAllBody[flag],
        `el flag ${flag} debe llegar como booleano explicito`
      ).toBe('boolean');
      expect(
        simulateAllBody[flag],
        `el flag ${flag} del body de simulateAll debe coincidir con el toggle leido antes del click`
      ).toBe(togglesAntes[flag]);
    }

    // --- Enviar el servicio, capturando el body del POST de alta en paralelo ---
    await expect(p.selectedVehicleCard).toBeVisible({ timeout: 45_000 });
    await expect(p.submitButton).toBeVisible({ timeout: 45_000 });

    const { body: createBody, travelId } = await p.submitAndCaptureCreate();
    expect(travelId).toMatch(/^\d+$/);
    createdTravelId = Number(travelId);
    recordCreatedTrip(createdTravelId, 'MG-682', testInfo);

    for (const flag of ['avoidTolls', 'avoidHighways', 'fastestRoute'] as const) {
      expect(
        typeof createBody[flag],
        `el flag ${flag} del alta debe llegar como booleano explicito`
      ).toBe('boolean');
      expect(
        createBody[flag],
        `el flag ${flag} del POST de alta debe coincidir con el mismo flag cotizado en simulateAll`
      ).toBe(simulateAllBody[flag]);
    }

    // --- Verificar en Trips Management que el viaje quedo listado para asignar ---
    await tripsManagement.goto();
    await tripsManagement.selectTab('assign');
    const fila = tripsManagement.rowByTrip({
      passenger: CLIENT_QUERY,
      origin: ORIGIN_QUERY.split(',')[0],
      destination: DESTINATION_QUERY.split(',')[0]
    });
    await expect(fila.first()).toBeVisible();

    await attachXrayEvidence(testInfo, page, {
      name: 'flags-simulateall-y-alta',
      comment: `Medido: toggles antes de cotizar ${JSON.stringify(togglesAntes)}; simulateAll envió avoidTolls=${simulateAllBody.avoidTolls}, avoidHighways=${simulateAllBody.avoidHighways}, fastestRoute=${simulateAllBody.fastestRoute}; el alta (travelId=${travelId}) envió avoidTolls=${createBody.avoidTolls}, avoidHighways=${createBody.avoidHighways}, fastestRoute=${createBody.fastestRoute}. El viaje figura en la pestaña de asignación.`
    });
  });

  test('TM-1140: debería reflejar en simulateAll y en el alta del viaje el toggle fastestRoute alternado manualmente', async ({
    page
  }, testInfo) => {
    makeAnnotate('TM-1140', ROUTE)('TC27', 'EC');
    const p = new NewTripPage(page);
    const tripsManagement = new TravelDashboardPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillOrigin(ORIGIN_QUERY);
    await p.fillFirstDestination(DESTINATION_QUERY);

    const antes = (await p.readRouteToggles()).fastestRoute;
    await p.setRouteToggle('fastestRoute', !antes);

    const simulateAllBody = await p.selectVehicleAndCaptureSimulateAllBody();

    expect(
      typeof simulateAllBody.fastestRoute,
      'fastestRoute debe llegar como booleano explicito en simulateAll'
    ).toBe('boolean');
    expect(
      simulateAllBody.fastestRoute,
      'el toggle alternado manualmente debe reflejarse tal cual en el body de simulateAll'
    ).toBe(!antes);

    // --- Enviar el servicio, capturando el body del POST de alta en paralelo ---
    await expect(p.selectedVehicleCard).toBeVisible({ timeout: 45_000 });
    await expect(p.submitButton).toBeVisible({ timeout: 45_000 });

    const { body: createBody, travelId } = await p.submitAndCaptureCreate();
    expect(travelId).toMatch(/^\d+$/);
    createdTravelId = Number(travelId);
    recordCreatedTrip(createdTravelId, 'MG-682', testInfo);

    expect(
      typeof createBody.fastestRoute,
      'fastestRoute del alta debe llegar como booleano explicito'
    ).toBe('boolean');
    expect(
      createBody.fastestRoute,
      'el fastestRoute del POST de alta debe coincidir con el mismo flag cotizado en simulateAll'
    ).toBe(simulateAllBody.fastestRoute);

    // --- Verificar en Trips Management que el viaje quedo listado para asignar ---
    await tripsManagement.goto();
    await tripsManagement.selectTab('assign');
    const fila = tripsManagement.rowByTrip({
      passenger: CLIENT_QUERY,
      origin: ORIGIN_QUERY.split(',')[0],
      destination: DESTINATION_QUERY.split(',')[0]
    });
    await expect(fila.first()).toBeVisible();

    await attachXrayEvidence(testInfo, page, {
      name: 'fastestroute-alternado-simulateall-y-alta',
      comment: `Medido: fastestRoute por defecto=${antes}, alternado manualmente a ${!antes}; simulateAll envió fastestRoute=${simulateAllBody.fastestRoute}; el alta (travelId=${travelId}) envió fastestRoute=${createBody.fastestRoute}. El viaje figura en la pestaña de asignación.`
    });
  });
});
