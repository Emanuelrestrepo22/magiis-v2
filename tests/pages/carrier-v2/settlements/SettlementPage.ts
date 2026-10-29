// tests/pages/carrier-v2/settlements/SettlementPage.ts
// Pantallas «Nueva liquidacion» de CHOFER y PROPIETARIO (Carrier V2, menu Settlements/Liquidaciones)
// y la alerta de edicion de un viaje ya liquidado.
//
// PROVENIENCIA (magiis-fe-carrier-v2, rama develop, leida el 2026-10-21; rutas relativas a
// src/app/pages/carrier/settlements/):
// - Rutas (services/enum/navigation/router.enum.ts): `liquidations/drivers/create/:driver-id`,
//   `liquidations/owners/create/:owner-id`; tras crear navega a `.../last-liquidation/:id/:liquidationId`.
//   driver-id = DRIVER.ID; owner-id = VEHICLEOWNERS.ID.
// - driver-create/driver-liquidation-create.component.{ts,html} y owner-create/owner-liquidation-create.component.{ts,html}:
//   tabla `table.table` con checkbox por fila (`input.form-check-input`), checkbox «todas» en el `thead`,
//   caja `.totals-box` con `<strong>` = total (suma de `comNeta` de lo tildado), textarea de
//   observaciones, boton aceptar `button.btn.btn-primary` (i18n `button_accept_popup`, texto NO verificado)
//   dentro de `div.d-flex.justify-content-end` al pie de `.card-body`. Sin data-testid.
// - Al aceptar: POST `carrierDriverLiquidations/{carrierId}/{driverId}` o `carrierOwnerLiquidations/...`,
//   body `{total, status:'PAID', details, observations, dateTo}`; 201 con `originalId`.
// - Las columnas de la tabla son configurables por usuario (localStorage) y los encabezados son i18n:
//   por eso la lectura por fila NO se ata a posiciones; se lee total, cantidad de filas y se compara
//   contra el oraculo. TODO(no verificado): lectura por fila (el codigo usa `tableCodePipe`, formato
//   no medido en el DOM).
// - Viaje liquidado: travel-detail-native.component.ts `editPricesData()` abre
//   `app-modal-price-modification-native` (NgbModal; `.modal-body` con `img[alt="warning"]` y un `<p>`
//   «<cuerpo> DRIVER | OWNER …») y NO abre el panel de edicion; el 409 TRAVEL_LIQUIDATED del PUT solo
//   se ve si el detalle cargado quedo viejo.
//
// IRREVERSIBLE: `confirm()` crea la liquidacion PAID (bloquea editar los viajes); exige
// FR_CONFIRM_SETTLEMENT=1 y lanza antes de tocar la pantalla si el gate esta cerrado.
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import { parseMoney } from '../../../utils/money.js';
import { SETTLEMENT_GATE, isSettlementGateOpen } from '../../../api/clients/settlement.client.js';

export type SettlementKind = 'driver' | 'owner';

const CREATE_PATH: Record<SettlementKind, string> = {
  driver: '/carrier/#/liquidations/drivers/create/',
  owner: '/carrier/#/liquidations/owners/create/'
};
const LAST_PATH: Record<SettlementKind, string> = {
  driver: '/carrier/#/liquidations/drivers/last-liquidation/',
  owner: '/carrier/#/liquidations/owners/last-liquidation/'
};
const UNSETTLED_URL: Record<SettlementKind, RegExp> = {
  driver: /\/carrierDriverLiquidations\/surrenders\/withoutLiquidations\//,
  owner: /\/carrierOwnerLiquidations\/surrenders\/withoutLiquidations\//
};
const POST_URL: Record<SettlementKind, RegExp> = {
  driver: /\/carrierDriverLiquidations\/\d+\/\d+(\?|$)/,
  owner: /\/carrierOwnerLiquidations\/\d+\/\d+(\?|$)/
};

export type SettlementPreview = {
  /** Filas de datos de la tabla (el propietario muestra grupos fecha/vehiculo, no rendiciones). */
  rows: number;
  /** Total mostrado en `.totals-box` tras tildar TODAS las filas. */
  total: number;
  /** Total mostrado antes de tildar (debe ser 0). */
  totalBeforeSelect: number;
};

