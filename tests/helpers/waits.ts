// tests/helpers/waits.ts
// Waits estables - jamas usar page.waitForTimeout().
import type { Page, Locator } from '@playwright/test';

/** Espera a que la red este idle. Usar con cuidado: en SPAs Angular puede no llegar nunca. */
export async function waitForNetworkIdle(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout });
}

/** Espera a que un loader desaparezca. Patron comun en carrier V2. */
export async function waitForLoaderGone(page: Page, timeout = 15_000): Promise<void> {
  const loader = page.locator('.mat-progress-spinner, .p-progress-spinner, [data-loading="true"]');
  await loader.waitFor({ state: 'hidden', timeout });
}

/** Espera a que un locator tenga al menos N elementos. */
export async function waitForCountAtLeast(locator: Locator, min: number, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const count = await locator.count();
    if (count >= min) return;
    await locator.first().waitFor({ state: 'attached', timeout: 500 }).catch(() => {});
  }
  throw new Error(`Timeout esperando count >= ${min} para locator`);
}
