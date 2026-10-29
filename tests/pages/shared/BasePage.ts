// tests/pages/shared/BasePage.ts
// Clase base de Page Objects. Encapsula utilidades comunes (waits, navegacion, toasts).
// Cada page de carrier-v2 extiende esta clase para reutilizar.
import type { Page, Locator } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  ENV_RETRY_ANNOTATION,
  isNavigationNetworkError,
  networkErrorCode
} from '../../utils/envAvailability.js';

export abstract class BasePage {
  protected readonly page: Page;

  /**
   * Espera antes del unico reintento de navegacion por error de red. NAV_RETRY_DELAY_MS lo
   * ajusta (los unit tests usan 0); NAV_RETRY=0 desactiva el reintento.
   */
  protected readonly navRetryDelayMs = Number(process.env.NAV_RETRY_DELAY_MS ?? 10_000);

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navega a una ruta relativa al baseURL y espera DOM listo.
   * Subclases deben llamar a este metodo en su propio goto().
   * Timeout 45s tolera latencia transitoria del backend de auth/datos.
   *
   * Si el `goto` falla porque el servidor no respondio (`net::ERR_TIMED_OUT`, conexion
   * rechazada/reseteada, DNS), reintenta UNA vez tras `navRetryDelayMs` y deja la annotation
   * `env-retry` con el codigo de error. No es el `retries` de Playwright: no repite el test
   * entero, y el reporter lo clasifica como `env-flaky` en lugar de flaky del test. Cualquier
   * otro error (HTTP, certificado, aserciones) se propaga sin reintentar. Origen: TC162/TC163,
   * corrida TM-1361 del 2026-10-06.
   */
  protected async navigate(path: string, timeout = 45_000): Promise<void> {
    try {
      await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (process.env.NAV_RETRY?.trim() === '0' || !isNavigationNetworkError(message)) throw error;
      this.annotateEnvRetry(
        `navegacion a ${path} sin respuesta del servidor (${networkErrorCode(message)}); reintentada una vez`
      );
      if (this.navRetryDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, this.navRetryDelayMs);
        });
      }
      await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout });
    }
  }

  /** Registra la annotation en el test en curso; fuera de un test (scripts, unit tests) no hace nada. */
  private annotateEnvRetry(description: string): void {
    this.annotateEnv(ENV_RETRY_ANNOTATION, description);
  }

  /** Annotation de ambiente generica (`env-retry`, `env-slow-load`); no-op fuera de un test. */
  protected annotateEnv(type: string, description: string): void {
    try {
      test.info().annotations.push({ type, description });
    } catch {
      // Sin test en curso: no hay donde anotar.
    }
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
