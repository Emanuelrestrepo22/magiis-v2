/**
 * S5 — campo de dirección del home con el tipo de viaje «Solo Ida» seleccionado.
 *
 * El tipo de viaje no cambia el componente del campo: cambia el estado del formulario que lo rodea. El home
 * mantiene UNA sola fila activa (la editable lleva `allow-pointer`, las demás `readonly`/`no-pointer`), así que
 * se resuelve la fila editable en vivo y se informa cuál se usó (`detail`). Si el carrier no habilita «Solo Ida»
 * (`showOneWay` en `develop`), la superficie es inalcanzable: NUNCA un defecto.
 *
 * Selectores: PROBADO UAT v2.5.19, coinciden con `develop` (`button.travelHistory-btn.travel-first-btns-one-way`,
 * clase `active` con `travelButtonsHistory === 'oneWay'`).
 */

import { SURFACE_LOCATORS, DESTINATION_SELECTOR, ORIGIN_SELECTOR } from './surfaceLocators.js';
import {
  clearField,
  firstEditable,
  firstSelector,
  goHome,
  placeholderSelector
} from './surfaceSteps.js';
import type { AddressSurface, SurfacePort, SurfaceReach } from './types.js';

export const ONE_WAY_TEXT = 'solo ida';

export class HomeOneWaySurface implements AddressSurface {
  readonly id = 'S5' as const;
  readonly label = 'Home · Solo Ida';
  readonly fieldLocator = SURFACE_LOCATORS.homeOneWay;
  private resolved = '';

  async navigate(port: SurfacePort): Promise<SurfaceReach> {
    if (!(await goHome(port))) {
      return {
        reachable: false,
        reason: 'No se pudo llevar la app al home (flecha / pestaña Inicio).'
      };
    }
    if (!(await port.tapByText(firstSelector('tripTypeButton'), ONE_WAY_TEXT, 7000))) {
      return {
        reachable: false,
        reason: 'El carrier no ofrece el tipo de viaje «Solo Ida» en el home.'
      };
    }
    await port.pause(2200);
    if (!(await port.isTripTypeActive(ONE_WAY_TEXT))) {
      return { reachable: false, reason: '«Solo Ida» se tocó pero no quedó marcado como activo.' };
    }

    const live = await port.findEditablePlaceholder('origen|destino');
    if (live) this.resolved = placeholderSelector(live);
    else this.resolved = (await firstEditable(port, [DESTINATION_SELECTOR, ORIGIN_SELECTOR])) ?? '';
    if (!this.resolved) {
      return {
        reachable: false,
        reason: 'Con «Solo Ida» activo no hay ninguna fila de dirección editable.'
      };
    }
    return {
      reachable: true,
      fieldSelector: this.resolved,
      detail: `${this.label} · campo ${this.resolved} (tipo confirmado activo)`
    };
  }

  async cleanup(port: SurfacePort): Promise<void> {
    await clearField(port, this.resolved);
  }
}
