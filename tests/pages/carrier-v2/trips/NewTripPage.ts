// tests/pages/carrier-v2/trips/NewTripPage.ts
// Pantalla de alta de viaje. Formulario reactivo grande: extiende BasePage y define su propio
// goto(). Selectores derivados del fuente real DESPLEGADO (release v2.0.13) — el working tree
// de refs/v2/ esta desactualizado (v2.0.4) y no sirve de referencia para esta pantalla.
// Proveniencia completa y comandos: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
// Sin data-testid en el front: se ancla por rol + nombre accesible, con fallback a
// id/formcontrolname.
/**
 * @jira MG-19
 * @route /carrier/#/travel/create
 * @priority P1
 * @type functional
 * @note Detras de `*ngIf="migrated"`: si el flag resuelve false la ruta cae al iframe V1.
 *       goto() espera el <form> V2, no solo la URL, para no afirmar contra el iframe sin notarlo.
 */
import type { Page, Locator, Response } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import { FrequentDestinationsModalPage } from './FrequentDestinationsModalPage.js';
import { AddOtherCostModalPage } from './AddOtherCostModalPage.js';
import {
  ENV_SLOW_LOAD_ANNOTATION,
  ENV_NORMAL_LOAD_MS,
  formatSlowLoadDescription
} from '../../../utils/envAvailability.js';
import { parseDistance, type DistanceReading } from '../../../utils/units.js';

