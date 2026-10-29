// tests/api/clients/settlement.client.ts
// Cliente de liquidaciones (settlements) de CHOFER y PROPIETARIO del carrier. Lecturas libres;
// la unica escritura (`create*Liquidation`) exige el gate FR_CONFIRM_SETTLEMENT=1 y es IRREVERSIBLE
// de facto (la anulacion solo es posible sobre la ULTIMA liquidacion; este cliente no la expone).
//
// Contrato (magiis-be, rama develop, leido 2026-10-21; el FE usa los mismos paths con
// carrierId = identityService.userId = session.carrierId):
// Chofer  — CarrierDriverLiquidationController, @RequestMapping("carrierDriverLiquidations"):
//   GET  surrenders/withoutLiquidations/{carrierId}/{driverId}/{to}   rendiciones pendientes (lista plana;
//        `page`/`size` se ignoran). `to` = DateTime.parse(to)+1d-1s. driverId = DRIVER.ID.
//   GET  {carrierId}/initialData/{driverId}                           nombre + fecha de inicio.
//   GET  findDrivers/{carrierId}/paginated?page&size[&find]           resumen: balance + toLiquidate.
//   GET  byCarrier/{carrierId}/driverId/{driverId}/{from}/{to}/paginated?page&size&column&sort
//        (los 4 query params se leen con `.get()` sin guarda: omitirlos = 500).
//   GET  getLiquidationDetails/{liquidationId}                        cabecera.
//   GET  getLiquidationSurrenderDetails/{liquidationId}?column&sort   rendiciones de la liquidacion
//        (column/sort tambien con `.get()`).
//   POST {carrierId}/{driverId}  body {total,status,details:[{travelSurrenderId}],observations,dateTo}
//        -> 201 CarrierDriverLiquidationDTO {id (idForCarrier), originalId (PK), ...}. Cualquier
//        excepcion se devuelve como 404 INTERNAL_SERVER_ERROR (el catch del controller).
// Propietario — CarrierOwnerLiquidationController, @RequestMapping("carrierOwnerLiquidations"):
//   GET  surrenders/withoutLiquidations/{carrierId}/{ownerId}/{to}?page&size   OBLIGATORIOS (Integer sin
//        default: omitirlos = 400/500). Agrupa por (fecha del carrier, vehiculo); `surrenderIds` = ids
//        separados por coma.
//   GET  {carrierId}/initialData/{ownerId} · findOwners/{carrierId}/paginated · ownerDetail/{carrierId}/ownerId/{ownerId}
//        (esta ultima devuelve balance + toLiquidate de UN propietario).
//   GET  byCarrier/{carrierId}/ownerId/{ownerId}/{from}/{to}/paginated?page&size&column&sort
//   GET  getLiquidationDetails/{id} · getLiquidationSurrenderDetails/{id}?page&size&column&sort
//        (column se inyecta en JpaSort.unsafe: usar solo la expresion del FE, `TRUNC(sur.creationDate)`).
//   POST {carrierId}/{ownerId}  body igual; `travelSurrenderId` = ids separados por coma de UN grupo.
// Estados (LiquidationStatus, ordinal): 0 NOTPAID, 1 PAID, 2 CANCELED. El FE crea siempre con 'PAID'.
import type { APIRequestContext } from '@playwright/test';
import { readJson, sendGetOk, sendOk, type CarrierSession } from './carrierSession.js';

/** Rendicion pendiente de chofer (TravelsSurrenderReportDTO, constructor de 25 parametros). */
export type DriverUnsettledRow = {
  id: number;
  idForCarrier?: number | null;
  creationDate?: string;
  totalTravelsQty?: number | null;
  totalBilling?: number | null;
  driverCommission?: number | null;
  totalTip?: number | null;
  totalFinancialCost?: number | null;
  /** Lo que suma el FE al tildar la fila. */
  comNeta?: number | null;
  [extra: string]: unknown;
};

/** Grupo pendiente de propietario (fecha del carrier + vehiculo). */
export type OwnerUnsettledRow = {
  surrenderIds?: string | null;
  totalSurrendersQty?: number | null;
  totalTravelsQty?: number | null;
  totalBilling?: number | null;
  ownerCommission?: number | null;
  totalTip?: number | null;
  totalExpenses?: number | null;
  totalFinancialCost?: number | null;
  comNeta?: number | null;
  [extra: string]: unknown;
};

export type LiquidationHead = {
  id?: number;
  originalId?: number;
  status?: string | null;
  total?: number | null;
  [extra: string]: unknown;
};

type Page<T> = { content?: T[]; totalElements?: number; totalPages?: number };

export type DriverSummaryRow = {
  driverAccountId?: number;
  balance?: number | null;
  toLiquidate?: number | null;
  lastLiquidationId?: number | null;
  [extra: string]: unknown;
};

export type OwnerSummaryRow = {
  ownerId?: number;
  balance?: number | null;
  toLiquidate?: number | null;
  lastLiquidationId?: number | null;
  [extra: string]: unknown;
};

