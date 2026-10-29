// tests/pages/carrier-v2/trips/TripEditPage.ts
// Edicion inline de precios finales de un viaje finalizado (detalle nativo V2, card «Datos
// finales», ruta `travel/detail/:id`).
//
// PROVENIENCIA (magiis-fe-carrier-v2, rama develop, leida el 2026-10-19; rutas relativas a
// src/app/pages/carrier/trips/travel-detail/native/):
// - components/final-data-form/travel-detail-final-data-form.component.html: boton «Editar»
//   `button.btn-soft-primary` con icono `ri-edit-2-line` (visible con permiso TMG.1 y estado DONE);
//   input de venta de la tarifa `formControlName="newTourPrice"` (directiva currencyInput, sin
//   label accesible); motivo `textarea[formControlName="description"]` (obligatorio, MG TC-F08);
//   Cancelar `button.btn-danger`, Confirmar `button.btn-primary` (texto i18n
//   `buttons_labels_common.confirm`).
// - travel-detail-native.component.ts:3314-3420 (ACT-047): al confirmar manda PUT
//   `carriers/{carrierUserId}/travels/{travelId}/updateFinalPrices` y, con 200, POST
//   `.../updateFinalPricesProcess` (fire-and-forget). Si el cambio es de un solo lado (venta o
//   costo) puede abrir un dialogo de confirmacion previo (`confirmOneSidedChange`); con tarifador
//   sin costo (RATE_BY_COST=0, caso FR) no hay columna de costo, asi que no deberia aparecer.
//   TODO(no verificado): texto/rol de ese dialogo; hoy se falla explicito si el PUT no sale.
// - Edicion de un viaje YA RENDIDO: TRAVEL_LIQUIDATED muestra alerta (ver ts:3314). TODO(no
//   verificado en TEST): comportamiento exacto del modal de alerta con rendicion cerrada.
//
// IRREVERSIBLE (dato): `updateFinalPrice` solo observa la red y exige FR_EDIT_AFTER_SURRENDER=1.
// No llama a la API directamente: el PUT lo emite la propia pantalla.
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { isFrGateOpen } from '../../../config/runtime.js';
import { BasePage } from '../../shared/BasePage.js';
import { parseMoney } from '../../../utils/money.js';

/** Campos editables de «Datos finales» (ventas en la moneda del viaje; distancia en la unidad del carrier). */
export type FinalPriceEdits = {
  fare?: number;
  toll?: number;
  parking?: number;
  /** Otros costos COMISIONABLES (venta). */
  otherCom?: number;
  /** Otros costos NO comisionables (venta). */
  otherNoCom?: number;
  distance?: number;
};

/**
 * Posicion de cada fila en `.fd-table > .fd-row:not(.fd-head)` segun el template
 * travel-detail-final-data-form.component.html (leido 2026-10-21, develop): 0 Tarifa (newTourPrice),
 * 1 Espera (newWaitTimePrice; no se edita aqui), 2 Peajes (newRoadToll), 3 Estacionamiento
 * (newParking), 4 Otros costos comisionables (newOtherCost), 5 Otros costos NO comisionables
 * (newOtherCostNoCom; en edicion siempre existe). El pie (Subtotal/Total) vive en `.fd-foot`, que
 * no es `.fd-row` hijo directo de `.fd-table`.
 */
export const FINAL_PRICE_ROW_INDEX = {
  fare: 0,
  toll: 2,
  parking: 3,
  otherCom: 4,
  otherNoCom: 5
} as const;

/** Clave del cuerpo del PUT updateFinalPrices (FinalPricesUpdatedRequestDTO) por campo de venta. */
export const FINAL_PRICE_PAYLOAD_KEY = {
  fare: 'newTripAmount',
  toll: 'newToll',
  parking: 'newParking',
  otherCom: 'newOtherCost',
  otherNoCom: 'newOtherCostNoCom'
} as const;

type MoneyField = keyof typeof FINAL_PRICE_ROW_INDEX;
const MONEY_FIELDS = Object.keys(FINAL_PRICE_ROW_INDEX) as MoneyField[];

