// tests/helpers/selectors.ts
// Helpers de seleccion especificos para Angular V2 (forms reactivos, control flow nuevo).
import type { Page, Locator } from '@playwright/test';

/**
 * Selector estable para inputs de ReactiveForms.
 * Equivalente a page.locator('[formcontrolname="x"]') pero con tipado y log claro.
 */
export function byFormControl(page: Page, name: string): Locator {
  return page.locator(`[formcontrolname="${name}"]`);
}

/**
 * Selector estable para componentes con atributo data-testid (preferido cuando exista).
 * Wrapper de page.getByTestId para uniformidad.
 */
export function byTestId(page: Page, id: string): Locator {
  return page.getByTestId(id);
}

/**
 * Selector para opcion de un mat-select / p-dropdown abierto.
 */
export function bySelectOption(page: Page, label: string | RegExp): Locator {
  // mat-option (Angular Material) y p-dropdown-item (PrimeNG).
  return page
    .locator('mat-option, .p-dropdown-item, [role="option"]')
    .filter({ hasText: label });
}

/**
 * Selector de fila de tabla por texto contenido. Util para tablas de listado.
 */
export function tableRowByText(table: Locator, text: string | RegExp): Locator {
  return table.locator('tbody tr').filter({ hasText: text });
}
