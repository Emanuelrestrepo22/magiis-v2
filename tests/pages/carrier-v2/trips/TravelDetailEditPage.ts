// tests/pages/carrier-v2/trips/TravelDetailEditPage.ts
// Detalle de viaje en MODO EDICION (`#/travel/detail/:id?mode=Edit`), al que se llega con el lapiz de la
// fila en Trips Management > Scheduled. MG-1132 PK-5 (ATP TM-1841).
// PROVENIENCIA: recon en TEST v2.0.22 el 19/11/2026 (DOM del propio modo edicion, sin codigo fuente del front):
// - ruta: `app-route-editor` con `.route-row--origin` y `.route-row--destination`; cada fila trae un
//   `ng-select` (combobox) y, a la derecha, `.route-row__actions` con el reloj (`ri-time-line`).
// - fecha `#programmedDate` + hora `ng-select.nt-time-select`.
// - tarjeta NOTE `app-trip-notes-display` con el lapiz `.tnc-edit` que abre el modal «Trip Notes» (textbox
//   «Pickup: …» y «Drop-Off: …», Cancel / Accept).
// - botones «Recalculate» (POST `travels/simulate`) y «Save» (PUT `carriers/{id}/travels/{id}/update`; al
//   guardar la app vuelve al dashboard). «Save» nace deshabilitado.
// - fila del listado: lapiz = `button:has(i.mdi-pencil)`. NUNCA se pulsan los otros iconos de la fila
//   (`mdi-send` = enviar a choferes, `mdi-car` = asignar, `mdi-close-circle` = cancelar).
// El POM solo expone acciones y estado de UI; las reglas de negocio se aseveran en el test.
import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import { TravelDashboardPage } from './TravelDashboardPage.js';
import { PlaceFields, type PlaceField } from './PlaceFields.js';

const UPDATE_URL = /\/carriers\/\d+\/travels\/\d+\/update(\?|$)/;
const SIMULATE_URL = /\/carriers\/\d+\/travels\/simulate(\?|$)/;

export type NoteKind = 'pickup' | 'dropoff';

export class TravelDetailEditPage extends BasePage {
  readonly places: PlaceFields;
  readonly routeEditor: Locator;
  readonly saveButton: Locator;
  readonly recalculateButton: Locator;
  readonly timeSelect: Locator;
  readonly notesEditButton: Locator;
  readonly notesDialog: Locator;

  /** PUT `…/update` emitidos desde la pagina (oraculo «no se guarda»). */
  private updatePuts = 0;

  constructor(page: Page) {
    super(page);
    this.places = new PlaceFields(page, 'edit');
    this.routeEditor = page.locator('app-route-editor');
    this.saveButton = page.getByRole('button', { name: /\b(save|guardar)\b/i });
    this.recalculateButton = page.getByRole('button', { name: /recalculate|recalcular/i });
    this.timeSelect = page.locator('ng-select.nt-time-select');
    this.notesEditButton = page.locator('app-trip-notes-display .tnc-edit');
    this.notesDialog = page.getByRole('dialog').first();
    page.on('request', (request) => {
      if (request.method() === 'PUT' && UPDATE_URL.test(request.url())) this.updatePuts += 1;
    });
  }

  /** Cantidad de PUT de actualizacion de viaje emitidos desde esta pagina. */
  get updateRequestCount(): number {
    return this.updatePuts;
  }

  private async expectReady(): Promise<void> {
    await expect(this.routeEditor, 'el editor de ruta debe renderizarse').toBeVisible({
      timeout: 45_000
    });
    await expect(this.recalculateButton).toBeVisible({ timeout: 15_000 });
    await expect(
      this.places.placeRow('origin').locator('.ng-value-label'),
      'el origen del viaje debe estar cargado'
    ).toHaveCount(1, { timeout: 30_000 });
  }

