// tests/pages/shared/BasePage.ts
// Clase base de Page Objects. Encapsula utilidades comunes (waits, navegacion, toasts).
// Cada page de carrier-v2 extiende esta clase para reutilizar.
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export abstract class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navega a una ruta relativa al baseURL y espera DOM listo.
   * Subclases deben llamar a este metodo en su propio goto().
   */
  protected async navigate(path: string, timeout = 20_000): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout });
  }

  /** Toast de exito/error generico - Angular usa typicamente .toast-message. */
  toastMessage(): Locator {
    return this.page.locator('.toast-message, .mat-snack-bar-container, .p-toast-message');
  }

  /** Espera que un toast con texto especifico aparezca. */
  async expectToast(text: string | RegExp, timeout = 5000): Promise<void> {
    await expect(this.toastMessage().filter({ hasText: text })).toBeVisible({ timeout });
  }

  /** Cierra cualquier modal/dialog abierto presionando Escape. */
  async dismissAnyDialog(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }
}
