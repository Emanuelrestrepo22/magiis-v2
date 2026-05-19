// tests/pages/shared/BaseListPage.ts
// Clase intermedia para pantallas de listado del carrier V2.
// La mayoria del Release V2.0.2 son listados con la misma estructura: heading h2,
// search input, filtros (date picker, combobox), boton PDF, tabla con columnheaders,
// paginacion (Show N + Previous/Next).
//
// Cada POM concreto extiende BaseListPage y agrega:
// - filtros especificos (tabs, switches, checkboxes adicionales)
// - botones de accion (New, Import, etc.)
// - columnas conocidas (opcional, para validar UI consistency)
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export abstract class BaseListPage extends BasePage {
  /** Heading principal h2. Cada POM puede sobrescribir con regex propio. */
  readonly heading: Locator;
  /** Breadcrumb h4 con jerarquia (ej. "Owners / Owners Management"). */
  readonly breadcrumb: Locator;
  /** Input de busqueda libre. Placeholder varia entre "Search...", "Search Name...", etc. */
  readonly searchInput: Locator;
  /** Date picker principal (cuando aplica). Placeholder "Choose Date" o input visible con formato fecha. */
  readonly dateRangeInput: Locator;
  /** Boton de export PDF (usualmente disabled si no hay datos). */
  readonly pdfButton: Locator;
  /** Tabla principal con columnheaders. */
  readonly table: Locator;
  /** Page size selector (ng-select con texto "Show N"). */
  readonly pageSizeText: Locator;
  /** Link de paginacion Previous. */
  readonly previousPageLink: Locator;
  /** Link de paginacion Next. */
  readonly nextPageLink: Locator;

  /** Ruta del POM concreto (cada subclase lo declara). */
  abstract readonly path: string;

  /** Regex del heading h2. Subclases pueden override si el portal usa otro idioma o variante. */
  protected get headingRegex(): RegExp {
    return /./;
  }

  /** Regex opcional del breadcrumb. */
  protected get breadcrumbRegex(): RegExp | null {
    return null;
  }

  constructor(page: Page) {
    super(page);

    // Sin level fijo: algunos POMs usan h2 (Quotes, Tips Report), otros solo h4 breadcrumb
    // (Travel Dashboard, Recurring). Cada POM concreto puede sobrescribir headingRegex.
    this.heading = page.getByRole('heading', { name: this.headingRegex }).first();
    this.breadcrumb = this.breadcrumbRegex
      ? page.getByRole('heading', { name: this.breadcrumbRegex, level: 4 }).first()
      : page.locator('h4').first();

    this.searchInput = page
      .getByPlaceholder(/search|buscar/i)
      .first();

    this.dateRangeInput = page
      .getByPlaceholder(/choose date|elegi.? fecha|seleccion.? fecha/i)
      .first();

    this.pdfButton = page.getByRole('button', { name: /^pdf$/i }).or(page.getByRole('button', { name: /pdf$/i }));

    this.table = page.getByRole('table').first();

    this.pageSizeText = page.getByText(/show \d+|mostrar \d+/i).first();
    this.previousPageLink = page.getByRole('link', { name: /^previous$|^anterior$/i });
    this.nextPageLink = page.getByRole('link', { name: /^next$|^siguiente$/i });
  }

  /**
   * Navega a la ruta declarada por la subclase y espera heading visible.
   * Asume sesion activa via storageState.
   */
  async goto(): Promise<void> {
    await this.navigate(this.path);
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Smoke check: heading + tabla visibles.
   * searchInput se valida aparte porque no todas las pantallas lo exponen
   * (ej. Cotizaciones usa solo date range + filtros combobox).
   */
  async expectListReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.table).toBeVisible();
  }

  /** Smoke check estricto: incluye search input visible. Llamar solo si el POM lo tiene. */
  async expectListReadyWithSearch(): Promise<void> {
    await this.expectListReady();
    await expect(this.searchInput).toBeVisible();
  }

  /** Llena el input de busqueda. */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  /** Verifica que la paginacion este visible (Previous + Next). */
  async expectPaginationReady(): Promise<void> {
    await expect(this.previousPageLink).toBeVisible();
    await expect(this.nextPageLink).toBeVisible();
  }
}