export type FinalPriceEditResult = {
  putStatus: number;
  /** Cuerpo enviado en el PUT updateFinalPrices (montos; sin PII). */
  putPayload: unknown;
  processStatus: number;
};

const PUT_URL = /\/travels\/\d+\/updateFinalPrices(\?|$)/;
const PROCESS_URL = /\/travels\/\d+\/updateFinalPricesProcess(\?|$)/;

export class TripEditPage extends BasePage {
  private readonly card: Locator;
  readonly editButton: Locator;
  readonly saleTripAmountInput: Locator;
  readonly reasonInput: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.locator('app-travel-detail-final-data-form');
    this.editButton = this.card.locator('button.btn-soft-primary', {
      has: page.locator('i.ri-edit-2-line')
    });
    // The sale cells bind `[formControlName]="ctrl"` dynamically (saleCell template), so no
    // `formcontrolname` attribute is rendered. Fare is the first data row after the header row.
    this.saleTripAmountInput = this.card
      .locator('.fd-table > .fd-row:not(.fd-head)')
      .first()
      .locator('input');
    this.reasonInput = this.card.locator('textarea[formcontrolname="description"]');
    this.confirmButton = this.card.locator('button.btn.btn-primary');
    this.cancelButton = this.card.locator('button.btn.btn-danger');
  }

  /** Abre el detalle del viaje (solo lectura; sin pasar por el gate). */
  async goto(travelId: number): Promise<void> {
    await this.page.goto('about:blank');
    await this.navigate(`/carrier/#/travel/detail/${travelId}`);
    await expect(this.card, 'la card «Datos finales» debe renderizarse').toBeVisible({
      timeout: 30_000
    });
  }

  private moneyInput(field: MoneyField): Locator {
    return this.card
      .locator('.fd-table > .fd-row:not(.fd-head)')
      .nth(FINAL_PRICE_ROW_INDEX[field])
      .locator('.fd-amount-group input')
      .first();
  }

  /** Valor mostrado en un input de monto (vacio = 0). */
  private async shown(input: Locator): Promise<number> {
    const raw = (await input.inputValue()).trim();
    return raw.length === 0 ? 0 : parseMoney(raw);
  }

  /**
   * The `currencyInput` directive reformats on focus; plain fill() raced with it (2828 -> 28282838).
   * Clear explicitly and type; the caller verifies the shown value.
   */
  private async typeAmount(input: Locator, value: number): Promise<void> {
    await input.click();
    await input.press('Control+A');
    await input.press('Delete');
    await expect(input).toHaveValue('');
    await input.pressSequentially(value.toFixed(2).replace('.', ','));
  }

  /**
   * IRREVERSIBLE: edita la venta de la tarifa (`newTourPrice`) a `newAmount` con `reason` y
   * confirma. Delega en `editFinalPrices`. Lanza antes de tocar la pantalla salvo
   * FR_EDIT_AFTER_SURRENDER=1. `newAmount` se teclea con coma decimal (aceptado en TEST 1901).
   */
  async updateFinalPrice(params: {
    travelId: number;
    newAmount: number;
    reason: string;
  }): Promise<FinalPriceEditResult> {
    return this.editFinalPrices({
      travelId: params.travelId,
      fare: params.newAmount,
      reason: params.reason
    });
  }

  /**
   * IRREVERSIBLE: edita los campos pedidos de «Datos finales» de un viaje DONE y confirma. Solo se
   * toca lo indicado. Antes de confirmar verifica que cada campo muestre exactamente lo pedido y
   * que los no pedidos no cambiaron (si no, cancela sin guardar y lanza); ademas una guarda de red
   * aborta el PUT si el cuerpo no coincide.
   * Distancia: se teclea en la unidad del carrier (km/mi) y el PUT lleva `newKm` en km, por eso no
   * se compara su valor en el cuerpo (TODO(no verificado): conversion con carrier en millas).
   */
  async editFinalPrices(
    params: FinalPriceEdits & { travelId: number; reason: string }
  ): Promise<FinalPriceEditResult> {
    if (!isFrGateOpen('FR_EDIT_AFTER_SURRENDER')) {
      throw new Error(
        '[TripEditPage] editFinalPrices() bloqueado: edita datos de un viaje cerrado; requiere FR_EDIT_AFTER_SURRENDER=1'
      );
    }
    const { travelId, reason, distance } = params;
    const requested = MONEY_FIELDS.filter((f) => params[f] !== undefined);
    if (requested.length === 0 && distance === undefined) {
      throw new Error('[TripEditPage] editFinalPrices requiere al menos un campo a editar');
    }
    const values: Array<[string, number | undefined]> = [
      ...requested.map((f): [string, number | undefined] => [f, params[f]]),
      ['distance', distance]
    ];
    for (const [name, v] of values) {
      if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
        throw new Error(`[TripEditPage] ${name} invalido: ${v}`);
      }
    }
    if (!reason.trim()) {
      throw new Error('[TripEditPage] reason es obligatorio (la pantalla lo exige)');
    }
    await this.goto(travelId);
    await expect(
      this.editButton,
      'el boton Editar debe estar visible (estado DONE y permiso TMG.1)'
    ).toBeVisible({
      timeout: 15_000
    });
    await this.editButton.click();
    await expect(this.moneyInput('fare')).toBeVisible({ timeout: 10_000 });

    const original = {} as Record<MoneyField, number>;
    for (const f of MONEY_FIELDS) original[f] = await this.shown(this.moneyInput(f));

    for (const f of requested) {
      await this.typeAmount(this.moneyInput(f), params[f] as number);
    }
    const distanceInput = this.card.locator('.fd-edit-input input');
    if (distance !== undefined) await this.typeAmount(distanceInput, distance);
    await this.reasonInput.fill(reason);

    // Verify-before-confirm: requested fields show the requested value, the rest is untouched.
    const mismatches: string[] = [];
    for (const f of MONEY_FIELDS) {
      const want = params[f] ?? original[f];
      const got = await this.shown(this.moneyInput(f));
      if (Math.abs(got - want) > 0.005) mismatches.push(`${f}: muestra ${got}, esperado ${want}`);
    }
    if (distance !== undefined) {
      const got = await this.shown(distanceInput);
      if (Math.abs(got - distance) > 0.005) {
        mismatches.push(`distance: muestra ${got}, esperado ${distance}`);
      }
    }
    if (mismatches.length > 0) {
      await this.cancelButton.click();
      throw new Error(
        `[TripEditPage] campos con valor inesperado (${mismatches.join('; ')}): edicion cancelada sin guardar`
      );
    }

    // Last-resort guard: abort the PUT if a requested amount differs, or an untouched money field
    // travels with a value other than the one the screen showed.
    const round = (n: number): number => Math.round(n * 100) / 100;
    await this.page.route(PUT_URL, async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      const bad = MONEY_FIELDS.some((f) => {
        const sent = body[FINAL_PRICE_PAYLOAD_KEY[f]];
        const want = params[f];
        if (want !== undefined) return Number(sent) !== round(want);
        return sent !== null && sent !== undefined && round(Number(sent)) !== round(original[f]);
      });
      if (bad) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    const put = this.page.waitForResponse(
      (r) => PUT_URL.test(r.url()) && r.request().method() === 'PUT',
      { timeout: 60_000 }
    );
    const process = this.page.waitForResponse(
      (r) => PROCESS_URL.test(r.url()) && r.request().method() === 'POST',
      { timeout: 60_000 }
    );
    await this.confirmButton.click();
    const putResponse = await put.finally(() => this.page.unroute(PUT_URL));
    const putPayload: unknown = putResponse.request().postDataJSON();
    if (putResponse.status() !== 200) {
      void process.catch(() => undefined);
      return { putStatus: putResponse.status(), putPayload, processStatus: 0 };
    }
    const processResponse = await process;
    return {
      putStatus: putResponse.status(),
      putPayload,
      processStatus: processResponse.status()
    };
  }
}
