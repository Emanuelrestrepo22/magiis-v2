// tests/api/clients/checkingAccount.client.ts
// Cliente de cuenta corriente (CC) del carrier: oraculo de lectura del libro mayor de una CC.
// SOLO GET. Endpoint (api-e2e openapi.yaml `getClientsCheckingAccountDetail`, confirmado en TEST
// el 2026-10-13 con la sesion del carrier 1521):
//   GET checking-accounts/carrier/{carrierId}/checking-account/{checkingAccountId}/paginated
//   Query: page (1-based; page=0 → 500 "Page index must not be less than zero!"), size,
//          sort = ASC|DESC (enum Spring Direction; "campo,dir" → 400), dateFrom, dateTo, ...
//   Respuesta: { content: Row[], number, size, totalElements, totalPages }.
// Nota: `GET checking-accounts/carrier/{id}/movements` NO sirve para filtrar por viaje (solo acepta
// `type`, schema MovementsListDto sin campos); el detalle por CC si trae `travelId` por fila.
// Fila (REDACTADA, ejemplo real de TEST, CC 5245):
//   { "creationDate": "2026-10-09T21:54:49.499+0000", "travelId": 71061, "travelIdForCarrier": 4891,
//     "concept": "carrier.checking_accounts.concept_codes.TIVR", "costCenter": null,
//     "passengerName": "<redactado>", "debit": 47.22, "credit": 0, "balance": -113.92,
//     "balanceByClient": -22.28, "comment": null, "multiTripSeq": null, "currencyCode": "USD" }
// `balance` = saldo acumulado tras la fila; `debit` = monto cobrado al viaje.
import type { APIRequestContext } from '@playwright/test';
import { readJson, sendGetOk, type CarrierSession } from './carrierSession.js';

/** Fila del detalle de CC (ClientCheckingAccountDetailResponseDTO). `passengerName` es PII. */
export type CheckingAccountRow = {
  creationDate?: string;
  travelId?: number | null;
  travelIdForCarrier?: number | null;
  concept?: string | null;
  costCenter?: string | null;
  passengerName?: string | null;
  debit?: number | null;
  credit?: number | null;
  balance?: number | null;
  balanceByClient?: number | null;
  comment?: string | null;
  multiTripSeq?: number | null;
  currencyCode?: string | null;
  [extra: string]: unknown;
};

type CheckingAccountPage = {
  content?: CheckingAccountRow[];
  number?: number;
  size?: number;
  totalElements?: number;
  totalPages?: number;
};

export type CheckingAccountQuery = {
  checkingAccountId: number;
  /** Tamano de pagina (default 200). */
  size?: number;
  /** Pagina 1-based (default 1). */
  page?: number;
  /** Orden por fecha de creacion (default DESC: lo mas reciente primero). */
  sort?: 'ASC' | 'DESC';
  /** Cota inferior de fecha (ISO) para acotar el barrido. */
  dateFrom?: string;
};

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGES = 25;

export class CheckingAccountClient {
  constructor(
    private readonly api: APIRequestContext,
    private readonly session: CarrierSession
  ) {}

