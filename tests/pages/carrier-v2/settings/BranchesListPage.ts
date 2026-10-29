// tests/pages/carrier-v2/settings/BranchesListPage.ts
/**
 * @jira MG-1147
 * @route /carrier/#/settings/branches/list
 * @priority P1
 * @type functional
 * @note Configuración › Sucursales («Branches» / «Sucursales»): grilla con «Operation Radius» /
 *       «Radio de operación» y modal «Edit a Branch» / «Editar una sucursal» (input numérico del
 *       radio con la unidad en un `.input-group-text` + mapa Leaflet con el círculo del radio).
 *       Selectores derivados del DOM VIVO de la v2.0.17 desplegada (UAT, 07/10/2026).
 *
 *       SOLO LECTURA: este POM abre y cancela el modal. NO modela «Guardar» ni «Eliminar»: guardar
 *       el radio reescribe `OPERATION_RADIUS` en la base (deriva por redondeo O-1, defecto abierto)
 *       y está fuera del alcance de la ronda 1. El único acceso al botón es `expectSaveEnabled()`,
 *       que lee su estado sin clickearlo.
 *
 *       Oráculo: `GET /carriers/{id}/branches/paginated` (clave `operationRadius`, km).
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import { parseDistance, parseLocalizedNumber, type DistanceReading } from '../../../utils/units.js';

/** Sucursal tal como la devuelve el listado (solo los campos que consumen los specs). */
export interface BranchRaw {
  id: number;
  branchName: string;
  /** Radio de operación en km (crudo del backend). */
  operationRadius: number;
}

export class BranchesListPage extends BasePage {
  readonly path = '/carrier/#/settings/branches/list';

  readonly table: Locator;
  readonly rows: Locator;
  /** Modal de edición (ngb-modal-window). */
  readonly modal: Locator;
  /** Input numérico del radio dentro del modal. */
  readonly radiusInput: Locator;
  /** Rótulo de unidad pegado al input del radio («Mi» / «km»). */
  readonly radiusUnit: Locator;
  readonly cancelButton: Locator;
  private readonly saveButton: Locator;

  constructor(page: Page) {
    super(page);
    this.table = page.getByRole('table').first();
    this.rows = this.table.locator('tbody tr');
    this.modal = page.locator('ngb-modal-window');
    this.radiusInput = this.modal.locator('input[formcontrolname="operationRadius"]');
    this.radiusUnit = this.modal.locator(
      '.input-group:has(input[formcontrolname="operationRadius"]) .input-group-text'
    );
    this.cancelButton = this.modal.getByRole('button', { name: /^(cancel|cancelar)$/i });
    this.saveButton = this.modal.getByRole('button', { name: /^(save|guardar)$/i });
  }

  /**
   * Navega al listado y devuelve las sucursales crudas de la primera página (10 por defecto) que
   * el front pidió. Espera a que la grilla tenga filas.
   */
  async gotoAndCapture(): Promise<BranchRaw[]> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          /\/carriers\/\d+\/branches\/paginated/.test(r.url()) && r.request().method() === 'GET',
        { timeout: 30_000 }
      ),
      this.navigate(this.path)
    ]);
    expect(response.ok(), `GET branches/paginated respondió ${response.status()}`).toBe(true);
    const body = (await response.json()) as { content?: BranchRaw[] };
    await expect(this.rows.first()).toBeVisible({ timeout: 30_000 });
    return body.content ?? [];
  }

  /** Fila de la grilla de una sucursal, por su código (primera columna, texto exacto). */
  rowOf(branchId: number): Locator {
    return this.rows.filter({
      has: this.page.locator('td', { hasText: new RegExp(`^\\s*${branchId}\\s*$`) })
    });
  }

  /** Índice de la columna «Operation Radius» / «Radio de operación». */
  private async radiusColumnIndex(): Promise<number> {
    const headers = await this.table.locator('thead tr').first().locator('th').allInnerTexts();
    const index = headers.findIndex((text) =>
      /operation\s+radius|radio\s+de\s+operaci/i.test(text)
    );
    if (index < 0) throw new Error(`No hay columna de radio en la grilla: ${headers.join(' | ')}`);
    return index;
  }

  /** Texto de la celda de radio de una sucursal («100.00 Mi»). */
  async radiusCellText(branchId: number): Promise<string> {
    const index = await this.radiusColumnIndex();
    return (await this.rowOf(branchId).locator('td').nth(index).innerText()).trim();
  }

  /** Lectura «número + unidad» de la celda de radio. */
  async readGridRadius(branchId: number): Promise<DistanceReading | null> {
    return parseDistance(await this.radiusCellText(branchId));
  }

  /** Texto completo de la columna de radio de TODAS las filas (para buscar la unidad equivocada). */
  async allRadiusCellsText(): Promise<string> {
    const index = await this.radiusColumnIndex();
    return (await this.rows.locator(`td:nth-child(${index + 1})`).allInnerTexts()).join(' | ');
  }

  /** Abre el modal de edición de una sucursal (botón «Edit»/«Editar» de su fila). */
  async openEdit(branchId: number): Promise<void> {
    await this.rowOf(branchId)
      .getByTitle(/^(edit|editar)$/i)
      .click();
    await expect(this.modal).toBeVisible({ timeout: 15_000 });
    await expect(this.radiusInput).toBeVisible({ timeout: 15_000 });
  }

  /** Radio que muestra el modal, con la unidad de su rótulo. */
  async readModalRadius(): Promise<DistanceReading | null> {
    const value = parseLocalizedNumber((await this.radiusInput.inputValue()).trim());
    const unitText = (await this.radiusUnit.innerText()).trim();
    return Number.isNaN(value) ? null : parseDistance(`${value} ${unitText}`);
  }

  /** Cierra el modal SIN guardar. */
  async cancelModal(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.modal).toBeHidden({ timeout: 10_000 });
  }

  /** Estado de «Guardar» sin clickearlo (BVA del mínimo: radio < 1 la deshabilita). */
  async expectSaveEnabled(enabled: boolean): Promise<void> {
    if (enabled) await expect(this.saveButton).toBeEnabled();
    else await expect(this.saveButton).toBeDisabled();
  }
}
