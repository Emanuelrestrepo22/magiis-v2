// tests/steps/trips/referencePointTrip.steps.ts
// Recorrido reusable «viaje con puntos de referencia» (MG-1132 PK-5, ATP TM-1841). Patron de
// `NewTripOtherCostsFlow`: precondiciones por API (puntos propios), alta por UI con «Enviar Manual», oraculos
// de API y DB (solo SELECT), evidencia y limpieza SIEMPRE.
//
// REGLAS DE VIAJES (no negociables, QA lead):
// - Todo viaje en el carrier 1521 (la sesion por defecto), alta por UI con «Enviar Manual».
// - NUNCA el boton «A» (autodispatch) ni ninguna asignacion automatica.
// - Antes de crear un viaje, gate `DRIVER_STATUS` por DB: si hay choferes del 1521 no OFFLINE el test se
//   salta (`test.skip` real con motivo); sin DB el gate no se puede evaluar y el test FALLA (infra ausente).
// - Todo viaje creado se registra en el ledger `waypoints` en cuanto responde el alta y se cancela en la
//   limpieza; la limpieza verifica por API que quedo CANCELLED.
import type { Page, Response, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { PlaceFields, type PlaceField } from '../../pages/carrier-v2/trips/PlaceFields.js';
import type { TravelDetail, TravelsClient } from '../../api/clients/travels.client.js';
import type { WaypointDto } from '../../api/clients/waypoints.client.js';
import type { CarrierSession } from '../../api/clients/carrierSession.js';
import { requireOracle } from '../../helpers/db-gate.js';
import type { OracleDb } from '../../db/OracleDb.js';
import type { AreaRow } from '../../helpers/zone-coverage.js';
import { ledgerAdd, ledgerRemove } from '../../helpers/trip-ledger.js';
import { watchPlacesTraffic, type PlacesTrafficWatch } from '../../utils/networkWatch.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';

/** Scope del ledger de viajes de la familia (recupero de corridas interrumpidas). */
export const WAYPOINTS_LEDGER_SCOPE = 'waypoints';

/** Cliente del carrier 1521 (tarifador de venta) y medio de pago de la familia de viajes. */
export const TRIP_CLIENT_QUERY = 'Stripe, Cliente';
export const TRIP_PAYMENT_METHOD = 'Cash';
/** Texto para elegir direcciones de Google en Florida (zonas del 1521). */
export const GOOGLE_DESTINATION_TEXT = '10101 Collins';
export const GOOGLE_ORIGIN_TEXT = '100 N 31st Ave';

/** Texto de busqueda de los puntos propios del run (prefijo + runId: unico, no compartido con otras corridas). */
export function searchTextFor(runId: string): string {
  return `QA AUTO ${runId}`;
}

/** Lugar de un campo de la ruta: punto propio (se busca por el prefijo del run) o direccion de Google. */
export type PlaceSpec = { kind: 'point'; point: WaypointDto } | { kind: 'google'; text: string };

export type QuoteResult = {
  /** Cuerpo del POST `travels/simulateAll`. */
  requestBody: Record<string, unknown>;
  status: number;
  options: Record<string, unknown>[];
  /** La UI mostro vehiculo elegido y botones de envio (cotizacion completa). */
  uiQuoted: boolean;
};

export type ManualSaveResult = {
  travelId: number;
  requestBody: Record<string, unknown>;
  status: number;
};

/** Fecha futura `MM/DD/YYYY` (zona del carrier 1521) a `daysAhead` dias; dentro de la ventana de Scheduled (30). */
export function futureTripDate(daysAhead = 6, now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(now + daysAhead * 86_400_000));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}/${get('day')}/${get('year')}`;
}

/** Instante UTC (ISO) de una hora de pared `YYYY-MM-DD HH:mm` en la zona `timeZone`. */
export function zonedWallTimeToUtcIso(
  wall: { date: string; hour: number; minute: number },
  timeZone: string
): string {
  const [y, m, d] = wall.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, wall.hour, wall.minute);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const offsetAt = (instant: number): number => {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).map((x) => [x.type, Number(x.value)])
    );
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
  };
  // Dos pasadas: la segunda corrige el cambio de offset si cruza un cambio de horario.
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return new Date(guess).toISOString();
}

/** Los cinco valores del lugar que un viaje debe conservar (API `GET travels/{id}`). */
export function placeSnapshot(place: unknown): Record<string, unknown> {
  const p = place as Record<string, unknown>;
  return {
    mapPlaceId: p.mapPlaceId,
    latitude: String(p.latitude),
    longitude: String(p.longitude),
    shortName: p.shortName,
    specialInstruction: p.specialInstruction ?? null
  };
}

/** Motivo del `test.skip` cuando el gate de choferes esta cerrado. */
export function driversSkipReason(gate: {
  nonOffline: number;
  statuses: Record<string, number>;
}): string {
  return `gate DRIVER_STATUS: ${gate.nonOffline} choferes del carrier no OFFLINE (${JSON.stringify(gate.statuses)}); podrian tomar el viaje y no se crea`;
}

/** Id del viaje en la respuesta del alta: `travelId`, `id` o `travel.travelId` / `travel.id`. */
function travelIdFromCreateBody(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const nested = (root.travel ?? {}) as Record<string, unknown>;
  const id = Number(root.travelId ?? root.id ?? nested.travelId ?? nested.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Fila de lugar del viaje en la DB (origen/destino por la cotizacion, parada por TRAVELID). */
export type DbPlaceRow = {
  MAPPLACEID: string | null;
  LATITUDE: string | number | null;
  LONGITUDE: string | number | null;
  SHORTNAME: string | null;
  SPECIAL_INSTRUCTION: string | null;
};

const PLACE_COLUMNS = 'MAPPLACEID, LATITUDE, LONGITUDE, SHORTNAME, SPECIAL_INSTRUCTION';

export class ReferencePointTripFlow {
  readonly newTrip: NewTripPage;
  readonly places: PlaceFields;

  /** Observador de trafico de lugares a nivel de TEST (falla cerrado): desde la primera seleccion hasta despues de `simulateAll`. */
  readonly traffic: PlacesTrafficWatch;
  private readonly travelIds = new Set<number>();
  private readonly unidentifiedCreates: string[] = [];
  private readonly pendingCreateResponses: Promise<void>[] = [];
  private createRequests = 0;
  private createResponses = 0;

  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
    private readonly session: CarrierSession,
    private readonly travelsApi: TravelsClient,
    private readonly db: OracleDb | null,
    readonly runId: string
  ) {
    this.newTrip = new NewTripPage(page);
    this.places = new PlaceFields(page, 'new');
    this.traffic = watchPlacesTraffic(page);
    // Salir de Nuevo Viaje con el formulario sucio dispara `beforeunload`: se acepta; cualquier otro dialogo se descarta.
    page.on('dialog', (dialog) => {
      void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    });
    page.on('request', (request) => {
      if (request.method() === 'POST' && NewTripPage.CREATE_TRAVEL_URL.test(request.url())) {
        this.createRequests += 1;
      }
    });
    // Registro del viaje INDEPENDIENTE del resultado del metodo del POM: si el alta responde y el test
    // falla antes de leerla, el viaje igual queda anotado para la limpieza.
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        NewTripPage.CREATE_TRAVEL_URL.test(response.url())
      ) {
        this.createResponses += 1;
        this.pendingCreateResponses.push(this.registerCreateResponse(response));
      }
    });
  }

  private registerTravel(travelId: number): void {
    if (this.travelIds.has(travelId)) return;
    this.travelIds.add(travelId);
    ledgerAdd(
      this.session.env,
      { travelId, runId: this.runId, recordedAt: new Date().toISOString() },
      WAYPOINTS_LEDGER_SCOPE
    );
  }

  private async registerCreateResponse(response: Response): Promise<void> {
    const body = (await response.json().catch(() => null)) as unknown;
    const travelId = travelIdFromCreateBody(body);
    if (travelId !== null) {
      this.registerTravel(travelId);
    } else if (response.ok()) {
      const keys = body && typeof body === 'object' ? Object.keys(body).join(',') : 'sin JSON';
      this.unidentifiedCreates.push(`status ${response.status()}, claves [${keys}]`);
    }
  }

  /** Cantidad de POST de alta de viaje emitidos por la pagina en este test (oraculo «no se crea viaje»). */
  get createTravelRequestCount(): number {
    return this.createRequests;
  }

  // === Gate de choferes (DB, solo SELECT) ===

  /**
   * Choferes del carrier que NO estan OFFLINE (podrian tomar el viaje). El llamador salta el test si > 0.
   * Sin DB lanza (infra ausente = fallo, no skip).
   */
  async driversGate(): Promise<{ nonOffline: number; statuses: Record<string, number> }> {
    const expectedCarrier = waypointsDataFor(this.session.env)?.primary.carrierId;
    if (expectedCarrier === undefined || this.session.carrierId !== expectedCarrier) {
      throw new Error(
        `[gate choferes] la sesion es del carrier ${this.session.carrierId}; los viajes de esta familia solo se crean en el ${String(expectedCarrier)}`
      );
    }
    const db = requireOracle(this.db, 'el gate DRIVER_STATUS antes de crear un viaje');
    const rows = await db.query<{ DRIVER_STATUS: string; N: number }>(
      'SELECT DRIVER_STATUS, COUNT(*) AS N FROM DRIVER_STATUS WHERE CARRIERACCOUNT_ID = :c GROUP BY DRIVER_STATUS',
      { c: this.session.carrierId }
    );
    if (rows.length === 0) {
      throw new Error(
        `[gate choferes] DRIVER_STATUS no devolvio filas para el carrier ${this.session.carrierId}: el gate no puede evaluarse (un carrier sin choferes tambien lo abre en vacio)`
      );
    }
    const statuses: Record<string, number> = {};
    for (const row of rows) statuses[row.DRIVER_STATUS] = Number(row.N);
    const nonOffline = rows
      .filter((row) => row.DRIVER_STATUS !== 'OFFLINE')
      .reduce((sum, row) => sum + Number(row.N), 0);
    return { nonOffline, statuses };
  }

  // === Alta por UI ===

  /** Abre Nuevo Viaje limpio (descarta el borrador con «Start Over» si la app lo ofrece), cliente y pago. */
  async openNewTrip(): Promise<void> {
    await this.newTrip.goto();
    const startOver = this.page.getByRole('button', { name: /start over/i });
    if ((await startOver.count()) > 0) await startOver.click();
    await this.newTrip.selectClient(TRIP_CLIENT_QUERY);
    await this.newTrip.selectPaymentMethod(TRIP_PAYMENT_METHOD);
  }

  /** Carga un lugar en el campo; devuelve las llamadas vigiladas observadas al elegirlo. */
  async fillPlace(field: PlaceField, spec: PlaceSpec): Promise<string[]> {
    if (
      (await this.places.placeValue(field)) !== '' &&
      (field === 'origin' || field === 'destination')
    ) {
      await this.places.clearField(field);
    }
    if (spec.kind === 'point') {
      const picked = await this.places.pickReferencePoint(
        field,
        searchTextFor(this.runId),
        spec.point.placeId
      );
      return picked.outboundCalls;
    }
    return (await this.places.pickGoogleAddress(field, spec.text)).outboundCalls;
  }

  /** Fecha del viaje (futura, `MM/DD/YYYY`). */
  async setDate(date: string): Promise<void> {
    await this.newTrip.tripDateInput.fill(date);
    await expect(this.newTrip.tripDateInput).toHaveValue(date);
  }

  /** Hora del viaje por su texto exacto (p. ej. «10:00 AM»). */
  async setTime(text: string): Promise<void> {
    await this.newTrip.tripTimeSelect.click();
    await this.page
      .locator('.ng-dropdown-panel .ng-option')
      .filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) })
      .first()
      .click();
    await expect(this.newTrip.tripTimeValue).toHaveText(text);
  }

  /**
   * «Select Vehicle» capturando `simulateAll` (cuerpo enviado y respuesta). Un 200 con opciones deja la UI
   * cotizada (vehiculo elegido y botones de envio); cualquier otra cosa se devuelve SIN aseverar para que el
   * llamador decida (TM-1790: contrato abierto Q2). Una espera agotada (sin respuesta) lanza: es ambiente.
   */
  async quote(): Promise<QuoteResult> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/travels/simulateAll') && res.request().method() === 'POST',
        { timeout: 60_000 }
      ),
      this.newTrip.selectVehicleButton.click()
    ]);
    const requestBody = response.request().postDataJSON() as Record<string, unknown>;
    const status = response.status();
    const parsed = status === 200 ? ((await response.json().catch(() => null)) as unknown) : null;
    const options = Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    let uiQuoted = false;
    if (status === 200 && options.length > 0) {
      await expect(this.newTrip.selectedVehicleCard).toBeVisible({ timeout: 45_000 });
      await expect(this.newTrip.submitButton).toBeVisible({ timeout: 45_000 });
      uiQuoted = true;
    }
    return { requestBody, status, options, uiQuoted };
  }

  /** «Enviar Manual» (queda en Assign sin despacho automatico); registra el viaje antes de cualquier aserto. */
  async saveManually(): Promise<ManualSaveResult> {
    // Gate estructural: se reevalua JUSTO antes del alta (el del inicio del test es solo un atajo).
    const gate = await this.driversGate();
    if (gate.nonOffline > 0) test.skip(true, driversSkipReason(gate));
    const result = await this.newTrip.sendManualAndCaptureCreate();
    const travelId = Number(result.travelId);
    this.registerTravel(travelId);
    return { travelId, requestBody: result.requestBody, status: result.status };
  }

  /**
   * Alta completa por UI de un viaje programado (Enviar Manual): origen, destino y parada opcional.
   * Precondicion comun de los Tests que parten de un viaje existente.
   */
  async seedTrip(route: {
    origin: PlaceSpec;
    destination: PlaceSpec;
    stop?: PlaceSpec;
  }): Promise<ManualSaveResult> {
    await this.openNewTrip();
    await this.fillPlace('origin', route.origin);
    await this.fillPlace('destination', route.destination);
    if (route.stop) {
      await this.newTrip.addStop();
      await this.fillPlace({ stop: 1 }, route.stop);
    }
    await this.setDate(futureTripDate());
    const quote = await this.quote();
    if (!quote.uiQuoted) {
      throw new Error(
        `[seedTrip] la cotizacion de la precondicion no quedo completa (simulateAll ${quote.status}, ${quote.options.length} opciones)`
      );
    }
    const saved = await this.saveManually();
    if (saved.status !== 200) {
      throw new Error(`[seedTrip] el alta de la precondicion respondio ${saved.status}`);
    }
    return saved;
  }

  /** Sale del alta sin guardar (acepta el `beforeunload`). */
  async leaveWithoutSaving(): Promise<void> {
    await this.page.goto('about:blank');
  }

  /** Codigo visible del viaje en el listado: `{travelIdForCarrier}-{canal}`. */
  tripCode(detail: TravelDetail): string {
    return `${String(detail.travelIdForCarrier)}-${String(detail.channel ?? 'W')}`;
  }

  // === Oraculos DB (solo SELECT) ===

  private requireDb(label: string): OracleDb {
    return requireOracle(this.db, label);
  }

  /** Filas de lugar del origen y del destino del viaje (por la cotizacion SIMULATIONPRICEI). */
  async dbOriginDestination(
    travelId: number
  ): Promise<{ origin: DbPlaceRow | undefined; destination: DbPlaceRow | undefined }> {
    const db = this.requireDb('el oraculo DB de origen/destino del viaje');
    const pick = async (
      column: 'ORIGINPLACE_ID' | 'DESTINATIONPLACE_ID'
    ): Promise<DbPlaceRow | undefined> =>
      (
        await db.query<DbPlaceRow>(
          `SELECT ${PLACE_COLUMNS.split(', ')
            .map((c) => `p.${c} AS ${c}`)
            .join(', ')} FROM TRAVEL t JOIN SIMULATIONPRICEI s ON s.ID = t.SIMULATIONPRICE_ID ` +
            `JOIN PLACE p ON p.ID = s.${column} WHERE t.ID = :id`,
          { id: travelId }
        )
      )[0];
    return { origin: await pick('ORIGINPLACE_ID'), destination: await pick('DESTINATIONPLACE_ID') };
  }

  /** Fila de lugar ligada al viaje por TRAVELID (paradas) con su orden. */
  async dbStopRows(
    travelId: number,
    placeId: string
  ): Promise<(DbPlaceRow & { ORDER_IDX_WAYPOINT: number | null })[]> {
    const db = this.requireDb('el oraculo DB de la parada del viaje');
    return db.query<DbPlaceRow & { ORDER_IDX_WAYPOINT: number | null }>(
      `SELECT ${PLACE_COLUMNS}, ORDER_IDX_WAYPOINT FROM PLACE WHERE TRAVELID = :id AND MAPPLACEID = :p`,
      { id: travelId, p: placeId }
    );
  }

  /** Filas de `MAGIIS_PLACE` de los placeId dados (versiones de un punto), ordenadas por placeId. */
  async dbMagiisPlaces(
    placeIds: string[]
  ): Promise<{ PLACE_ID: string; LATITUDE: string | number; LONGITUDE: string | number }[]> {
    const db = this.requireDb('las versiones del punto en MAGIIS_PLACE');
    const binds: Record<string, string> = {};
    const names = placeIds.map((id, i) => {
      binds[`p${i}`] = id;
      return `:p${i}`;
    });
    return db.query(
      `SELECT PLACE_ID, LATITUDE, LONGITUDE FROM MAGIIS.MAGIIS_PLACE WHERE PLACE_ID IN (${names.join(',')}) ORDER BY PLACE_ID`,
      binds
    );
  }

  /** Areas de las zonas de cotizacion ACTIVAS del carrier (solo SELECT). */
  async dbCarrierAreas(): Promise<AreaRow[]> {
    const db = this.requireDb('las zonas de cotizacion del carrier');
    return db.query<AreaRow>(
      'SELECT a.AREA_TYPE, a.CIRCLE, a.POLYGON, a.ZIPCODE FROM CARRIER_ZONES z ' +
        'JOIN CARRIER_ZONES_DEFINITION d ON d.ZONE_ID = z.ID JOIN CARRIER_AREAS a ON a.ID = d.AREA_ID ' +
        'WHERE z.CARRIER_ID = :c AND z.ACTIVE = 1',
      { c: this.session.carrierId }
    );
  }

  /** Estado del viaje y SPECIAL_ASSIGN / DRIVER_ID (prueba de que no hubo asignacion automatica). */
  async dbTravelAssignment(
    travelId: number
  ): Promise<
    { STATE: number; SPECIAL_ASSIGN: number | null; DRIVER_ID: number | null } | undefined
  > {
    const db = this.requireDb('el estado de asignacion del viaje');
    return (
      await db.query<{ STATE: number; SPECIAL_ASSIGN: number | null; DRIVER_ID: number | null }>(
        'SELECT STATE, SPECIAL_ASSIGN, DRIVER_ID FROM TRAVEL WHERE ID = :id',
        { id: travelId }
      )
    )[0];
  }

  // === Evidencia ===

  /** Adjunta la captura de la pagina y el comentario de medicion del run. */
  async evidence(name: string, comment: string): Promise<void> {
    await this.testInfo.attach(name, {
      body: await this.page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
    this.testInfo.annotations.push({ type: 'xray_comment', description: comment });
  }

  // === Limpieza ===

  /**
   * Cancela los viajes de ESTE test y verifica por API que quedaron CANCELLED. Intenta todo aunque algo
   * falle y recien al final lanza si hubo errores (los viajes no cancelados quedan en el ledger `waypoints`
   * para el recupero de la corrida siguiente).
   */
  async cleanup(): Promise<void> {
    const errors: string[] = [];
    const done: string[] = [];
    this.traffic.dispose();
    await this.settleCreateResponses();
    const unanswered = this.createRequests - this.createResponses;
    if (unanswered > 0) {
      errors.push(
        `${unanswered} POST de alta sin respuesta: puede haber quedado un viaje sin id; revisar Assign a mano`
      );
    }
    for (const detail of this.unidentifiedCreates) {
      errors.push(`alta OK sin id reconocible (${detail}): el viaje existe, cancelarlo a mano`);
    }
    for (const travelId of this.travelIds) {
      try {
        const before = String((await this.travelsApi.getDetail(travelId)).state ?? '');
        if (before !== 'CANCELLED') {
          await this.travelsApi.cancel(travelId, `QA AUTO ${this.runId} limpieza`);
        }
        const after = String((await this.travelsApi.getDetail(travelId)).state ?? '');
        if (after !== 'CANCELLED') {
          errors.push(`viaje ${travelId}: sigue en estado ${after} tras cancelar`);
          continue;
        }
        ledgerRemove(this.session.env, travelId, WAYPOINTS_LEDGER_SCOPE);
        done.push(`viaje ${travelId} cancelado`);
      } catch (error) {
        errors.push(`viaje ${travelId}: ${(error as Error).message}`);
      }
    }
    if (done.length > 0 || errors.length > 0) {
      this.testInfo.annotations.push({
        type: 'xray_comment',
        description: `Limpieza: ${done.join('; ') || 'nada'}${errors.length ? ` · ERRORES: ${errors.join('; ')}` : ''}.`
      });
    }
    if (errors.length > 0) throw new Error(`[limpieza puntos de referencia] ${errors.join(' | ')}`);
  }

  private async settleCreateResponses(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (
      this.createResponses < this.createRequests &&
      !this.page.isClosed() &&
      Date.now() < deadline
    ) {
      await this.page
        .waitForEvent('response', { timeout: Math.max(deadline - Date.now(), 1) })
        .catch(() => undefined);
    }
    await Promise.all(this.pendingCreateResponses);
  }

  /** Ids de los viajes creados por este test (para la medicion y el cierre). */
  get createdTravelIds(): number[] {
    return [...this.travelIds];
  }
}
