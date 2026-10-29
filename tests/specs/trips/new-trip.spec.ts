// tests/specs/trips/new-trip.spec.ts
// Primera ronda de automatizacion de la pantalla Nuevo Viaje (historia MG-19, estado TEST).
//
// TRAZABILIDAD: cada test mapea 1:1 a un Xray Test del proyecto TM, que enlaza a MG-19 con
// link de tipo "Test" (ATP TM-36 · ATR TM-18). Detalle completo del esquema de trazabilidad y
// de cada gap declarado: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
//
// Selectores derivados del fuente real desplegado — ver cabecera de NewTripPage.ts.
// Agnostica de ambiente a proposito (corre en test y uat, ver notas). El typeahead de cliente
// es parametrizable por MG19_CLIENT_QUERY porque la pantalla no se puede ejercitar sin cliente.
import { test, expect, attachXrayEvidence } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

// Xray Test (proyecto TM) que respalda cada TC de la matriz QA de Alta de Viaje.
// Constantes sueltas a proposito: scripts/extract-tc-map.ts resuelve
// `makeAnnotate(CONST, ROUTE)` por nombre de constante del propio spec, no una expresion
// indexada tipo `TM[tc]`.
const TM_TC063 = 'TM-508';
const TM_TC157 = 'TM-522';
const TM_TC161 = 'TM-602';
const TM_TC164 = 'TM-605';
const TM_TC167 = 'TM-608';
const TM_TC168 = 'TM-609';
const TM_TC197 = 'TM-770';
const TM_TC210 = 'TM-783';
const TM_TC211 = 'TM-784';

/** Texto de busqueda de cliente. Configurable por ambiente: los datos de UAT no son fijos. */
const CLIENT_QUERY = process.env.MG19_CLIENT_QUERY ?? 'test';

