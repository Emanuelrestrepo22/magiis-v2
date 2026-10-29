// tests/pages/carrier-v2/trips/FrequentDestinationsModalPage.ts
// Modal de seleccion de destino frecuente dentro de Nuevo Viaje (`<app-frequent-destinations-modal>`,
// new-trip.component.html:2109-2113). NO confundir con el modal de ALTA/EDICION de destino
// frecuente en Configuracion > Tarifas (ese vive en SELECTORS.md del repo de bugs y tiene otro
// componente Angular, otro filtro y otro boton de confirmar).
//
// PROVENIENCIA DE SELECTORES: `components/modals/frequent-destinations-modal/
// frequent-destinations-modal.component.html`, misma fuente citada en NewTripPage.ts (release
// v2.0.13, origin/main de magiis-fe-carrier-v2).
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';

export class FrequentDestinationsModalPage extends BasePage {
  /** Input de filtro por nombre — `name="frequentDestinationFilter"`, html:15-23. */
  readonly filterInput: Locator;
  /** Filas seleccionables de la tabla de destinos frecuentes — html:43-52. */
  readonly rows: Locator;
  /**
   * Boton "Seleccionar" del footer. Sin clase unica (`btn btn-primary`, compartida con otros
   * botones primarios de la app) — se ancla por rol accesible ACOTADO al `.modal-footer` para
   * no colisionar con otro boton primario de la pantalla (mismo patron de acotar por contenedor
   * que `roundTripMirrorRow` en `NewTripPage.ts`).
   */
  readonly confirmButton: Locator;
  /** Boton "Volver" del footer — `.btn-light`, html:5,59-61. */
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);

    this.filterInput = page.locator('input[name="frequentDestinationFilter"]');
    this.rows = page.locator('table.table-hover tbody tr');
    this.confirmButton = page
      .locator('.modal-footer')
      .getByRole('button', { name: /seleccionar|select/i });
    this.cancelButton = page.locator('.modal-footer button.btn-light');
  }

  /**
   * El modal debe estar visible antes de operarlo.
   * `filterInput` esta SIEMPRE presente (con o sin filas cargadas); usarlo solo evita el
   * strict-mode violation de `rows.first().or(filterInput)` cuando ambos resuelven a la vez
   * (medido en vivo 2026-09-08, fixture QA-MG682-R4-N1-TC01: 2 elementos, no 1).
   */
  async expectVisible(): Promise<void> {
    await expect(this.filterInput).toBeVisible({ timeout: 15_000 });
  }

  /** Filtra por nombre, elige la fila que lo contiene y confirma la seleccion. */
  async selectByName(name: string): Promise<void> {
    await this.filterInput.fill(name);
    const row = this.rows.filter({ hasText: name }).first();
    await expect(
      row,
      `el modal de destino frecuente debe ofrecer una fila para "${name}"`
    ).toBeVisible({ timeout: 10_000 });
    await row.click();
    await this.confirmButton.click();
  }
}