  /**
   * Abre la edicion como el operador: Trips Management > Scheduled > lapiz de la fila con ese codigo
   * (la pestaña muestra viajes de hasta 30 dias). `code` = `{travelIdForCarrier}-{canal}`.
   */
  async openFromScheduledList(code: string): Promise<void> {
    const dashboard = new TravelDashboardPage(this.page);
    await dashboard.goto();
    await this.page
      .getByRole('tab', { name: /scheduled\s*\(\d+\)|programad[oa]s?\s*\(\d+\)/i })
      .click();
    const row = dashboard.rowByCode(code);
    await expect(row, `el viaje ${code} debe listarse en Scheduled`).toBeVisible({
      timeout: 45_000
    });
    await row.locator('button:has(i.mdi-pencil)').click();
    await expect(this.page).toHaveURL(/travel\/detail\/\d+\?mode=Edit/i, { timeout: 30_000 });
    await this.expectReady();
  }

  /** Abre la edicion por URL directa (atajo para los tests que no prueban el lapiz). */
  async open(travelId: number): Promise<void> {
    await this.navigate(`/carrier/#/travel/detail/${travelId}?mode=Edit`);
    await this.expectReady();
  }

  /** Hora elegida hoy en el selector (texto del chip). */
  async timeValue(): Promise<string> {
    return ((await this.timeSelect.locator('.ng-value-label').first().textContent()) ?? '').trim();
  }

  /** Elige una hora del selector por su texto exacto (p. ej. «10:30 AM»). */
  async selectTime(text: string): Promise<void> {
    await this.timeSelect.click();
    await this.page
      .locator('.ng-dropdown-panel .ng-option')
      .filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
      .first()
      .click();
    await expect(this.timeSelect.locator('.ng-value-label')).toHaveText(text);
  }

  /** «Recalculate» y devuelve la respuesta de `travels/simulate` (el test asevera el status). */
  async recalculate(): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => SIMULATE_URL.test(r.url()) && r.request().method() === 'POST',
        { timeout: 60_000 }
      ),
      this.recalculateButton.click()
    ]);
    return response;
  }

  /** «Save» y devuelve el PUT `…/update` (cuerpo enviado y status). */
  async save(): Promise<{ status: number; body: Record<string, unknown> }> {
    await expect(this.saveButton, '«Save» debe estar habilitado').toBeEnabled({ timeout: 15_000 });
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => UPDATE_URL.test(r.url()) && r.request().method() === 'PUT', {
        timeout: 60_000
      }),
      this.saveButton.click()
    ]);
    return {
      status: response.status(),
      body: (response.request().postDataJSON() ?? {}) as Record<string, unknown>
    };
  }

  // === Notas del viaje (tarjeta NOTE > lapiz > modal «Trip Notes») ===

  private noteBox(kind: NoteKind): Locator {
    return this.notesDialog.getByRole('textbox', {
      name: kind === 'pickup' ? /^(pickup|origen|recogida)\b/i : /^(drop-?off|destino)\b/i
    });
  }

  async openNotes(): Promise<void> {
    await this.notesEditButton.click();
    await expect(this.notesDialog).toBeVisible({ timeout: 15_000 });
  }

  /** Valor de la nota del lugar en el modal abierto. */
  async noteValue(kind: NoteKind): Promise<string> {
    return this.noteBox(kind).inputValue();
  }

  async acceptNotes(): Promise<void> {
    await this.notesDialog.getByRole('button', { name: /^(accept|aceptar)$/i }).click();
    await expect(this.notesDialog).toBeHidden({ timeout: 15_000 });
  }

  async cancelNotes(): Promise<void> {
    await this.notesDialog.getByRole('button', { name: /^(cancel|cancelar)$/i }).click();
    await expect(this.notesDialog).toBeHidden({ timeout: 15_000 });
  }

  /** Lugar actual de un campo de la ruta (chip). */
  placeValue(field: PlaceField): Promise<string> {
    return this.places.placeValue(field);
  }
}
