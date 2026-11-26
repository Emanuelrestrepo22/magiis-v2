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
import { parseDeliverBase, type DeliverBalanceBase } from '../../../helpers/f5-surrender-oracle.js';
import { parseMoney } from '../../../utils/money.js';

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
/** Escrituras de la rendicion: POST toTravelsSurrender (confirma) y PUT travelsSurrender (automatica). */
const WRITE_URL =
  /\/travels\/toTravelsSurrender(\?|$)|\/vehicles\/\d+\/carrier\/\d+\/travelsSurrender/;

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
  private blockedWrites = 0;
  private confirmReceipt: Buffer | null = null;
  private confirmRequestBody: Record<string, unknown> | null = null;

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
    const response = await post;
    // Body que el front mando (importes de la rendicion; sin headers ni token).
    this.confirmRequestBody = (() => {
      try {
        return JSON.parse(response.request().postData() ?? 'null') as Record<
          string,
          unknown
        > | null;
      } catch {
        return null;
      }
    })();
    // TravelController.java:2545: con 200 el cuerpo trae el comprobante en base64 (`file`).
    const body = (await response.json().catch(() => null)) as { file?: unknown } | null;
    this.confirmReceipt = typeof body?.file === 'string' ? Buffer.from(body.file, 'base64') : null;
    return response.status();
  }

  /**
   * Guardia de red de las vistas previas: aborta toda escritura de la rendicion (POST
   * toTravelsSurrender y PUT vehicles/{id}/carrier/{id}/travelsSurrender) y las cuenta. Invocarla ANTES
   * de navegar; los GET pasan. Es defensa en profundidad: ningun metodo de lectura pulsa Confirmar.
   */
  async blockWrites(): Promise<void> {
    await this.page.route(WRITE_URL, async (route) => {
      if (route.request().method() === 'GET') {
        await route.continue();
        return;
      }
      this.blockedWrites += 1;
      await route.abort('blockedbyclient');
    });
  }

  /** Escrituras de la rendicion abortadas por `blockWrites()` (0 = la vista previa fue solo lectura). */
  writeAttempts(): number {
    return this.blockedWrites;
  }

  /**
   * Abre el acordeon «Total Amount Collected» (colapsado por defecto en algunos lotes: sus lineas, entre
   * ellas la de no comisionables, no existen en el texto visible hasta abrirlo). Solo cambia la vista.
   */
  async expandCollected(): Promise<void> {
    const header = this.page.getByText('Total Amount Collected', { exact: true }).first();
    const cashTrips = this.page.getByText('Cash Trips', { exact: true }).first();
    if (!(await cashTrips.isVisible())) await header.click();
    await expect(cashTrips).toBeVisible({ timeout: 10_000 });
  }

  /** Renglones de texto de la pantalla (innerText, uno por linea); sin interpretar ni aseverar. */
  async readBodyLines(): Promise<string[]> {
    await this.expandCollected();
    const text = await this.page.locator('body').innerText();
    return text.split(/\r?\n/);
  }

  /** Tarjeta de balance (la que contiene «Amount due to»). */
  private get balanceCard(): Locator {
    return this.page.locator('.card', { hasText: 'Amount due to' }).first();
  }

  /**
   * Campo «Entregar» (etiqueta «Cash»): el unico `input[currencyinput]` dentro de un `.input-group` de la
   * tarjeta de balance que no es de gastos (`.expense-input`: Combustible / Otros gastos, que en 1521
   * conviven en pantalla). Sin `.first()`/`.nth()`: si hay 0 o 2+ coincidencias Playwright falla (strict
   * mode) en vez de operar sobre otro campo. Ademas `assertDeliverFieldIsEntregar` lo contrasta por valor.
   */
  get deliverInput(): Locator {
    return this.balanceCard.locator(
      '.input-group:not(.expense-input):has(> span.input-group-text) > input[currencyinput]:not(.expense-input)'
    );
  }

  /** Importes de la formula del saldo leidos de la tarjeta (base = Total Cash − deducciones − comisiones + financieros). */
  async readDeliverBase(): Promise<DeliverBalanceBase> {
    const text = (await this.balanceCard.innerText()).replace(/\s+/g, ' ');
    const base = parseDeliverBase(text);
    if (base === null) {
      throw new Error(
        `[SurrenderPage] la tarjeta de balance no trae la formula completa del saldo: «${text}»`
      );
    }
    return base;
  }

  /**
   * Guarda anti-campo-equivocado: ANTES de teclear, «Entregar» viene precargado con el monto a entregar
   * (|base|, igual al «Amount due to»). Si el locator apuntara a «Combustible»/«Otros gastos» (precarga 0.00)
   * esto falla en voz alta con ambos valores. Devuelve la base ya validada.
   */
  async assertDeliverFieldIsEntregar(): Promise<DeliverBalanceBase> {
    const base = await this.readDeliverBase();
    const preload = parseMoney(await this.deliverInput.inputValue());
    if (Math.abs(preload - Math.abs(base.base)) > 0.005) {
      throw new Error(
        `[SurrenderPage] el campo localizado como «Entregar» tiene precarga ${preload} y el monto a entregar ` +
          `de la tarjeta es ${Math.abs(base.base)} (Total Cash ${base.totalCash} − deducciones ${base.deductions} − ` +
          `comisiones ${base.commissions} + financieros ${base.financialCosts}): se esta leyendo OTRO campo`
      );
    }
    return base;
  }

  /** Teclea un valor en «Entregar» (borra antes) SIN pulsar Confirmar; devuelve el estado resultante. */
  async typeDeliver(
    raw: string,
    options: { guardShown?: boolean; paste?: boolean } = {}
  ): Promise<{
    shown: string;
    confirmDisabled: boolean;
    balanceKind: 'Company' | 'Driver' | null;
    balanceText: string | null;
  }> {
    const input = this.deliverInput;
    await input.click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Delete');
    await expect(input).toHaveValue('');
    // `paste`: fill() dispara el evento `input` de una vez (equivale a pegar): el campo recorta a 2 decimales.
    if (raw !== '') {
      if (options.paste === true) await input.fill(raw);
      else await input.pressSequentially(raw, { delay: 60 });
    }
    // Guarda tecnica anti-carrera: el campo debe mostrar lo tipeado antes de leer el saldo (sin ella un
    // caracter perdido produce un saldo de OTRO importe). Las entradas que el campo transforma a
    // proposito (decimales de mas, signo, letras) se leen sin esta guarda.
    if (options.guardShown !== false) await expect(input).toHaveValue(raw);
    const card = this.balanceCard;
    const cardText = (await card.innerText()).replace(/\s+/g, ' ');
    const due = /Due to (Company|Driver):\s*([^\s].*?)(?:\s+Confirm|$)/.exec(cardText);
    return {
      shown: await input.inputValue(),
      confirmDisabled: await this.confirmButton.isDisabled(),
      balanceKind: due ? (due[1] as 'Company' | 'Driver') : null,
      balanceText: due ? due[2].trim() : null
    };
  }

  /** Body JSON del POST del ultimo confirm() (null si no hubo o no era JSON). Solo lectura. */
  readConfirmRequestBody(): Record<string, unknown> | null {
    return this.confirmRequestBody;
  }

  /** PDF del comprobante devuelto por el ultimo confirm() (null si no vino). Solo lectura. */
  readConfirmReceipt(): Buffer | null {
    return this.confirmReceipt;
  }
}
