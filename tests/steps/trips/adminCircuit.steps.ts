// tests/steps/trips/adminCircuit.steps.ts
// Recorrido reusable del circuito admin: alta por UI -> cancel / finalizeAdmin por API -> lecturas
// de detalle y de cuenta corriente -> medicion. Plan PLAN-E2E-ALTA-CIRCUITO-ADMIN-2026-10-13 §3.1/§3.3/§3.4.
//
// Reglas:
// - Cada metodo es un paso atomico: ninguno llama a otro (la secuencia la orquesta el spec).
// - Los viajes terminan DONE a proposito: se anotan en el registro `admin-circuit` apenas se captura
//   el travelId, para excluirlos de la regresion manual R-01. Ningun barrido los cancela.
// - Sin esperas fijas, sin reintentos, sin expects ablandados: ante un fallo de API se lanza.
// - Chofer de finalizeAdmin: env `ADMIN_FINALIZE_DRIVER_ID` (DRIVER.ID, NO un USER_ID; en TEST es
//   4987). Nunca se hardcodea.
import type { CostSalePair, TariffEvidence } from '../../helpers/cost-sale.js';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  getCurrentEnv,
  isCircuitCreateGateOpen,
  isCircuitGateOpen,
  type CarrierRegion
} from '../../config/runtime.js';
import { requirePrep, type CarrierProfile, type PrepPair } from '../../config/carrier-profiles.js';
import {
  expectedQuote,
  PREP_SCENARIOS,
  scenarioCosts,
  type ExpectedQuote,
  type PrepScenario
} from '../../data/carrier-v2/trips/prep-scenarios.js';
import {
  assertDriverMatchesPair,
  assertEnvMatchesProfile,
  detailDriverId,
  evaluatePrepClosure,
  type ClosureMismatch
} from '../../helpers/circuit-guards.js';
import {
  TripEditPage,
  type FinalPriceEditResult
} from '../../pages/carrier-v2/trips/TripEditPage.js';
import { ApiStatusError } from '../../api/clients/carrierSession.js';
import type {
  CheckingAccountClient,
  CheckingAccountRow
} from '../../api/clients/checkingAccount.client.js';
import type { TravelDetail, TravelsClient } from '../../api/clients/travels.client.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { TravelDashboardPage } from '../../pages/carrier-v2/trips/TravelDashboardPage.js';
import { TravelDetailPage } from '../../pages/carrier-v2/trips/TravelDetailPage.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { recordAdminCircuitTrip } from '../../helpers/trip-ledger.js';
import { quoteRouteFor } from '../../data/carrier-v2/trips/quote-route.js';
import { parseMoney } from '../../utils/money.js';

/** Nota de oraculo pendiente para los comentarios Xray de los runs con cancelacion. */
export const DB_ORACLE_PENDING_NOTE =
  'Oraculo DB pendiente (columnas TRAVEL_HISTORY, fase 2): en API el cancel sin cargo deja amount null/0.';

/** Resultado del alta: id capturado de la respuesta del POST y total cotizado en pantalla. */
export type AdminCircuitCreated = {
  travelId: number;
  simulatedAmount: number;
  /** Origen/destino resueltos por la pantalla (el spec asevera que difieran: si no, distancia 0 y precio 0). */
  resolvedOrigin: string;
  resolvedDestination: string;
  /** Resumen de importes crudo tal como lo pinta la pantalla tras cotizar (ver `readPriceSummary`). */
  summary: Awaited<ReturnType<NewTripPage['readPriceSummary']>>;
};

/**
 * Medicion por run (plan §3.4). `states` = estado tras alta / cancel / finalizeAdmin (null si el
 * paso no se ejecuto). `detailAfter` debe ser una vista de lista blanca (sin PII del pasajero).
 */