  private assertId(name: string, value: number): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`[checkingAccount] ${name} invalido: ${value}`);
    }
  }

  /** Una pagina del libro mayor de la CC. Falla rapido ante non-2xx. */
  async page(query: CheckingAccountQuery): Promise<CheckingAccountPage> {
    this.assertId('checkingAccountId', query.checkingAccountId);
    const params: Record<string, string | number> = {
      page: query.page ?? 1,
      size: query.size ?? DEFAULT_PAGE_SIZE,
      sort: query.sort ?? 'DESC'
    };
    if (query.dateFrom) params.dateFrom = query.dateFrom;
    const response = await sendGetOk(`checking-account/${query.checkingAccountId}/paginated`, () =>
      this.api.get(
        `checking-accounts/carrier/${this.session.carrierId}/checking-account/${query.checkingAccountId}/paginated`,
        { params }
      )
    );
    const body = await readJson<CheckingAccountPage>(response);
    if (!body || !Array.isArray(body.content)) {
      throw new Error(`[checkingAccount] CC ${query.checkingAccountId}: respuesta sin 'content'`);
    }
    return body;
  }

  /**
   * Movimientos de UN viaje (filtro por `travelId` exacto) en la CC indicada. Recorre paginas
   * (mas recientes primero) hasta agotar la CC o `MAX_PAGES`. Devuelve [] si no hay ninguno.
   */
  async movementsByTravel(
    params: { travelId: number } & CheckingAccountQuery
  ): Promise<CheckingAccountRow[]> {
    const { travelId, ...query } = params;
    this.assertId('travelId', travelId);
    const found: CheckingAccountRow[] = [];
    let page = query.page ?? 1;
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const body = await this.page({ ...query, page });
      found.push(...(body.content ?? []).filter((row) => row.travelId === travelId));
      if (page >= (body.totalPages ?? 1)) break;
      page += 1;
    }
    return found;
  }

  /**
   * Saldo actual de la CC: `balance` de la fila mas reciente (null si la CC no tiene filas).
   * Es el saldo acumulado tras el ultimo movimiento.
   */
  async balance(params: { checkingAccountId: number }): Promise<number | null> {
    const body = await this.page({
      checkingAccountId: params.checkingAccountId,
      size: 1,
      sort: 'DESC'
    });
    return body.content?.[0]?.balance ?? null;
  }

  // ───────── Libros de chofer, propietario y contractor (magiis-be, rama develop) ─────────

  /**
   * Resumen de saldos por chofer (una fila por chofer, NO movimientos).
   * magiis-be CheckingAccountController.java:91-115 `carrier/{carrierId}/drivers/paginated`
   * (page 1-based, size, column=id, sort OBLIGATORIO, find). Respuesta DriverCheckingAccountResponseDTO
   * `{ page: Page<{driverId, firstName, lastName, lastLiquidationDate, balance}>, totalBalance }`.
   */
  async driversPage(
    query: { page?: number; size?: number; sort?: 'ASC' | 'DESC'; find?: string } = {}
  ): Promise<DriversSummaryResponse> {
    const response = await sendGetOk('drivers/paginated', () =>
      this.api.get(`checking-accounts/carrier/${this.session.carrierId}/drivers/paginated`, {
        params: summaryParams(query)
      })
    );
    return requireBody(await readJson<DriversSummaryResponse>(response), 'drivers/paginated');
  }

  /**
   * Resumen de saldos por propietario. magiis-be CheckingAccountController.java:117-140
   * `carrier/{carrierId}/owners/paginated`. Respuesta OwnerCheckingAccountResponseDTO
   * `{ page: Page<{ownerId, firstName, lastName, lastPaymentDate, balance, carQuantity}>, totalBalance }`
   * (DTO: OwnerCheckingAccountDTO.java; wrapper asumido por analogia con DriverCheckingAccountResponseDTO,
   * no leido).
   */
  async ownersPage(
    query: { page?: number; size?: number; sort?: 'ASC' | 'DESC'; find?: string } = {}
  ): Promise<OwnersSummaryResponse> {
    const response = await sendGetOk('owners/paginated', () =>
      this.api.get(`checking-accounts/carrier/${this.session.carrierId}/owners/paginated`, {
        params: summaryParams(query)
      })
    );
    return requireBody(await readJson<OwnersSummaryResponse>(response), 'owners/paginated');
  }

  /**
   * Movimientos del libro de UN chofer (CHECKINGACCOUNTFORDRIVER).
   * magiis-be DriverAccountController.java:510-580 (clase `carriers/{carrierId}/drivers`, L93-94)
   * `GET {driverUserId}/checkingAccountMovements/paginated`: page, size, column=id, sort=ASC,
   * startDate=1900-01-01, endDate='' , movementFilter. Respuesta
   * `{ page: Page<DriverBookRow>, actualBalance }`. Las filas NO traen travelId: `origin` es
   * TRAVELSSURRENDER.IDFORCARRIER de la rendicion que las genero.
   */
  async driverMovements(
    params: BookMovementsQuery & { driverUserId: number }
  ): Promise<{ rows: DriverBookRow[]; balance: number | null }> {
    this.assertId('driverUserId', params.driverUserId);
    const response = await sendGetOk('driver/checkingAccountMovements', () =>
      this.api.get(
        `carriers/${this.session.carrierId}/drivers/${params.driverUserId}/checkingAccountMovements/paginated`,
        { params: bookParams(params) }
      )
    );
    const body = requireBody(
      await readJson<{ page?: { content?: DriverBookRow[] }; actualBalance?: number | null }>(
        response
      ),
      'driver/checkingAccountMovements'
    );
    return { rows: body.page?.content ?? [], balance: body.actualBalance ?? null };
  }

  /**
   * Movimientos del libro de UN propietario (CHECKINGACCOUNTFOROWNER).
   * magiis-be VehicleOwnerController.java:219-282 (clase `/carriers/{carrierUserId}/vehicleOwners`,
   * L72) `GET {ownerId}/checkingAccountMovements/paginated`: page, size, column=creationDate,
   * sort=ASC, startDate, endDate, movementFilter, find. Respuesta
   * CheckingAccountForOwnerResponseDTOContainer `{ page, currentBalance, ownerId, carrierId }`.
   */
  async ownerMovements(
    params: BookMovementsQuery & { ownerId: number }
  ): Promise<{ rows: OwnerBookRow[]; balance: number | null }> {
    this.assertId('ownerId', params.ownerId);
    const response = await sendGetOk('owner/checkingAccountMovements', () =>
      this.api.get(
        `carriers/${this.session.carrierId}/vehicleOwners/${params.ownerId}/checkingAccountMovements/paginated`,
        { params: { ...bookParams(params), column: 'creationDate' } }
      )
    );
    const body = requireBody(
      await readJson<{ page?: { content?: OwnerBookRow[] }; currentBalance?: number | null }>(
        response
      ),
      'owner/checkingAccountMovements'
    );
    return { rows: body.page?.content ?? [], balance: body.currentBalance ?? null };
  }

  /**
   * Cuenta corriente del contractor-carrier (vista admin, no por cliente).
   * magiis-be CheckingAccountController.java:352-376 `GET admin/{carrierId}/detail/paginated`:
   * page, size, column=paymentMethod, sort, paymentMethod, dateFrom, dateTo (yyyy-MM-dd), find.
   * Respuesta Page<ContractorCheckingAccountDto> (ContractorCheckingAccountDto.java). Puede ser
   * restringida a rol admin: un 403 sale como SessionRejectedError.
   */
  async contractorMovements(
    query: {
      page?: number;
      size?: number;
      sort?: 'ASC' | 'DESC';
      dateFrom?: string;
      dateTo?: string;
    } = {}
  ): Promise<ContractorRow[]> {
    const params: Record<string, string | number> = {
      page: query.page ?? 1,
      size: query.size ?? DEFAULT_PAGE_SIZE,
      sort: query.sort ?? 'DESC'
    };
    if (query.dateFrom) params.dateFrom = query.dateFrom;
    if (query.dateTo) params.dateTo = query.dateTo;
    const response = await sendGetOk('admin/detail/paginated', () =>
      this.api.get(`checking-accounts/admin/${this.session.carrierId}/detail/paginated`, { params })
    );
    const body = requireBody(
      await readJson<{ content?: ContractorRow[] }>(response),
      'admin/detail/paginated'
    );
    return body.content ?? [];
  }
}

