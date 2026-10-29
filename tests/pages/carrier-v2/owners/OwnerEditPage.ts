// tests/pages/carrier-v2/owners/OwnerEditPage.ts
// POM de Carrier V2 > Owners > Edit (`#/owner/edit?id=<owner>`) para la RENDICION AUTOMATICA FR.
// Camino real (QA lead, 2026-10-21): «Financial Preferences» > «Collects Cash: Company <-> Vehicle Owner»
// + «Update»; «Add Vehicle» > fila del vehiculo > papelera > modal «Attention» > boton primario
// -> PUT vehicles/{v}/carrier/{c}/travelsSurrender (body {vehicleId, carrierUserId}) -> `true`.
//
// Fuentes (magiis-fe-carrier-v2 develop): pages/carrier/owners/form-owner/form-owner.component.{ts,html}
// - toggle: `input#cashCollector` (formControlName cashCollector; marcado = Vehicle Owner).
// - `onDelete`: elige modal por el VALOR DEL FORMULARIO (no por la DB): con el toggle en Owner abre
//   `confirmAutoSurrenderModal` (Accept -> PUT); con Company abre `confirmManualSurrenderModal`
//   («View Pending Settlements» -> navega a travelsToPay, NO dispara el PUT).
// - Tras el PUT el FE consulta choferes del vehiculo: con chofer abre el modal «has assigned drivers» y NO
//   desasigna ni guarda el propietario.
// - Backend: VehicleController.surrenderVehicleTravels no valida el flag del propietario ni desasigna.
//
// Toda escritura (toggle + Update + disparo) exige FR_TOGGLE_AUTO_SURRENDER=1. El disparo ademas instala
// un firewall de red: solo deja pasar el PUT cuyo path contenga vehicles/<vehiculo>/carrier/<carrier>/.
import type { Locator, Page, Request, Response, Route } from '@playwright/test';
import { expect } from '@playwright/test';
import { isFrGateOpen } from '../../../config/runtime.js';
import { BasePage } from '../../shared/BasePage.js';

const GATE_MESSAGE =
  '[OwnerEditPage] accion de escritura bloqueada: requiere FR_TOGGLE_AUTO_SURRENDER=1';

export type CollectsCash = 'owner' | 'company';

/** Variante del modal «Attention» segun el texto (el boton primario es el mismo selector). */
export type SurrenderModalVariant = 'auto' | 'manual' | 'unknown';

export type VehicleSurrenderResult = {
  modalVariant: SurrenderModalVariant;
  modalText: string;
  putStatus: number;
  putUrl: string;
  /** Cuerpo del PUT parseado (esperado `true`). */
  putBody: unknown;
  /** El FE abrio el modal «has assigned drivers» tras el PUT (esperado: 3765 sigue con su chofer). */
  driversModalShown: boolean;
  /** Requests travelsSurrender abortados por el firewall (esperado: []). */
  blocked: string[];
};

export class OwnerEditPage extends BasePage {
  private readonly cashCollectorToggle: Locator;
  private readonly updateButton: Locator;
  private readonly vehicleRows: Locator;
  private readonly modal: Locator;
  private readonly modalPrimary: Locator;

  constructor(page: Page) {
    super(page);
    this.cashCollectorToggle = page.locator('input#cashCollector');
    this.updateButton = page.getByRole('button', { name: /^\s*(update|actualizar)\s*$/i });
    this.vehicleRows = page.locator('table tbody tr');
    this.modal = page.locator('ngb-modal-window');
    // Selector pedido por QA: body > ngb-modal-window ... .modal-footer button.btn.btn-primary
    this.modalPrimary = page.locator('ngb-modal-window div.modal-footer button.btn.btn-primary');
  }

  private assertGate(): void {
    if (!isFrGateOpen('FR_TOGGLE_AUTO_SURRENDER')) throw new Error(GATE_MESSAGE);
  }