export type AdminCircuitMeasurement = {
  travelId: number;
  paymentMethod: string;
  simulatedAmount: number;
  states: [string | null, string | null, string | null];
  finalizeAdminStatus: number | string | null;
  detailAfter: Record<string, unknown> | null;
  /** `amount` crudo del detalle tras cancelar (null = sin FINALPRICEI; ver `expectNoCharge`). */
  rawCancelledAmount?: number | null;
  dbOracle?: string;
  /** Sale/cost pairs of the closed trip detail (expectCostEqualsSale); null if the oracle failed. */
  costSalePairs?: CostSalePair[] | null;
  /** Effective-tariff evidence of the closed trip (tariffEvidence); source `unverified` if the API hides it. */
  tariff?: TariffEvidence;
  movement?: {
    id: number | string | null;
    type: string | null;
    mount: number | null;
    balanceBefore: number | null;
    balanceAfter: number | null;
  };
  /** Chofer de la finalizacion; null si el run no finalizo (F-D). */
  driverId: number | null;
  /** `detail` = leido del detalle tras finalizar; `config` = solo env; `none` = sin finalizar. */
  driverIdSource: 'detail' | 'config' | 'none';
  /** Comentario del run (annotation `xray_comment`), p. ej. la cita a MG-1581 en F-B. */
  comment?: string;
};

export type AdminCircuitMovementRead = {
  rows: CheckingAccountRow[];
  /** Saldo API de la CC (NO es el BALANCE de DB): comparar deltas por fila, no absolutos. */
  balance: number | null;
};

/** DRIVER.ID del chofer de la finalizacion administrativa, desde el entorno (falla rapido). */
function adminFinalizeDriverId(): number {
  const raw = process.env.ADMIN_FINALIZE_DRIVER_ID?.trim();
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    throw new Error(
      '[adminCircuit] ADMIN_FINALIZE_DRIVER_ID no definido o invalido (debe ser un DRIVER.ID entero positivo)'
    );
  }
  return id;
}

export class AdminCircuitFlow {
  readonly runId = makeRunId();

  constructor(
    private readonly travels: TravelsClient,
    private readonly checkingAccount: CheckingAccountClient
  ) {}

  /**
   * Alta por UI con «Enviar Manual» (queda en Assign, sin despacho automatico). Orden: cliente ->
   * metodo de pago -> origen -> destino -> cotizar. `simulatedAmount` = «Trip Total» del resumen de
   * precios tras cotizar (incluye otros costos), parseado con `parseMoney`. El travelId sale de la
   * respuesta del POST de alta y se registra en el ledger `admin-circuit` antes de cualquier
   * aserto posterior.
   *
   * F-C: `otherCostName` agrega ese concepto (nombre exacto del catalogo) tras cotizar y antes de
   * leer el total; `otherCostAmount` se teclea solo para conceptos VAR (FIX/QTY/PCT usan su
   * precarga). El total simulado ya incluye el otro costo.
   */
  async createViaUi(params: {
    page: Page;
    client: string;
    paymentMethod: string | RegExp;
    otherCostName?: string;
    otherCostAmount?: number;
    authorizer?: string;
    /** Region del carrier; 'FR' usa la ruta FR_* y sobrescribe el origen autocompletado por el cliente. */
    region?: CarrierRegion;
    /**
     * Perfil de carrier del circuito administrativo: equivale al comportamiento 'FR' (gate de alta, ruta
     * <PREFIX>_*, origen sobrescrito) para el carrier del perfil. Tiene prioridad sobre `region`.
     */
    circuitProfile?: CarrierProfile;
    /**
     * Precondiciones anti-vacuidad del SPEC (origen != destino, cotizado > 0). Se invoca tras leer la
     * cotizacion y ANTES de enviar: si lanza, no se crea ningun viaje. Por convencion es obligatorio;
     * sin callback se emite un console.warn (el step no asevera reglas de negocio).
     */
    assertBeforeSubmit?: (quote: {
      simulatedAmount: number;
      resolvedOrigin: string;
      resolvedDestination: string;
    }) => void | Promise<void>;
  }): Promise<AdminCircuitCreated> {
    const {
      page,
      client,
      paymentMethod,
      otherCostName,
      otherCostAmount,
      authorizer,
      region,
      circuitProfile,
      assertBeforeSubmit
    } = params;
    const isCircuitTrip = circuitProfile !== undefined || region === 'FR';
    if (isCircuitTrip && !isCircuitCreateGateOpen()) {
      throw new Error(
        '[adminCircuit] el alta del circuito crea un viaje real; requiere FR_CIRCUIT_CREATE_TRIP=1 (o CIRCUIT_PREP_CREATE_TRIPS=1)'
      );
    }
    const route = quoteRouteFor(region, circuitProfile?.envPrefix);
    const trip = new NewTripPage(page);
    await trip.goto();
    await trip.selectClient(client);
    if (authorizer !== undefined) {
      await trip.selectAuthorizer(authorizer);
    }
    await trip.selectPaymentMethod(paymentMethod);
    if (isCircuitTrip) await trip.overwriteOrigin(route.origin);
    else await trip.fillOrigin(route.origin);
    await trip.fillFirstDestination(route.destination);
    const resolvedOrigin = ((await trip.resolvedOriginValue.textContent()) ?? '').trim();
    const resolvedDestination = ((await trip.resolvedDestinationValue.textContent()) ?? '').trim();
    const caller = (new Error().stack ?? '').split('\n')[2]?.trim() ?? 'caller desconocido';
    const created = await this.quoteAndSubmit(trip, {
      costs: otherCostName !== undefined ? [{ name: otherCostName, amount: otherCostAmount }] : [],
      resolvedOrigin,
      resolvedDestination,
      readBase: false,
      assertBeforeSubmit,
      caller
    });
    return {
      travelId: created.travelId,
      simulatedAmount: created.simulatedAmount,
      summary: created.summary,
      resolvedOrigin,
      resolvedDestination
    };
  }