export type SettlementConfirmResult = {
  postStatus: number;
  /** PK de la liquidacion creada (C_D_LIQUIDATION.ID / C_O_LIQUIDATION.ID). */
  liquidationId: number;
  /** Cuerpo enviado (montos e ids; sin PII). */
  postPayload: unknown;
  /** Total mostrado en la pantalla de detalle posterior (`last-liquidation`). */
  totalShownAfter: number;
};

export class SettlementPage extends BasePage {
  readonly dataRows: Locator;
  readonly selectAllCheckbox: Locator;
  readonly totalLabel: Locator;
  readonly observations: Locator;
  readonly acceptButton: Locator;
  readonly cancelLiquidationButton: Locator;

  constructor(
    page: Page,
    private readonly kind: SettlementKind
  ) {
    super(page);
    this.dataRows = page.locator('table.table tbody tr').filter({
      has: page.locator('input.form-check-input[type="checkbox"]')
    });
    this.selectAllCheckbox = page.locator('table.table thead th input[type="checkbox"]').first();
    this.totalLabel = page.locator('.totals-box strong').first();
    this.observations = page.locator('.card-body textarea.form-control').first();
    this.acceptButton = page.locator(
      '.card-body > .d-flex.justify-content-end button.btn.btn-primary'
    );
    this.cancelLiquidationButton = page.locator(
      '.card-body > .d-flex.justify-content-end button.btn.btn-danger'
    );
  }

  /** Abre «Nueva liquidacion» y espera la carga de pendientes (solo lectura). */
  async gotoCreate(accountId: number): Promise<void> {
    if (!Number.isInteger(accountId) || accountId <= 0) {
      throw new Error(`[SettlementPage] accountId invalido: ${accountId}`);
    }
    const loaded = this.page.waitForResponse(
      (r) => UNSETTLED_URL[this.kind].test(r.url()) && r.request().method() === 'GET',
      { timeout: 60_000 }
    );
    await this.page.goto('about:blank');
    await this.navigate(`${CREATE_PATH[this.kind]}${accountId}`);
    const response = await loaded;
    expect(response.status(), `GET pendientes (${this.kind}) debe responder 200`).toBe(200);
    await expect(this.totalLabel, 'la caja de totales debe renderizarse').toBeVisible({
      timeout: 30_000
    });
  }

  private async shownTotal(): Promise<number> {
    return parseMoney((await this.totalLabel.innerText()).trim());
  }

  /**
   * Lee la vista previa: filas, total en cero sin seleccion y total tras tildar todas. Deja las
   * filas tildadas (listo para `confirm()`); es solo estado de pantalla, no escribe nada.
   */
  async readPreview(): Promise<SettlementPreview> {
    const rows = await this.dataRows.count();
    const totalBeforeSelect = await this.shownTotal();
    if (rows === 0) return { rows, total: totalBeforeSelect, totalBeforeSelect };
    await this.selectAllCheckbox.check();
    await expect(this.dataRows.first().locator('input[type="checkbox"]')).toBeChecked();
    // El total se recalcula en el handler (change); esperar a que deje de ser el inicial.
    await expect
      .poll(async () => this.shownTotal(), { timeout: 10_000 })
      .not.toBe(totalBeforeSelect);
    return { rows, total: await this.shownTotal(), totalBeforeSelect };
  }

