// tests/helpers/assertions.ts
// Assertions reutilizables: validaciones complejas que se repiten en multiples specs.
import { expect, type Page, type Locator } from '@playwright/test';

/** Verifica que la URL actual coincide con el patron esperado (string contenido o RegExp). */
export async function expectUrlMatches(page: Page, pattern: string | RegExp, timeout = 10_000): Promise<void> {
  await expect(page).toHaveURL(pattern, { timeout });
}

/** Valida que un locator tiene un texto que respeta una expresion regular. */
export async function expectTextMatches(locator: Locator, pattern: RegExp, timeout = 5000): Promise<void> {
  await expect(locator).toHaveText(pattern, { timeout });
}

/** Valida que una tabla tiene N filas visibles (excluye header). */
export async function expectTableRowCount(table: Locator, expectedCount: number, timeout = 5000): Promise<void> {
  await expect(table.locator('tbody tr')).toHaveCount(expectedCount, { timeout });
}

/** Valida que un form tiene un error de validacion especifico. */
export async function expectFormError(page: Page, fieldLabel: string, errorText: string | RegExp): Promise<void> {
  const field = page.getByLabel(fieldLabel);
  await expect(field).toBeVisible();
  const error = page.locator('.mat-error, .p-error, .invalid-feedback').filter({ hasText: errorText });
  await expect(error.first()).toBeVisible({ timeout: 3000 });
}