  /**
   * Cuerpo comun del alta (extraido de `createViaUi`, plan D5): cotiza, agrega los conceptos, lee el resumen, corre
   * el aserto anti-vacuidad del SPEC y envia con «Enviar Manual». El travelId sale de la respuesta del POST y se
   * registra en el ledger `admin-circuit`. `readBase` lee el total tras cotizar y ANTES de los conceptos
   * (`baseAmount`: base del total esperado); con false queda null y no se hace la lectura extra.
   */
  private async quoteAndSubmit(
    trip: NewTripPage,
    p: {
      costs: ReadonlyArray<{ name: string; amount?: number }>;
      resolvedOrigin: string;
      resolvedDestination: string;
      readBase: boolean;
      assertBeforeSubmit?: (quote: {
        simulatedAmount: number;
        resolvedOrigin: string;
        resolvedDestination: string;
        baseAmount: number | null;
      }) => void | Promise<void>;
      caller: string;
    }
  ): Promise<AdminCircuitCreated & { baseAmount: number | null }> {
    await trip.quoteTrip();
    const baseAmount = p.readBase ? parseMoney((await trip.readPriceSummary()).total) : null;
    for (const cost of p.costs) {
      await trip.addOtherCost({ name: cost.name, amount: cost.amount });
    }
    const summary = await trip.readPriceSummary();
    const simulatedAmount = parseMoney(summary.total);
    // Anti-vacuidad: un cotizado en 0 haria pasar `0 == 0` en vacio (run 2026-10-13: cliente 'test'
    // + ruta por defecto cotizo 0 y TM-1403 quedo verde sin probar nada). Lo asevera el spec ANTES de crear.
    if (p.assertBeforeSubmit) {
      await p.assertBeforeSubmit({
        simulatedAmount,
        resolvedOrigin: p.resolvedOrigin,
        resolvedDestination: p.resolvedDestination,
        baseAmount
      });
    } else {
      console.warn(
        `[adminCircuit] createViaUi sin assertBeforeSubmit (inseguro: una cotizacion en 0 crearia un viaje real igual). Caller: ${p.caller}`
      );
    }

    const created = await trip.sendManualAndCaptureCreate();
    const travelId = Number(created.travelId);
    recordAdminCircuitTrip(getCurrentEnv(), travelId, this.runId);
    return {
      travelId,
      simulatedAmount,
      summary,
      resolvedOrigin: p.resolvedOrigin,
      resolvedDestination: p.resolvedDestination,
      baseAmount
    };
  }

