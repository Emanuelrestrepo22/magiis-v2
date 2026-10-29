// tests/api/clients/travels.client.ts
// Cliente de viajes del carrier: oraculo de persistencia (detalle) y limpieza (cancelar).
// Endpoints (front v2.0.17, rutas relativas a src/app/):
// - detalle:  GET carriers/{carrierUserId}/travels/{travelId}
//   (services/travel/command/getTravelDetail.command.ts:23-24).
// - cancelar: PUT carriers/{carrierUserId}/travels/{travelId}/cancel
//   (services/travel/command/cancelTravel.command.ts:14-33). Body = CancelTravelRequestDTO completo,
//   igual que el front (services/travel/travel-dashboard.service.ts:180-196). Medido en UAT el
//   2026-09-29: con body `{}` un viaje en SEARCHING_DRIVER responde 400 ACTION_NOT_ALLOWED; con el
//   DTO completo responde 200 y el viaje queda CANCELLED.
import type { APIRequestContext } from '@playwright/test';
import { readJson, sendGetOk, sendOk, type CarrierSession } from './carrierSession.js';

/** Item presupuestado de `simulationPrice.otherCosts[]` (relevamiento §5). */
export type SimulationOtherCost = {
  otherCostId: number;
  name?: string;
  type?: string;
  price: number;
  quantity: number;
  [extra: string]: unknown;
};

/**
 * Campos del detalle que usa la automatizacion (medidos en el relevamiento §5). El resto del
 * cuerpo trae PII del pasajero: no volcarlo a evidencia sin lista blanca.
 */
export type TravelDetail = {
  travelId?: number;
  state?: string;
  /** Opcional: nombre legible del estado; no verificado contra el detalle real (T1, sin llamar APIs). */
  stateName?: string;
  /** Opcional: metodo de pago del viaje (ej. CASH / CREDIT_CARD); no verificado contra el detalle real. */
  paymentMethod?: string | null;
  /** Opcional: marca de finalizacion administrativa; forma no verificada contra el detalle real. */
  finalizeAdmin?: boolean | null;
  amount?: number | null;
  /** Cost pair of `amount`. Measured in TEST 2026-10-13 (trips 71124 and 71106). */
  amountCost?: number | null;
  tourPrice?: number | null;
  tourPriceCost?: number | null;
  waitTimePrice?: number | null;
  /** Cost pair of `waitTimePrice` (the name does NOT follow the `*Cost` pattern). */
  waitTotalPriceCost?: number | null;
  otherCost?: number | null;
  otherCostPriceCost?: number | null;
  /** Commissionable / non-commissionable other costs and the cost pair of the latter. */
  otherCostCom?: number | null;
  otherCostNoCom?: number | null;
  otherCostPriceCostNoCom?: number | null;
  otherCostList?: Array<{
    id?: number;
    name?: string;
    price?: number;
    [extra: string]: unknown;
  }> | null;
  simulationPrice?: {
    pricePointToPoint?: number | null;
    otherCosts?: SimulationOtherCost[] | null;
    [extra: string]: unknown;
  } | null;
  [extra: string]: unknown;
};

export class TravelsClient {
  constructor(
    private readonly api: APIRequestContext,
    private readonly session: CarrierSession
  ) {}

  private path(travelId: number, suffix = ''): string {
    if (!Number.isInteger(travelId) || travelId <= 0) {
      throw new Error(`[travels] travelId invalido: ${travelId}`);
    }
    return `carriers/${this.session.carrierId}/travels/${travelId}${suffix}`;
  }

  /** Detalle del viaje (solo lectura). */
  async getDetail(travelId: number): Promise<TravelDetail> {
    const response = await sendGetOk(`travels/${travelId}`, () =>
      this.api.get(this.path(travelId))
    );
    const body = await readJson<TravelDetail>(response);
    if (!body || typeof body !== 'object') {
      throw new Error(`[travels] el detalle de ${travelId} vino vacio`);
    }
    return body;
  }

  /** Cancela un viaje creado por la automatizacion (limpieza en finally). */
  async cancel(travelId: number): Promise<void> {
    await sendOk(`travels/${travelId}/cancel`, () =>
      this.api.put(this.path(travelId, '/cancel'), {
        data: {
          carrierUserId: String(this.session.carrierId),
          travelId,
          reasonForCancellation: 'QA E2E OC limpieza automatizacion',
          canceledBy: this.session.role,
          name: this.session.subUserName,
          userId: String(this.session.subUserId),
          checkPassengerCancelation: false
        }
      })
    );
  }

  /**
   * Finalizacion administrativa del viaje (boton bandera del portal carrier).
   * `POST carriers/{carrierId}/travels/{travelId}/finalizeAdmin`, body
   * `{ carrierUserId, travelId, userId, userIdManager, driverId }`.
   * - `driverId` DEBE ser DRIVER.ID (no un USER_ID): con un USER_ID el BE no halla vehiculo, NPE y
   *   responde 400 ACTION_NOT_ALLOWED. Se toma del llamador (env `ADMIN_FINALIZE_DRIVER_ID`).
   * - No se envia `vehicleId`: el BE usa el vehiculo vigente del driver.
   * - Un 200 puede traer body `false`; no se interpreta: verificar el estado con `getDetail`.
   * Falla rapido ante cualquier no-2xx (ApiStatusError / SessionRejectedError).
   */
  async finalizeAdmin(params: { travelId: number; driverId: number }): Promise<void> {
    const { travelId, driverId } = params;
    if (!Number.isInteger(driverId) || driverId <= 0) {
      throw new Error(`[travels] driverId invalido: ${driverId}`);
    }
    await sendOk(`travels/${travelId}/finalizeAdmin`, () =>
      this.api.post(this.path(travelId, '/finalizeAdmin'), {
        data: {
          carrierUserId: String(this.session.carrierId),
          travelId,
          userId: String(this.session.subUserId),
          userIdManager: String(this.session.subUserId),
          driverId
        }
      })
    );
  }
}
