// tests/specs/trips/new-trip-frequent-destination.spec.ts
// MG-682: auto-deteccion de destino frecuente en Nuevo Viaje. `checkSavedFrequentAddresses()`
// (new-trip.component.ts) matchea la regla del carrier contra el par origen/destino cargado, primero
// por `placeId` EXACTO y, si no hay match exacto, por RADIO (`selectFrequentRuleByRadius`). En
// cualquiera de los dos caminos la regla PRECARGA sus tres flags de ruta (avoidTolls/avoidHighways/
// fastestRoute) sobre el formulario, editables despues por el operador (`applyFrequentRuleState`).
// Sin match, ningun flag se toca: quedan en lo que ya hubiera en pantalla — el parametro del
// carrier, si el operador no los toco. Cada test cotiza, envia el servicio y verifica que el POST
// de alta (`POST /carriers/:id/travels`, ver new-trip-happy-path.spec.ts) reciba los mismos tres
// flags que quedaron precargados/preservados en pantalla -- que lo que muestra la pantalla sea lo
// que se guarda.
//
// No usa el modal de seleccion manual (`openFrequentDestinationsModal`) para producir el match: la
// deteccion es automatica al tipear las direcciones (no pasa por el modal). El modal se abre solo
// para CONFIRMAR que la regla ya existe y es visible al operador antes de tipear.
//
// Fixture real de datos, no inventado: `FREQUENTDESTINATION.ID=21070`
// ("QA-MG682-R4-N1-TC01", carrier 1521, rate "Base"=2261 -- el rate por defecto de practicamente
// todo pasajero de prueba de este carrier, confirmado por consulta a la base de TEST 2026-09-08).
// Radios de 0.48 km en los dos extremos, avoidTolls=false / avoidHighways=false / fastestRoute=true.
//
// TC16 (TM-945, cobertura de persistencia en TRAVEL/MAGIIS_ROUTES) vive en `magiis-api-e2e` -- V2
// no tiene acceso a DB. Cada test de aca es su propio caso Xray, con su propia trazabilidad.
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
import type { Page, TestInfo } from '@playwright/test';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { TravelDashboardPage } from '../../pages/carrier-v2/trips/TravelDashboardPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

/**
 * Cotiza, envia el servicio y verifica que el POST de alta reciba los mismos flags de ruta que
 * ya estaban en pantalla al momento de cotizar. Reusa quoteTrip()/submitAndCaptureCreate() de
 * NewTripPage (no sendService(): ver la nota de ese metodo sobre por que este flujo no navega
 * a la pantalla de asignacion con el carrier 1521); solo agrega la captura del body del alta.
 */
async function enviarYVerificarFlagsEnAlta({
  page,
  testInfo,
  onCreated,
  p,
  tripsManagement,
  expectedFlags,
  datosFila,
  logTag
}: {
  page: Page;
  testInfo: TestInfo;
  onCreated: (travelId: number) => void;
  p: NewTripPage;
  tripsManagement: TravelDashboardPage;
  expectedFlags: { avoidTolls: boolean; avoidHighways: boolean; fastestRoute: boolean };
  datosFila: { passenger: string; origin: string; destination: string };
  logTag: string;
}): Promise<void> {
  await p.quoteTrip();

  const { body: createBody, travelId } = await p.submitAndCaptureCreate();
  expect(travelId).toMatch(/^\d+$/);
  onCreated(Number(travelId));

  for (const flag of ['avoidTolls', 'avoidHighways', 'fastestRoute'] as const) {
    expect(
      typeof createBody[flag],
      `el flag ${flag} del alta debe llegar como booleano explicito`
    ).toBe('boolean');
    expect(
      createBody[flag],
      `el flag ${flag} del POST de alta debe coincidir con el mismo flag que quedo en pantalla al cotizar`
    ).toBe(expectedFlags[flag]);
  }

  await tripsManagement.goto();
  await tripsManagement.selectTab('assign');
  const fila = tripsManagement.rowByTrip(datosFila);
  await expect(fila.first()).toBeVisible();

  await attachXrayEvidence(testInfo, page, {
    name: 'flags-precargados-y-alta',
    comment: `Medido (${logTag}): flags en pantalla al cotizar ${JSON.stringify(expectedFlags)}; el alta (travelId=${travelId}) envió avoidTolls=${createBody.avoidTolls}, avoidHighways=${createBody.avoidHighways}, fastestRoute=${createBody.fastestRoute}. El viaje figura en la pestaña de asignación.`
  });
}

