// tests/pages/carrier-v2/pay/SurrenderPage.ts
// Rendicion de choferes de la V2 (nativa): grilla de pendientes `#/pay/travels` (PayTripsComponent)
// y pantalla de confirmacion `#/pay/travels/confirm` (PayTravelsConfirmComponent).
//
// PROVENIENCIA DE SELECTORES (magiis-fe-carrier-v2, rama develop, leida el 2026-10-19; rutas
// relativas a src/app/pages/carrier/pay/):
// - trips/pay-trips.component.html: grilla `<table>`, una fila `tr` por chofer/vehiculo; accion por
//   fila = `button.btn-icon` (icono `ri-money-dollar-circle-line`, SIN texto accesible: solo tooltip)
//   que llama `callToConfirmation(row.driverId, row.vehicleId)` (pay-trips.component.ts:268-286).
//   `row.driverId` = DRIVER USER_ID (el que viaja como `driverUserId`). La fila NO expone ese id en
//   el DOM: se mapea por INDICE contra la respuesta `driversSurrenderSummary` (mismo orden).
// - confirm/pay-travels-confirm.component.html: tarjeta de viajes `.display-6` (= totalElements),
//   boton de confirmacion `#confirm_surrenders_button` (html:619), tabla de detalle con una fila
//   por viaje (columna `travelId`, orden de columnas configurable -> NO se lee del DOM).
// Los ids de viaje del lote se leen de la respuesta GET `toSurrend` que dispara la propia pantalla
// (solo observacion de red); los totales, de GET `toTravelsSurrender`.
//
// IRREVERSIBLE: `confirm()` dispara POST toTravelsSurrender (genera la rendicion). Lanza salvo
// FR_CONFIRM_SURRENDER=1. Ningun otro metodo escribe: `readPreview` falla si vio un POST.
import type { Locator, Page, Request, Response } from '@playwright/test';
import { expect } from '@playwright/test';
import { isFrGateOpen } from '../../../config/runtime.js';
import { BasePage } from '../../shared/BasePage.js';

export type SurrenderBatchKey = { driverUserId: number; vehicleId: number };

export type SurrenderUiPreview = {
  /** Ids de la respuesta GET toSurrend de la pagina cargada (orden de la pantalla). */
  travelIds: number[];
  /** `totalElements` de esa respuesta: el lote completo (puede superar a `travelIds`). */
  totalElements: number;
  /** Numero mostrado en la tarjeta de viajes de la pantalla de confirmacion. */
  uiTravelsCount: number;
  /** Cuerpo crudo de GET toTravelsSurrender (totales y comisiones del lote); null si no se vio. */
  totals: Record<string, unknown> | null;
};

type SummaryRow = { driverId: number; vehicleId: number };

const SUMMARY_URL = /\/travels\/driversSurrenderSummary\?/;
const BATCH_URL = /\/travels\/toSurrend\?/;
const TOTALS_URL = /\/travels\/toTravelsSurrender\?/;

export class SurrenderPage extends BasePage {
  readonly pendingPath = '/carrier/#/pay/travels';

  /** Filas de la grilla de pendientes (una por chofer/vehiculo). */
  readonly pendingRows: Locator;
  /** Boton de confirmacion de la rendicion (id verificado en el html del front). */
  readonly confirmButton: Locator;
  /** Tarjeta con el numero de viajes del lote en la confirmacion. */
  readonly travelsCount: Locator;

  private summaryRows: SummaryRow[] = [];
  private batchResponse: Response | null = null;
  private totalsResponse: Response | null = null;
  private sawSurrenderPost = false;

  constructor(page: Page) {
    super(page);
    this.pendingRows = page.locator('table tbody tr').filter({
      has: page.locator('button.btn-icon')
    });
    this.confirmButton = page.locator('#confirm_surrenders_button');
    this.travelsCount = page.locator('.display-6').first();
    page.on('response', (response) => {
      const request = response.request();
      if (request.method() !== 'GET') return;
      if (BATCH_URL.test(response.url())) this.batchResponse = response;
      else if (TOTALS_URL.test(response.url())) this.totalsResponse = response;
    });
    page.on('request', (request: Request) => {
      if (request.method() !== 'GET' && TOTALS_URL.test(request.url())) {
        this.sawSurrenderPost = true;
      }
    });
  }

