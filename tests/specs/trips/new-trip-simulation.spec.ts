// tests/specs/trips/new-trip-simulation.spec.ts
// Nucleo de simulacion de Alta de Viaje (AC3) — grupo 7 del orden de criticidad del ATR TM-830.
// Cotiza de verdad (llama al tarifador) pero NO crea ningun viaje: termina antes del envio.
//
// TRAZABILIDAD: TC199 / TM-772.
// TC198 (TM-771) y TC200 (TM-773) NO se automatizaron: se midio que en este ambiente no son
// aseverables sin escribir un assert que pase por la razon equivocada. Detalle de la medicion:
// docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
//
// DATO: reusa el fixture determinista del happy path. El destino tiene que ser una direccion
// ENRUTABLE — con una sugerencia cualquiera de Places el cotizador aborta con "Check the route"
// (medido 2026-09-09, ver IMPLEMENTATION-NOTES.md).
import { test, expect } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';
import tripData from '../../data/carrier-v2/trips/new-trip-happy-path.json' with { type: 'json' };

const ROUTE = '/carrier/#/travel/create';
const TM_TC199 = 'TM-772';

const CLIENT_QUERY = process.env.MG19_CLIENT_QUERY ?? tripData.customer.search;

test.describe('@P1 @functional @MG-19 Nuevo Viaje - simulacion y totales', () => {
  // Cotizar depende de Places + Directions + el tarifador del backend: latencia variable.
  test.describe.configure({ timeout: 180_000 });

  test('TC199 Con un tipo de vehiculo elegido se muestran los totales y se habilita el envio', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC199, ROUTE)('TC199', 'HP');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillFirstDestinationMatching(
      tripData.destination.search,
      new RegExp(tripData.destination.optionPattern, 'i')
    );
    await expect(p.resolvedDestinationValue).toHaveCount(1);

    // PRECONDICION, aseverada para que el test no sea vacuo: antes de cotizar no hay ni cards de
    // vehiculo ni boton de envio. Sin este par de control, "aparecen" no probaria nada.
    // NO se asevera que el bloque de totales este ausente: SI esta, y muestra "Trip Total $ NaN"
    // (defecto candidato medido el 2026-09-09, ver IMPLEMENTATION-NOTES.md).
    await expect(p.vehicleCards).toHaveCount(0);
    await expect(p.submitButton).toHaveCount(0);

    await p.quoteTrip();

    // La pantalla preselecciona un tipo de vehiculo: el caso arranca con uno ya elegido.
    await expect(p.vehicleCards).not.toHaveCount(0);
    await expect(p.selectedVehicleCard).toBeVisible();
    await expect(p.selectedVehicleName).not.toBeEmpty();

    // Los totales: importe del vehiculo, subtotal, otros costos y total del viaje.
    const precioVehiculo = (await p.selectedVehiclePrice.innerText()).trim();
    expect(precioVehiculo, 'el tarifador debe devolver un importe, no cero').not.toMatch(
      /^\$\s*0\.00$/
    );
    // Ademas de cuadrar, el total tiene que ser un IMPORTE: pre-cotizacion la pantalla pinta
    // "$ NaN" ahi, asi que un assert que solo mirara "hay algo" pasaria con el NaN puesto.
    const totalViaje = p.amount(/trip total|total del viaje/i);
    await expect(totalViaje, 'el total no puede quedar en NaN').not.toContainText('NaN');
    // El patron va SIN anclar: `hasText` compara contra el texto completo del bloque, que es
    // "Subtotal $ 681.00" — un /^subtotal$/ no matchea nada.
    await expect(p.amount(/subtotal/i)).toHaveText(precioVehiculo);
    // "Other Costs" NO se asevera aca: existe en la pantalla pero vive fuera de los bloques
    // `.bg-light.rounded` que lee `amount()`, asi que pide un locator propio. Es el oraculo de
    // TC231, no de este caso.
    // Sin propina ni otros costos cargados, el total del viaje ES el precio del vehiculo.
    await expect(totalViaje).toHaveText(precioVehiculo);

    // Y se habilita el envio.
    await expect(p.submitButton).toBeVisible();
    await expect(p.submitButton).toBeEnabled();

    // Evidencia publicable (evidence-conventions §4): captura de la pantalla cotizada + medicion.
    await testInfo.attach('cotizacion-totales', {
      body: await page.screenshot(),
      contentType: 'image/png'
    });
    testInfo.annotations.push({
      type: 'xray_comment',
      description: `Medido: con el vehículo preseleccionado el tarifador devolvió ${precioVehiculo}; subtotal y total del viaje coinciden con ese importe (sin NaN) y «Send Service» quedó habilitado. No se creó ningún viaje.`
    });
  });
});
