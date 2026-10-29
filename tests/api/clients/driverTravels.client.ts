// tests/api/clients/driverTravels.client.ts
// Ciclo de vida del viaje desde el lado del chofer (lo que hace la app driver v2), por API.
// Reproduce el cierre «app vieja»: finalize SIN campos de costo (`*Cost`), de modo que la regla
// de pares venta<->costo del backend (F2-BE-04) los resuelva. Fail-fast ante no-2xx.
//
// Fuente (magiis-be, develop, controllers/TravelController.java, @RequestMapping
// "carriers/{carrierId}/travels"):
// - POST {travelId}/assign                          (:1622) body ConfirmTravelRequestDTO; la llama el CARRIER.
//   409 TRAVEL_INVALID_STATE si el estado no es SEARCHING_DRIVER/WITH_DRIVER_ASSIGNED/SCHEDULED/
//   RESERVED; 409 DRIVER_WITHOUT_VEHICLE si el chofer no tiene vehiculo.
// - POST {travelId}/confirm                         (:1455) body ConfirmTravelRequestDTO.
// - POST {travelId}/goingToDestination/{codeOK}     (:1864) sin body.
// - POST {travelId}/arriveToDestination             (:1896) query opcional `waypointsAmount`.
// - POST {travelId}/finalize                        (:1990) body FinalizeTravelRequestDTO.
// DTOs: dto/requests/travel/ConfirmTravelRequestDTO.java (`driverUserId` @NotNull, `userId`) y
// FinalizeTravelRequestDTO.java (@NotNull: finalKm, tollPrice, parking, otherCost, additionalStop,
// waitTime). Cliente: magiis-mobile-driver-v2 (`goingToClient.command.ts` → confirm,
// `payTravel.command.ts` → finalize).
// GET drivers/basicInfo/{driverUserId}: getDriver.command.ts (solo lectura, usado en el smoke).
import type { APIRequestContext } from '@playwright/test';
import {
  readJson,
  redactApiText,
  sendGetOk,
  sendOk,
  SessionRejectedError,
  type CarrierSession
} from './carrierSession.js';
import type { DriverSession } from './driverSession.js';

/** Respuesta de `carriers/{carrierId}/drivers/{driverId}/status` (campos usados por la precondicion). */
export type DriverStatus = {
  incomingTripId: number | null;
  currentTrip: unknown;
  [extra: string]: unknown;
};

/** Resultado de `listProgrammed`: el status crudo (sin lanzar ante 5xx) y la pagina si fue 2xx. */
export type DriverTravelList = {
  status: number;
  items: Array<Record<string, unknown>> | null;
  /** Primeros 500 caracteres del cuerpo, ya redactados (para la medicion de un 5xx). */
  bodyExcerpt: string;
};

/** `ConfirmTravelRequestDTO`: `driverUserId` carries DRIVER.ID (TEST: the login USER_ID gives 404 DRIVER_NOT_FOUND on confirm). */
type ConfirmBody = { driverUserId: number; userId?: number };

/** Item de `otherCostList` (TravelOtherCostDTO): el contrato exacto se fija al capturar la app. */
export type DriverFinalizeOtherCost = Record<string, unknown>;

/**
 * `FinalizeTravelRequestDTO`. Los campos `*Cost` (finalCostPrice, totalCostPartialCost,
 * waitTimePriceCost, otherCostTotalPriceCost) los manda la app NUEVA; omitirlos reproduce la app
 * vieja y el backend resuelve el par segun el tarifador (F2-BE-04). Enviarlos solo en un negativo
 * de contraste (T6).
 */