  /**
   * Alta por UI desde el PERFIL del carrier (preparacion multi-carrier, plan D5): cliente (atajo de pasajero o
   * typeahead) -> [Authorizer] -> medio de pago del escenario -> origen -> destino -> nota de trazabilidad ->
   * cotizar -> conceptos del escenario (por nombre exacto) -> «Enviar Manual» (NUNCA «Send Service» ni el boton
   * «A»). Gate: `CIRCUIT_PREP_CREATE_TRIPS=1`. El spec debe pasar `assertBeforeSubmit` (cotizado > 0, origen !=
   * destino, total = `expected.total`); recibe tambien `baseAmount` y el total esperado (`expected`).
   */
  async createFromProfile(params: {
    page: Page;
    profile: CarrierProfile;
    scenario: PrepScenario;
    /** Nota general del viaje: `QA F5 UAT <escenario> <runId>`. */
    note: string;
    assertBeforeSubmit: (quote: {
      simulatedAmount: number;
      resolvedOrigin: string;
      resolvedDestination: string;
      baseAmount: number;
      expected: ExpectedQuote;
    }) => void | Promise<void>;
  }): Promise<AdminCircuitCreated & { baseAmount: number; expected: ExpectedQuote }> {
    const { page, profile, scenario, note, assertBeforeSubmit } = params;
    if (!isCircuitGateOpen('CIRCUIT_PREP_CREATE_TRIPS')) {
      throw new Error(
        '[adminCircuit] la preparacion crea un viaje permanente; requiere CIRCUIT_PREP_CREATE_TRIPS=1'
      );
    }
    assertEnvMatchesProfile(profile);
    if (scenario.payment === null) {
      throw new Error(`[adminCircuit] el escenario ${scenario.id} no crea viajes`);
    }
    const prep = requirePrep(profile);
    const customer = scenario.payment === 'cash' ? prep.customers.cash : prep.customers.account;
    const paymentMethod =
      scenario.payment === 'cash' ? prep.paymentMethods.cash : prep.paymentMethods.account;
    if (!customer || !paymentMethod) {
      throw new Error(
        `[adminCircuit] perfil "${profile.id}": falta cliente o medio de pago de ${scenario.payment} (TODO de descubrimiento)`
      );
    }
    const costs = scenarioCosts(profile, scenario);

    const trip = new NewTripPage(page);
    await trip.goto();
    if (customer.shortcut !== undefined) {
      await trip.pickPassengerShortcut(customer.shortcut);
    } else if (customer.query !== undefined) {
      await trip.selectClient(customer.query, customer.optionText);
    } else {
      throw new Error(
        `[adminCircuit] perfil "${profile.id}": el cliente no define shortcut ni query`
      );
    }
    if (customer.authorizer !== undefined) await trip.selectAuthorizer(customer.authorizer);
    await trip.selectPaymentMethod(paymentMethod);
    if (customer.origin === null) {
      await expect(
        trip.resolvedOriginValue,
        'el cliente debe autocompletar el origen (perfil con origin null)'
      ).toHaveCount(1, { timeout: 30_000 });
    } else {
      await trip.fillOrigin(customer.origin);
    }
    await trip.fillFirstDestination(customer.destination);
    const resolvedOrigin = ((await trip.resolvedOriginValue.textContent()) ?? '').trim();
    const resolvedDestination = ((await trip.resolvedDestinationValue.textContent()) ?? '').trim();
    await trip.addNotes({ general: note });

    let expected: ExpectedQuote | null = null;
    const created = await this.quoteAndSubmit(trip, {
      costs: costs.map((c) => ({ name: c.name })),
      resolvedOrigin,
      resolvedDestination,
      readBase: true,
      caller: 'createFromProfile',
      assertBeforeSubmit: async (quote) => {
        const baseAmount = quote.baseAmount as number;
        expected = expectedQuote(profile, scenario, baseAmount);
        await assertBeforeSubmit({
          simulatedAmount: quote.simulatedAmount,
          resolvedOrigin: quote.resolvedOrigin,
          resolvedDestination: quote.resolvedDestination,
          baseAmount,
          expected
        });
      }
    });
    return {
      travelId: created.travelId,
      simulatedAmount: created.simulatedAmount,
      summary: created.summary,
      resolvedOrigin,
      resolvedDestination,
      baseAmount: created.baseAmount as number,
      expected: expected as unknown as ExpectedQuote
    };
  }

