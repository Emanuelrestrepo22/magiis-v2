// tests/pages/carrier-v2/settings/SettingsParametersPage.ts
/**
 * @jira MG-1192
 * @route /carrier/#/settings/parameters (`SettingsParametersComponent`, carrier.routing.ts:501)
 * @priority P1
 * @type functional
 * @note Configuración › Parámetros («Operational Preferences»): en la v2.0.17 es un IFRAME de la V1
 *       (`/#/home/carrier/settings/parameters?external=hideBars&lang=…`), no una pantalla V2. Los
 *       selectores salen del DOM VIVO del iframe (Angular 8, formularios reactivos), no de `refs/`.
 *       Solo se modela lo que consume MG-1192 TC4: la solapa «Search method» → sección «Automatic
 *       assignment» y el campo «Theoretical Distance Open Dest.» (`totalDistanceOpenTrip`).
 *
 *       SOLO LECTURA: este POM abre solapas y secciones (acordeón) y lee el campo. NO modela el
 *       botón «Save» ni escribe en ningún input: guardar reescribe los parámetros del carrier.
 *
 *       Oráculo: `GET /carriers/{id}/parameters` (clave `totalDistanceOpenTrip`, km), que dispara el
 *       propio iframe al cargar.
 *
 *       DEFECTO CONOCIDO H-4 (abierto, intermitente): en un carrier MÉTRICO el iframe a veces muestra
 *       el valor convertido a millas bajo el rótulo «Km» (carrier 1040: 4 km → «2.485 Km»). Este POM
 *       lee lo que hay en pantalla; el spec NO relaja el esperado por ese defecto.
 */
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import { parseDistance, parseLocalizedNumber, type DistanceReading } from '../../../utils/units.js';

export class SettingsParametersPage extends BasePage {
  readonly path = '/carrier/#/settings/parameters';

  /** Iframe de la V1 que renderiza la pantalla. */
  readonly frame: FrameLocator;
  readonly searchMethodTab: Locator;
  readonly automaticAssignmentSection: Locator;
  /** Input «Theoretical Distance Open Dest.» y el rótulo de unidad pegado a su derecha. */
  readonly openDestinationInput: Locator;
  readonly openDestinationUnit: Locator;

  constructor(page: Page) {
    super(page);
    this.frame = page.frameLocator('iframe').first();
    this.searchMethodTab = this.frame.getByText('Search method').first();
    this.automaticAssignmentSection = this.frame.getByText('Automatic assignment').first();
    this.openDestinationInput = this.frame.locator(
      'input[formcontrolname="totalDistanceOpenTrip"]'
    );
    this.openDestinationUnit = this.frame.locator(
      '.input-group:has(input[formcontrolname="totalDistanceOpenTrip"]) .input-group-text'
    );
  }

  /**
   * Navega a Parámetros y devuelve `totalDistanceOpenTrip` (km) del `GET …/parameters` que el
   * iframe dispara. Espera a que el iframe termine de armar la solapa «Search method».
   */
  async gotoAndCaptureOpenDestinationKm(): Promise<number> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.request().method() === 'GET' &&
          /\/carriers\/\d+\/parameters$/.test(new URL(r.url()).pathname),
        { timeout: 45_000 }
      ),
      this.navigate(this.path)
    ]);
    expect(response.ok(), `GET parameters respondió ${response.status()}`).toBe(true);
    const body = (await response.json()) as { totalDistanceOpenTrip?: number };
    await expect(this.searchMethodTab).toBeVisible({ timeout: 45_000 });
    return Number(body.totalDistanceOpenTrip ?? Number.NaN);
  }

  /** Abre «Search method» → «Automatic assignment» (solo expande; no modifica nada). */
  async openAutomaticAssignment(): Promise<void> {
    await this.searchMethodTab.click();
    await this.automaticAssignmentSection.click();
    await expect(this.openDestinationInput).toBeVisible({ timeout: 15_000 });
  }

  /** Valor y unidad de «Theoretical Distance Open Dest.» tal como los muestra el iframe. */
  async readOpenDestinationDistance(): Promise<DistanceReading | null> {
    const value = parseLocalizedNumber((await this.openDestinationInput.inputValue()).trim());
    const unit = (await this.openDestinationUnit.innerText()).trim();
    return Number.isNaN(value) ? null : parseDistance(`${value} ${unit}`);
  }
}
