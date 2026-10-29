// tests/specs/trips/new-trip-open-destination.spec.ts
// MG-19: segunda ronda de automatizacion de "Destino Abierto" en Nuevo Viaje. La primera ronda
// (new-trip.spec.ts) ya cubre TC161/164/167/168 (TM-602/605/608/609): switch deshabilitado sin
// cliente, ocultar+etiquetar el destino, bloquear cotizacion sin destino y habilitarla con solo
// origen. Esta suite cierra el resto del corpus TS-ALTAVIAJE de la matriz QA (TM-602..TM-616,
// 15 TCs totales) que es capa UI pura o UI con verificacion de API embebida — ver la nota de
// exclusiones al final del archivo para lo que quedo afuera y por que.
//
// FUENTE: mismo criterio de new-trip.spec.ts — selectores derivados del fuente real de la V2
// DESPLEGADA (release v2.0.13, origin/main de gitlab.com/repo.magiis/magiis-fe-carrier-v2, leido
// 2026-09-09). new-trip.component.ts:171-290 documenta el modelo completo de Destino Abierto:
// `canUseOpenDestination` (courier/one-shot no aplican), `toggleOpenDestination()` (limpia
// paradas + ida-y-vuelta + descarta cotizacion vigente), `showsTheoreticalDistance` (parametros
// del carrier). El propio front tiene unit tests dedicados
// (new-trip.component.ts junto a new-trip.open-destination.spec.ts en el repo fuente) que
// ejercitan la MISMA logica a nivel de componente Angular — esta suite la ejercita a nivel de
// pantalla real, que es la capa que le falta a esa cobertura.
//
// NOTE(env): igual que new-trip.spec.ts, la suite es AGNOSTICA de ambiente:
//   npm run test:test -- tests/specs/trips/new-trip-open-destination.spec.ts
//   npm run test:uat  -- tests/specs/trips/new-trip-open-destination.spec.ts
// NOTE(data): mismo MG19_CLIENT_QUERY que el resto de la suite MG-19. TC163/TC171 necesitan
// ademas un tipo de servicio de mensajeria (COURIER) visible para ese cliente: configurable por
// MG19_COURIER_SERVICE_TYPE (default /mensajer[ií]a|courier/i). Si el ambiente no lo tiene, el
// test falla explicito senalando el patron a ajustar — no se gatea con test.skip a proposito,
// mismo criterio que selectClient() en new-trip.spec.ts.
import { test, expect, attachXrayEvidence } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

const TM_TC162 = 'TM-603';
const TM_TC163 = 'TM-604';
const TM_TC165 = 'TM-606';
const TM_TC166 = 'TM-607';
const TM_TC169 = 'TM-610';
const TM_TC170 = 'TM-611';
const TM_TC171 = 'TM-612';
const TM_TC175 = 'TM-616';

const CLIENT_QUERY = process.env.MG19_CLIENT_QUERY ?? 'test';
const ORIGIN_QUERY = process.env.MG19_ORIGIN_QUERY ?? 'Aeropuerto';
// Mismo par validado en vivo por new-trip-route-flags.spec.ts (MG19_DESTINATION_QUERY): 'test'
// (CLIENT_QUERY) NO es una direccion real, asi que TC165/TC166 necesitan su propia query de
// lugar para el destino que van a limpiar/cotizar.
const DESTINATION_QUERY = process.env.MG19_DESTINATION_QUERY ?? 'AEP';
const COURIER_SERVICE_TYPE = new RegExp(
  process.env.MG19_COURIER_SERVICE_TYPE ?? 'mensajer[ií]a|courier',
  'i'
);

