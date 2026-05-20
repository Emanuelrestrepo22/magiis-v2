// tests/pages/shared/BaseDetailPage.ts
// Clase intermedia para pantallas de DETALLE (con `:id` en la URL).
// Las pantallas de detalle del carrier V2 comparten estructura: breadcrumb h4 con
// jerarquia ("Padre / Detail"), heading principal h2, panel de filtros/datos, y a veces
// boton de back / accion. Cada POM concreto extiende esta clase y declara su `headingRegex`
// y opcionalmente sobrescribe `expectDetailReady()`.
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export abstract class BaseDetailPage extends BasePage {
  /** Heading principal h2 (cada POM declara su regex). */
  readonly heading: Locator;
  /** Breadcrumb h4 con jerarquia padre/detail. */
  readonly breadcrumb: Locator;
  /** Boton tipico de "Back" / "Volver" / "Cancelar" si la pantalla lo expone. */
  readonly backButton: Locator;

  /** Regex del heading h2. Cada subclase override este getter. */
  protected get headingRegex(): RegExp {
    return /./;
  }

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: this.headingRegex }).first();
    this.breadcrumb = page.locator('h4').first();
    this.backButton = page.getByRole('button', { name: /^back$|^volver$|^cancel(ar)?$/i });
  }

  /**
   * Smoke check para pantallas de detalle: heading visible.
   * Cada POM puede override agregando assertions de paneles especificos.
   */
  async expectDetailReady(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Captura los segmentos de path despues del hash. Util para validar que la URL contiene
   * `:id` correcto post-navegacion desde lista.
   * @example
   * const segments = detail.getPathSegments(); // ['liquidations', 'contractors', 'details', 'abc-123', 'def-456']
   */
  getPathSegments(): string[] {
    return (this.page.url().split('#')[1] ?? '').split('/').filter(Boolean);
  }
}