  /**
   * IRREVERSIBLE (gate FR_CONFIRM_SETTLEMENT=1): acepta la liquidacion con las filas tildadas.
   * Exige que `expectedTotal` coincida con lo mostrado ANTES de enviar (el BE no recalcula) y que
   * el cuerpo del POST lleve ese total. Devuelve lo observado en red + total del detalle posterior.
   */
  async confirm(params: {
    expectedTotal: number;
    observations?: string;
  }): Promise<SettlementConfirmResult> {
    if (!isSettlementGateOpen()) {
      throw new Error(
        `[SettlementPage] confirm() bloqueado: crea una liquidacion PAID irreversible; requiere ${SETTLEMENT_GATE}=1`
      );
    }
    const shown = await this.shownTotal();
    if (Math.abs(shown - params.expectedTotal) > 0.005) {
      throw new Error(
        `[SettlementPage] total en pantalla ${shown} != oraculo ${params.expectedTotal}: liquidacion NO confirmada`
      );
    }
    if (params.observations) await this.observations.fill(params.observations);
    await expect(this.acceptButton, 'el boton aceptar debe estar habilitado').toBeEnabled();

    const post = this.page.waitForResponse(
      (r) => POST_URL[this.kind].test(r.url()) && r.request().method() === 'POST',
      { timeout: 60_000 }
    );
    await this.acceptButton.click();
    const response = await post;
    const postPayload: unknown = response.request().postDataJSON();
    const postStatus = response.status();
    if (postStatus !== 201) {
      throw new Error(
        `[SettlementPage] POST de liquidacion (${this.kind}) respondio ${postStatus}, esperado 201`
      );
    }
    const body = (await response.json()) as { originalId?: number };
    if (typeof body.originalId !== 'number') {
      throw new Error('[SettlementPage] respuesta del POST sin originalId');
    }
    // Tras crear, el FE navega a last-liquidation/:accountId/:liquidationId.
    await this.page.waitForURL(
      new RegExp(`${LAST_PATH[this.kind].replace('/carrier/', '')}\\d+/${body.originalId}`),
      {
        timeout: 30_000
      }
    );
    await expect(this.totalLabel).toBeVisible({ timeout: 30_000 });
    return {
      postStatus,
      liquidationId: body.originalId,
      postPayload,
      totalShownAfter: await this.shownTotal()
    };
  }

  /** True si la pantalla ofrece «Anular» (solo en la ULTIMA liquidacion no anulada). Lectura. */
  async canCancelLast(): Promise<boolean> {
    return this.cancelLiquidationButton.isVisible();
  }
}

/** Lo observado al intentar editar un viaje liquidado (el spec juzga el bloqueo). */
export type SettledTripEditAlertRead = {
  /** Aparecio el modal de alerta tras pulsar «Editar». */
  alertShown: boolean;
  /** Texto del modal ('' si no aparecio). */
  alertText: string;
  /** Se abrio el panel de edicion (campo de motivo presente). */
  editPanelOpen: boolean;
  /** PUT updateFinalPrices emitidos por la pantalla. */
  putUrls: string[];
};

/**
 * Alerta de edicion de un viaje liquidado (detalle nativo V2). NO envia ningun PUT: con liquidacion,
 * el FE muestra el modal y no abre el panel de edicion. Es solo lectura + un clic en «Editar».
 */
export class SettledTripEditAlert extends BasePage {
  private readonly card: Locator;
  readonly editButton: Locator;
  readonly alertModal: Locator;
  readonly reasonInput: Locator;

  constructor(page: Page) {
    super(page);
    this.card = page.locator('app-travel-detail-final-data-form');
    // Mismo selector que TripEditPage.editButton (boton lapiz de «Datos finales»).
    this.editButton = this.card.locator('button.btn-soft-primary', {
      has: page.locator('i.ri-edit-2-line')
    });
    this.alertModal = page.locator('ngb-modal-window .modal-body', {
      has: page.locator('img[alt="warning"]')
    });
    this.reasonInput = this.card.locator('textarea[formcontrolname="description"]');
  }

  /**
   * Abre el detalle, pulsa «Editar» y devuelve lo OBSERVADO (sin juzgarlo): si aparecio el modal de
   * alerta, su texto, si se abrio el panel de edicion y los PUT updateFinalPrices emitidos. El spec
   * decide si el viaje liquidado quedo bloqueado.
   */
  async openAndReadAlert(travelId: number): Promise<SettledTripEditAlertRead> {
    const puts: string[] = [];
    const onRequest = (url: string, method: string): void => {
      if (method === 'PUT' && /\/travels\/\d+\/updateFinalPrices(\?|$)/.test(url)) puts.push(url);
    };
    this.page.on('request', (req) => onRequest(req.url(), req.method()));
    await this.page.goto('about:blank');
    await this.navigate(`/carrier/#/travel/detail/${travelId}`);
    await expect(this.card, 'la card «Datos finales» debe renderizarse').toBeVisible({
      timeout: 30_000
    });
    await expect(
      this.editButton,
      'el boton Editar debe estar visible (estado DONE y permiso TMG.1); si falta, no se puede probar el bloqueo'
    ).toBeVisible({ timeout: 15_000 });
    await this.editButton.click();
    const alertShown = await this.alertModal
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const editPanelOpen = (await this.reasonInput.count()) > 0;
    const alertText = alertShown ? (await this.alertModal.innerText()).trim() : '';
    return { alertShown, alertText, editPanelOpen, putUrls: [...puts] };
  }
}