test.describe('@P1 @functional @migration MG-19 Nuevo Viaje - Destino Abierto (ronda 2)', () => {
  // Mismo motivo que new-trip.spec.ts: cliente, tipos de servicio y Google Places con latencia
  // variable.

  test('TC162 Destino Abierto habilita el switch al seleccionar un cliente', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC162, ROUTE)('TC162', 'HP');
    const p = new NewTripPage(page);
    await p.goto();

    // Precondicion explicita del propio TC161 (ya automatizado, TM-602): sin cliente el switch
    // esta deshabilitado. Este test es la mitad complementaria — la EP inversa, no una
    // repeticion: mismo control, precondicion contraria, aseveracion contraria.
    await expect(p.openDestinationSwitch).toBeDisabled();

    await p.selectClient(CLIENT_QUERY);

    await expect(p.openDestinationSwitch).toBeEnabled();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'switch-habilitado-con-cliente',
      comment: `Medido: sin cliente el switch «Destino Abierto» estaba deshabilitado; tras seleccionar «${CLIENT_QUERY}» quedó habilitado.`
    });
  });

  test('TC163 Destino Abierto no se ofrece cuando el tipo de servicio es de mensajeria', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC163, ROUTE)('TC163', 'NEG');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.selectServiceTypeMatching(COURIER_SERVICE_TYPE);

    // canUseOpenDestination = !isDelivery && !isOneShotSelected. Con un tipo COURIER el switch
    // no se OCULTA-Y-DESHABILITA: se saca del DOM (*ngIf="i === 0 && canUseOpenDestination"),
    // por eso la aseveracion es de conteo, no de visibilidad.
    await expect(
      p.openDestinationSwitch,
      'con un tipo de servicio de mensajeria el switch no debe estar en el DOM'
    ).toHaveCount(0);
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'switch-fuera-del-dom-mensajeria',
      comment: `Medido: con el tipo de servicio de mensajería (patrón ${COURIER_SERVICE_TYPE}) el switch «Destino Abierto» tiene 0 nodos en el DOM.`
    });
  });

  test('TC165 Destino Abierto limpia las paradas, el destino de regreso y apaga ida y vuelta al activarse', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC165, ROUTE)('TC165', 'EC');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillOrigin(ORIGIN_QUERY);
    await p.fillFirstDestination(DESTINATION_QUERY);

    // SIMPLIFICACION DECLARADA vs. el TC manual (que pide "dos paradas intermedias"): una sola
    // parada alcanza para la misma particion EP ("hay paradas cargadas" != "no hay paradas"). El
    // comportamiento que se afirma —vaciar TODO el FormArray salvo una fila— no cambia con la
    // cantidad de paradas de partida; agregar una segunda solo repetiria la misma llamada a
    // addDestinationStop() sin sumar cobertura nueva.
    await p.addDestinationStop(DESTINATION_QUERY);
    await expect(p.destinationFormRows).toHaveCount(2);

    await p.activateRoundTrip();
    await expect(p.returnDestinationRow).toBeVisible();

    await p.toggleOpenDestination();

    // Las tres mitades del caso: paradas colapsadas a una sola fila (ya reseteada por
    // removeDestination(0)), y el destino de regreso vuelto a ocultar porque roundTrip paso a
    // false (toggleOpenDestination() lo apaga ANTES de vaciar el FormArray).
    await expect(
      p.destinationFormRows,
      'activar Destino Abierto debe colapsar las paradas a una sola fila de destino'
    ).toHaveCount(1);
    await expect(
      p.returnDestinationRow,
      'activar Destino Abierto debe apagar ida y vuelta y ocultar el destino de regreso'
    ).toBeHidden();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'destino-abierto-limpia-paradas',
      comment: `Medido: con 1 parada agregada (2 filas de destino) e ida y vuelta activa, al activar Destino Abierto las filas de destino quedaron en 1 y el destino de regreso oculto.`
    });
  });

  test('TC166 Destino Abierto descarta la simulacion de vehiculos vigente al activarse', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC166, ROUTE)('TC166', 'EC');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    await p.fillOrigin(ORIGIN_QUERY);
    await p.fillFirstDestination(DESTINATION_QUERY);

    await p.quoteTrip();
    await expect(
      p.vehicleTypesHeading,
      'debe haber una simulacion vigente antes de activar el modo'
    ).toBeVisible();

    await p.toggleOpenDestination();

    // toggleOpenDestination() fija showVehicleTypesOptions = false: la simulacion vigente se
    // descarta y el bloque entero de tipos de vehiculo deja de ofrecerse, obligando a cotizar
    // de nuevo (que es justamente lo que impide canSelectVehicle hasta que el operador repita
    // Seleccionar Vehiculo).
    await expect(
      p.vehicleTypesHeading,
      'activar Destino Abierto debe descartar la simulacion de vehiculos vigente'
    ).toBeHidden();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'destino-abierto-descarta-simulacion',
      comment: `Medido: con la simulación de vehículos vigente (encabezado de tipos de vehículo visible), al activar Destino Abierto el encabezado quedó oculto.`
    });
  });

  test('TC169 Destino Abierto sigue exigiendo el origen para poder cotizar', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC169, ROUTE)('TC169', 'NEG');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);
    // Precondicion del TC: origen vacio. El cliente (CLIENT_QUERY) autocompleta el origen, asi que
    // se vacia y se verifica explicitamente antes de activar Destino Abierto.
    await p.clearOrigin();
    await expect(
      p.resolvedOriginValue,
      'precondicion TC169: el origen debe estar vacio'
    ).toHaveCount(0);

    // Al reves de TC168 (ya automatizado, TM-609: origen SI cargado, cotizacion SI ofrecida):
    // el modo reemplaza al destino, nunca al origen.
    await p.toggleOpenDestination();
    await expect(p.openDestinationSwitch).toBeChecked();

    await expect(
      p.selectVehicleButton,
      'sin origen, Destino Abierto no debe ofrecer la cotizacion'
    ).toBeHidden();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'destino-abierto-exige-origen',
      comment: `Medido: con Destino Abierto marcado y sin origen cargado, el botón de cotizar (Select Vehicle) permanece oculto.`
    });
  });

  test('TC170 Destino Abierto calcula la cotizacion con distancia cero', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC170, ROUTE)('TC170', 'INT');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.toggleOpenDestination();
    await p.fillOrigin(ORIGIN_QUERY);

    // Verificacion de API embebida (mismo patron que new-trip-route-flags.spec.ts): la pantalla
    // no expone un campo de "distancia" visible para un viaje sin ruta trazada, asi que la
    // evidencia de "distancia cero" es la respuesta real de simulateAll.
    //
    // DOS ASEVERACIONES RETIRADAS (2026-09-14), ambas por cambio de comportamiento confirmado
    // por el dueño del caso — no por flakiness:
    //
    // 1. `liveRouteBadge` oculto. Se aseveraba que un viaje a Destino Abierto no traza ruta y
    //    por lo tanto el badge de Google Directions nunca se pinta. Hoy el trazado funciona
    //    correctamente en TEST, asi que la premisa ya no aplica. Medido ademas como inestable:
    //    en la corrida del 2026-09-10 el badge aparecio en 1 de 3 intentos, lo que la hacia
    //    fallar de forma intermitente incluso bajo la premisa vieja.
    //
    // 2. `firstOption.destination` igual a `firstOption.origin`. Se aseveraba que el backend
    //    cortocircuitaba Google copiando el origen resuelto al destino. Ese comportamiento se
    //    discontinuo: hoy la pantalla muestra "Destino Abierto" en el campo Destino y lo deja
    //    no editable, sin copiar el origen. Esa mitad del caso ya la cubre TC164 (TM-605) en
    //    new-trip.spec.ts, que asevera el campo oculto + la etiqueta; no se duplica aqui.
    const simulateAllResponse = await p.selectVehicleAndCaptureSimulateAllResponse();
    const [firstOption] = simulateAllResponse;

    const distance = Number(firstOption.distance ?? firstOption.routeDistance ?? NaN);
    expect(
      distance,
      `distance/routeDistance de simulateAll debe ser 0 para Destino Abierto (recibido: ${JSON.stringify({ distance: firstOption.distance, routeDistance: firstOption.routeDistance })})`
    ).toBe(0);

    // COBERTURA PARCIAL DECLARADA + HALLAZGO: el TC (TM-611) espera "el precio resultante de la
    // base del tarifador". MEDIDO EN VIVO 2026-09-09 contra el carrier 1521 (rate "Base",
    // rateId 2261): `pricePerKm` SI esta configurado (2.48549), pero TODOS los conceptos de
    // `fixConceptList` (incluido `FARE`, el que aportaria una base fija) traen
    // `fixAmount: null`. Con distancia 0 y sin importe fijo configurado, `pricePointToPoint` y
    // `totalCostPrice` dan 0 de forma consistente con la formula (0 km * $/km = $0) — no es un
    // trazado roto, es que este carrier/rate no tiene una base fija cargada. Verificar la mitad
    // "el precio es la base del tarifador, nunca $0" exige un carrier/rate con `FARE.fixAmount`
    // > 0 identificado en el ambiente, dato que hoy no esta confirmado (mismo tipo de gap que
    // TC174/TM-615, ver exclusiones al pie del archivo). Se asevera aqui solo la mitad
    // verificable con los datos disponibles: el campo llega bien formado.
    expect(
      typeof firstOption.pricePointToPoint,
      'debe cotizar un precio (aunque sea 0 con la configuracion de tarifa actual del carrier)'
    ).toBe('number');
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'distancia-cero-simulateall',
      comment: `Medido: la respuesta de simulateAll para Destino Abierto trae distance=${firstOption.distance ?? 'n/d'}, routeDistance=${firstOption.routeDistance ?? 'n/d'} (aseverado 0) y pricePointToPoint=${firstOption.pricePointToPoint} (tipo ${typeof firstOption.pricePointToPoint}). El precio base del tarifador no se asevera (cobertura parcial declarada).`
    });
  });

  test('TC171 Cambiar a un tipo de servicio de mensajeria apaga Destino Abierto y vuelve a exigir destino', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC171, ROUTE)('TC171', 'EC');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.toggleOpenDestination();
    await expect(p.openDestinationSwitch).toBeChecked();

    await p.selectServiceTypeMatching(COURIER_SERVICE_TYPE);

    // syncOpenDestinationWithTripType(): si el viaje pasa a un tipo que exige destino, el modo
    // se apaga SOLO, sin intervencion del operador. El switch mismo sale del DOM (canUseOpenDestination
    // pasa a false), y el campo de destino real vuelve a ofrecerse en su lugar.
    await expect(
      p.openDestinationSwitch,
      'cambiar a mensajeria debe sacar el switch del DOM (ya no aplica)'
    ).toHaveCount(0);
    await expect(
      p.firstDestinationInput,
      'debe reaparecer el campo de destino real y volver a exigirse'
    ).toBeVisible();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'mensajeria-apaga-destino-abierto',
      comment: `Medido: con Destino Abierto marcado, al cambiar a un tipo de mensajería (${COURIER_SERVICE_TYPE}) el switch salió del DOM (0 nodos) y reapareció el campo de destino real.`
    });
  });

  test('TC175 Apagar Destino Abierto restituye el campo de destino y vuelve a exigirlo', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC175, ROUTE)('TC175', 'HP');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.toggleOpenDestination();
    await expect(p.firstDestinationInput).toBeHidden();

    // Inversa de TC164 (ya automatizado, TM-605: activar oculta+etiqueta). Este TC prueba que
    // apagar es reversible y deja el campo vacio y exigido — no la direccion de origen que
    // getPrices() le habia copiado mientras el modo estuvo activo (ver el comentario de
    // toggleOpenDestination() en el fuente, QA Ronda 2 TC175 23/08).
    await p.toggleOpenDestination();

    await expect(
      p.firstDestinationInput,
      'apagar Destino Abierto debe restituir el campo de destino real'
    ).toBeVisible();
    await expect(
      p.resolvedDestinationValue,
      'el destino restituido debe quedar vacio, no con la copia del origen'
    ).toHaveCount(0);
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'apagar-destino-abierto-restituye',
      comment: `Medido: activado y luego desactivado Destino Abierto, el campo de destino real quedó visible y sin destino resuelto (0 valores; no se conservó la copia del origen).`
    });
  });
});

