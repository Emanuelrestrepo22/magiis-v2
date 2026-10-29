// tests/api/clients/surrender.client.ts
// Cliente de LECTURA de la rendicion de un chofer (lote pendiente). Solo GET: no existe ningun
// metodo de escritura (el POST toTravelsSurrender es la confirmacion irreversible y se hace por UI).
//
// Contrato (magiis-be, rama develop, TravelController, @RequestMapping("carriers/{carrierId}/travels")):
// - toSurrend:         GET .../toSurrend?to&page&size&column&sort&driverUserId&vehicleId&search
//     TravelController.java:2604-2605 (getDriverCashSurrender). Lista PAGINADA de los viajes del lote
//     (estados DONE/CANCELLED, solo pendientes). `page`, `size`, `column`, `sort` y `search` se leen
//     con `.get()` sin guarda: omitirlos responde 500, por eso se mandan siempre.
//     Respuesta (TravelsSurrenderResponsePlusTotalAmountDTO): { travelSurrenderResponseDto: Page<{
//     travelId, paymentMethod, travelAmount, ... }>, totalCashAmount, totalCashAdvance }.
// - toTravelsSurrender: GET .../toTravelsSurrender?driverUserId&vehicleId&to
//     TravelController.java:2590-2591 (getTravelsSurrender). Totales/comisiones del lote
//     (TravelsSurrenderDTO). El BE exige `to` y NO lee `from` (el front lo manda; aqui se omite).
//     OJO: el mismo path con POST (TravelController.java:2523-2524) CONFIRMA la rendicion.
// - driversSurrenderSummary: GET .../driversSurrenderSummary?page&size&column&sort&search
//     Grilla de pendientes; mapea chofer/vehiculo -> driverUserId (campo `driverId` del front).
// Front equivalente (magiis-fe-carrier-v2 develop): services/surrenders/surrenders.service.ts y
// services/carrier/command/{getDriverCashSurrender,getDriversSurrenderSummary}.command.ts,
// services/travel/command/getTravelsSurrender.command.ts.
import type { APIRequestContext } from '@playwright/test';
import { readJson, sendGetOk, type CarrierSession } from './carrierSession.js';

/** Fila del lote (DriverCashSurrenderGridDto). `passengerName` es PII: no volcar a evidencia. */
export type SurrenderPreviewRow = {
  travelId?: number;
  paymentMethod?: string | null;
  travelAmount?: number | null;
  driverCommissionAmount?: number | null;
  ownerCommissionAmount?: number | null;
  agencyCommissionAmount?: number | null;
  [extra: string]: unknown;
};

type SurrenderPreviewPage = {
  travelSurrenderResponseDto?: {
    content?: SurrenderPreviewRow[];
    totalElements?: number;
    totalPages?: number;
    number?: number;
  };
  totalCashAmount?: number | null;
  totalCashAdvance?: number | null;
};

export type SurrenderPreview = {
  rows: SurrenderPreviewRow[];
  totalElements: number;
  totalCashAmount: number | null;
  totalCashAdvance: number | null;
};

/** Fila de la grilla de pendientes (DriverSurrenderSummaryGridDto). `driverId` = driverUserId. */
export type SurrenderSummaryRow = {
  driverId: number;
  driverIdForCarrier?: number;
  vehicleId: number;
  travelsToSurrender?: number;
  toSurrenderTotal?: number;
  [extra: string]: unknown;
};

export type SurrenderBatch = { driverUserId: number; vehicleId: number };

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[surrender] ${name} invalido: ${value}`);
  }
}

/** Fecha tope `yyyy-MM-dd` (el BE la interpreta en la zona del carrier). Default: hoy local. */
function toDateParam(to?: string): string {
  if (to !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error(`[surrender] to invalido: ${to}`);
    return to;
  }
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export class SurrenderClient {
  constructor(
    private readonly api: APIRequestContext,
    private readonly session: CarrierSession
  ) {}

  private base(suffix: string): string {
    return `carriers/${this.session.carrierId}/travels/${suffix}`;
  }

  /**
   * Viajes del lote del chofer/vehiculo (todas las paginas, solo lectura). Orden `id` ASC como la
   * pantalla de confirmacion del front.
   * TODO(verificar en TEST): que `column=id` sea una columna de orden valida para toSurrend (el
   * front reutiliza el `column` de la grilla de pendientes, que por defecto es `id`).
   */
  async preview(params: SurrenderBatch & { to?: string }): Promise<SurrenderPreview> {
    assertPositiveInt('driverUserId', params.driverUserId);
    assertPositiveInt('vehicleId', params.vehicleId);
    const to = toDateParam(params.to);
    const rows: SurrenderPreviewRow[] = [];
    let totals: Pick<SurrenderPreview, 'totalCashAmount' | 'totalCashAdvance'> = {
      totalCashAmount: null,
      totalCashAdvance: null
    };
    let totalElements = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await sendGetOk('travels/toSurrend', () =>
        this.api.get(this.base('toSurrend'), {
          params: {
            to,
            page,
            size: PAGE_SIZE,
            column: 'id',
            sort: 'ASC',
            driverUserId: params.driverUserId,
            vehicleId: params.vehicleId,
            search: ''
          }
        })
      );
      const body = await readJson<SurrenderPreviewPage>(response);
      const pageDto = body?.travelSurrenderResponseDto;
      if (!pageDto || !Array.isArray(pageDto.content)) {
        throw new Error('[surrender] toSurrend sin travelSurrenderResponseDto.content');
      }
      rows.push(...pageDto.content);
      totalElements = pageDto.totalElements ?? rows.length;
      totals = {
        totalCashAmount: body.totalCashAmount ?? null,
        totalCashAdvance: body.totalCashAdvance ?? null
      };
      if (rows.length >= totalElements || pageDto.content.length === 0) break;
      if (page === MAX_PAGES) {
        throw new Error(`[surrender] lote con mas de ${MAX_PAGES * PAGE_SIZE} viajes: se aborta`);
      }
    }
    return { rows, totalElements, ...totals };
  }

  /** Totales/comisiones del lote (TravelsSurrenderDTO crudo). Solo lectura (GET). */
  async totals(params: SurrenderBatch & { to?: string }): Promise<Record<string, unknown>> {
    assertPositiveInt('driverUserId', params.driverUserId);
    assertPositiveInt('vehicleId', params.vehicleId);
    const response = await sendGetOk('travels/toTravelsSurrender', () =>
      this.api.get(this.base('toTravelsSurrender'), {
        params: {
          driverUserId: params.driverUserId,
          vehicleId: params.vehicleId,
          to: toDateParam(params.to)
        }
      })
    );
    const body = await readJson<Record<string, unknown>>(response);
    if (!body || typeof body !== 'object') throw new Error('[surrender] toTravelsSurrender vacio');
    return body;
  }

  /** Grilla de pendientes por chofer/vehiculo (primera pagina de hasta 200). Solo lectura. */
  async pendingSummary(): Promise<SurrenderSummaryRow[]> {
    const response = await sendGetOk('travels/driversSurrenderSummary', () =>
      this.api.get(this.base('driversSurrenderSummary'), {
        params: { page: 1, size: PAGE_SIZE, column: 'id', sort: 'ASC', search: '' }
      })
    );
    const body = await readJson<{ content?: SurrenderSummaryRow[] }>(response);
    if (!body || !Array.isArray(body.content)) {
      throw new Error('[surrender] driversSurrenderSummary sin content');
    }
    return body.content;
  }
}
