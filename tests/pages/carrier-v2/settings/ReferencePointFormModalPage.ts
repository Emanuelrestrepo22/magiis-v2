// tests/pages/carrier-v2/settings/ReferencePointFormModalPage.ts
// Modal de alta / edición de un punto de referencia (Configuración › Puntos de referencia).
// PROVENIENCIA: recon en TEST el 19/11/2026 (v2.0.22): mapa Leaflet `#waypointFormMap`, contadores
// «n/50» y «n/240», ubicación = ng-select de búsqueda de dirección + coordenada
// (`data-testid="waypoint-coords"`), aviso de pin obligatorio «Mark the point on the map» tras Guardar
// sin pin. Sin reglas de negocio: solo estado de UI.
/**
 * @jira MG-1132
 * @route /carrier/#/settings/waypoints
 * @priority P1
 * @type functional
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';
import {
  clickMapAndWaitForCheckPlace,
  type ClickedPlaceAck,
  type MapPoint
} from '../../../utils/leafletMap.js';

export class ReferencePointFormModalPage extends BasePage {
  readonly dialog: Locator;
  readonly nameInput: Locator;
  readonly referenceInput: Locator;
  readonly nameCounter: Locator;
  readonly referenceCounter: Locator;
  readonly addressSearch: Locator;
  readonly map: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  /** Coordenada elegida («25.774835, -80.188490»). */
  readonly coordinates: Locator;
  /** Aviso bajo Ubicación al guardar sin pin. */
  readonly pinRequiredMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByRole('dialog').filter({ has: page.locator('#waypointFormMap') });
    this.nameInput = this.dialog.locator('#waypointName');
    this.referenceInput = this.dialog.locator('#waypointReference');
    this.nameCounter = this.dialog.getByText(/^\d+\/50$/);
    this.referenceCounter = this.dialog.getByText(/^\d+\/240$/);
    this.addressSearch = this.dialog.getByRole('combobox');
    this.map = this.dialog.locator('#waypointFormMap');
    this.saveButton = this.dialog.getByRole('button', { name: /^(save|guardar)$/i });
    this.cancelButton = this.dialog.getByRole('button', { name: /^(cancel|cancelar)$/i });
    this.coordinates = this.dialog.getByTestId('waypoint-coords');
    this.pinRequiredMessage = this.dialog
      .locator('.text-danger')
      .filter({ hasText: /mark the point on the map|marc[aá] el punto en el mapa/i });
  }

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.map).toBeVisible();
  }

  async fillName(text: string): Promise<void> {
    await this.nameInput.fill(text);
    await expect(this.nameInput).toHaveValue(text);
  }

  async fillReference(text: string): Promise<void> {
    await this.referenceInput.fill(text);
    await expect(this.referenceInput).toHaveValue(text);
  }

  /** Pega `text` con `keyboard.insertText` (como un pegado del usuario: respeta `maxlength`). */
  async pasteInto(locator: Locator, text: string): Promise<void> {
    await locator.click();
    await this.page.keyboard.insertText(text);
  }

  /** Click en el mapa del modal y espera el ack `checkPlace?waypoint=true`. */
  async placePin(lat: number, lng: number, zoom?: number): Promise<ClickedPlaceAck> {
    const point: MapPoint = zoom === undefined ? { lat, lng } : { lat, lng, zoom };
    return clickMapAndWaitForCheckPlace(this.page, this.map, point);
  }

  async save(): Promise<void> {
    await this.saveButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.dialog).toBeHidden();
  }

  /** Contadores «n/50» y «n/240» como números. */
  async readCounters(): Promise<{ name: number; reference: number }> {
    const parse = async (locator: Locator): Promise<number> =>
      Number((await locator.innerText()).split('/')[0]);
    return { name: await parse(this.nameCounter), reference: await parse(this.referenceCounter) };
  }
}