// ───────── Tipos y helpers de los libros ─────────

type SummaryPage<T> = { content?: T[]; totalElements?: number; totalPages?: number };

export type DriversSummaryResponse = {
  page?: SummaryPage<{
    driverId: number;
    firstName?: string | null;
    lastName?: string | null;
    lastLiquidationDate?: string | null;
    balance: number | null;
  }>;
  totalBalance?: number | null;
};

export type OwnersSummaryResponse = {
  page?: SummaryPage<{
    ownerId: number;
    firstName?: string | null;
    lastName?: string | null;
    lastPaymentDate?: string | null;
    balance: number | null;
    carQuantity?: number | null;
  }>;
  totalBalance?: number | null;
};

/** Fila del libro del chofer (CheckingAccountForDriverResponseDTO): amount = debito, paid = credito. */
export type DriverBookRow = {
  id: number;
  amount?: number | null;
  paid?: number | null;
  balance?: number | null;
  creationDate?: string;
  movementType?: string | null;
  checkingAccountCode?: string | null;
  comments?: string | null;
  /** TRAVELSSURRENDER.IDFORCARRIER de la rendicion de origen (no es un travelId). */
  origin?: number | null;
  [extra: string]: unknown;
};

/** Fila del libro del propietario (CheckingAccountForOwnerResponseDTO). */
export type OwnerBookRow = DriverBookRow & {
  driverFirstName?: string | null;
  driverLastName?: string | null;
  vehicleIdentification?: string | null;
};

export type ContractorRow = {
  id?: number;
  paymentMethod?: string | null;
  concept?: string | null;
  conceptCode?: string | null;
  debit?: number | null;
  credit?: number | null;
  balance?: number | null;
  creationDate?: string;
  [extra: string]: unknown;
};

export type BookMovementsQuery = {
  page?: number;
  size?: number;
  sort?: 'ASC' | 'DESC';
  /** yyyy-MM-dd (default del backend: 1900-01-01). */
  startDate?: string;
  /** yyyy-MM-dd (default del backend: hoy). */
  endDate?: string;
  movementFilter?: string;
};

function summaryParams(query: {
  page?: number;
  size?: number;
  sort?: 'ASC' | 'DESC';
  find?: string;
}): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    size: query.size ?? DEFAULT_PAGE_SIZE,
    column: 'id',
    sort: query.sort ?? 'ASC'
  };
  if (query.find) params.find = query.find;
  return params;
}

function bookParams(query: BookMovementsQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    size: query.size ?? DEFAULT_PAGE_SIZE,
    // Orden por id descendente: lo nuevo primero (el default ASC del backend lo dejaria en la ultima pagina).
    column: 'id',
    sort: query.sort ?? 'DESC'
  };
  if (query.startDate) params.startDate = query.startDate;
  if (query.endDate) params.endDate = query.endDate;
  if (query.movementFilter) params.movementFilter = query.movementFilter;
  return params;
}

function requireBody<T>(body: T | null, label: string): T {
  if (body === null) throw new Error(`[checkingAccount] ${label}: respuesta vacia`);
  return body;
}