/** Wait budget for data driven by the selected client (typeahead, cascaded origin). */
const CLIENT_DATA_TIMEOUT_MS = 20_000;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class NewTripPage extends BasePage {
  // === Gate de migracion (V2 real vs iframe V1) ===
  /** Formulario reactivo de la V2. Solo existe cuando `migrated` resolvio a true. */
  readonly form: Locator;
  /** Iframe de la pantalla V1. Solo existe cuando `migrated` resolvio a false. */
  readonly v1Iframe: Locator;
  /** Breadcrumb de la pantalla: "Nuevo Viaje" / "New Trip". */
  readonly heading: Locator;

  // === Quien viaja ===
  /** Titulo de la primera seccion: "Quien Viaja" / "Who Travels". */
  readonly whoTravelsHeading: Locator;
  /** Cliente/solicitante. Control real `isClientSelect`, no `clientId`. Typeahead desde 3 caracteres. */
  readonly clientInput: Locator;
  /** Contenedor ng-select del cliente — necesario para abrirlo y leer su estado. */
  readonly clientSelect: Locator;
  /** Checkbox "PAX Invitado" / "Guest PAX". */
  readonly guestPassengerCheck: Locator;
  /** Input de nombre del pasajero invitado; solo aparece con el checkbox activo. */
  readonly guestPassengerName: Locator;

  // === Tipo de servicio ===
  /** ng-select de tipo de servicio. Se autocompleta a "Regular" al elegir cliente. */
  readonly serviceTypeSelect: Locator;

  // === Ruta ===
  /** Origen. Deshabilitado mientras no haya cliente (`idClient == 0`). */
  readonly originInput: Locator;
  /** Primer destino del FormArray `destination`. */
  readonly firstDestinationInput: Locator;
  /** Boton "+" agregar parada. Desaparece al tope de waypoints o con Destino Abierto activo. */
  readonly addStopButton: Locator;

  // === Destino Abierto ===
  /** Switch Destino Abierto (no es formControlName). Deshabilitado sin cliente. */
  readonly openDestinationSwitch: Locator;
  /** Etiqueta que reemplaza al campo de destino cuando el switch esta activo. */
  readonly openDestinationValue: Locator;
  /**
   * Nota bajo el switch: «Hold Amount for Open Destination Trip: $ 50.00 · Theoretical Distance
   * Open Dest.: 594421.311 Mi» (ES «Monto de Reserva… · Distancia Teórica Dest. Abierto: …»). El
   * tramo de distancia solo aparece cuando el parámetro del carrier es mayor que 0.
   */
  readonly openDestinationNote: Locator;

  // === Fecha y hora ===
  /** Input de fecha (NgbDatepicker dentro de <app-date-time-row>). */
  readonly tripDateInput: Locator;

  // === Pasajeros y pago (efectos en cascada de elegir cliente) ===
  /** Cantidad de pasajeros. Solo se renderiza si el tipo de servicio lo exige. */
  readonly paxQtyInput: Locator;
  /** Authorizer (contractor customers only): `app-trip-passenger-select` labelled «Authorizer». */
  readonly authorizerSelect: Locator;
  /** ng-select de pasajero. Se puebla en cascada tras elegir cliente. */
  readonly passengerSelect: Locator;
  /** ng-select de metodo de pago. La cascada del cliente le auto-selecciona un default. */
  readonly paymentMethodSelect: Locator;

  // === Salida de la ruta ===
  /**
   * Badge con duracion y distancia que publica el callback de Google Directions. Es la
   * evidencia observable de que la ruta se trazo: los markers del mapa son overlays JS de
   * @angular/google-maps y no tienen DOM aseverable.
   */
  readonly liveRouteBadge: Locator;

  // === Acciones ===
  /**
   * Accion principal de cotizacion: "Seleccionar Vehiculo" / "Select Vehicle". NO confundir
   * con el boton literal "Cotizar" (`quoteButton`), que abre otro flujo.
   */
  readonly selectVehicleButton: Locator;
  /** Boton "Cotizar" / "Quote" — abre el modal de guardado, no cotiza la ruta. */
  readonly quoteButton: Locator;
  /** Envio definitivo: "Enviar Servicio" / "Send Service". */
  readonly submitButton: Locator;

  // === Errores de validacion ===
  /** Clases reales de error de esta pantalla: `.error-message` y `.text-danger.small` (sin Material/PrimeNG). */
  readonly fieldErrors: Locator;

  /** Opciones desplegadas de cualquier ng-select abierto. */
  readonly dropdownOptions: Locator;

  /**
   * Valor resuelto del primer destino (el chip `.ng-value` que ng-select pinta al confirmar).
   * El `value` del input NO sirve para preguntar "hay destino elegido": es el termino de
   * busqueda y en reposo esta vacio con y sin destino.
   */
  readonly resolvedDestinationValue: Locator;
  /** Valor resuelto del origen. Mismo criterio que resolvedDestinationValue. */
  readonly resolvedOriginValue: Locator;

  // === Contrato inicial del formulario ===
  /** "Limpiar formulario" / "Clear form". */
  readonly clearFormButton: Locator;
  /** Popup de confirmacion (SweetAlert2) que aparece si hay datos cargados que perder. */
  readonly clearConfirmDialog: Locator;
  readonly clearConfirmButton: Locator;
  readonly keepEditingButton: Locator;
  /** ng-select de hora del viaje ("Now" + slots de 5 minutos). */
  readonly tripTimeSelect: Locator;
  readonly tripTimeValue: Locator;
  readonly avoidTollsCheckbox: Locator;
  readonly avoidHighwaysCheckbox: Locator;
  /** Switch Shortest route (off) / Fastest route (on). */
  readonly fastestRouteSwitch: Locator;
  /** Boton "Destino frecuente": abre el modal de seleccion (MG-682). `.nt-freq-pill`. */
  readonly frequentDestinationButton: Locator;
  /**
   * Opcion deshabilitada que el typeahead usa como aviso ("Type at least 3 characters to
   * search", "No users found"). ng-select la renderiza con rol option, asi que hay que
   * distinguirla por la clase para no confundirla con una opcion real.
   */
  readonly dropdownNotice: Locator;

  // === MG-19 ronda 2: Destino Abierto (TC162/163/165/166/169/170/171/175) ===
  /**
   * Cada fila del FormArray `destination` (origen excluido). Ancla por `formArrayName`, NO por
   * la clase dinamica `{{ getDestinationClass(i) }}` (stop / destiny / destiny-airport): esa
   * clase cambia segun la fila sea la ultima o traiga aeropuerto, y contar por ella exigiria
   * conocer de antemano la combinacion vigente. `formArrayName="destination"` es el mismo en
   * TODAS las filas del *ngFor, incluida la unica que queda tras limpiar paradas.
   */
  readonly destinationFormRows: Locator;
  /**
   * Boton "Ida y vuelta" (icono `mdi-repeat`) de la ULTIMA fila de destino.
   *
   * MEDIDO EN VIVO 2026-09-09: anclar solo por rol+nombre accesible ("Round Trip"/"Ida y
   * vuelta") da `strict mode violation` — hay OTRO elemento con el mismo nombre accesible cerca
   * del tipo de servicio (badge informativo `[ngClass]="roundTrip ? 'clicked' : 'not-clicked'"`,
   * SIN la clase `.nt-tool-btn`). Se distingue por esa clase, que es exclusiva de los tres
   * botones-icono de la fila de destino (avion/agregar/ida-y-vuelta/quitar).
   *
   * Nace y desaparece con la fila: `*ngIf` lo saca del DOM apenas se activa el propio round
   * trip, se elige un tipo de servicio incompatible, o se activa Destino Abierto — las tres son
   * excluyentes con ida y vuelta en el modelo de negocio.
   */
  readonly roundTripButton: Locator;
  /**
   * Fila espejo de "destino de regreso" (`origin2`, read-only): aparece cuando `roundTrip` es
   * true y se oculta con `[hidden]="!roundTrip"` — NO se saca del DOM, asi que es la señal mas
   * directa de si el ida-y-vuelta sigue activo tras un efecto en cascada (p.ej. activar Destino
   * Abierto). Ancla por el label de su input (`for="origin2"`), unico en la pantalla.
   */
  readonly returnDestinationRow: Locator;

  // === Notas del viaje ===
  /** "Add Note". Desaparece del DOM una vez que hay notas confirmadas. */
  readonly addNoteButton: Locator;
  /** Modal "Trip notes". */
  readonly notesDialog: Locator;
  /** Tarjeta que reemplaza al boton "Add Note" cuando hay notas confirmadas. */
  readonly notesCard: Locator;
  /** Lapiz de la tarjeta de notas (tooltip "Edit Note"): reabre el modal para editarlas. */
  readonly notesCardEditButton: Locator;

  // === Cotizacion (existe recien despues de "Select Vehicle") ===
  readonly vehicleTypesHeading: Locator;
  /**
   * Todas las cards del carrusel de tipos de vehiculo (una por tipo disponible).
   * Pre-cotizacion la lista esta vacia: sirve de par de control.
   */
  readonly vehicleCards: Locator;
  /** Card del tipo de vehiculo elegido. La pantalla preselecciona uno. */
  readonly selectedVehicleCard: Locator;
  readonly selectedVehicleName: Locator;
  readonly selectedVehiclePrice: Locator;

  // === Modal de vuelo (MU-039) — NgbModal fuera del <form>; todo se ancla bajo `flightModal`
  // para no colisionar con controles homonimos de la pantalla principal. Fuente + hallazgos
  // H1-H13: docs/qa/migration/units/MU-039-plan.md.
  /** Boton "avion" de la fila de ORIGEN, solo visible si el origen es aeropuerto. */
  readonly originFlightButton: Locator;
  /** Boton "avion" del primer destino, solo visible si es aeropuerto y ultima fila sin round-trip. */
  readonly destinationFlightButton: Locator;
  /** Boton "avion" de una parada intermedia. Fuera de alcance de MU-039. */
  readonly stopFlightButton: Locator;
  /** Contenedor del modal. */
  readonly flightModal: Locator;
  /** Titulo del modal: "Flight Information" / "Informacion de Vuelo". */
  readonly flightModalTitle: Locator;
  /** Subtitulo con el nombre del aeropuerto del punto. */
  readonly flightModalAirport: Locator;
  /** ng-select de aerolinea, typeahead >= 2 caracteres. */
  readonly flightAirlineSelect: Locator;
  /** Input de busqueda interno del ng-select de aerolinea. */
  readonly flightAirlineInput: Locator;
  /** Opciones del panel de aerolinea. */
  readonly flightAirlineOptions: Locator;
  /** Input de numero de vuelo, opcional en la busqueda. */
  readonly flightNumberInput: Locator;
  /** Radio "Llegada". */
  readonly flightRadioArrival: Locator;
  /** Radio "Salida". */
  readonly flightRadioDepart: Locator;
  /** Radio "Nacional" — solo visible en alta manual. */
  readonly flightRadioNational: Locator;
  /** Radio "Internacional" — solo visible en alta manual. */
  readonly flightRadioInternational: Locator;
  /** Input de fecha en modo API. Fuera de alcance (H12). */
  readonly flightDateInput: Locator;
  /** Input datetime-local en modo manual. */
  readonly flightManualDateInput: Locator;
  /** Boton "Search". [disabled] depende de fecha + aerolinea elegida (H4). */
  readonly flightSearchButton: Locator;
  /** Cards de resultado. */
  readonly flightResultCards: Locator;
  /** Card actualmente seleccionada. */
  readonly flightSelectedCard: Locator;
  /** Aviso de busqueda sin resultados. H9: aparece con 200 `[]` o con error HTTP. */
  readonly flightNoResultsMessage: Locator;
  /** Boton que pasa al alta manual, solo visible sin resultados. */
  readonly flightManualInputButton: Locator;
  /** Boton "Accept". [disabled] es union de 5 terminos (H2); ver MU-039-plan.md. */
  readonly flightAcceptButton: Locator;
  /** Boton "Cancel" — descarta el modal sin aceptar. */
  readonly flightCancelButton: Locator;
  /** Icono de papelera del footer. Icon-only, sin aria-label. */
  readonly flightClearButton: Locator;
  /** Aviso de campos pendientes, scoped al modal (evita colisionar con `fieldErrors`). */
  readonly flightMissingFieldsHint: Locator;
  /** ng-select del filtro por aeropuerto contraparte — el unico sin `formcontrolname`. */
  readonly flightAirportFilterSelect: Locator;

  constructor(page: Page) {
    super(page);

    this.form = page.locator('form[novalidate], form[method="post"]').first();
    // Only the V1 bridge iframe counts: the Google Maps widget of the V2 form also renders an
    // iframe (inside `.gm-style`), which made `iframe` alone report a false «fell back to V1».
    this.v1Iframe = page
      .locator(
        'xpath=//iframe[not(ancestor::*[contains(concat(" ", normalize-space(@class), " "), " gm-style ")])]'
      )
      .first();
    // El breadcrumb es <h4>. Anclamos por rol: el texto "New Trip" tambien aparece en el
    // navbar y en el sidebar, asi que getByText daria strict-mode violation.
    this.heading = page.getByRole('heading', { name: /^(nuevo viaje|new trip)$/i }).first();

    this.whoTravelsHeading = page
      .getByRole('heading', { name: /qui[eé]n viaja|who travels/i })
      .first();
    // ng-select se expone como combobox con el label como nombre accesible. El id `clientSelect`
    // viaja al input interno via [labelForId], asi que el combobox es el ancla correcta.
    this.clientSelect = page.getByRole('combobox', { name: /^(cliente|customer)$/i });
    this.clientInput = page.locator('#clientSelect');
    this.guestPassengerCheck = page.locator('#guestPassengerCheck');
    this.guestPassengerName = page.locator('#guestPassengerName');

    // Solo se renderiza cuando el carrier del cliente elegido trae tipos de servicio
    // (*ngIf="serviceTypes.length > 0"): antes de elegir cliente NO existe en el DOM.
    this.serviceTypeSelect = page.locator('#serviceTypeId');

    this.originInput = page.getByRole('combobox', { name: /pick-?up|origen/i }).first();
    this.firstDestinationInput = page
      .getByRole('combobox', { name: /^(to|destino)\s*\*?$/i })
      .first();
    // ARREGLADO 2026-09-09. La version anterior
    // (`.locator('.btn nt-tool-btn ng-tns-c1233886022-0')`) no encontraba nada por dos motivos:
    // le faltaban los puntos de clase — era un selector de DESCENDENCIA de tres tokens que no
    // existen como elementos — y se anclaba a `ng-tns-c1233886022-0`, una clase de scope que
    // Angular regenera en cada build. Quedo latente porque su unico consumidor (TC059) esta
    // en `fixme` y nunca corrio.
    // El `^add$` es imprescindible: sin el, matchea " Add Note", que es otro boton de la pantalla.
    // Medido en vivo (ver IMPLEMENTATION-NOTES.md).
    this.addStopButton = this.form.getByRole('button', { name: /^add$/i }).first();

    this.openDestinationSwitch = page.getByRole('switch', {
      name: /open destination|destino abierto/i
    });
    this.openDestinationValue = page.locator('.nt-open-dest-value');
    this.openDestinationNote = page.locator('.nt-open-dest-note');

    // NgbDatepicker: el input toma su nombre accesible del placeholder, que sigue el formato
    // del locale del carrier (en el harness, en-US => mm/dd/yyyy).
    this.tripDateInput = page.getByPlaceholder(/[dm]{2}\/[dm]{2}\/yyyy/i).first();

    this.paxQtyInput = page.locator('input[formcontrolname="paxQty"]');
    this.authorizerSelect = page.getByRole('combobox', { name: /^(autorizador|authorizer)$/i });
    this.passengerSelect = page.getByRole('combobox', { name: /^(pasajero|passenger)$/i });
    this.paymentMethodSelect = page.locator('.nt-payment-select');

    this.liveRouteBadge = page.locator('.nt-live-route-badge');

    this.selectVehicleButton = page.locator('button.btn-select-vehicle');
    this.quoteButton = page.getByRole('button', { name: /^(cotizar|quote)$/i });
    this.submitButton = page.getByRole('button', {
      name: /^(enviar servicio|send service)$/i
    });

    this.fieldErrors = page.locator('.error-message, .text-danger.small');
    // ng-select expone sus opciones con rol `option` dentro de un listbox.
    this.dropdownOptions = page.getByRole('option');
    this.resolvedDestinationValue = this.firstDestinationInput
      .locator('xpath=ancestor::ng-select[1]')
      .locator('.ng-value');
    this.resolvedOriginValue = this.originInput
      .locator('xpath=ancestor::ng-select[1]')
      .locator('.ng-value');

    // Regex sin anclar: el nombre accesible lleva un espacio inicial por el <i> de icono
    // adelante ("Send Service" no tiene ese prefijo, por eso submitButton si va anclado).
    this.clearFormButton = page.getByRole('button', {
      name: /clear form|limpiar formulario/i
    });
    this.tripTimeSelect = page.locator('ng-select.nt-time-select');
    // `.ng-value-label` cuando el ng-select es clearable por defecto, `.ng-value` directo
    // cuando define su propio label template.
    this.tripTimeValue = this.tripTimeSelect
      .locator('.ng-value-label, .ng-value:not(:has(.ng-value-label))')
      .first();
    this.avoidTollsCheckbox = page.locator('#avoidTolls');
    this.avoidHighwaysCheckbox = page.locator('#avoidHighways');
    this.fastestRouteSwitch = page.locator('#fastestRoute');
    this.frequentDestinationButton = page.locator('.nt-freq-pill');
    this.clearConfirmDialog = page.locator('.swal2-popup');
    this.clearConfirmButton = this.clearConfirmDialog.locator('.swal2-confirm');
    this.keepEditingButton = this.clearConfirmDialog.locator('.swal2-cancel');
    this.dropdownNotice = page.locator('.ng-dropdown-panel .ng-option-disabled');

    this.destinationFormRows = page.locator('[formArrayName="destination"]');
    this.roundTripButton = page
      .locator('button.nt-tool-btn')
      .filter({ has: page.locator('i.mdi-repeat') });
    this.returnDestinationRow = page.locator(
      'div.trip-address-row.destiny:has(label[for="origin2"])'
    );

    // El texto viaja con un icono adelante, asi que el nombre accesible no es exacto.
    this.addNoteButton = page.getByRole('button', { name: /add note|agregar nota/i });
    this.notesDialog = page.getByRole('dialog');
    this.notesCard = page.locator('app-trip-notes-display .trip-notes-card');
    // El lapiz NO tiene nombre accesible (es un <i class="ri-pencil-line"> dentro del boton):
    // getByRole('button', {name: /edit/i}) no lo encuentra. El tooltip "Edit Note" vive en
    // ng-reflect-ngb-tooltip, que es un atributo de debug de Angular y no se puede usar como
    // ancla estable. Se ancla por la clase acotada al contenedor de la tarjeta.
    // Medido en vivo 2026-09-08 (docs/analysis/mg19-evidence/).
    this.notesCardEditButton = this.notesCard.locator('.tnc-edit');

    this.vehicleTypesHeading = page.getByRole('heading', {
      name: /vehicle types|tipos de veh[ií]culo/i
    });
    this.vehicleCards = page.locator('li.vehicle-card-wrap');
    this.selectedVehicleCard = page.locator('li.vehicle-card-wrap .card-vehicle.vehicle-selected');
    this.selectedVehicleName = this.selectedVehicleCard.locator('.vehicle-name');
    this.selectedVehiclePrice = this.selectedVehicleCard.locator('.vehicle-price');

    // === Modal de vuelo (MU-039) ===
    this.originFlightButton = page.locator('.trip-address-row.origin .btn-flight-round');
    this.destinationFlightButton = page.locator(
      '.trip-address-row.destiny-airport .btn-flight-round'
    );
    this.stopFlightButton = page.locator('.trip-address-row.stop-airport .btn-flight-round');

    this.flightModal = page.locator('ngb-modal-window');
    this.flightModalTitle = this.flightModal.locator('.modal-title');
    this.flightModalAirport = this.flightModal.locator('.modal-header small.text-muted');
    this.flightAirlineSelect = this.flightModal.locator('ng-select[formcontrolname="airlineName"]');
    this.flightAirlineInput = this.flightAirlineSelect.locator('.ng-input input');
    this.flightAirlineOptions = this.flightModal.getByRole('option');
    this.flightNumberInput = this.flightModal.locator('input[formcontrolname="flightNumber"]');
    this.flightRadioArrival = this.flightModal.locator('#flightSearchRadioArrival');
    this.flightRadioDepart = this.flightModal.locator('#flightSearchRadioDepart');
    this.flightRadioNational = this.flightModal.locator('#flightSearchRadioNational');
    this.flightRadioInternational = this.flightModal.locator('#flightSearchRadioInternational');
    this.flightDateInput = this.flightModal.locator('input[ngbdatepicker]');
    this.flightManualDateInput = this.flightModal.locator(
      'input[formcontrolname="departReturnSchedule"]'
    );
    this.flightSearchButton = this.flightModal.getByRole('button', {
      name: /^(search|buscar)$/i
    });
    this.flightResultCards = this.flightModal.locator('.flight-result-card');
    this.flightSelectedCard = this.flightModal.locator('.flight-result-card--selected');
    this.flightNoResultsMessage = this.flightModal.getByText(
      /no flights were found|no se encontraron vuelos/i
    );
    this.flightManualInputButton = this.flightModal.getByRole('button', {
      name: /^(manual input|ingreso manual)$/i
    });
    this.flightAcceptButton = this.flightModal.getByRole('button', {
      name: /^(accept|aceptar)$/i
    });
    this.flightCancelButton = this.flightModal.getByRole('button', {
      name: /^(cancel|cancelar)$/i
    });
    this.flightClearButton = this.flightModal.locator(
      '.modal-footer span[role="button"].text-danger'
    );
    this.flightMissingFieldsHint = this.flightModal.locator('.modal-footer .text-danger.small');
    this.flightAirportFilterSelect = this.flightModal.locator('ng-select:not([formcontrolname])');
  }

  /**
   * Navega y espera a que el gate `migrated` resuelva a la V2.
   * Si la pantalla cayera al iframe V1 el assert falla con un mensaje explicito, en lugar de
   * dejar que el spec siga corriendo contra la V1 embebida.
   */
  async goto(): Promise<void> {
    const startedAt = Date.now();
    await this.navigate('/carrier/#/travel/create');

    // Dos asserts separados: uno solo mezclaba el timeout de boot de la SPA + el guard de ruta
    // con el diagnostico del flag `migrated`, y una corrida lenta se leia como "cayo a la V1".
    await expect(
      this.v1Iframe,
      'la ruta cayo al iframe de la V1: el flag `migrated` resolvio false'
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(this.form, 'el formulario V2 debe renderizarse').toBeVisible({
      timeout: 30_000
    });
    // Policy exception (user decision 2026-10-12, H-03): the TEST front is a dev build and this page
    // takes 19-30 s to load. The test timeout is extended ONLY by the measured excess over a normal
    // load (ENV_NORMAL_LOAD_MS), so the product keeps the same functional budget it would have with
    // a normal front. Nothing else raises timeouts; a timeout is still reported as FAILED.
    const loadMs = Date.now() - startedAt;
    if (loadMs > ENV_NORMAL_LOAD_MS) {
      const addedMs = loadMs - ENV_NORMAL_LOAD_MS;
      try {
        const info = test.info();
        if (info.timeout > 0) info.setTimeout(info.timeout + addedMs);
        info.annotations.push({
          type: ENV_SLOW_LOAD_ANNOTATION,
          description: formatSlowLoadDescription(loadMs, addedMs)
        });
      } catch {
        // No test in progress (scripts, unit tests): nothing to extend.
      }
    }
  }

  /** Secciones minimas que prueban que el alta de viaje cargo completa. */
  async expectMainSectionsReady(): Promise<void> {
    await expect(this.form).toBeVisible();
    await expect(this.whoTravelsHeading).toBeVisible();
    await expect(this.clientInput).toBeVisible();
  }

  /**
   * Elige un cliente por texto (typeahead recien pide opciones desde 3 caracteres). Clickea la
   * opcion que CONTIENE la query, no "la primera" (el panel se re-renderiza al responder el
   * servidor), y verifica el EFECTO observable — origen habilitado — no el texto del combo.
   * Detalle de ambos fallos medidos: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
   */
  async selectClient(query: string): Promise<void> {
    await this.clientSelect.click();
    await this.clientInput.fill(query);

    const option = this.dropdownOptions.filter({ hasText: query }).first();
    await expect(
      option,
      `el typeahead de cliente debe devolver al menos una opcion para "${query}"`
    ).toBeVisible({ timeout: CLIENT_DATA_TIMEOUT_MS });
    await option.click();

    await expect(
      this.originInput,
      'elegir cliente debe habilitar el origen (efecto en cascada de idClient)'
    ).toBeEnabled({ timeout: CLIENT_DATA_TIMEOUT_MS });
  }

  /**
   * Picks the Authorizer of a contractor customer (typeahead from 3 characters). Without it
   * «Select Vehicle» stays disabled. Clicks the option CONTAINING the query and asserts the chip.
   */
  async selectAuthorizer(query: string): Promise<void> {
    await expect(
      this.authorizerSelect,
      'the Authorizer field must render after choosing a contractor customer'
    ).toBeVisible({ timeout: CLIENT_DATA_TIMEOUT_MS });
    await this.authorizerSelect.click();
    await this.authorizerSelect.fill(query);

    const option = this.dropdownOptions.filter({ hasText: query }).first();
    await expect(
      option,
      `the authorizer typeahead must return an option for "${query}"`
    ).toBeVisible({ timeout: CLIENT_DATA_TIMEOUT_MS });
    await option.click();

    await expect(
      this.authorizerSelect.locator('xpath=ancestor::ng-select[1]').locator('.ng-value'),
      `the selected authorizer must contain "${query}"`
    ).toContainText(query, { timeout: CLIENT_DATA_TIMEOUT_MS });
  }

  /** Texto del tipo de servicio actualmente seleccionado; espera a que el bloque se renderice. */
  async selectedServiceType(): Promise<string> {
    await expect(
      this.serviceTypeSelect,
      'el bloque de tipo de servicio debe renderizarse tras elegir cliente'
    ).toBeVisible({ timeout: 20_000 });
    // Este ng-select define un label template propio: el valor cae en `.ng-value`, no en
    // `.ng-value-label` (ese wrapper es solo del render por defecto).
    const value = this.serviceTypeSelect.locator('.ng-value').first();
    await expect(value).toBeVisible({ timeout: 20_000 });
    return ((await value.textContent()) ?? '').trim();
  }

  /** Texto del metodo de pago seleccionado (chip `.ng-value`); espera a que exista un valor. */
  async selectedPaymentMethod(): Promise<string> {
    const value = this.paymentMethodSelect.locator('.ng-value').first();
    await expect(
      value,
      'el metodo de pago debe tener un valor seleccionado (default en cascada o elegido)'
    ).toBeVisible({ timeout: CLIENT_DATA_TIMEOUT_MS });
    return ((await value.textContent()) ?? '').replace(/^\s*×\s*/, '').trim();
  }

  /**
   * Elige un metodo de pago por su etiqueta visible (texto contenido, case-insensitive) y
   * verifica que el valor seleccionado la refleje.
   */
  async selectPaymentMethod(label: string | RegExp): Promise<void> {
    await expect(
      this.paymentMethodSelect,
      'el metodo de pago debe renderizarse tras elegir cliente'
    ).toBeVisible({ timeout: CLIENT_DATA_TIMEOUT_MS });
    await this.paymentMethodSelect.click();

    const option = this.dropdownOptions.filter({ hasText: label }).first();
    await expect(option, `debe existir la opcion de pago "${String(label)}"`).toBeVisible({
      timeout: CLIENT_DATA_TIMEOUT_MS
    });
    await option.click();

    // El chip incluye el boton "×" de limpiar: se compara por contenido, no por texto exacto.
    const matcher = typeof label === 'string' ? new RegExp(escapeRegExp(label), 'i') : label;
    await expect(
      this.paymentMethodSelect.locator('.ng-value').first(),
      `el metodo de pago seleccionado debe ser "${String(label)}"`
    ).toHaveText(matcher, { timeout: CLIENT_DATA_TIMEOUT_MS });
  }

  /** Activa o desactiva Destino Abierto. El switch es un checkbox nativo. */
  async toggleOpenDestination(): Promise<void> {
    await this.openDestinationSwitch.click();
  }

  /**
   * Lectura «número + unidad» de «Distancia Teórica Dest. Abierto» (3 decimales en millas), o
   * `null` si la nota no trae ese renglón (parámetro del carrier en 0).
   */
  async readOpenDestinationDistance(): Promise<DistanceReading | null> {
    const text = (await this.openDestinationNote.innerText()).replace(/\s+/g, ' ');
    const match =
      /(?:Theoretical Distance Open Dest\.|Distancia Te[oó]rica Dest\. Abierto):\s*(.+)$/i.exec(
        text
      );
    return match ? parseDistance(match[1]) : null;
  }

  /** Escribe el origen y confirma una sugerencia del autocompletado de direcciones. */
  async fillOrigin(query: string): Promise<void> {
    await this.pickAddress(this.originInput, query);
  }

  /**
   * Vacia el origen (lo autocompleta el cliente elegido, p. ej. CLIENT_QUERY) y confirma que
   * quedo sin valor. Sirve a los TCs cuya precondicion es "origen vacio".
   *
   * Espera (CLIENT_DATA_TIMEOUT_MS, igual que selectClient) a que el origen autocompletado exista y recien entonces
   * lo vacia, sin condicional: el autocompletado asincrono ya no puede dejar la precondicion
   * vacua. Si el cliente elegido no autocompleta origen, falla ruidosamente en esa espera en vez
   * de saltear el vaciado: la precondicion de estos TCs es "cliente con origen por defecto".
   */
  async clearOrigin(): Promise<void> {
    const host = this.originInput.locator('xpath=ancestor::ng-select[1]');
    await expect(
      this.resolvedOriginValue,
      'el cliente debe autocompletar el origen antes de vaciarlo'
    ).toHaveCount(1, { timeout: CLIENT_DATA_TIMEOUT_MS });
    await host.hover();
    await host.locator('.ng-clear-wrapper').click();
    await expect(this.resolvedOriginValue, 'el origen debe quedar vacio').toHaveCount(0);
  }

  /**
   * Sobrescribe el origen SIEMPRE, aunque el cliente elegido lo haya autocompletado (p. ej. Luis
   * Orellano trae un pickup de Buenos Aires en el carrier Francia). Orden: espera a que el cliente
   * termine de autocompletar (si lo hace), vacia el control, elige `query` y comprueba que el
   * origen resuelto cambio y que ya no es el autocompletado. Si el cliente no autocompleta origen
   * no falla: simplemente elige el pedido.
   */
  async overwriteOrigin(query: string): Promise<string> {
    const host = this.originInput.locator('xpath=ancestor::ng-select[1]');
    // Da tiempo al autocompletado asincrono del cliente; si no llega, no hay nada que pisar.
    const autocompleted = await this.resolvedOriginValue
      .waitFor({ state: 'attached', timeout: CLIENT_DATA_TIMEOUT_MS })
      .then(async () => ((await this.resolvedOriginValue.textContent()) ?? '').trim())
      .catch(() => '');
    if (autocompleted) {
      await host.hover();
      await host.locator('.ng-clear-wrapper').click();
      await expect(
        this.resolvedOriginValue,
        'el origen autocompletado debe quedar vacio'
      ).toHaveCount(0);
    }
    await this.pickAddress(this.originInput, query);
    const resolved = ((await this.resolvedOriginValue.textContent()) ?? '').trim();
    expect(
      resolved && resolved !== autocompleted,
      `el origen debe ser el pedido «${query}», no el autocompletado «${autocompleted}» (resuelto: «${resolved}»)`
    ).toBeTruthy();
    return resolved;
  }

  /** Escribe el primer destino y confirma una sugerencia del autocompletado. */
  async fillFirstDestination(query: string): Promise<void> {
    await this.pickAddress(this.firstDestinationInput, query);
  }

  /**
   * Como fillFirstDestination(), pero filtra la sugerencia por `optionPattern` en vez de tomar
   * la primera: la primera coincidencia de Places puede ser un POI, no el aeropuerto real.
   * Investigacion completa: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
   */
  async fillFirstDestinationMatching(query: string, optionPattern: RegExp): Promise<void> {
    await this.firstDestinationInput.click();
    await this.firstDestinationInput.fill(query);

    const option = this.dropdownOptions.filter({ hasText: optionPattern }).first();
    await expect(
      option,
      `el autocompletado debe ofrecer una opcion que matchee ${optionPattern} (ajustar MG19_AIRPORT_OPTION)`
    ).toBeVisible({ timeout: 20_000 });
    await option.click();

    await expect(
      this.firstDestinationInput
        .locator('xpath=ancestor::ng-select[1]')
        .locator('.ng-value')
        .first(),
      'la direccion elegida debe quedar fijada en el control'
    ).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Rutina compartida de autocompletado de direcciones: escribir, esperar sugerencias de
   * Places y confirmar la que coincide con lo buscado.
   */
  private async pickAddress(input: Locator, query: string): Promise<void> {
    await input.click();
    await input.fill(query);

    const suggestion = this.dropdownOptions.filter({ hasText: query }).first();
    await expect(
      suggestion,
      `el autocompletado de direcciones debe sugerir algo para "${query}"`
    ).toBeVisible({ timeout: 25_000 });
    await suggestion.click();

    // ng-select limpia su input de busqueda al confirmar: el valor elegido queda en el
    // `.ng-value` del contenedor, no en el `value` del input.
    await expect(
      input.locator('xpath=ancestor::ng-select[1]').locator('.ng-value').first(),
      'la direccion elegida debe quedar fijada en el control'
    ).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Cuenta las opciones que devuelve el typeahead de cliente, SIN aseverar.
   * Sirve para gatear por datos: si el ambiente no tiene clientes queremos un 0 para poder
   * saltar el test con motivo, no una excepcion que se lea como defecto de producto.
   */
  async clientOptionCount(query: string): Promise<number> {
    await this.clientSelect.click();
    await this.clientInput.fill(query);
    await this.dropdownOptions
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {});
    return this.dropdownOptions.count();
  }

  /**
   * Ensucia el primer destino (escribe y limpia) para que Angular lo marque dirty+invalid y
   * pinte su aviso. El error exige `dirty`, no `touched`: un focus/blur no alcanza. Detalle en
   * docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
   */
  async dirtyFirstDestination(query: string): Promise<void> {
    await this.pickAddress(this.firstDestinationInput, query);
    const host = this.firstDestinationInput.locator('xpath=ancestor::ng-select[1]');
    await host.locator('.ng-clear-wrapper').click();
    await expect(host.locator('.ng-value')).toHaveCount(0);
  }

  /** Cantidad de filas de destino visibles en el FormArray. */
  async destinationRowCount(): Promise<number> {
    return this.page.locator('.trip-address-row').count();
  }

  /** Errores de validacion que contienen un texto dado. */
  errorsContaining(text: string | RegExp): Locator {
    return this.fieldErrors.filter({ hasText: text });
  }

  /**
   * Abre el typeahead de cliente y escribe la query SIN aseverar nada.
   * A diferencia de selectClient(), no espera opciones: sirve para verificar los avisos del
   * combo (minimo de caracteres, sin resultados), donde el panel responde con una opcion
   * deshabilitada en vez de datos.
   */
  async searchClient(query: string): Promise<void> {
    await this.clientSelect.click();
    await this.clientInput.fill(query);
    await expect(this.dropdownNotice.or(this.dropdownOptions.first())).toBeVisible({
      timeout: 20_000
    });
  }

  /** Pide limpiar el formulario SIN confirmar, para poder aseverar el popup o descartarlo. */
  async requestClearForm(): Promise<void> {
    await this.clearFormButton.click();
  }

  /** Descarta el popup de confirmacion dejando el formulario intacto. */
  async keepEditing(): Promise<void> {
    await this.keepEditingButton.click();
    await expect(this.clearConfirmDialog).toBeHidden({ timeout: 10_000 });
  }

  /**
   * Vuelve el formulario a sus valores por defecto, confirmando el popup si aparece (solo
   * aparece cuando hay datos cargados que perder; con el formulario pristino el borrado es
   * directo).
   */
  async clearForm(): Promise<void> {
    await this.requestClearForm();
    const askedForConfirmation = await this.clearConfirmDialog
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (askedForConfirmation) {
      await this.clearConfirmButton.click();
      await expect(this.clearConfirmDialog).toBeHidden({ timeout: 10_000 });
    }
  }

  // === Notas del viaje ===

  /**
   * Abre el modal "Trip notes" desde el boton "Add Note".
   *
   * Cuantos textareas expone depende del estado del formulario: 3 (General/Pick-Up/Private) si
   * no hay destino commiteado, y 4 con la nota de Drop-Off cuando si lo hay. Ver `noteField()`.
   */
  async openNotes(): Promise<void> {
    await this.addNoteButton.click();
    await expect(this.notesDialog).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Reabre el modal de notas desde el lapiz de la tarjeta, la unica via de edicion una vez
   * que hay notas confirmadas (el boton "Add Note" ya no esta en el DOM).
   */
  async editNotesFromCard(): Promise<void> {
    await this.notesCardEditButton.click();
    await expect(this.notesDialog).toBeVisible({ timeout: 15_000 });
  }

  /** Textarea del dialogo por tipo de nota. */
  /**
   * Textarea del dialogo por tipo de nota. Son CUATRO tipos, no tres.
   *
   * `dropOff` (`#noteDest1`) es la nota del primer destino y la genera un `*ngFor` sobre el
   * FormArray `dest`: **solo existe cuando el destino esta COMMITEADO** al array, lo que pasa
   * al pulsar `addStopButton`. Con el destino nada mas resuelto en la fila (chip `.ng-value`
   * visible) el campo NO esta en el DOM. Medido 2026-09-09 — detalle de por que esto se
   * confundio con un defecto: docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
   */
  noteField(kind: 'general' | 'pickUp' | 'dropOff' | 'private'): Locator {
    const ids = {
      general: '#noteGeneral',
      pickUp: '#noteOrigin',
      dropOff: '#noteDest1',
      private: '#noteDriver'
    };
    return this.notesDialog.locator(ids[kind]);
  }

  /**
   * Commitea el destino resuelto al FormArray de destinos (boton "Add" de la fila).
   * Efecto observable: aparece una fila de direccion mas, y con ella la nota de Drop-Off.
   */
  async addStop(): Promise<void> {
    const antes = await this.destinationRowCount();
    await this.addStopButton.click();
    await expect.poll(() => this.destinationRowCount(), { timeout: 15_000 }).toBeGreaterThan(antes);
  }

  /** Carga notas y confirma. Al aceptar, el boton "Add Note" se reemplaza por notesCard. */
  async addNotes(notes: {
    general?: string;
    pickUp?: string;
    dropOff?: string;
    private?: string;
  }): Promise<void> {
    await this.openNotes();
    for (const kind of ['general', 'pickUp', 'dropOff', 'private'] as const) {
      const value = notes[kind];
      if (value !== undefined) await this.noteField(kind).fill(value);
    }
    await this.notesDialog.getByRole('button', { name: /^(aceptar|accept)$/i }).click();
    await expect(this.notesDialog).toBeHidden({ timeout: 15_000 });
  }

  /** Cierra el dialogo descartando lo escrito. */
  async discardNotes(): Promise<void> {
    await this.notesDialog.getByRole('button', { name: /^(cancelar|cancel)$/i }).click();
    await expect(this.notesDialog).toBeHidden({ timeout: 15_000 });
  }

  /**
   * Valor de una nota confirmada en la tarjeta del formulario.
   * VERIFICADOS en vivo 'general' y 'origin' (2026-09-08, `.tnc-label--general` y
   * `.tnc-label--origin` con su `.tnc-value`); el sufijo 'driver' se deriva del mismo patron
   * de clase pero todavia no fue observado.
   */
  savedNote(kind: 'general' | 'origin' | 'driver'): Locator {
    return this.page.locator(`app-trip-notes-display .tnc-row:has(.tnc-label--${kind}) .tnc-value`);
  }

  // === Cotizacion y envio ===

  /**
   * Dispara el calculo de ruta y tarifas ("Select Vehicle"). Recien despues de esto la
   * pantalla revela Vehicle Types (con un tipo ya elegido), los importes y los botones de
   * envio: antes NO estan en el DOM.
   */
  async quoteTrip(): Promise<void> {
    await this.selectVehicleButton.click();
    await expect(this.selectedVehicleCard).toBeVisible({ timeout: 45_000 });
    await expect(this.submitButton).toBeVisible({ timeout: 45_000 });
  }

  /**
   * Importe de una fila del resumen. Las filas no tienen id ni data-*: se distinguen por el
   * texto de su label, asi que el label es el ancla.
   */
  amount(label: RegExp): Locator {
    return this.page
      .locator('div.bg-light.rounded')
      .filter({ hasText: label })
      .locator('strong')
      .first();
  }

  /**
   * Crea el viaje con "Enviar Servicio" y devuelve el id del viaje creado, leido de la URL de
   * redireccion (`#/driver/list/Assign?id=<travelId>`) sin tocar la red. El viaje queda en
   * estado SEARCHING_DRIVER y aparece en el tab Assign de Trips Management.
   */
  async sendService(): Promise<string> {
    await this.submitButton.click();
    await this.page.waitForURL(
      (url) => url.hash.includes('/driver/list/Assign') && url.hash.includes('id='),
      { timeout: 60_000 }
    );
    const query = this.page.url().split('?')[1] ?? '';
    const id = new URLSearchParams(query).get('id');
    if (!id) {
      throw new Error(`no se pudo extraer el travelId de la URL: ${this.page.url()}`);
    }
    return id;
  }

  /**
   * Abre el modal de vuelo desde el boton "avion" del PRIMER destino (`destiny-airport`,
   * H_gate: solo visible si `isAirport` del punto y con `idClient != 0`).
   */
  async openFlightModalFromDestination(): Promise<void> {
    await this.destinationFlightButton.click();
    await expect(this.flightModal, 'el modal de vuelo debe abrirse').toBeVisible({
      timeout: 15_000
    });
  }

  /** Abre el modal de vuelo desde el boton "avion" del ORIGEN. Fuera de alcance de MU-039. */
  async openFlightModalFromOrigin(): Promise<void> {
    await this.originFlightButton.click();
    await expect(this.flightModal, 'el modal de vuelo debe abrirse').toBeVisible({
      timeout: 15_000
    });
  }

  /** Elige aerolinea del typeahead (>=2 caracteres); verifica el EFECTO (Search habilitado). */
  async selectFlightAirline(query: string): Promise<void> {
    await this.flightAirlineSelect.click();
    await this.flightAirlineInput.fill(query);

    const option = this.flightAirlineOptions.filter({ hasText: query }).first();
    await expect(
      option,
      `el typeahead de aerolinea debe devolver al menos una opcion para "${query}"`
    ).toBeVisible({ timeout: 20_000 });
    await option.click();

    await expect(
      this.flightAirlineSelect.locator('.ng-value'),
      'la aerolinea elegida debe ser la buscada'
    ).toContainText(query);
    await expect(
      this.flightSearchButton,
      'elegir una aerolinea de la lista debe habilitar Search (isAirlineSelected)'
    ).toBeEnabled({ timeout: 10_000 });
  }

  /** Dispara la busqueda de vuelos y espera la respuesta de getFlights (observacion pasiva de red). */
  async searchFlights(flightNumber?: string): Promise<Response> {
    if (flightNumber !== undefined) {
      await this.flightNumberInput.fill(flightNumber);
    }

    const [response] = await Promise.all([
      this.page.waitForResponse('**/flights/getFlights/**', { timeout: 45_000 }),
      this.flightSearchButton.click()
    ]);
    return response;
  }

  /**
   * Clickea una card de resultado. H6: `onFlightClick` es un TOGGLE — clickear la card ya
   * seleccionada la deselecciona en lugar de dejarla fija.
   */
  async toggleFlightResult(index = 0): Promise<void> {
    await this.flightResultCards.nth(index).click();
  }

  // === Destino frecuente y ruta (MG-682) ===

  /**
   * Abre el modal de seleccion de destino frecuente.
   * El boton exige cliente elegido (`[disabled]="idClient == 0 || isOpenDestinationTrip"`).
   */
  async openFrequentDestinationsModal(): Promise<FrequentDestinationsModalPage> {
    await this.frequentDestinationButton.click();
    const modal = new FrequentDestinationsModalPage(this.page);
    await modal.expectVisible();
    return modal;
  }

  /** Lee el estado actual de los tres toggles de ruta. */
  async readRouteToggles(): Promise<{
    avoidTolls: boolean;
    avoidHighways: boolean;
    fastestRoute: boolean;
  }> {
    return {
      avoidTolls: await this.avoidTollsCheckbox.isChecked(),
      avoidHighways: await this.avoidHighwaysCheckbox.isChecked(),
      fastestRoute: await this.fastestRouteSwitch.isChecked()
    };
  }

  /** Alterna un toggle de ruta al valor pedido, solo si no lo tiene ya. */
  async setRouteToggle(
    flag: 'avoidTolls' | 'avoidHighways' | 'fastestRoute',
    checked: boolean
  ): Promise<void> {
    const map = {
      avoidTolls: this.avoidTollsCheckbox,
      avoidHighways: this.avoidHighwaysCheckbox,
      fastestRoute: this.fastestRouteSwitch
    };
    const el = map[flag];
    if ((await el.isChecked()) !== checked) await el.click();
  }

  /**
   * Click en "Seleccionar Vehiculo" capturando en paralelo el body del POST a
   * `travels/simulateAll` que dispara. Si el request no llega, `waitForRequest` agota su
   * timeout y el test falla explicito (no silencioso).
   */
  async selectVehicleAndCaptureSimulateAllBody(): Promise<Record<string, unknown>> {
    const [request] = await Promise.all([
      this.page.waitForRequest(
        (req) => req.url().includes('/travels/simulateAll') && req.method() === 'POST',
        { timeout: 30_000 }
      ),
      this.selectVehicleButton.click()
    ]);
    return request.postDataJSON();
  }

  /**
   * Envia el servicio capturando el POST de alta, y devuelve su body junto al id del viaje.
   *
   * No usa `sendService()` a proposito. Ese metodo espera la navegacion a la pantalla de
   * asignacion, que SOLO ocurre cuando el carrier tiene `INSTANT_ASSIGNMENT` activo: por
   * decision de producto del 2026-08-23 (`new-trip.component.ts`, `navigateAfterCreate`),
   * sin ese parametro el alta navega a la grilla de viajes con `limitExceeded` y SIN el id
   * en la URL. El carrier 1521 lo tiene apagado, asi que ahi `sendService()` agota su
   * espera aunque el viaje se haya creado bien.
   *
   * Leer el id de la respuesta del alta funciona en los dos caminos y no depende de a que
   * pantalla navegue la app despues.
   */
  async submitAndCaptureCreate(): Promise<{
    body: Record<string, unknown>;
    travelId: string;
  }> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          /\/carriers\/\d+\/travels(?:\?.*)?$/.test(res.url()) && res.request().method() === 'POST',
        { timeout: 60_000 }
      ),
      this.submitButton.click()
    ]);

    const body = response.request().postDataJSON() as Record<string, unknown>;
    const payload = (await response.json()) as { travelId?: unknown; id?: unknown };
    const travelId = String(payload.travelId ?? payload.id ?? '');
    if (!travelId || travelId === 'undefined') {
      throw new Error(
        `el alta no devolvio el id del viaje (status ${response.status()}): ${JSON.stringify(payload).slice(0, 300)}`
      );
    }
    return { body, travelId };
  }

  // === MG-19 ronda 2: Destino Abierto (TC162/163/165/166/169/170/171/175) ===
  //
  // Metodos agregados en esta ola (2026-09-09) para cerrar el hueco "Destino Abierto" del
  // corpus MG-19. Van al final de la clase, no intercalados, para no reordenar el diff de los
  // metodos ya validados en vivo (new-trip.spec.ts, new-trip-route-flags.spec.ts).

  /**
   * Abre el combo de tipo de servicio y elige la primera opcion que matchee `pattern`.
   *
   * Mismo cuidado que `selectClient()`: si el ambiente no tiene un tipo de servicio de la
   * partición pedida (p.ej. mensajeria/COURIER), el mensaje de error lo dice explicito para
   * distinguir un problema de datos de un defecto de producto — no hay `service_type` fijo
   * conocido en el carrier de test, asi que la busqueda es por patron, configurable por
   * ambiente igual que `CLIENT_QUERY` en el spec.
   */
  async selectServiceTypeMatching(pattern: RegExp): Promise<void> {
    await expect(
      this.serviceTypeSelect,
      'el bloque de tipo de servicio debe renderizarse tras elegir cliente'
    ).toBeVisible({ timeout: 20_000 });
    await this.serviceTypeSelect.click();

    const option = this.dropdownOptions.filter({ hasText: pattern }).first();
    await expect(
      option,
      `el carrier de test debe tener un tipo de servicio que matchee ${pattern} (ajustar MG19_COURIER_SERVICE_TYPE)`
    ).toBeVisible({ timeout: 10_000 });
    await option.click();
  }

  /**
   * Agrega una parada (fila nueva al final del FormArray `destination`) y resuelve su
   * direccion. El boton "+" vive DENTRO de la fila que hoy es la ultima — por eso se ubica por
   * indice (`destinationFormRows.last()`), no por clase dinamica: apenas se agrega una parada,
   * la fila vieja pasa a ser intermedia y la clase que trae el "+" se recalcula.
   */
  async addDestinationStop(query: string): Promise<void> {
    const rowsBefore = await this.destinationFormRows.count();
    const addButtonOnLastRow = this.destinationFormRows
      .last()
      .getByRole('button', { name: /^(agregar|add)$/i });
    await addButtonOnLastRow.click();

    await expect(
      this.destinationFormRows,
      'agregar parada debe sumar una fila al FormArray de destino'
    ).toHaveCount(rowsBefore + 1);

    const newRowInput = this.destinationFormRows.last().getByRole('combobox').first();
    await this.pickAddress(newRowInput, query);
  }

  /**
   * Activa "Ida y vuelta" desde el boton de la ultima fila de destino. El propio componente
   * espeja el origen en `origin2` al activarlo (`selectRoundTrip()`), asi que no hace falta
   * resolver una direccion de regreso a mano: `returnDestinationRow` visible ya es la prueba
   * de que el destino de regreso quedo cargado.
   */
  async activateRoundTrip(): Promise<void> {
    await this.roundTripButton.click();
    await expect(
      this.returnDestinationRow,
      'activar ida y vuelta debe mostrar la fila de destino de regreso (origin2)'
    ).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Click en "Seleccionar Vehiculo" capturando la RESPUESTA (no el request) de
   * `travels/simulateAll`. A diferencia de `selectVehicleAndCaptureSimulateAllBody()` (que lee
   * lo que la pantalla ENVIA), esto lee lo que el backend CONTESTA — necesario para TC170
   * (Destino Abierto cotiza con distancia cero): `distance`/`routeDistance` y
   * `pricePointToPoint` solo estan en la respuesta, no en el payload de simulacion.
   * Tipo de la respuesta: `TravelSimulateResponseDto[]` (magiis-fe-carrier-v2,
   * apiInterfaces.d.ts:867-893) — no tipado aca porque este repo no importa esos DTOs del
   * front, se leen como `Record<string, unknown>` igual que el resto de los metodos de captura
   * de red de esta clase.
   */
  async selectVehicleAndCaptureSimulateAllResponse(): Promise<Record<string, unknown>[]> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/travels/simulateAll') && res.request().method() === 'POST',
        { timeout: 30_000 }
      ),
      this.selectVehicleButton.click()
    ]);
    const body = (await response.json()) as Record<string, unknown>[];
    if (!Array.isArray(body) || body.length === 0) {
      throw new Error(
        `simulateAll no devolvio opciones de vehiculo (status ${response.status()}): ${JSON.stringify(body).slice(0, 300)}`
      );
    }
    return body;
  }

  // === MG-995/MG-996 fase 1: Otros Costos en el alta (TM-1084..1091, TM-1277, TM-1279) ===
  //
  // Bloque agregado al final (regla de unidad: solo miembros nuevos, sin reordenar lo validado).
  // Los locators se declaran con inicializador de campo en vez de sumarse al constructor para no
  // tocar el cuerpo existente: corren justo despues de `super()`, cuando `this.page` ya existe.
  //
  // PROVENIENCIA: relevamiento docs/analysis/migration-evidence/new-trip-other-costs-2026-09-29.md
  // §1-§3, verificado contra magiis-fe-carrier-v2 origin/release/v2.0.17 (commit 6e39104c),
  // `src/app/pages/carrier/trips/new-trip/new-trip.component.html` (lineas citadas en cada miembro).
  // El bloque vive dentro de `[hidden]="!showVehicleTypesOptions"` (html:1026): existe en el DOM
  // pero con ancho 0 hasta que responde `simulateAll`. Siempre llamar `quoteTrip()` antes.
  // Sin nombre accesible en "+", borrar y X (hallazgo H-2): se ancla por contenedor + clase acotada.

  /**
   * URL del POST de alta de viaje (`POST carriers/{id}/travels`, addTravel.command.ts:10-21).
   * Fuente única: la usan `sendManualAndCaptureCreate()` y el contador/registro de altas de la
   * capa Steps (oráculo «el alta no se guarda» de TM-1277/TM-1279 y limpieza de viajes).
   */
  static readonly CREATE_TRAVEL_URL = /\/carriers\/\d+\/travels(?:\?.*)?$/;

  /**
   * Contenedor del bloque Otros Costos (`div.mb-3.mt-3`, html:1448). Se filtra por el label de
   * la seccion (`label.col-form-label`, html:1451-1453) y no por `getByText` suelto: el texto
   * «Other Costs» tambien existe en el menu lateral (Configuracion > Otros Costos).
   */
  readonly otherCostsBlock: Locator = this.page.locator('div.mb-3.mt-3').filter({
    has: this.page.locator('label.col-form-label', {
      hasText: /^\s*(otros costos|other costs)\s*$/i
    })
  });
  /**
   * Total de la seccion (`totalOtherCosts`, `span.fw-semibold` del encabezado, html:1459).
   * Formato `currencySymbolFormat` con 2 decimales (`$ 1,234.50`).
   */
  readonly otherCostsTotal: Locator = this.otherCostsBlock.locator('span.fw-semibold').first();
  /** Boton «+» que abre el modal (`showModalOtherCosts`, html:1464-1466). Sin nombre accesible. */
  readonly addOtherCostButton: Locator = this.otherCostsBlock.locator('button.btn-soft-primary');
  /**
   * Lineas agregadas (`*ngFor="let cost of otherCostsList"`, `div.ps-2`, html:1470-1497). Solo se
   * renderizan con la seccion expandida (`showOtherCostsSection`, default `true`, ts:784).
   */
  readonly otherCostLines: Locator = this.otherCostsBlock.locator(
    // `div.nt-other-cost-item` = markup observado en TEST 2026-10-13 (probe TM-1111); `div.ps-2` = release v2.0.17.
    'div.nt-other-cost-item, div.ps-2'
  );
  /**
   * «Enviar Manual» / «Send Manual» (`onSendManualClick`, `isSpecialAssign=true`; html:1613-1620,
   * ts:5942-5945). El viaje queda en Assign sin despacho automatico a choferes.
   */
  readonly sendManualButton: Locator = this.page.getByRole('button', {
    name: /^(enviar manual|send manual)$/i
  });
  /** Footer del shell: «© Copyright AAAA. MAGIIS. All rights reserved - vX.Y.Z» (layouts/footer). */
  readonly appFooter: Locator = this.page.locator('footer.footer');

  /**
   * Linea del bloque cuyo concepto es EXACTAMENTE `name`. El label varia por tipo (html:1475-1488):
   * PCT «nombre (P%)», QTY o FIX con cantidad > 1 «nombre (×N)», resto «nombre». La regex admite
   * solo esos sufijos para no confundir conceptos que comparten prefijo.
   */
  otherCostLine(name: string): Locator {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.otherCostLines.filter({
      has: this.page.locator('span.text-muted.small', {
        hasText: new RegExp(`^\\s*${escaped}(\\s*\\((×\\s*\\d+|-?[\\d.,]+\\s*%)\\))?\\s*$`)
      })
    });
  }

  /** Importe de una linea (`cost.total`, primer `span` del grupo de acciones, html:1490). */
  otherCostLineAmount(name: string): Locator {
    return this.otherCostLine(name)
      .locator('span.nt-amount, div.gap-2 > span:not(.text-muted):not(.nt-amounts)')
      .first();
  }

  /**
   * Total que muestra el encabezado de una seccion opcional del resumen (Cargos Fijos html:1504-1513,
   * Impuestos html:1525-1534). Mismo patron que Otros Costos: label de la seccion → fila de
   * encabezado (`justify-content-between`) → `span.fw-semibold`.
   */
  private sectionHeaderTotal(label: RegExp): Locator {
    return this.page
      .locator('label.col-form-label', { hasText: label })
      .locator('xpath=ancestor::div[contains(@class,"justify-content-between")][1]')
      .locator('span.fw-semibold')
      .first();
  }

  /**
   * Abre el modal «Agregar Otro Costo» desde el «+» del bloque. Exige haber cotizado antes
   * (`quoteTrip()`): sin `simulateAll` el bloque esta oculto.
   */
  async openAddOtherCostModal(): Promise<AddOtherCostModalPage> {
    await expect(
      this.addOtherCostButton,
      'el bloque Otros Costos solo aparece despues de «Select Vehicle» (llamar quoteTrip())'
    ).toBeVisible({ timeout: 15_000 });
    await this.addOtherCostButton.click();
    const modal = new AddOtherCostModalPage(this.page);
    await modal.expectVisible();
    return modal;
  }

  /**
   * Agrega un concepto de punta a punta: abre el modal, elige el concepto por nombre exacto,
   * carga cantidad (QTY/FIX) o importe (VAR) si se pasan, acepta y verifica que la linea aparece.
   * FIX y PCT usan su precarga (sin tipeo), como pide el plan (§10, mascaras).
   */
  async addOtherCost(opts: {
    name: string;
    quantity?: number;
    amount?: number | string;
  }): Promise<void> {
    const modal = await this.openAddOtherCostModal();
    await modal.selectConcept(opts.name);
    if (opts.quantity !== undefined) await modal.setQuantity(opts.quantity);
    if (opts.amount !== undefined) await modal.setAmount(opts.amount);
    await modal.accept();
    await expect(
      this.otherCostLine(opts.name),
      `el concepto "${opts.name}" debe aparecer como linea del bloque Otros Costos`
    ).toHaveCount(1, { timeout: 10_000 });
  }

  /**
   * Quita un concepto con su boton de borrar (`deleteOtherCost(cost.id)`, sin confirmacion,
   * html:1495, ts:7932-7936) y verifica que la linea desaparece.
   */
  async removeOtherCost(name: string): Promise<void> {
    const line = this.otherCostLine(name);
    await expect(line, `no hay linea "${name}" para quitar`).toHaveCount(1);
    await line.locator('button.btn-soft-danger').click();
    await expect(line, `quitar "${name}" debe sacar su linea del bloque`).toHaveCount(0, {
      timeout: 10_000
    });
  }

  /**
   * Lee el resumen de importes tal como lo pinta la pantalla, SIN parsear: los textos vienen con
   * `currencySymbolFormat` (`$ 1,234.56`) y el parseo es responsabilidad del llamador
   * (`tests/utils/money.ts`, plan §5.1), para no duplicar la regla de separadores en el POM.
   * - `subtotal`: fila «Subtotal» (html:1401-1421; con Costo Fijo muestra el monto fijo).
   * - `otherCosts`: encabezado del bloque (html:1459).
   * - `fixedFees` / `taxes`: encabezados opcionales (`*ngIf` por lista vacia) → `null` si no estan.
   * - `total`: fila «Trip Total» / «Total del Viaje» (`totalWithTaxesTrip`, html:1552-1566).
   * - `lines`: cada linea del bloque con su label crudo (incluye el sufijo «(×N)» / «(P%)»).
   */
  async readPriceSummary(): Promise<{
    subtotal: string;
    otherCosts: string;
    fixedFees: string | null;
    taxes: string | null;
    total: string;
    lines: { label: string; amount: string }[];
  }> {
    const subtotalCell = this.amount(/subtotal/i);
    const totalCell = this.amount(/trip total|total del viaje/i);
    await expect(subtotalCell, 'el resumen solo existe despues de cotizar').toBeVisible({
      timeout: 15_000
    });
    await expect(totalCell).toBeVisible();

    const optionalText = async (cell: Locator): Promise<string | null> =>
      (await cell.count()) > 0 ? ((await cell.textContent()) ?? '').trim() : null;

    const lines: { label: string; amount: string }[] = [];
    for (const line of await this.otherCostLines.all()) {
      lines.push({
        label: ((await line.locator('span.text-muted.small').first().textContent()) ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        amount: (
          (await line
            .locator('span.nt-amount, div.gap-2 > span:not(.text-muted):not(.nt-amounts)')
            .first()
            .textContent()) ?? ''
        ).trim()
      });
    }

    return {
      subtotal: ((await subtotalCell.textContent()) ?? '').trim(),
      otherCosts: ((await this.otherCostsTotal.textContent()) ?? '').trim(),
      fixedFees: await optionalText(this.sectionHeaderTotal(/^\s*(cargos fijos|fixed fees)\s*$/i)),
      taxes: await optionalText(this.sectionHeaderTotal(/^\s*(impuestos|taxes)\s*$/i)),
      total: ((await totalCell.textContent()) ?? '').trim(),
      lines
    };
  }

  /**
   * Crea el viaje con «Enviar Manual» capturando el POST de alta (`POST carriers/{id}/travels`,
   * addTravel.command.ts:10-21) y devuelve request, respuesta e id. Espejo de
   * `submitAndCaptureCreate()` para el boton manual: el id se lee de la RESPUESTA, no de la URL,
   * porque la navegacion posterior depende de `INSTANT_ASSIGNMENT` (`navigateAfterCreate`).
   * El id puede venir en `travelId`, `id` o `travel.travelId` / `travel.id` (ts:5760-5765).
   * No asevera el status: un alta rechazada lanza con el status y SOLO los nombres de las claves
   * de la respuesta (el cuerpo puede traer datos del pasajero y termina en el comentario de Xray).
   * El registro del viaje para la limpieza no depende de este metodo: lo hace la capa Steps con
   * un listener de `response` sobre la misma URL.
   */
  async sendManualAndCaptureCreate(): Promise<{
    requestBody: Record<string, unknown>;
    responseBody: Record<string, unknown>;
    status: number;
    travelId: string;
  }> {
    await expect(this.sendManualButton, '«Send Manual» debe estar habilitado').toBeEnabled({
      timeout: 15_000
    });
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => NewTripPage.CREATE_TRAVEL_URL.test(res.url()) && res.request().method() === 'POST',
        { timeout: 60_000 }
      ),
      this.sendManualButton.click()
    ]);

    const requestBody = response.request().postDataJSON() as Record<string, unknown>;
    const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const nested = (responseBody.travel ?? {}) as Record<string, unknown>;
    const rawId = responseBody.travelId ?? responseBody.id ?? nested.travelId ?? nested.id;
    const travelId = rawId === undefined || rawId === null ? '' : String(rawId);
    if (!response.ok() || !travelId) {
      throw new Error(
        `el alta manual no devolvio el id del viaje (status ${response.status()}, claves de la respuesta: [${Object.keys(responseBody).join(', ')}])`
      );
    }
    return { requestBody, responseBody, status: response.status(), travelId };
  }

  /**
   * Version del front desplegado leida del footer del shell (`vX.Y.Z`), para el run record y el
   * comentario del run (CONVENTIONS §13). Devuelve `null` si el footer no la expone.
   */
  async appVersion(): Promise<string | null> {
    const text =
      (await this.appFooter
        .first()
        .textContent()
        .catch(() => null)) ?? '';
    return text.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? null;
  }
}
