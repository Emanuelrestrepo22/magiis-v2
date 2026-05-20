// tests/pages/carrier-v2/ReportsTipsPage.ts
/**
 * @jira MX-5560
 * @route /carrier/#/reports/tips
 * @priority P1
 * @type functional + UX
 * @note POM extendido para cubrir los 26 TCs de la matriz QA (matriz_cases_baja_complejidad.md).
 *       Selectores validados contra refs/v2 release/v2.0.4 src/app/pages/carrier/reports/report-tips/
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BaseListPage } from '../shared/BaseListPage.js';

export type TravelType = 'historical' | 'recent';

export class ReportsTipsPage extends BaseListPage {
  readonly path = '/carrier/#/reports/tips';

  protected get headingRegex(): RegExp {
    return /tips? report|propinas?|reporte (de )?propinas?/i;
  }

  // ===== Filtros principales =====
  /** Dropdown travel type (Historical / Recent). */
  readonly travelTypeSelect: Locator;
  /** Date range picker (visible solo cuando travelType = Historical). */
  readonly dateRangePicker: Locator;
  /** Search input con placeholder "Search Name...". */
  readonly searchByNameInput: Locator;
  /** Dropdown payment method (Checking Account / Credit Card). */
  readonly paymentMethodSelect: Locator;
  /** Dropdown status. */
  readonly statusSelect: Locator;

  // ===== Acciones =====
  /** Boton PDF (disabled cuando reportList.length === 0). */
  readonly pdfActionButton: Locator;
  /** Boton refresh de la tabla. */
  readonly refreshButton: Locator;

  // ===== Tabla =====
  /** Header row con cdkDropList. */
  readonly tableHeaderRow: Locator;
  /** Cualquier resize-handle dentro del header. */
  readonly resizeHandles: Locator;
  /** Drag handles (`<span class="drag-handle" cdkDragHandle>`). */
  readonly dragHandles: Locator;
  /** Boton de config de columnas (engranaje al final del header). */
  readonly columnsConfigButton: Locator;

  // ===== Empty state =====
  /** Mensaje empty state cuando no hay resultados. */
  readonly emptyStateMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.travelTypeSelect = page.locator('ng-select').first();
    this.dateRangePicker = page.locator('app-magiis-ranges-date-picker');
    // Input real: <input type="text" class="form-control search"> con placeholder i18n
    // "filter_common.search_name" -> EN "Search Name", ES "Buscar nombre". Anclamos a
    // class.search dentro de .search-box porque hay multiples inputs en pantalla.
    this.searchByNameInput = page
      .locator('.search-box input.search, input.form-control.search')
      .first();
    this.paymentMethodSelect = page.locator('ng-select').nth(1);
    this.statusSelect = page.locator('ng-select').nth(2);

    // PDF button real: <button class="btn btn-light"><i class="mdi mdi-file-pdf-box"> + "Save PDF"
    this.pdfActionButton = page.getByRole('button', { name: /save pdf|guardar pdf|pdf/i }).first();
    // Refresh button real: <button class="btn btn-outline-primary" ngbTooltip="..."><i class="mdi mdi-refresh">
    // El ngbTooltip NO se expone como accessible name. Anclamos a la clase + icono.
    this.refreshButton = page.locator('button.btn-outline-primary:has(i.mdi-refresh)').first();

    this.tableHeaderRow = page.locator('thead tr.header-table-color').first();
    this.resizeHandles = this.tableHeaderRow.locator('.resize-handle');
    this.dragHandles = this.tableHeaderRow.locator('.drag-handle');
    this.columnsConfigButton = this.tableHeaderRow.locator('th').last().locator('a');

    this.emptyStateMessage = page.getByText(/no data|sin datos|no records/i).first();
  }

  /**
   * Override: Tips Report usa el input `searchByNameInput` (con clase `.search` dentro de .search-box).
   * El generico de BaseListPage matchea cualquier placeholder con /search/i y puede colisionar
   * con dropdowns de filtro que tambien tienen "Search...".
   */
  async search(query: string): Promise<void> {
    await this.searchByNameInput.fill(query);
  }

  /** Cambia el dropdown de travel type. */
  async selectTravelType(value: TravelType): Promise<void> {
    await this.travelTypeSelect.click();
    const label = value === 'historical' ? /historical/i : /recent/i;
    await this.page.getByRole('option', { name: label }).click();
  }

  /** Click sobre el N-esimo column header sortable para disparar order toggle. */
  async clickColumnHeader(index: number): Promise<void> {
    const headers = this.tableHeaderRow.locator('th');
    await headers.nth(index).click();
  }

  /** Devuelve true si la columna N tiene icon de sort ASC (mdi-menu-up). */
  async isColumnSortedAsc(index: number): Promise<boolean> {
    const header = this.tableHeaderRow.locator('th').nth(index);
    return header.locator('.mdi-menu-up').isVisible();
  }

  /** Devuelve true si la columna N tiene icon de sort DESC (mdi-menu-down). */
  async isColumnSortedDesc(index: number): Promise<boolean> {
    const header = this.tableHeaderRow.locator('th').nth(index);
    return header.locator('.mdi-menu-down').isVisible();
  }

  /** Click boton PDF si esta enabled. */
  async downloadPdf(): Promise<void> {
    await this.pdfActionButton.click();
  }

  /** Verifica que el PDF button este disabled (empty state o loading). */
  async expectPdfDisabled(): Promise<void> {
    await expect(this.pdfActionButton).toBeDisabled();
  }

  /** Click refresh y espera spinner. */
  async refresh(): Promise<void> {
    await this.refreshButton.click();
  }
}