  /** Abre el editor del propietario y espera el toggle (acordeon abierto por defecto) y la tabla. */
  async goto(ownerId: number): Promise<void> {
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      throw new Error(`[OwnerEditPage] ownerId invalido: ${ownerId}`);
    }
    // The form renders with defaults (Company) before GET vehicleOwners/{id} patches it: reading the
    // toggle earlier made arm/fire/disarm act on a stale «Company» (TEST 2026-10-21, owner 2927).
    const ownerLoaded = this.page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new RegExp(`/vehicleOwners/${ownerId}(\\?|$)`).test(r.url()) &&
        r.ok(),
      { timeout: 30_000 }
    );
    await this.navigate(`/carrier/#/owner/edit?id=${ownerId}`);
    await ownerLoaded;
    await expect(this.cashCollectorToggle).toBeVisible({ timeout: 30_000 });
    await expect(this.vehicleRows.first()).toBeVisible({ timeout: 30_000 });
  }

  /** Estado del toggle en el formulario (lectura): `owner` = Vehicle Owner, `company` = Company. */
  async readCollectsCash(): Promise<CollectsCash> {
    return (await this.cashCollectorToggle.isChecked()) ? 'owner' : 'company';
  }

  /**
   * Fija «Collects Cash». Con `persist` pulsa «Update» y espera el PUT del propietario (2xx);
   * sin `persist` cambia solo el formulario en memoria. Si el toggle ya muestra el destino no hay PUT:
   * devuelve `{ saveStatus: null, alreadyAtTarget: true }`. Apagar (company) con viajes pendientes lo
   * rechaza el backend (VEHICLE_OWNER_HAS_PENDING_SURRENDER, 400).
   */
  async setCollectsCash(
    target: CollectsCash,
    opts: { persist: boolean; ownerId: number }
  ): Promise<{ saveStatus: number | null; alreadyAtTarget: boolean }> {
    this.assertGate();
    const alreadyAtTarget = (await this.readCollectsCash()) === target;
    if (!alreadyAtTarget) {
      await this.cashCollectorToggle.setChecked(target === 'owner');
    }
    await expect.poll(() => this.readCollectsCash(), { timeout: 5_000 }).toBe(target);
    // Sin cambio de formulario el FE no emite el PUT: no se espera; el llamador verifica el flag en DB.
    if (!opts.persist || alreadyAtTarget) return { saveStatus: null, alreadyAtTarget };
    const ownerUrl = new RegExp(`/vehicleOwners/${opts.ownerId}(\\?|$)`);
    // El FE habilita «Update» solo con el formulario modificado: esperar a que este habilitado antes del click.
    await expect(this.updateButton).toBeEnabled({ timeout: 10_000 });
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r: Response) => r.request().method() === 'PUT' && ownerUrl.test(r.url()),
        { timeout: 30_000 }
      ),
      this.updateButton.click()
    ]);
    return { saveStatus: response.status(), alreadyAtTarget };
  }

  private vehicleRow(domain: string): Locator {
    return this.vehicleRows.filter({
      has: this.page.locator('td', {
        hasText: new RegExp(`^\\s*${escapeRegExp(domain)}\\s*$`, 'i')
      })
    });
  }

  /** true si la fila del vehiculo (por dominio) esta en la tabla del propietario (lectura). */
  async hasVehicle(domain: string): Promise<boolean> {
    return (await this.vehicleRow(domain).count()) > 0;
  }

  /**
   * Papelera de la fila > modal «Attention» > boton primario > PUT travelsSurrender. NO guarda el
   * propietario. Precondicion: toggle en `owner` en el formulario (si no, el FE ofrece el camino manual
   * y no hay PUT: se informa con error explicito) y el vehiculo con viajes DONE sin rendir.
   */
  async triggerVehicleSurrender(opts: {
    vehicleId: number;
    carrierId: number;
    domain: string;
  }): Promise<VehicleSurrenderResult> {
    this.assertGate();
    const { vehicleId, carrierId, domain } = opts;
    const allowed = `/vehicles/${vehicleId}/carrier/${carrierId}/travelsSurrender`;
    const blocked: string[] = [];
    const guard = async (route: Route, request: Request): Promise<void> => {
      const url = request.url();
      if (request.method() === 'PUT' && url.includes(allowed)) {
        await route.continue();
        return;
      }
      blocked.push(`${request.method()} ${url}`);
      await route.abort('blockedbyclient');
    };
    await this.page.route('**/vehicles/*/carrier/*/travelsSurrender', guard);
    try {
      const row = this.vehicleRow(domain);
      await expect(
        row,
        `la fila del vehiculo ${domain} debe estar en la tabla del propietario`
      ).toHaveCount(1);
      await row.locator('button.btn-soft-danger').click();
      await expect(
        this.modal,
        `no aparecio el modal «Attention» para ${domain}: sin viajes DONE sin rendir, o viaje en curso`
      ).toBeVisible({ timeout: 10_000 });
      const modalText = (
        (await this.modal.locator('.modal-body').first().textContent()) ?? ''
      ).trim();
      const modalVariant = classifyModal(modalText);
      const putResponse = this.page
        .waitForResponse(
          (r: Response) => r.request().method() === 'PUT' && r.url().includes(allowed),
          { timeout: 20_000 }
        )
        .catch(() => null);
      await this.modalPrimary.click();
      const response = await putResponse;
      if (response === null) {
        throw new Error(
          `[OwnerEditPage] el boton primario no disparo ${allowed} (modal ${modalVariant}: «${modalText}»). ` +
            'Con el toggle en Company el FE navega a travelsToPay sin PUT; verificar toggle=Vehicle Owner y la version desplegada.'
        );
      }
      const driversModalShown = await this.page
        .locator('ngb-modal-window .modal-footer button.btn-light')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (driversModalShown) await this.modalCancel();
      let putBody: unknown = null;
      try {
        putBody = await response.json();
      } catch {
        putBody = await response.text().catch(() => null);
      }
      return {
        modalVariant,
        modalText,
        putStatus: response.status(),
        putUrl: response.url(),
        putBody,
        driversModalShown,
        blocked
      };
    } finally {
      await this.page.unroute('**/vehicles/*/carrier/*/travelsSurrender', guard);
    }
  }

  /** Cierra el modal abierto con su boton «Cancel» (btn-light). */
  private async modalCancel(): Promise<void> {
    await this.page.locator('ngb-modal-window .modal-footer button.btn-light').first().click();
    await expect(this.modal).toHaveCount(0, { timeout: 5_000 });
  }

  /** Sale del editor sin guardar (descarta el formulario en memoria). */
  async leaveWithoutSaving(): Promise<void> {
    await this.page.goto('about:blank');
  }
}

/** Clasifica el modal por texto (en-US/es-AR); exportado para unit test. */
export function classifyModal(text: string): SurrenderModalVariant {
  if (/automatic|autom[aá]tic/i.test(text)) return 'auto';
  if (/manual/i.test(text)) return 'manual';
  return 'unknown';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