export type CreateLiquidationBody = {
  total: number;
  status: 'PAID';
  details: Array<{ travelSurrenderId: string | number }>;
  observations?: string;
  /** ISO. El BE lo recibe (CarrierLiquidationRequestDTO.dateTo) pero no lo usa en el create. */
  dateTo: string;
};

const BIG_PAGE = 200;
/** Gate de escrituras de liquidaciones (definido aqui, no en runtime.ts: solo el valor exacto `1` lo abre). */
export const SETTLEMENT_GATE = 'FR_CONFIRM_SETTLEMENT';

export function isSettlementGateOpen(): boolean {
  return process.env[SETTLEMENT_GATE]?.trim() === '1';
}

function assertId(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`[settlement] ${name} invalido: ${value}`);
}

/** `yyyy-MM-dd` (el BE hace DateTime.parse; acepta tambien ISO completo). */
function assertDay(name: string, value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`[settlement] ${name} invalido: ${value}`);
  return value;
}

export function todayParam(now: Date = new Date()): string {
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export class SettlementClient {
  constructor(
    private readonly api: APIRequestContext,
    private readonly session: CarrierSession
  ) {}

  private get carrierId(): number {
    return this.session.carrierId;
  }

  private async get<T>(
    label: string,
    url: string,
    params?: Record<string, string | number>
  ): Promise<T> {
    const response = await sendGetOk(label, () =>
      this.api.get(url, params ? { params } : undefined)
    );
    const body = await readJson<T>(response);
    if (body === null) throw new Error(`[settlement] ${label}: respuesta vacia`);
    return body;
  }

  // ───────────── chofer (lecturas) ─────────────

  async driverUnsettled(p: {
    driverAccountId: number;
    to?: string;
  }): Promise<DriverUnsettledRow[]> {
    assertId('driverAccountId', p.driverAccountId);
    const to = assertDay('to', p.to ?? todayParam());
    return this.get<DriverUnsettledRow[]>(
      'carrierDriverLiquidations/surrenders/withoutLiquidations',
      `carrierDriverLiquidations/surrenders/withoutLiquidations/${this.carrierId}/${p.driverAccountId}/${to}`,
      { page: 1, size: BIG_PAGE }
    );
  }

  async driverInitialData(driverAccountId: number): Promise<Record<string, unknown>> {
    assertId('driverAccountId', driverAccountId);
    return this.get(
      'carrierDriverLiquidations/initialData',
      `carrierDriverLiquidations/${this.carrierId}/initialData/${driverAccountId}`
    );
  }

  /**
   * Resumen por chofer (columnas «Saldo» y «A liquidar»). Trae solo los que matchean `find`.
   * El BE responde `ListCarrierDriverDTO` = `{ page: Page<...>, totalConsolidated }` (la pagina viene
   * ANIDADA en `page`, no en la raiz); aca se normaliza a `{ content, totalConsolidated }`.
   * `driverAccountId` = MAX(DRIVER.ID) agrupado por nombre/apellido (incluye choferes sin rendiciones).
   */
  async driversSummary(
    p: { find?: string } = {}
  ): Promise<Page<DriverSummaryRow> & { totalConsolidated?: number | null }> {
    const body = await this.get<
      Page<DriverSummaryRow> & {
        page?: Page<DriverSummaryRow>;
        totalConsolidated?: number | null;
      }
    >(
      'carrierDriverLiquidations/findDrivers',
      `carrierDriverLiquidations/findDrivers/${this.carrierId}/paginated`,
      {
        page: 1,
        size: BIG_PAGE,
        ...(p.find ? { find: p.find } : {})
      }
    );
    const inner = body.page ?? body;
    return {
      content: inner.content ?? [],
      totalElements: inner.totalElements,
      totalPages: inner.totalPages,
      totalConsolidated: body.totalConsolidated ?? null
    };
  }

  async driverLiquidations(p: {
    driverAccountId: number;
    from: string;
    to: string;
  }): Promise<Page<LiquidationHead>> {
    assertId('driverAccountId', p.driverAccountId);
    return this.get(
      'carrierDriverLiquidations/byCarrier',
      `carrierDriverLiquidations/byCarrier/${this.carrierId}/driverId/${p.driverAccountId}/${assertDay('from', p.from)}/${assertDay('to', p.to)}/paginated`,
      { page: 1, size: BIG_PAGE, column: 'id', sort: 'DESC' }
    );
  }

  async driverLiquidationDetails(liquidationId: number): Promise<LiquidationHead> {
    assertId('liquidationId', liquidationId);
    return this.get(
      'carrierDriverLiquidations/getLiquidationDetails',
      `carrierDriverLiquidations/getLiquidationDetails/${liquidationId}`
    );
  }

  async driverLiquidationSurrenders(liquidationId: number): Promise<DriverUnsettledRow[]> {
    assertId('liquidationId', liquidationId);
    return this.get(
      'carrierDriverLiquidations/getLiquidationSurrenderDetails',
      `carrierDriverLiquidations/getLiquidationSurrenderDetails/${liquidationId}`,
      { column: 'id', sort: 'DESC' }
    );
  }

  // ───────────── propietario (lecturas) ─────────────

  async ownerUnsettled(p: { ownerId: number; to?: string }): Promise<OwnerUnsettledRow[]> {
    assertId('ownerId', p.ownerId);
    const to = assertDay('to', p.to ?? todayParam());
    return this.get<OwnerUnsettledRow[]>(
      'carrierOwnerLiquidations/surrenders/withoutLiquidations',
      `carrierOwnerLiquidations/surrenders/withoutLiquidations/${this.carrierId}/${p.ownerId}/${to}`,
      { page: 1, size: BIG_PAGE }
    );
  }

  async ownerInitialData(ownerId: number): Promise<Record<string, unknown>> {
    assertId('ownerId', ownerId);
    return this.get(
      'carrierOwnerLiquidations/initialData',
      `carrierOwnerLiquidations/${this.carrierId}/initialData/${ownerId}`
    );
  }

  /** Balance + toLiquidate de UN propietario (CarrierOwnerLiquidationSummaryDTO). */
  async ownerDetail(ownerId: number): Promise<OwnerSummaryRow> {
    assertId('ownerId', ownerId);
    return this.get(
      'carrierOwnerLiquidations/ownerDetail',
      `carrierOwnerLiquidations/ownerDetail/${this.carrierId}/ownerId/${ownerId}`
    );
  }

  async ownersSummary(
    p: { find?: string } = {}
  ): Promise<Page<OwnerSummaryRow> & { totalConsolidated?: number | null }> {
    return this.get(
      'carrierOwnerLiquidations/findOwners',
      `carrierOwnerLiquidations/findOwners/${this.carrierId}/paginated`,
      {
        page: 1,
        size: BIG_PAGE,
        ...(p.find ? { find: p.find } : {})
      }
    );
  }

  async ownerLiquidations(p: {
    ownerId: number;
    from: string;
    to: string;
  }): Promise<Page<LiquidationHead>> {
    assertId('ownerId', p.ownerId);
    return this.get(
      'carrierOwnerLiquidations/byCarrier',
      `carrierOwnerLiquidations/byCarrier/${this.carrierId}/ownerId/${p.ownerId}/${assertDay('from', p.from)}/${assertDay('to', p.to)}/paginated`,
      { page: 1, size: BIG_PAGE, column: 'id', sort: 'DESC' }
    );
  }

  async ownerLiquidationDetails(liquidationId: number): Promise<LiquidationHead> {
    assertId('liquidationId', liquidationId);
    return this.get(
      'carrierOwnerLiquidations/getLiquidationDetails',
      `carrierOwnerLiquidations/getLiquidationDetails/${liquidationId}`
    );
  }

  /** Grupos fecha/vehiculo de la liquidacion (misma forma que el pendiente). */
  async ownerLiquidationSurrenders(liquidationId: number): Promise<Page<OwnerUnsettledRow>> {
    assertId('liquidationId', liquidationId);
    return this.get(
      'carrierOwnerLiquidations/getLiquidationSurrenderDetails',
      `carrierOwnerLiquidations/getLiquidationSurrenderDetails/${liquidationId}`,
      { page: 1, size: BIG_PAGE, column: 'TRUNC(sur.creationDate)', sort: 'ASC' }
    );
  }

  // ───────────── escrituras (gate FR_CONFIRM_SETTLEMENT=1) ─────────────

  private assertCreateGate(method: string): void {
    if (!isSettlementGateOpen()) {
      throw new Error(
        `[settlement] ${method}() bloqueado: crea una liquidacion PAID que impide editar los viajes; requiere ${SETTLEMENT_GATE}=1`
      );
    }
  }

  /** IRREVERSIBLE (gate). `driverAccountId` = DRIVER.ID. El total lo manda el cliente (el BE no lo recalcula). */
  async createDriverLiquidation(
    driverAccountId: number,
    body: CreateLiquidationBody
  ): Promise<LiquidationHead> {
    this.assertCreateGate('createDriverLiquidation');
    assertId('driverAccountId', driverAccountId);
    return this.post(
      'carrierDriverLiquidations POST',
      `carrierDriverLiquidations/${this.carrierId}/${driverAccountId}`,
      { ...body, driverId: driverAccountId }
    );
  }

  /** IRREVERSIBLE (gate). `ownerId` = VEHICLEOWNERS.ID. `details[].travelSurrenderId` = ids "a,b,c" de un grupo. */
  async createOwnerLiquidation(
    ownerId: number,
    body: CreateLiquidationBody
  ): Promise<LiquidationHead> {
    this.assertCreateGate('createOwnerLiquidation');
    assertId('ownerId', ownerId);
    return this.post(
      'carrierOwnerLiquidations POST',
      `carrierOwnerLiquidations/${this.carrierId}/${ownerId}`,
      { ...body, driverId: ownerId }
    );
  }

  private async post(label: string, url: string, data: unknown): Promise<LiquidationHead> {
    const response = await sendOk(label, () => this.api.post(url, { data }));
    const body = await readJson<LiquidationHead>(response);
    if (!body || typeof body.originalId !== 'number') {
      throw new Error(
        `[settlement] ${label}: respuesta sin originalId (liquidacion no confirmada)`
      );
    }
    return body;
  }
}
