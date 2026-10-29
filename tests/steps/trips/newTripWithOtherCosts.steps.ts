// tests/steps/trips/newTripWithOtherCosts.steps.ts
// Recorrido reusable «Nuevo Viaje con Otros Costos» (MG-995/MG-996 fase 1, ATR TM-1280).
// Plan MG-990-fase1 §5.1-§5.2: conceptos por API → alta por UI → oráculo UI + API → evidencia →
// limpieza. Capa Steps nueva en V2 (docs/architecture/ADR-0003, propuesto): la reusan F2, F5 y F7.
//
// Reglas:
// - Las aserciones fijas del recorrido viven en los POM (la línea aparece, el modal cierra, el POST
//   responde). Las de negocio (importes) quedan en el test.
// - Limpieza SIEMPRE (la dispara el fixture del spec aunque el test falle): viajes cancelados por
//   API y conceptos dados de baja por API. Solo toca lo que creó esta corrida.
// - Evidencia sin PII ni token: la medición usa lista blanca de campos (plan §5.7).
import type { Page, Response, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { TravelDetailPage } from '../../pages/carrier-v2/trips/TravelDetailPage.js';
import { TravelDashboardPage } from '../../pages/carrier-v2/trips/TravelDashboardPage.js';
import type { OtherCostItem, OtherCostsClient } from '../../api/clients/otherCosts.client.js';
import type {
  SimulationOtherCost,
  TravelDetail,
  TravelsClient
} from '../../api/clients/travels.client.js';
import {
  ApiStatusError,
  redactApiText,
  SessionRejectedError,
  type CarrierSession
} from '../../api/clients/carrierSession.js';
import {
  makeRunId,
  type OtherCostContext,
  type OtherCostPayload
} from '../../fixtures/factories/otherCostFactory.js';
import type { OtherCostsEnvData } from '../../data/carrier-v2/trips/other-costs.js';
import { parseMoney } from '../../utils/money.js';
import {
  ledgerAdd,
  ledgerRemove,
  OTHER_COSTS_LEDGER_SCOPE,
  recordLeakedTrip,
  recoverLeakedTrips
} from '../../helpers/trip-ledger.js';

/** Resumen de importes de Nuevo Viaje, ya parseado (las secciones opcionales ausentes valen 0). */
export type PriceSummary = {
  subtotal: number;
  otherCosts: number;
  fixedFees: number;
  taxes: number;
  total: number;
  lines: { label: string; amount: number }[];
};

/** Item del request de alta / simulateAll: `{ id, quantity, price }` (price = total de la línea). */
export type RequestOtherCost = { id: number; quantity: number; price: number };

export type ManualSaveResult = {
  travelId: number;
  requestOtherCosts: RequestOtherCost[] | null;
  status: number;
};

/** Status de un rechazo de NEGOCIO al crear un concepto (validación); el resto se relanza. */
const BUSINESS_REJECTION_STATUSES = new Set([400, 409, 422]);
/** Espera máxima, en la limpieza, por la respuesta de un POST de alta que salió sin respuesta. */
const PENDING_CREATE_WAIT_MS = 30_000;

// Registro persistente de viajes (recupero de corridas interrumpidas): vive en el modulo neutral
// tests/helpers/trip-ledger.ts; se re-exporta aca para los llamadores existentes.
export { recordLeakedTrip, recoverLeakedTrips };

/** Id del viaje en la respuesta del alta: `travelId`, `id` o `travel.travelId` / `travel.id`. */
function travelIdFromCreateBody(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const nested = (root.travel ?? {}) as Record<string, unknown>;
  const id = Number(root.travelId ?? root.id ?? nested.travelId ?? nested.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Vista de un concepto apta para evidencia (sin datos de usuario). */
function conceptView(item: OtherCostItem): Record<string, unknown> {
  return {
    id: item.id,
    concept: item.concept,
    conceptType: item.conceptType,
    conceptValue: item.conceptValue,
    maxValue: item.maxValue,
    apply: item.apply,
    isByCost: item.isByCost,
    conceptValueCost: item.conceptValueCost,
    maxCostValue: item.maxCostValue,
    currency: item.currency?.code ?? null
  };
}

/** Vista del detalle apta para evidencia: lista blanca de campos, sin datos del pasajero. */
export function travelDetailView(detail: TravelDetail): Record<string, unknown> {
  const sim = detail.simulationPrice ?? null;
  return {
    travelId: detail.travelId ?? null,
    travelIdForCarrier: detail.travelIdForCarrier ?? null,
    state: detail.state ?? null,
    amount: detail.amount ?? null,
    otherCost: detail.otherCost ?? null,
    otherCostList: (detail.otherCostList ?? []).map((l) => ({
      id: l.id ?? null,
      name: l.name ?? null,
      price: l.price ?? null
    })),
    simulationPrice: sim
      ? {
          pricePointToPoint: sim.pricePointToPoint ?? null,
          otherCosts: (sim.otherCosts ?? []).map((c) => ({
            otherCostId: c.otherCostId,
            name: c.name ?? null,
            type: c.type ?? null,
            price: c.price,
            quantity: c.quantity,
            conceptValue: c.conceptValue ?? null,
            maxValue: c.maxValue ?? null
          }))
        }
      : null
  };
}

/** Item presupuestado de un concepto en el detalle, o null si no está. */
export function simulationItem(
  detail: TravelDetail,
  conceptId: number
): SimulationOtherCost | null {
  return (
    (detail.simulationPrice?.otherCosts ?? []).find((c) => c.otherCostId === conceptId) ?? null
  );
}

/**
 * Estado y acciones de un test de la familia. Una instancia por test (la crea el fixture del spec,
 * que llama `cleanup()` al terminar pase lo que pase).
 */
export class NewTripOtherCostsFlow {
  readonly runId = makeRunId();
  readonly newTrip: NewTripPage;
  readonly detail: TravelDetailPage;
  readonly dashboard: TravelDashboardPage;

  private readonly conceptIds: number[] = [];
  private readonly travelIds = new Set<number>();
  /** Altas que respondieron OK sin id reconocible: el viaje existe y hay que cancelarlo a mano. */
  private readonly unidentifiedCreates: string[] = [];
  /** Parseo en curso de respuestas de alta (la limpieza las espera antes de cancelar). */
  private readonly pendingCreateResponses: Promise<void>[] = [];
  private createTravelRequests = 0;
  private createTravelResponses = 0;
  private currencyId: number | null | undefined;

  constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
    private readonly session: CarrierSession,
    private readonly otherCostsApi: OtherCostsClient,
    private readonly travelsApi: TravelsClient,
    readonly data: OtherCostsEnvData
  ) {
    this.newTrip = new NewTripPage(page);
    this.detail = new TravelDetailPage(page);
    this.dashboard = new TravelDashboardPage(page);

    // Salir de Nuevo Viaje con el formulario sucio dispara `pendingChangesGuard` / `beforeunload`
    // (relevamiento §1): se acepta ese diálogo; cualquier otro se descarta (default de Playwright).
    page.on('dialog', (dialog) => {
      void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    });
    // Oráculo de «no se guarda» (TM-1277/1279): cuenta los POST de alta de viaje. Misma regex que
    // usa NewTripPage para capturar el alta (una sola fuente: NewTripPage.CREATE_TRAVEL_URL).
    page.on('request', (request) => {
      if (request.method() === 'POST' && NewTripPage.CREATE_TRAVEL_URL.test(request.url())) {
        this.createTravelRequests += 1;
      }
    });
    // Registro del viaje para la limpieza INDEPENDIENTE del resultado del método del POM: si
    // `sendManualAndCaptureCreate` agota su espera o no reconoce el id, el viaje igual se anota.
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        NewTripPage.CREATE_TRAVEL_URL.test(response.url())
      ) {
        this.createTravelResponses += 1;
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
      OTHER_COSTS_LEDGER_SCOPE
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

  /** Cantidad de POST de alta de viaje que salieron desde la página en este test. */
  get createTravelRequestCount(): number {
    return this.createTravelRequests;
  }

  // === Conceptos (API) ===

  /**
   * Contexto de la factory. La moneda se DESCUBRE del catálogo (un concepto existente en la moneda
   * del carrier, plan §5.3); si no hay ninguno se deja null y el backend usa la del carrier.
   */
  async conceptContext(extra: Partial<OtherCostContext> = {}): Promise<OtherCostContext> {
    if (this.currencyId === undefined) {
      const catalog = await this.otherCostsApi.search();
      this.currencyId =
        catalog.find((item) => item.currency?.code === this.data.currencyCode)?.currency
          ?.currencyId ?? null;
    }
    return {
      carrierId: this.session.carrierId,
      userId: this.session.subUserId,
      currencyId: this.currencyId,
      runId: this.runId,
      ...extra
    };
  }

  /** Crea un concepto por API y lo registra para la limpieza. */
  async createConcept(payload: OtherCostPayload): Promise<OtherCostItem> {
    const item = await this.otherCostsApi.create(payload);
    this.conceptIds.push(item.id);
    return item;
  }

  /**
   * Intenta crear un concepto que el backend podría rechazar (TM-1279: valor negativo, dato
   * legado). Solo un rechazo de NEGOCIO (4xx de validación: 400/409/422) no lanza: devuelve el
   * motivo redactado para que el test lo declare como skip explícito. Todo lo demás (401/403 =
   * STOP, 5xx, red, timeout) se relanza: una falla de infraestructura no es una regla de PO.
   * Si la respuesta se perdió o fue 5xx, antes de relanzar busca el concepto por nombre y, si el
   * servidor igual lo creó, lo registra para la limpieza.
   */
  async tryCreateConcept(
    payload: OtherCostPayload
  ): Promise<{ item: OtherCostItem | null; rejection: string | null }> {
    try {
      return { item: await this.createConcept(payload), rejection: null };
    } catch (error) {
      if (error instanceof ApiStatusError && BUSINESS_REJECTION_STATUSES.has(error.status)) {
        return { item: null, rejection: redactApiText(error.message).slice(0, 300) };
      }
      if (!(error instanceof SessionRejectedError)) {
        const created = await this.otherCostsApi.findByName(payload.name).catch(() => null);
        if (created && !this.conceptIds.includes(created.id)) this.conceptIds.push(created.id);
      }
      throw error;
    }
  }

  /** Fila vigente del catálogo para un concepto creado (oráculo de catálogo, TM-1277/1279). */
  async catalogItem(id: number): Promise<OtherCostItem | null> {
    return (await this.otherCostsApi.search()).find((item) => item.id === id) ?? null;
  }

  // === Alta por UI ===

  /**
   * Abre Nuevo Viaje, completa cliente, origen y destino y cotiza («Select Vehicle»). Recién ahí
   * aparece el bloque Otros Costos (relevamiento §1). `long` usa la ruta larga (Porcentaje).
   */
  async startQuotedTrip(route: 'short' | 'long' = 'short'): Promise<PriceSummary> {
    const r = this.data.route;
    await this.newTrip.goto();
    await this.newTrip.selectClient(r.clientQuery);
    await this.newTrip.fillOrigin(r.originQuery);
    if (route === 'long') {
      await this.newTrip.fillFirstDestinationMatching(
        r.longDestinationQuery,
        r.longDestinationOption
      );
    } else {
      await this.newTrip.fillFirstDestination(r.destinationQuery);
    }
    await this.newTrip.quoteTrip();
    return this.readSummary();
  }

  /** Resumen de importes parseado con `parseMoney`. */
  async readSummary(): Promise<PriceSummary> {
    const raw = await this.newTrip.readPriceSummary();
    const optional = (text: string | null): number => (text ? parseMoney(text) : 0);
    return {
      subtotal: parseMoney(raw.subtotal),
      otherCosts: parseMoney(raw.otherCosts),
      fixedFees: optional(raw.fixedFees),
      taxes: optional(raw.taxes),
      total: parseMoney(raw.total),
      lines: raw.lines.map((l) => ({ label: l.label, amount: parseMoney(l.amount) }))
    };
  }

  /**
   * Agrega un concepto de precio precargado (FIX) leyendo antes de aceptar el valor que el modal
   * precarga (TM-1279: «debería precargar su venta»). Devuelve la precarga cruda.
   */
  async addConceptReadingPreload(name: string): Promise<string> {
    const modal = await this.newTrip.openAddOtherCostModal();
    await modal.selectConcept(name);
    const preload = await modal.readPrice();
    await modal.accept();
    await expect(
      this.newTrip.otherCostLine(name),
      `el concepto "${name}" debe aparecer como línea del bloque Otros Costos`
    ).toHaveCount(1, { timeout: 10_000 });
    return preload;
  }

  /** Importe parseado de la línea de un concepto. */
  async lineAmount(name: string): Promise<number> {
    return parseMoney((await this.newTrip.otherCostLineAmount(name).textContent()) ?? '');
  }

  /** Precio del vehículo seleccionado (tarjeta), parseado. */
  async selectedVehiclePrice(): Promise<number> {
    return parseMoney((await this.newTrip.selectedVehiclePrice.textContent()) ?? '');
  }

  /**
   * Guarda con «Enviar Manual» (queda en Assign, sin despacho automático) y registra el viaje
   * para la limpieza ANTES de cualquier aserción posterior.
   */
  async saveManually(): Promise<ManualSaveResult> {
    // El listener de `response` ya anotó el viaje aunque este método lance (timeout, sin id).
    const result = await this.newTrip.sendManualAndCaptureCreate();
    const travelId = Number(result.travelId);
    this.registerTravel(travelId);
    const raw = result.requestBody.otherCosts;
    return {
      travelId,
      requestOtherCosts: Array.isArray(raw) ? (raw as RequestOtherCost[]) : null,
      status: result.status
    };
  }

  /** Sale del alta sin guardar (TM-1277/1279): acepta el `beforeunload` y deja la página en blanco. */
  async leaveWithoutSaving(): Promise<void> {
    await this.page.goto('about:blank');
  }

  // === Oráculos UI posteriores al alta ===

  /**
   * Detalle del viaje: código visible (para el listado) y fila Otros Costos del widget
   * presupuestado. `expectBudgetedOtherCosts` = el test asevera esa fila: se espera visible (no
   * se lee con un `count()` que no reintenta). Sin él, solo se registra (D1) y puede ser null.
   */
  async openDetail(
    travelId: number,
    options: { expectBudgetedOtherCosts?: boolean } = {}
  ): Promise<{ tripCode: string; budgetedOtherCosts: number | null }> {
    await this.detail.goto(travelId);
    const tripCode = ((await this.detail.tripCode.textContent()) ?? '').trim();
    const raw = await this.detail.readBudgetedOtherCosts({
      expectRow: options.expectBudgetedOtherCosts ?? false
    });
    return { tripCode, budgetedOtherCosts: raw ? parseMoney(raw) : null };
  }

  /** Celda «Presup./Budgeted» del listado (tab Assign) para el código del viaje. */
  async openDashboardBudget(tripCode: string): Promise<{ text: string; amount: number }> {
    await this.dashboard.goto();
    await this.dashboard.selectTab('assign');
    // La grilla carga asíncrona: esperar la fila antes de resolver la columna por su encabezado.
    await expect(
      this.dashboard.rowByCode(tripCode),
      `el viaje ${tripCode} debe listarse en Assign`
    ).toBeVisible({ timeout: 30_000 });
    const cell = await this.dashboard.budgetCellByCode(tripCode);
    await expect(cell, `la fila ${tripCode} debe mostrar su presupuesto`).toBeVisible();
    const text = ((await cell.textContent()) ?? '').trim();
    return { text, amount: parseMoney(text) };
  }

  // === Evidencia ===

  /** Adjunta una captura de página completa (la lleva el reporter a Xray). */
  async screenshot(name: string): Promise<void> {
    await this.testInfo.attach(name, {
      body: await this.page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
  }

  /** Adjunta la medición JSON (lista blanca; nunca volcar cuerpos crudos con PII). */
  async attachMeasurement(tmKey: string, measurement: Record<string, unknown>): Promise<void> {
    const body = {
      tmKey,
      env: this.session.env,
      carrierId: this.session.carrierId,
      runId: this.runId,
      gitSha: process.env.GIT_SHA ?? null,
      measuredAt: new Date().toISOString(),
      ...measurement
    };
    await this.testInfo.attach(`medicion-${tmKey}`, {
      body: JSON.stringify(body, null, 2),
      contentType: 'application/json'
    });
  }

  /** Vista de conceptos para la medición. */
  conceptsView(items: OtherCostItem[]): Record<string, unknown>[] {
    return items.map(conceptView);
  }

  /** Comentario de medición del run (annotation `xray_comment`, ver xray-reporter). */
  comment(text: string): void {
    this.testInfo.annotations.push({ type: 'xray_comment', description: text });
  }

  /** Hallazgo de producto conocido: se informa, nunca se asevera como esperado. */
  knownDefect(text: string): void {
    this.testInfo.annotations.push({ type: 'known-defect', description: text });
  }

  /** Encabezado común del comentario: ambiente, carrier, versión del front y commit. */
  async commentHeader(): Promise<string> {
    const version = await this.newTrip.appVersion();
    return (
      `Ambiente ${this.session.env} · carrier ${this.session.carrierId} · front v${version ?? '?'} · ` +
      `commit ${process.env.GIT_SHA ?? 'sin GIT_SHA'} · corrida ${this.runId}. ` +
      'Oráculo de persistencia: API (base de UAT no alcanzable, BL-046).'
    );
  }

  // === Limpieza ===

  /**
   * Cancela los viajes y da de baja los conceptos de ESTE test. Intenta todo aunque algo falle,
   * deja el resultado en el comentario del run y recién al final lanza si hubo errores.
   */
  async cleanup(): Promise<void> {
    const done: string[] = [];
    const errors: string[] = [];
    await this.settleCreateResponses();
    const unanswered = this.createTravelRequests - this.createTravelResponses;
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
        await this.travelsApi.cancel(travelId);
        ledgerRemove(this.session.env, travelId, OTHER_COSTS_LEDGER_SCOPE);
        done.push(`viaje ${travelId} cancelado`);
      } catch (error) {
        errors.push(`viaje ${travelId}: ${(error as Error).message}`);
      }
    }
    for (const id of this.conceptIds) {
      try {
        const removed = await this.otherCostsApi.remove(id);
        done.push(`concepto ${id} ${removed ? 'dado de baja' : 'ya no estaba'}`);
      } catch (error) {
        errors.push(`concepto ${id}: ${(error as Error).message}`);
      }
    }
    if (done.length > 0 || errors.length > 0) {
      this.comment(
        `Limpieza: ${done.join('; ') || 'nada'}${errors.length ? ` · ERRORES: ${errors.join('; ')}` : ''}.`
      );
    }
    if (errors.length > 0) {
      throw new Error(`[limpieza otros costos] ${errors.join(' | ')}`);
    }
  }

  /**
   * Espera (con tope) las respuestas de los POST de alta que salieron y todavía no respondieron,
   * y el parseo de las ya recibidas, para no cancelar antes de conocer todos los ids.
   */
  private async settleCreateResponses(): Promise<void> {
    const deadline = Date.now() + PENDING_CREATE_WAIT_MS;
    while (
      this.createTravelResponses < this.createTravelRequests &&
      !this.page.isClosed() &&
      Date.now() < deadline
    ) {
      await this.page
        .waitForEvent('response', { timeout: Math.max(deadline - Date.now(), 1) })
        .catch(() => undefined);
    }
    await Promise.all(this.pendingCreateResponses);
  }
}