export type FinalizeTravelPayload = {
  /** Distancia en km. @NotNull; debe ser > 0 (un cierre con 0 km vuelve vacuo el oraculo). */
  finalKm: number;
  /** Venta cotizada (tarifa). */
  finalCost?: number;
  totalCostPartial?: number;
  paymentMethod?: string;
  tollPrice: number;
  parking: number;
  otherCost: number;
  additionalStop: number;
  waitTime: number;
  waitTimePrice?: number;
  /** Quoted sale as the app sends it (`tripAmountMagiis`); never a `*Cost` field. */
  tripAmountMagiis?: number;
  /** Destination place as the app sends it; without it the detail GET answers 500 (trip 71215). */
  destination?: { id?: number | null; latitude: string; longitude: string; shortName?: string };
  duration?: number;
  otherCostList?: DriverFinalizeOtherCost[];
  finalCostPrice?: number;
  totalCostPartialCost?: number;
  waitTimePriceCost?: number;
  otherCostTotalPriceCost?: number;
  [extra: string]: unknown;
};

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[driverTravels] ${name} invalido: ${value}`);
  }
}

/**
 * Asignacion del viaje al chofer: la hace el CARRIER (no el chofer), por eso recibe el contexto
 * y la sesion del carrier. Vive aca para no tocar TravelsClient; `driverUserId` carries DRIVER.ID.
 */
export async function assignTravelToDriver(params: {
  carrierApi: APIRequestContext;
  carrierSession: CarrierSession;
  travelId: number;
  driverUserId: number;
}): Promise<void> {
  const { carrierApi, carrierSession, travelId, driverUserId } = params;
  assertPositiveInt('travelId', travelId);
  assertPositiveInt('driverUserId', driverUserId);
  const body: ConfirmBody = { driverUserId, userId: carrierSession.subUserId };
  await sendOk(`travels/${travelId}/assign`, () =>
    carrierApi.post(`carriers/${carrierSession.carrierId}/travels/${travelId}/assign`, {
      data: body
    })
  );
}

export class DriverTravelsClient {
  constructor(
    private readonly api: APIRequestContext,
    private readonly session: DriverSession,
    private readonly carrierId: number
  ) {
    assertPositiveInt('carrierId', carrierId);
  }

  private path(travelId: number, suffix: string): string {
    assertPositiveInt('travelId', travelId);
    return `carriers/${this.carrierId}/travels/${travelId}${suffix}`;
  }

  /**
   * Estado operativo del chofer (solo lectura):
   * `GET carriers/{carrierId}/drivers/{driverId}/status` (driver app v2, driverStatus.command.ts).
   * Verificado en TEST: `{ id, state, subState, incomingTripId, currentTrip, ... }`. `basicInfo` NO
   * trae el viaje abierto/entrante.
   */
  async getStatus(driverId: number): Promise<DriverStatus> {
    const response = await sendGetOk('drivers/status', () =>
      this.api.get(`carriers/${this.carrierId}/drivers/${driverId}/status`)
    );
    const body = await readJson<DriverStatus>(response);
    if (
      !body ||
      typeof body !== 'object' ||
      !('incomingTripId' in body) ||
      !('currentTrip' in body)
    ) {
      throw new Error('[driverTravels] drivers/status no trae incomingTripId/currentTrip');
    }
    return body;
  }

  /** Perfil basico del chofer (solo lectura): `GET drivers/basicInfo/{driverUserId}`. */
  async getBasicInfo(): Promise<Record<string, unknown>> {
    const response = await sendGetOk('drivers/basicInfo', () =>
      this.api.get(`drivers/basicInfo/${this.session.driverUserId}`)
    );
    const body = await readJson<Record<string, unknown>>(response);
    if (!body || typeof body !== 'object') {
      throw new Error('[driverTravels] drivers/basicInfo vino vacio');
    }
    return body;
  }

  /** El chofer acepta el viaje asignado. */
  async confirm(travelId: number, driverId: number): Promise<void> {
    const body: ConfirmBody = { driverUserId: driverId };
    await sendOk(`travels/${travelId}/confirm`, () =>
      this.api.post(this.path(travelId, '/confirm'), { data: body })
    );
  }

  /** Inicia el viaje hacia el destino (pasajero a bordo). `codeOK` = codigo de abordaje valido. */
  async goingToDestination(params: { travelId: number; codeOK?: boolean }): Promise<void> {
    const { travelId, codeOK = true } = params;
    await sendOk(`travels/${travelId}/goingToDestination`, () =>
      this.api.post(this.path(travelId, `/goingToDestination/${codeOK}`))
    );
  }

  /** Llegada al destino (estado CLOSING_TRAVEL). Opcional para finalizar; replica el log de la app. */
  async arriveToDestination(params: { travelId: number; waypointsAmount?: number }): Promise<void> {
    const { travelId, waypointsAmount } = params;
    const suffix = waypointsAmount === undefined ? '' : `?waypointsAmount=${waypointsAmount}`;
    await sendOk(`travels/${travelId}/arriveToDestination`, () =>
      this.api.post(this.path(travelId, `/arriveToDestination${suffix}`))
    );
  }

  /**
   * Cancelacion del viaje por el CHOFER con el motivo «No puedo cubrir» (app driver v2:
   * `cancelTravel.command.ts` -> `PUT carriers/{carrierUserId}/travels/{travelId}/cancel`, body
   * `{ travelId, carrierUserId, reasonForCancellation, canceledBy }`; `travel.service.ts:834-855`).
   * El backend deja el viaje en STATE 0 con `VEHICLE_ID` NULL (PK-B, TM-1427). Fail-fast ante no-2xx.
   */
  async cancelByDriver(travelId: number): Promise<void> {
    await sendOk(`travels/${travelId}/cancel (driver)`, () =>
      this.api.put(this.path(travelId, '/cancel'), {
        data: {
          travelId,
          carrierUserId: this.carrierId,
          reasonForCancellation: 'CANNOT_COVER',
          canceledBy: 'DRIVER'
        }
      })
    );
  }

  /**
   * Lista de viajes PROGRAMADOS del chofer, igual que la app (`travelList.command.ts`):
   * `GET carriers/{carrierUserId}/travels/paginated-driver?driverId&page&size&column&sort&programmed=true`.
   * `driverId` = DRIVER.ID. NO lanza ante un 5xx: devuelve el status para que el spec lo asevere
   * (el 500 nunca se espera); 401/403 si lanzan (sesion rechazada). `items` = `page.content` (forma medida en TEST el 2026-10-21: `{ page: { content, totalElements, ... } }`)
   * (null si la respuesta no es 2xx o no trae `page.content`).
   */
  async listProgrammed(params: {
    driverId: number;
    page?: number;
    size?: number;
  }): Promise<DriverTravelList> {
    assertPositiveInt('driverId', params.driverId);
    const response = await this.api.get(`carriers/${this.carrierId}/travels/paginated-driver`, {
      params: {
        driverId: params.driverId,
        page: params.page ?? 1,
        size: params.size ?? 10,
        column: 'id',
        sort: 'DESC',
        programmed: true
      }
    });
    const status = response.status();
    if (status === 401 || status === 403)
      throw new SessionRejectedError('paginated-driver', status);
    const text = await response.text().catch(() => '');
    let items: Array<Record<string, unknown>> | null = null;
    if (response.ok()) {
      try {
        const body = JSON.parse(text) as { page?: { content?: unknown } } | null;
        const content = body?.page?.content;
        if (Array.isArray(content)) {
          items = content as Array<Record<string, unknown>>;
        }
      } catch {
        items = null;
      }
    }
    return { status, items, bodyExcerpt: redactApiText(text).slice(0, 500) };
  }

  /** Cierre del viaje por el chofer. Ver `FinalizeTravelPayload` (sin `*Cost` = app vieja). */
  async finalize(params: { travelId: number; payload: FinalizeTravelPayload }): Promise<void> {
    const { travelId, payload } = params;
    if (!(payload.finalKm > 0)) {
      throw new Error(`[driverTravels] finalKm debe ser > 0 (recibido ${payload.finalKm})`);
    }
    await sendOk(`travels/${travelId}/finalize`, () =>
      this.api.post(this.path(travelId, '/finalize'), { data: payload })
    );
  }
}

/** Crea el contexto autenticado del chofer. El llamador lo descarta (`dispose`). */
export async function newDriverApiContext(
  factory: {
    newContext: (options: {
      baseURL: string;
      extraHTTPHeaders: Record<string, string>;
    }) => Promise<APIRequestContext>;
  },
  session: DriverSession
): Promise<APIRequestContext> {
  return factory.newContext({
    baseURL: session.apiBaseURL,
    extraHTTPHeaders: session.authHeaders()
  });
}