// Cliente puntual, no el generico 'test' de los otros specs: necesitamos uno con la tarifa
// "Base" (id 2261) asignada -- la unica que trae enlazada la regla fixture QA-MG682-R4-N1-TC01
// (confirmado por consulta a la base de TEST 2026-09-08: `getDestinationByPass` filtra por la
// tarifa efectiva del pasajero, no por el carrier a secas -- con 'test' el modal daba "Empty list").
const CLIENT_QUERY = process.env.MG682_FREQ_CLIENT_QUERY ?? 'Stripe, Cliente';

// Regla QA-MG682-R4-N1-TC01 (FREQUENTDESTINATION.ID=21070): los dos radios son 0.48 km.
const RULE_ORIGIN_EXACT = '100 N 31st Ave, Hollywood, FL 33021, USA';
const RULE_DESTINATION_EXACT = '10101 Collins Ave, Bal Harbour, FL 33154, USA';
const RULE_EXPECTED_FLAGS = {
  avoidTolls: false,
  avoidHighways: false,
  fastestRoute: true
} as const;

// Mismo par, un par de cuadras mas cerca (< 0.48 km): sigue cayendo dentro de los dos circulos.
const NEARBY_ORIGIN = '200 N 31st Ave, Hollywood, FL 33021, USA';
const NEARBY_DESTINATION = '9900 Collins Ave, Bal Harbour, FL 33154, USA';

// Muy lejos de los dos circulos (> 20 km): ninguna distancia entra en el radio de la regla.
const FAR_ORIGIN = '500 Ocean Dr, Miami Beach, FL 33139, USA';
const FAR_DESTINATION = '1601 Biscayne Blvd, Miami, FL 33132, USA';