  /**
   * Lee la etiqueta de estado del viaje en el listado: abre el detalle para obtener el codigo
   * visible (`travelIdForCarrier-canal`), va a la pestaña pedida y devuelve el texto de la celda
   * Status y la fila (para la captura de evidencia). Solo lectura.
   */
  async readGridStatus(params: {
    page: Page;
    travelId: number;
    tab: 'cancelled' | 'finalized';
  }): Promise<{ tripCode: string; statusText: string; row: Locator }> {
    const { page, travelId, tab } = params;
    const detail = new TravelDetailPage(page);
    await detail.goto(travelId);
    const tripCode = ((await detail.tripCode.textContent()) ?? '').trim();
    const dashboard = new TravelDashboardPage(page);
    await dashboard.goto();
    if (tab === 'cancelled') await dashboard.openCancelledTab();
    else await dashboard.openFinalizedTab();
    await dashboard.filterByCode(tripCode);
    const row = dashboard.rowByCode(tripCode);
    await expect(row, `el viaje ${tripCode} debe listarse en la pestaña ${tab}`).toBeVisible({
      timeout: 30_000
    });
    const cell = await dashboard.rowStatusByCode(tripCode);
    const statusText = ((await cell.textContent()) ?? '').trim();
    return { tripCode, statusText, row };
  }

  /**
   * Cancela el viaje por API (sin cargo en ola 1). `reason` opcional (preparacion: motivo trazable
   * `QA F5 UAT <escenario> <runId>`); sin el, el motivo historico. Falla rapido ante no-2xx.
   */
  async cancel(params: { travelId: number; reason?: string }): Promise<void> {
    await this.travels.cancel(params.travelId, params.reason);
  }

  /**
   * Finalizacion administrativa por API. `driverId` (DRIVER.ID del par PROPIO) tiene prioridad; sin el, el chofer
   * de `ADMIN_FINALIZE_DRIVER_ID` (comportamiento historico). Un 200 puede traer body `false`: el resultado se
   * verifica con `readDetail`/`assertClosedWithPair`, no con este metodo.
   */
  async finalizeAdmin(params: { travelId: number; driverId?: number }): Promise<void> {
    await this.travels.finalizeAdmin({
      travelId: params.travelId,
      driverId: params.driverId ?? adminFinalizeDriverId()
    });
  }

  /**
   * Lee el detalle tras el cierre administrativo de la preparacion y GARANTIZA el chofer del par: un chofer ajeno
   * lanza (guarda tecnica, incidente 723585). Devuelve el detalle y las diferencias contra lo esperado del
   * escenario (estado, medio de pago, conceptos); el spec asevera que no haya diferencias.
   */
  async assertClosedWithPair(params: {
    travelId: number;
    pair: PrepPair;
    scenario: PrepScenario;
    profile: CarrierProfile;
  }): Promise<{ detail: TravelDetail; mismatches: ClosureMismatch[] }> {
    const detail = await this.travels.getDetail(params.travelId);
    assertDriverMatchesPair(detailDriverId(detail), params.pair);
    const mismatches = evaluatePrepClosure(detail, {
      pair: params.pair,
      scenario: PREP_SCENARIOS[params.scenario.id],
      costs: scenarioCosts(params.profile, params.scenario)
    });
    return { detail, mismatches };
  }

