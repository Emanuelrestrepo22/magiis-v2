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
import { getCurrentEnv, isFrGateOpen, type CarrierRegion } from '../../config/runtime.js';
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
      assertBeforeSubmit
    } = params;
    if (region === 'FR' && !isFrGateOpen('FR_CIRCUIT_CREATE_TRIP')) {
      throw new Error(
        '[adminCircuit] el alta FR crea un viaje real; requiere FR_CIRCUIT_CREATE_TRIP=1'
      );
    }
    const route = quoteRouteFor(region);
    const trip = new NewTripPage(page);
    await trip.goto();
    await trip.selectClient(client);
    if (authorizer !== undefined) {
      await trip.selectAuthorizer(authorizer);
    }
    await trip.selectPaymentMethod(paymentMethod);
    if (region === 'FR') await trip.overwriteOrigin(route.origin);
    else await trip.fillOrigin(route.origin);
    await trip.fillFirstDestination(route.destination);
    const resolvedOrigin = ((await trip.resolvedOriginValue.textContent()) ?? '').trim();
    const resolvedDestination = ((await trip.resolvedDestinationValue.textContent()) ?? '').trim();
    await trip.quoteTrip();
    if (otherCostName !== undefined) {
      await trip.addOtherCost({ name: otherCostName, amount: otherCostAmount });
    }
    const summary = await trip.readPriceSummary();
    const simulatedAmount = parseMoney(summary.total);
    // Anti-vacuidad: un cotizado en 0 haria pasar `0 == 0` en vacio (run 2026-10-13: cliente 'test'
    // + ruta por defecto cotizo 0 y TM-1403 quedo verde sin probar nada). Lo asevera el spec ANTES de crear.
    if (assertBeforeSubmit) {
      await assertBeforeSubmit({ simulatedAmount, resolvedOrigin, resolvedDestination });
    } else {
      const caller = (new Error().stack ?? '').split('\n')[2]?.trim() ?? 'caller desconocido';
      console.warn(
        `[adminCircuit] createViaUi sin assertBeforeSubmit (inseguro: una cotizacion en 0 crearia un viaje real igual). Caller: ${caller}`
      );
    }

    const created = await trip.sendManualAndCaptureCreate();
    const travelId = Number(created.travelId);
    recordAdminCircuitTrip(getCurrentEnv(), travelId, this.runId);
    return { travelId, simulatedAmount, summary, resolvedOrigin, resolvedDestination };
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

  /** Cancela el viaje por API (sin cargo en ola 1). Falla rapido ante no-2xx. */
  async cancel(params: { travelId: number }): Promise<void> {
    await this.travels.cancel(params.travelId);
  }

  /**
   * Finalizacion administrativa por API con el chofer de `ADMIN_FINALIZE_DRIVER_ID`. Un 200 puede
   * traer body `false`: el resultado se verifica con `readDetail`, no con este metodo.
   */
  async finalizeAdmin(params: { travelId: number }): Promise<void> {
    await this.travels.finalizeAdmin({
      travelId: params.travelId,
      driverId: adminFinalizeDriverId()
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
