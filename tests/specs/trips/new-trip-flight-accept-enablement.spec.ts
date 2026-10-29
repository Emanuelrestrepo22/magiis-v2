// tests/specs/trips/new-trip-flight-accept-enablement.spec.ts
// MU-039 - programa de migracion V1->V2: port de la matriz de vuelo asociado de Alta de Viaje
// (V1 TS-MX5824-TC10/TC17) al modal V2 de vuelo. Hallazgos H1-H13 y fuente de selectores:
// docs/qa/migration/units/MU-039-plan.md.
//
// GATE AVIATION: el modo de busqueda por API depende de `flightApiAvailable` (storage
// carrier-50/51), un flag de backend por cuenta. Si el ambiente/cuenta no lo tiene, el modal
// cae a alta manual y el assert de "Search visible" falla con un mensaje claro — no es un
// defecto de producto. Detalle de la cuenta que se probo y su estado:
// docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
//
// Esta unidad NO crea viaje: termina dentro del modal, ningun test pulsa Accept.
// Cobertura parcial declarada (1 de 5 terminos del [disabled] de Accept) y la migracion de
// AIRPORT_QUERY de Miami a Ezeiza: ver IMPLEMENTATION-NOTES.md.
import { test, expect, attachXrayEvidence } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

// Tests de Xray (proyecto TM) creados 2026-09-03 bajo la story MG-19, parent epic TM-20.
const TM_TC01 = 'TM-843';
const TM_TC02 = 'TM-844';

/** Texto de busqueda de cliente. Mismo patron que new-trip.spec.ts. */
const CLIENT_QUERY = process.env.MG19_CLIENT_QUERY ?? 'test';
/** Aeropuerto del primer destino. Por que 'Ezeiza' y no Miami: IMPLEMENTATION-NOTES.md. */
const AIRPORT_QUERY = process.env.MG19_AIRPORT_QUERY ?? 'Ezeiza';
/** Patron para filtrar la sugerencia real del aeropuerto entre las opciones de Places. */
const AIRPORT_OPTION = new RegExp(
  process.env.MG19_AIRPORT_OPTION ?? 'Ezeiza|Ministro Pistarini',
  'i'
);
/** Aerolinea del typeahead del modal de vuelo. Texto real de la opcion: "Aerolineas Argentinas". */
const AIRLINE_QUERY = process.env.MG19_AIRLINE_QUERY ?? 'Argentinas';
/** Numero de vuelo que no matchea ningun resultado real (V1 flight-data.ts:26). */
const MISSING_FLIGHT_NUMBER = process.env.MG19_MISSING_FLIGHT_NUMBER ?? '00000';

test.describe('@P2 @functional @migration MG-19 Alta de viaje - vuelo asociado', () => {
  // Modal de vuelo golpea AeroAPI (FlightAware) via getFlights: latencia cubierta por el
  // timeout de 45_000 en waitForResponse() (searchFlights()), no por retries.
  // El flujo encadena cliente + Places + modal + busqueda AeroAPI (hasta 45_000 en solo esa
  // espera): el timeout por defecto de 60_000 no alcanza el presupuesto del propio caso. Medido
  // 2026-09-30: TC01 agoto los 60_000 sin retries (docs/analysis/migration-evidence/
  // TM-1146-TM-843-run3-2026-09-30.error-context.md).
  test.describe.configure({ timeout: 120_000 });

  test('TC01 "Aceptar" arranca deshabilitado y se habilita con un vuelo de la API', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC01, ROUTE)('TC01', 'EC');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillFirstDestinationMatching(AIRPORT_QUERY, AIRPORT_OPTION);
    await p.openFlightModalFromDestination();

    await expect(p.flightModalTitle).toHaveText(/flight information|informaci[oó]n de vuelo/i);
    await expect(
      p.flightSearchButton,
      'el gate AVIATION debe ofrecer busqueda por API'
    ).toBeVisible();
    await expect(p.flightAcceptButton).toBeVisible();
    await expect(p.flightAcceptButton).toBeDisabled();

    await p.selectFlightAirline(AIRLINE_QUERY);
    // Eje aislado (H2): elegir aerolinea habilita Search pero Accept sigue exigiendo un vuelo.
    await expect(p.flightAcceptButton).toBeDisabled();

    const searchResponse = await p.searchFlights();
    expect(searchResponse.status(), 'getFlights debe responder 200').toBe(200);
    await expect(
      p.flightResultCards,
      'la busqueda debe devolver al menos un resultado real'
    ).not.toHaveCount(0);

    // searchFlights() auto-selecciona el primer resultado (H5): Accept se habilita sin click.
    await expect(p.flightSelectedCard).toHaveCount(1);
    await expect(p.flightAcceptButton).toBeEnabled();

    // H6: onFlightClick es toggle. Oraculo disabled -> enabled -> disabled -> enabled.
    await p.flightSelectedCard.click();
    await expect(p.flightSelectedCard).toHaveCount(0);
    await expect(p.flightAcceptButton).toBeDisabled();

    await p.toggleFlightResult(0);
    await expect(p.flightSelectedCard).toHaveCount(1);
    await expect(p.flightAcceptButton).toBeEnabled();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'aceptar-vuelo-habilitacion',
      comment: `Medido: modal de vuelo con Aceptar deshabilitado al abrir; tras elegir aerolínea «${AIRLINE_QUERY}» seguía deshabilitado; getFlights respondió ${searchResponse.status()} con resultados y el primero quedó auto-seleccionado con Aceptar habilitado; al deseleccionarlo se deshabilitó y al reseleccionarlo se habilitó.`
    });
  });

  test('TC02 Buscar un vuelo sin resultados ofrece el ingreso manual', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC02, ROUTE)('TC02', 'NEG');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillFirstDestinationMatching(AIRPORT_QUERY, AIRPORT_OPTION);
    await p.openFlightModalFromDestination();

    await p.selectFlightAirline(AIRLINE_QUERY);

    const searchResponse = await p.searchFlights(MISSING_FLIGHT_NUMBER);
    // H9: withoutResult se prende tanto con 200 [] como con error HTTP. El caso exige
    // distinguir "no hay vuelos" de "la API fallo".
    expect(
      searchResponse.status(),
      'getFlights debe responder 200 (sin resultados, no un error)'
    ).toBe(200);

    await expect(p.flightNoResultsMessage).toBeVisible();
    await expect(p.flightManualInputButton).toBeVisible();
    await expect(p.flightManualInputButton).toBeEnabled();
    // control positivo del mismo locator en TC01 (cards >= 1)
    await expect(p.flightResultCards).toHaveCount(0);
    await expect(p.flightAcceptButton).toBeDisabled();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'vuelo-sin-resultados-ingreso-manual',
      comment: `Medido: búsqueda con aerolínea «${AIRLINE_QUERY}» y vuelo ${MISSING_FLIGHT_NUMBER}: getFlights respondió ${searchResponse.status()}, se mostró el mensaje de sin resultados, 0 tarjetas, botón de ingreso manual visible y habilitado y Aceptar deshabilitado.`
    });
  });
});
