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

    this.searchInput = page.getByPlaceholder(/search|buscar/i).first();

    this.dateRangeInput = page
      .getByPlaceholder(/choose date|elegi.? fecha|seleccion.? fecha/i)
      .first();

    this.pdfButton = page
      .getByRole('button', { name: /^pdf$/i })
      .or(page.getByRole('button', { name: /pdf$/i }));

    this.table = page.getByRole('table').first();

    // Pagination "Show" label real: `<label>{{ 'table_footer_common.show' | translate }} <ng-select>...</ng-select></label>`
    // El numero esta dentro del ng-select, no inline en el texto. Anclamos al label que envuelve "Show".
    this.pageSizeText = page
      .locator('label.d-inline-flex')
      .filter({ hasText: /show|mostrar/i })
      .first();
    this.previousPageLink = page.getByRole('link', { name: /^previous$|^anterior$/i });
    this.nextPageLink = page.getByRole('link', { name: /^next$|^siguiente$/i });
  }

  /**
   * Navega a la ruta declarada por la subclase y espera heading visible.
   * Asume sesion activa via storageState.
   * Timeout 30s para tolerar latencia transitoria del backend.
   */
  async goto(): Promise<void> {
    await this.navigate(this.path);
    await expect(this.heading).toBeVisible({ timeout: 30_000 });
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

  /**
   * Click en la primera row entera (cuando es clickable). Captura URL final.
   * NOTA: en Settlements (Contractor/Passenger/Driver/Owner) las rows NO son clickables;
   *       cada row tiene botones de accion (`+ Create`, `clock History`, `PDF`) en la
   *       ultima columna. Usar clickFirstRowActionButton() en esos casos.
   */
  async clickFirstRowAndCaptureUrl(): Promise<{ finalUrl: string; lastSegment: string | null }> {
    const rows = this.table.locator('tbody tr');
    await rows.first().click();
    await this.page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => null);
    const finalUrl = this.page.url();
    const pathAfterHash = finalUrl.split('#')[1] ?? '';
    const segments = pathAfterHash.split('/').filter(Boolean);
    return { finalUrl, lastSegment: segments.length > 0 ? segments[segments.length - 1] : null };
  }

  /**
   * Click en el N-esimo boton de accion dentro de la primera row con datos.
   * Patron Settlements: row expone botones `+ Create` (idx 0), `clock History` (idx 1),
   * `PDF` (idx 2, opcional). El click navega a la pantalla detail/history correspondiente
   * con :id capturable del URL.
   */
  async clickFirstRowActionButton(
    buttonIndex: number
  ): Promise<{ finalUrl: string; lastSegment: string | null }> {
    const firstRow = this.table.locator('tbody tr').first();
    const buttons = firstRow.getByRole('button');
    await buttons.nth(buttonIndex).click();
    await this.page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => null);
    const finalUrl = this.page.url();
    const pathAfterHash = finalUrl.split('#')[1] ?? '';
    const segments = pathAfterHash.split('/').filter(Boolean);
    return { finalUrl, lastSegment: segments.length > 0 ? segments[segments.length - 1] : null };
  }

  /**
   * Click en el ULTIMO boton de accion dentro de la primera row con datos.
   * Util cuando el numero de botones varia por tipo de row (ej. Affiliate CC IN vs OUT).
   * En Affiliate CC el ultimo boton siempre es "Details" -> navega a checking-account-detail/:id.
   *
   * Filtra la primera row CON botones (descarta placeholders Loading/No Data que no tienen botones).
   */
  async clickFirstRowLastActionButton(): Promise<{ finalUrl: string; lastSegment: string | null }> {
    const firstActionRow = this.table
      .locator('tbody tr')
      .filter({ has: this.page.locator('button') })
      .first();
    const buttons = firstActionRow.getByRole('button');
    await buttons.last().click();
    await this.page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => null);
    const finalUrl = this.page.url();
    const pathAfterHash = finalUrl.split('#')[1] ?? '';
    const segments = pathAfterHash.split('/').filter(Boolean);
    return { finalUrl, lastSegment: segments.length > 0 ? segments[segments.length - 1] : null };
  }

  /**
   * Cuenta rows con datos reales (excluye placeholders "Loading", "No Data", "Empty").
   * Util para `test.skip(rowCount === 0, 'sin datos')` en flujos padre->hijo.
   *
   * Criterio: row con datos = row que contiene texto no-vacio Y que NO es placeholder
   * (Loading / Cargando / No Data / Sin Datos / Empty). Pueden contener ellipsis "..."
   * o spinners, asi que el match es contiene-substring case-insensitive.
   */
  async getDataRowCount(): Promise<number> {
    const allRows = this.table.locator('tbody tr');
    const placeholderRows = this.table.locator('tbody tr', {
      hasText: /loading|cargando|no data|sin datos|empty/i
    });
    const total = await allRows.count();
    const placeholders = await placeholderRows.count();
    return Math.max(0, total - placeholders);
  }
}