// EXCLUSIONES DECLARADAS del corpus TS-ALTAVIAJE Destino Abierto (TM-602..TM-616):
//
// - TC172 (TM-613, "no se puede activar sobre tipo incompatible"): por codigo el switch se
//   saca del DOM para CUALQUIER tipo incompatible (`*ngIf="canUseOpenDestination"`), asi que la
//   unica evidencia posible ("switch ausente, sin error") es identica a la de TC163 si se
//   ejercita con el mismo tipo COURIER — no hay ATC nuevo que ganar repitiendo la misma
//   aseveracion sobre la misma particion. La particion DISTINTA (`isOneShotSelected`) se activa
//   por un flujo de acuerdo Affiliate One-Shot que no tiene datos confirmados en el ambiente de
//   test (new-trip.component.ts:683-685, `oneShotAgreementSelected`) — forzarlo pediria
//   identificar un affiliate agreement, que es un fixture de datos propio, no un cambio de
//   locator. Queda declarado como B (requiere setup de datos no confirmado), no automatizado.
//
// - TC174 (TM-615, "informa retencion de tarjeta y distancia teorica solo si el carrier las
//   configuro"): el AC pide COMPARAR dos carriers con `CC_HOLD_AMOUNT_OPEN_DESTINATION` y
//   `TOTAL_DISTANCE_OPEN_TRIP` en polaridad opuesta (uno > 0, el otro en 0). El ambiente de test
//   solo tiene confirmado el carrier 1521; no hay un segundo carrier con esos parametros
//   contrastados identificado. Queda declarado como B (requiere datos/configuracion de carrier
//   que este repo no puede fijar por UI), no automatizado. El locator para cuando haya datos ya
//   esta identificado en el fuente: `.nt-open-dest-note` (new-trip.component.html:542-555).
//
// - TC173 (TM-614, "el error de origen igual a destino se aplica sin el modo y se exceptua con
//   Destino Abierto"): HALLAZGO DE PRODUCTO, no gap de automatizacion. El guard de "origen ==
//   destino" que el TC da por vigente esta COMENTADO en el fuente desplegado (v2.0.13,
//   new-trip.component.ts:3717-3730): "Se QUITA por pedido explicito, para paridad con v1 (...)
//   Consecuencia asumida: un viaje con origen == destino vuelve a poder cotizarse y enviarse (0
//   Km / $0,00)". O sea que HOY, SIN el modo, origen == destino ya no dispara ningun error en
//   la pantalla — la primera mitad del TC (que el modo apagado SI frene la cotizacion) es falsa
//   contra el comportamiento real. Escribir el test tal como esta redactado forzaria una
//   aseveracion que el propio codigo contradice (encoding-a-defect-as-truth); escribirlo contra
//   el comportamiento real dejaria de probar lo que el TC dice probar. Se reporta como hallazgo
//   para que QA/PO decida si el TC debe reescribirse (verificar que YA NO hay error, en los dos
//   estados del modo) o si el guard debe reponerse en el front — no se automatiza en ningun
//   sentido hasta esa decision.