  /**
   * Abre la grilla de pendientes y captura la respuesta driversSurrenderSummary (mapa fila ->
   * driverUserId/vehicleId). Solo lectura.
   */
  async openPending(): Promise<void> {
    await this.page.goto('about:blank');
    const summary = this.page.waitForResponse(
      (r) => SUMMARY_URL.test(r.url()) && r.request().method() === 'GET',
      { timeout: 45_000 }
    );
    await this.navigate(this.pendingPath);
    const body = (await (await summary).json()) as {
      content?: SummaryRow[];
      totalElements?: number;
    };
    this.summaryRows = body.content ?? [];
    // TODO(verificar en TEST): la grilla pagina de a 20 (rowsOnPage=20); un lote en la pagina 2
    // exigiria paginar. Hoy se falla explicito en lugar de adivinar.
    if ((body.totalElements ?? 0) > this.summaryRows.length) {
      throw new Error(
        `[SurrenderPage] la grilla de pendientes tiene ${body.totalElements} filas y solo se leyo la pagina 1 (${this.summaryRows.length})`
      );
    }
    if (this.summaryRows.length > 0) {
      await expect(this.pendingRows).toHaveCount(this.summaryRows.length, { timeout: 15_000 });
    }
  }

  /**
   * Entra a la confirmacion del lote del chofer/vehiculo: ubica la fila por indice en la respuesta
   * del resumen y pulsa su accion (navega a `pay/travels/confirm`, NO confirma nada). Falla si el
   * par no esta pendiente.
   */
  async selectBatch(key: SurrenderBatchKey): Promise<void> {
    const index = this.summaryRows.findIndex(
      (row) => row.driverId === key.driverUserId && row.vehicleId === key.vehicleId
    );
    if (index < 0) {
      throw new Error(
        `[SurrenderPage] no hay pendientes para driverUserId=${key.driverUserId} vehicleId=${key.vehicleId}`
      );
    }
    this.batchResponse = null;
    this.totalsResponse = null;
    const batch = this.page.waitForResponse(
      (r) => BATCH_URL.test(r.url()) && r.request().method() === 'GET',
      { timeout: 30_000 }
    );
    await this.pendingRows.nth(index).locator('button.btn-icon').click();
    await expect(this.page).toHaveURL(/#\/pay\/travels\/confirm/, { timeout: 15_000 });
    await batch;
    await expect(this.confirmButton).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Lee la vista previa del lote ya abierto (solo observacion de red + tarjeta de conteo).
   * Falla si la pantalla emitio un POST a toTravelsSurrender (confirmacion no prevista).
   */
  async readPreview(): Promise<SurrenderUiPreview> {
    if (this.sawSurrenderPost) {
      throw new Error('[SurrenderPage] se detecto un POST toTravelsSurrender durante la lectura');
    }
    if (!this.batchResponse) {
      throw new Error(
        '[SurrenderPage] readPreview requiere selectBatch previo (sin toSurrend capturado)'
      );
    }
    const body = (await this.batchResponse.json()) as {
      travelSurrenderResponseDto?: {
        content?: Array<{ travelId?: number }>;
        totalElements?: number;
      };
    };
    const dto = body.travelSurrenderResponseDto;
    const travelIds = (dto?.content ?? []).map((row, i) => {
      if (typeof row.travelId !== 'number') {
        throw new Error(`[SurrenderPage] fila ${i} de toSurrend sin travelId`);
      }
      return row.travelId;
    });
    const uiTravelsCount = Number(((await this.travelsCount.textContent()) ?? '').trim());
    if (!Number.isInteger(uiTravelsCount)) {
      throw new Error('[SurrenderPage] la tarjeta de viajes no muestra un entero');
    }
    let totals: Record<string, unknown> | null = null;
    if (this.totalsResponse) {
      totals = (await this.totalsResponse.json()) as Record<string, unknown>;
    }
    return {
      travelIds,
      totalElements: dto?.totalElements ?? travelIds.length,
      uiTravelsCount,
      totals
    };
  }

  /**
   * IRREVERSIBLE: pulsa «Confirmar rendicion» y devuelve el status del POST toTravelsSurrender.
   * Lanza SIN tocar la pantalla salvo FR_CONFIRM_SURRENDER=1. Nunca debe invocarse desde un
   * subagente.
   */
  async confirm(): Promise<number> {
    if (!isFrGateOpen('FR_CONFIRM_SURRENDER')) {
      throw new Error(
        '[SurrenderPage] confirm() bloqueado: la rendicion es irreversible; requiere FR_CONFIRM_SURRENDER=1'
      );
    }
    const post = this.page.waitForResponse(
      (r) => TOTALS_URL.test(r.url()) && r.request().method() === 'POST',
      { timeout: 60_000 }
    );
    await this.confirmButton.click();
    return (await post).status();
  }
}