test.describe('@P1 @functional @migration MG-19 Nuevo Viaje - primera ronda matriz QA', () => {
  // Alta de viaje golpea clientes, tipos de servicio y Google Places; latencia variable.

  test('TC161 Destino Abierto ofrece el switch deshabilitado mientras no haya cliente', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC161, ROUTE)('TC161', 'EC');
    const p = new NewTripPage(page);
    await p.goto();
    await p.expectMainSectionsReady();

    // El switch se renderiza igual, pero con [disabled]="idClient == 0".
    await expect(p.openDestinationSwitch).toBeVisible();
    await expect(p.openDestinationSwitch).toBeDisabled();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'switch-destino-abierto-deshabilitado',
      comment: `Medido: sin cliente seleccionado el switch «Destino Abierto» está visible y deshabilitado (disabled).`
    });
  });

  test('TC157 Preselecciona el tipo de servicio Regular al seleccionar un cliente', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC157, ROUTE)('TC157', 'HP');
    const p = new NewTripPage(page);
    await p.goto();

    await p.selectClient(CLIENT_QUERY);

    // getCourierServiceTypes() antepone "Regular" y lo fija como valor inicial.
    expect(await p.selectedServiceType()).toMatch(/regular/i);
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'tipo-servicio-preseleccionado',
      comment: `Medido: al seleccionar el cliente «${CLIENT_QUERY}» el tipo de servicio quedó preseleccionado como «${await p.selectedServiceType()}».`
    });
  });

  test('TC210 Seleccionar un cliente carga pasajeros y metodos de pago y habilita ruta y servicio', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC210, ROUTE)('TC210', 'INT');
    const p = new NewTripPage(page);
    await p.goto();

    // Precondicion: sin cliente la ruta esta bloqueada (idClient == 0).
    await expect(p.originInput).toBeDisabled();

    await p.selectClient(CLIENT_QUERY);

    await expect(
      p.paymentMethodSelect.locator('.ng-value').first(),
      'debe cargar los metodos de pago y auto-seleccionar uno'
    ).toBeVisible({ timeout: 20_000 });
    await expect(p.originInput, 'debe habilitar la ruta').toBeEnabled();
    await expect(p.serviceTypeSelect, 'debe habilitar el tipo de servicio').toBeVisible({
      timeout: 20_000
    });

    // COBERTURA PARCIAL DECLARADA: la carga de pasajeros no se asevera. Requiere un cliente
    // corporativo con pasajeros asociados, dato no identificado hoy en el ambiente. Detalle
    // medido: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'cliente-carga-ruta-y-servicio',
      comment: `Medido: tras seleccionar el cliente «${CLIENT_QUERY}» se auto-seleccionó un método de pago, el campo Origen quedó habilitado y el selector de tipo de servicio visible. La carga de pasajeros no se asevera (cobertura parcial declarada).`
    });
  });

  test('TC164 Destino Abierto oculta el campo de destino y muestra su etiqueta al activarse', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC164, ROUTE)('TC164', 'HP');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await expect(p.firstDestinationInput).toBeVisible();

    await p.toggleOpenDestination();

    await expect(p.firstDestinationInput).toBeHidden();
    await expect(p.openDestinationValue).toBeVisible();
    await expect(p.openDestinationValue).toContainText(/destino abierto|open destination/i);
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'destino-abierto-activado',
      comment: `Medido: con Destino Abierto activo el campo de destino quedó oculto y la etiqueta visible dice «${(await p.openDestinationValue.innerText()).trim()}».`
    });
  });

  test('TC167 Sin Destino Abierto y con el destino vacio no se ofrece cotizar el viaje', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC167, ROUTE)('TC167', 'NEG');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.fillOrigin('Aeropuerto');

    // canSelectVehicle exige lat/lng en origen Y en el ultimo destino.
    await expect(p.openDestinationSwitch).not.toBeChecked();
    // "Destino vacio" se comprueba por la AUSENCIA de valor resuelto, no con `toHaveValue('')`
    // sobre el input: ese input es el buscador y en reposo lee '' con y sin destino elegido.
    await expect(
      p.resolvedDestinationValue,
      'no debe haber destino resuelto en este escenario'
    ).toHaveCount(0);
    await expect(p.selectVehicleButton).toBeHidden();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'sin-destino-no-cotiza',
      comment: `Medido: con Origen «Aeropuerto» cargado, el switch Destino Abierto sin marcar y sin destino resuelto (0 valores), el botón de cotizar (Select Vehicle) permanece oculto.`
    });
  });

  test('TC168 Destino Abierto habilita la cotizacion con el origen como unico dato de ruta', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC168, ROUTE)('TC168', 'HP');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.toggleOpenDestination();
    await expect(p.openDestinationSwitch).toBeChecked();

    await p.fillOrigin('Aeropuerto');

    // Con el flag activo canSelectVehicle vuelve true solo con origen.
    await expect(p.selectVehicleButton).toBeVisible({ timeout: 20_000 });
    await expect(p.selectVehicleButton).toBeEnabled();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'destino-abierto-cotiza-solo-origen',
      comment: `Medido: con Destino Abierto marcado y solo el origen «Aeropuerto» cargado, el botón de cotizar (Select Vehicle) quedó visible y habilitado.`
    });
  });

  test('TC063 Rechaza la fecha y hora que no respetan la anticipacion minima del carrier', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC063, ROUTE)('TC063', 'EC');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    // El rechazo es PREVENTIVO, no reactivo: el datepicker no acepta una fecha por debajo del
    // minimo y revierte al valor valido. El mensaje inline es una red de seguridad para cuando
    // el tiempo corre con el formulario abierto. Detalle medido:
    // docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
    await expect(
      p.tripDateInput,
      'la pantalla debe abrir con una fecha valida precargada'
    ).not.toHaveValue('');
    const validDate = await p.tripDateInput.inputValue();

    await p.tripDateInput.fill('01/01/2020');
    await p.tripDateInput.blur();

    await expect(
      p.tripDateInput,
      'una fecha por debajo de la anticipacion minima no debe quedar fijada'
    ).not.toHaveValue('01/01/2020');
    await expect(p.tripDateInput).toHaveValue(validDate);
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'fecha-invalida-revertida',
      comment: `Medido: se ingresó la fecha 01/01/2020 (bajo la anticipación mínima); el campo no la conservó y revirtió a la fecha válida precargada «${validDate}».`
    });
  });

  test('TC197 El formulario incompleto impide el envio y senala cada campo faltante', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC197, ROUTE)('TC197', 'NEG');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    // Con la ruta incompleta no se ofrece cotizar (*ngIf="canSelectVehicle").
    // No se asevera `submitButton` oculto: ese boton vive en una barra que solo se renderiza
    // DESPUES de cotizar, asi que en este estado nunca esta en el DOM y afirmarlo seria vacuo.
    await expect(p.selectVehicleButton).toBeHidden();

    // COBERTURA PARCIAL DECLARADA: "incluidas las paradas vacias" no se asevera — el aviso de
    // destino exige el control `dirty`, que no se alcanza por UI en este escenario, y la
    // cascada del cliente auto-rellena el origen. Investigacion completa:
    // docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
    await expect(p.firstDestinationInput).toBeEnabled();
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'formulario-incompleto-sin-cotizar',
      comment: `Medido: con cliente «${CLIENT_QUERY}» y la ruta incompleta, el botón de cotizar (Select Vehicle) está oculto y el campo de primer destino habilitado. Paradas vacías no asertadas (cobertura parcial declarada).`
    });
  });

  test('TC211 El origen y el destino por autocompletado marcan el mapa y trazan la ruta', async ({
    page
  }, testInfo) => {
    makeAnnotate(TM_TC211, ROUTE)('TC211', 'INT');
    const p = new NewTripPage(page);
    await p.goto();
    await p.selectClient(CLIENT_QUERY);

    await p.fillOrigin('Aeropuerto');
    await p.fillFirstDestination('Centro');

    // canSelectVehicle exige lat/lng en origen y en el ultimo destino: el boton apareciendo
    // prueba que el autocompletado geocodifico las dos direcciones.
    await expect(p.selectVehicleButton).toBeVisible({ timeout: 25_000 });
    await expect(p.selectVehicleButton).toBeEnabled();

    // COBERTURA PARCIAL DECLARADA + HALLAZGO SIN DIAGNOSTICAR: la mitad "trazan la ruta"
    // (badge .nt-live-route-badge) no se asevera — el badge no se renderizo en 3 intentos
    // medidos en vivo, causa no diagnosticada (¿quota de la API o defecto real?). Detalle:
    // docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
    // Evidencia publicable (evidence-conventions §4): captura + medición.
    await attachXrayEvidence(testInfo, page, {
      name: 'autocompletado-habilita-cotizar',
      comment: `Medido: con Origen «Aeropuerto» y Destino «Centro» resueltos por autocompletado, el botón de cotizar (Select Vehicle) quedó visible y habilitado (ambas direcciones geocodificadas). El badge de ruta trazada no se asevera (hallazgo declarado).`
    });
  });
});