  /**
   * EF-FARE0: edita la tarifa final del viaje PROPIO a `newAmount` por UI (PUT updateFinalPrices + POST
   * updateFinalPricesProcess). Delega en `TripEditPage.updateFinalPrice`, que exige `FR_EDIT_AFTER_SURRENDER=1`.
   */
  async editFinalFare(params: {
    page: Page;
    travelId: number;
    newAmount: number;
    reason: string;
  }): Promise<FinalPriceEditResult> {
    return new TripEditPage(params.page).updateFinalPrice({
      travelId: params.travelId,
      newAmount: params.newAmount,
      reason: params.reason
    });
  }

  /**
   * Reintento de finalizeAdmin sobre un viaje ya DONE: devuelve 'ok' (2xx) o 400 solo si el cuerpo
   * trae el errorCode ACTION_NOT_ALLOWED. Cualquier otro status (401/403/404/5xx...) o 400 con
   * otro codigo se relanza. El llamador compara el detalle antes/despues.
   */
  async finalizeAdminRetry(params: { travelId: number }): Promise<number | string> {
    try {
      await this.finalizeAdmin(params);
      return 'ok';
    } catch (error) {
      if (
        error instanceof ApiStatusError &&
        error.status === 400 &&
        error.message.includes('ACTION_NOT_ALLOWED')
      ) {
        return error.status;
      }
      throw error;
    }
  }

  /**
   * Chofer a registrar en la medicion: el realmente asignado segun el detalle tras finalizar
   * (`driverId` o `driver.id`). Si el detalle no lo expone se registra el de config con
   * `driverIdSource: 'config'`, sin presentarlo como medido.
   */
  measuredDriver(
    detail: TravelDetail
  ): Pick<AdminCircuitMeasurement, 'driverId' | 'driverIdSource'> {
    const nested = detail.driver;
    const candidate =
      detail.driverId ??
      (typeof nested === 'object' && nested !== null ? (nested as { id?: unknown }).id : undefined);
    const id = Number(candidate);
    if (candidate !== null && candidate !== undefined && Number.isInteger(id) && id > 0) {
      return { driverId: id, driverIdSource: 'detail' };
    }
    return { driverId: adminFinalizeDriverId(), driverIdSource: 'config' };
  }

  /** Detalle vigente del viaje (solo lectura). */
  async readDetail(params: { travelId: number }): Promise<TravelDetail> {
    return this.travels.getDetail(params.travelId);
  }

  /**
   * Movimientos del viaje en la CC y saldo API actual. Las filas no traen tipo de movimiento
   * (concepto `TIVR`); asertar sobre el debito de la fila y el delta de saldo por fila.
   */
  async readMovement(params: {
    travelId: number;
    checkingAccountId: number;
  }): Promise<AdminCircuitMovementRead> {
    const { travelId, checkingAccountId } = params;
    const rows = await this.checkingAccount.movementsByTravel({ travelId, checkingAccountId });
    const balance = await this.checkingAccount.balance({ checkingAccountId });
    return { rows, balance };
  }

  /**
   * Adjunta `medicion-<travelId>.json` y, si hay comentario, la annotation `xray_comment` que lee
   * el reporter. La medicion debe traer solo campos de lista blanca (sin PII ni token).
   */
  async attachMeasurement(params: {
    testInfo: TestInfo;
    measurement: AdminCircuitMeasurement;
  }): Promise<void> {
    const { testInfo, measurement } = params;
    const { comment, ...data } = measurement;
    await testInfo.attach(`medicion-${measurement.travelId}`, {
      body: JSON.stringify(
        { ...data, env: getCurrentEnv(), runId: this.runId, measuredAt: new Date().toISOString() },
        null,
        2
      ),
      contentType: 'application/json'
    });
    if (comment) testInfo.annotations.push({ type: 'xray_comment', description: comment });
  }
}