test.describe('@functional @e2e MG-682 Nuevo Viaje - deteccion de destino frecuente', () => {
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

  test('TM-1141: debería precargar los flags de la regla y reflejarlos en el alta del viaje cuando origen y destino coinciden exactamente con un destino frecuente', async ({
    page
  }, testInfo) => {
    makeAnnotate('TM-1141', ROUTE)('TC28', 'HP');
    const p = new NewTripPage(page);
    const tripsManagement = new TravelDashboardPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    // Confirma que la regla existe y es visible para el operador antes de tipear las
    // direcciones -- no se usa para producir el match (eso es automatico al tipear).
    // `destinationsCollection` llega por un request en vuelo disparado al elegir cliente
    // (`frequentDestinationsLoad`, new-trip.component.ts:2916) y el modal SNAPSHOTEA esa
    // coleccion al abrirse -- si el fetch todavia no resolvio, el modal abre en "Empty list"
    // y no se reactualiza solo (medido en vivo 2026-09-08 bajo carga concurrente). Se
    // reintenta cerrando y reabriendo en vez de esperar una URL de red: el backend expone
    // esto como comando RPC generico, sin un path propio que filtrar con `waitForResponse`.
    let ruleVisibleInModal = false;
    for (let attempt = 0; attempt < 5 && !ruleVisibleInModal; attempt++) {
      const modal = await p.openFrequentDestinationsModal();
      ruleVisibleInModal =
        (await modal.rows.filter({ hasText: 'QA-MG682-R4-N1-TC01' }).count()) > 0;
      await modal.cancelButton.click();
      await expect(modal.filterInput, 'el modal debe cerrarse antes de reintentar').toBeHidden({
        timeout: 5_000
      });
    }
    expect(
      ruleVisibleInModal,
      'la regla fixture debe estar disponible en el modal de destinos frecuentes'
    ).toBe(true);

    await p.fillOrigin(RULE_ORIGIN_EXACT);
    await p.fillFirstDestination(RULE_DESTINATION_EXACT);

    const toggles = await p.readRouteToggles();
    expect(toggles, 'match exacto: la regla debe precargar sus tres flags de ruta').toEqual(
      RULE_EXPECTED_FLAGS
    );

    await enviarYVerificarFlagsEnAlta({
      page,
      testInfo,
      onCreated: (id) => {
        createdTravelId = id;
        recordCreatedTrip(id, 'MG-682', testInfo);
      },
      p,
      tripsManagement,
      expectedFlags: RULE_EXPECTED_FLAGS,
      datosFila: {
        passenger: CLIENT_QUERY.split(',')[0],
        origin: RULE_ORIGIN_EXACT.split(',')[0],
        destination: RULE_DESTINATION_EXACT.split(',')[0]
      },
      logTag: 'TM-1141'
    });
  });

  test('TM-1142: debería precargar los flags de la regla y reflejarlos en el alta del viaje cuando origen y destino caen dentro del radio, sin coincidir exactamente', async ({
    page
  }, testInfo) => {
    makeAnnotate('TM-1142', ROUTE)('TC29', 'EC');
    const p = new NewTripPage(page);
    const tripsManagement = new TravelDashboardPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.fillOrigin(NEARBY_ORIGIN);
    await p.fillFirstDestination(NEARBY_DESTINATION);

    const toggles = await p.readRouteToggles();
    expect(
      toggles,
      'match por radio: la regla debe precargar los mismos tres flags que el match exacto'
    ).toEqual(RULE_EXPECTED_FLAGS);

    await enviarYVerificarFlagsEnAlta({
      page,
      testInfo,
      onCreated: (id) => {
        createdTravelId = id;
        recordCreatedTrip(id, 'MG-682', testInfo);
      },
      p,
      tripsManagement,
      expectedFlags: RULE_EXPECTED_FLAGS,
      datosFila: {
        passenger: CLIENT_QUERY.split(',')[0],
        origin: NEARBY_ORIGIN.split(',')[0],
        destination: NEARBY_DESTINATION.split(',')[0]
      },
      logTag: 'TM-1142'
    });
  });

  test('TM-1143: debería dejar los flags en el parámetro del carrier y reflejarlos así en el alta del viaje cuando origen y destino quedan fuera del radio de todo destino frecuente', async ({
    page
  }, testInfo) => {
    makeAnnotate('TM-1143', ROUTE)('TC30', 'EC');
    const p = new NewTripPage(page);
    const tripsManagement = new TravelDashboardPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    // Parametro del carrier: lo que ya muestra el formulario apenas se elige el cliente,
    // antes de tocar ninguna direccion -- ningun destino frecuente pudo haberlo tocado todavia.
    const parametroCarrier = await p.readRouteToggles();

    await p.fillOrigin(FAR_ORIGIN);
    await p.fillFirstDestination(FAR_DESTINATION);

    const toggles = await p.readRouteToggles();
    expect(toggles, 'sin match, los flags no deben moverse del parametro del carrier').toEqual(
      parametroCarrier
    );

    await enviarYVerificarFlagsEnAlta({
      page,
      testInfo,
      onCreated: (id) => {
        createdTravelId = id;
        recordCreatedTrip(id, 'MG-682', testInfo);
      },
      p,
      tripsManagement,
      expectedFlags: parametroCarrier,
      datosFila: {
        passenger: CLIENT_QUERY.split(',')[0],
        origin: FAR_ORIGIN.split(',')[0],
        destination: FAR_DESTINATION.split(',')[0]
      },
      logTag: 'TM-1143'
    });
  });
});
