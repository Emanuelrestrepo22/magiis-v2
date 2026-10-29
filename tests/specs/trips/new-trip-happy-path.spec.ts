// tests/specs/trips/new-trip-happy-path.spec.ts
// Alta de viaje de punta a punta: Nuevo Viaje -> Enviar Servicio -> verificacion en Trips
// Management. Es el unico test de MG-19 que CREA un viaje real.
//
// TRAZABILIDAD: TM-538 / TC37. Toca de paso, sin cobertura dedicada, TC198/TC199 (tarjetas de
// precio por vehiculo) y TC210 (cascada del cliente, ya cubierto en new-trip.spec.ts).
//
// Politica G5: el test limpia lo que crea. Marca al pasajero invitado con prefijo `qa_e2e_` y,
// en el afterEach, cancela el viaje por UI desde Trips Management (no hay endpoint de limpieza).
// Si la cancelacion falla el test falla y adjunta el id para limpieza manual.
import { test, expect } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { TravelDashboardPage } from '../../pages/carrier-v2/trips/TravelDashboardPage.js';
import { makeAnnotate } from '../../utils/traceability.js';
import tripData from '../../data/carrier-v2/trips/new-trip-happy-path.json' with { type: 'json' };

const ROUTE = '/carrier/#/travel/create';
const TM_TC37 = 'TM-538';

test.describe('@functional @e2e @MG-19 Nuevo Viaje - alta de viaje end to end', () => {
  // Google Places + cálculo de tarifas dependen de servicios externos, y el afterEach cancela
  // el viaje por UI: 180 s cubre alta + verificación + limpieza.
  test.describe.configure({ timeout: 180_000 });

  // Estado de limpieza G5: se registra en cuanto el viaje existe.
  let created: { travelId: string; paxName: string; precio: string } | null = null;

  test.beforeEach(() => {
    created = null;
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (!created) return;
    const { travelId, paxName, precio } = created;
    const dashboard = new TravelDashboardPage(page);
    await dashboard.goto();
    await dashboard.selectTab('assign');
    const cancelled = await dashboard.cancelTripByPassenger(paxName, 'qa_e2e_cleanup');
    testInfo.annotations.push({
      type: 'xray_comment',
      description: `Medido: viaje ${travelId} creado con pasajero invitado ${paxName}; precio del vehículo ${precio}; listado en Assign. Limpieza G5: cancelación por UI ${cancelled ? 'exitosa (la fila desaparece de Assign)' : 'FALLIDA'}.`
    });
    if (!cancelled) {
      await testInfo.attach('g5-cleanup-failure', {
        body: JSON.stringify({ travelId, paxName, motive: 'qa_e2e_cleanup' }),
        contentType: 'application/json'
      });
    }
    expect(cancelled, `G5: cancelación fallida — viaje ${travelId} requiere limpieza manual`).toBe(
      true
    );
  });

  test('TC37 Crea el viaje con Enviar Servicio y lo deja listado para asignar', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC37, ROUTE)('TC37', 'HP');

    const newTrip = new NewTripPage(page);
    const tripsManagement = new TravelDashboardPage(page);

    // --- Completar el formulario ---
    // Nuevo Viaje va PRIMERO, sobre un boot limpio de la SPA: pasar por Trips Management y
    // navegar por hash da falso positivo en el gate anti-iframe de goto(). Medido en vivo
    // 2026-09-03, detalle en docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
    await newTrip.goto();
    await newTrip.selectClient(tripData.customer.search);

    // Pasajero invitado marcado `qa_e2e_`: identifica la fila propia en la grilla y permite
    // cancelarla sin tocar viajes ajenos (política G5).
    const paxName = `qa_e2e_${Date.now()}-${testInfo.workerIndex}`;
    await newTrip.guestPassengerCheck.check();
    await newTrip.guestPassengerName.fill(paxName);

    // La cascada del cliente autocompleta Pick-Up con la direccion registrada del pasajero:
    // el test NO la escribe, la verifica. toContainText (no toHaveText): el chip .ng-value
    // incluye el icono "x" de limpiar antes del texto.
    await expect(newTrip.resolvedOriginValue).toContainText(tripData.expectedOrigin.address);
    expect(await newTrip.selectedServiceType()).toMatch(/regular/i);

    await newTrip.fillFirstDestinationMatching(
      tripData.destination.search,
      new RegExp(tripData.destination.optionPattern, 'i')
    );
    await expect(newTrip.resolvedDestinationValue).toContainText(tripData.destination.option);

    // --- Cotizar: calcula ruta y tarifas, y habilita el envio ---
    await newTrip.quoteTrip();

    await expect(newTrip.vehicleTypesHeading).toBeVisible();
    await expect(newTrip.selectedVehicleName).toHaveText(tripData.expectedVehicleType);

    // Sin otros costos, el total del viaje es el precio del vehiculo elegido.
    const precioVehiculo = (await newTrip.selectedVehiclePrice.innerText()).trim();
    expect(precioVehiculo).not.toBe('$ 0.00');
    await expect(newTrip.amount(/trip total|total del viaje/i)).toHaveText(precioVehiculo);

    // --- Enviar el servicio ---
    // El id se lee de la respuesta del alta: sin INSTANT_ASSIGNMENT la app navega a la grilla sin id en la URL.
    const { travelId } = await newTrip.submitAndCaptureCreate();
    expect(travelId).toMatch(/^\d+$/);
    created = { travelId, paxName, precio: precioVehiculo };

    // --- Verificar en Trips Management ---
    await tripsManagement.goto();
    await tripsManagement.selectTab('assign');

    // El travelId de la URL ya prueba que el POST creo el viaje; aca se verifica que quede
    // LISTADO para asignar. No se compara un delta del contador del tab: la assertion de la
    // fila auto-espera a que la grilla cargue, sin la fragilidad de leer un contador async.
    // Detalle: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
    const fila = tripsManagement.rowByTrip({
      passenger: paxName,
      origin: tripData.expectedOrigin.address.split(',')[0],
      // La grilla recorta el destino a «calle, CP localidad» (sin provincia ni pais).
      destination: tripData.destination.option.split(',').slice(0, 2).join(',')
    });
    await expect(fila.first()).toBeVisible();

    await testInfo.attach('fila-viaje-creado', {
      // Captura de la pantalla, no del elemento: la grilla se refresca sola y desmonta la fila.
      body: await page.screenshot(),
      contentType: 'image/png'
    });
  });
});
