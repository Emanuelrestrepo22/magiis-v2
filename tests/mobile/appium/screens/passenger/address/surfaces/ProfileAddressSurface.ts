/**
 * S7 — campo de dirección del perfil, en `/AddressesPage` (alta/edición de «Mis Direcciones»).
 *
 * TRES COSAS QUE COSTARON UNA CORRIDA ENTERA EN V1 (y siguen vigentes en `develop`):
 *  1. «Mis Direcciones» es una PÁGINA propia (`/AddressesPage`), no un panel del home.
 *  2. El botón «Mis Direcciones» del HOME (`button.travelHistory-btn.additional-btns-btn`) es un homónimo: un
 *     atajo para elegir un destino guardado. La sección del formulario se alcanza por el menú lateral
 *     (pestaña «Mi cuenta» -> ítem `menu.label_addresses`), por eso el tap se acota a `ion-menu ion-item`.
 *  3. El campo «Dirección» está DESHABILITADO hasta elegir un «Tipo» (`ion-select` en `#inputAddressType`). Las
 *     opciones dependen de lo ya guardado (`Casa`/`Trabajo` desaparecen si existen): se elige la primera
 *     opción ofrecida, nunca un literal. Sin ese paso el campo «no se encuentra» por una precondición de formulario.
 *
 * `develop` ya consulta `places/autocomplete` del endpoint propio desde esta página (MG-116 2.ª etapa,
 * `runGoogleAutocomplete` -> `GooglePlacesService`): TM-729 debería quedar verde en builds con ese cambio.
 *
 * Se sale SIN guardar (no hay botón «Cancelar» en `develop`: sólo la flecha del encabezado), para no crear
 * direcciones en UAT. Menú lateral: `SideMenuScreen.open()` por API `ion-menu.open()`.
 */

import { ADDRESSES_URL_RE, PROFILE_ADDRESS_SELECTOR, SURFACE_LOCATORS } from './surfaceLocators.js';
import { clearField, firstSelector, goHome } from './surfaceSteps.js';
import type { AddressSurface, SurfacePort, SurfaceReach } from './types.js';

export class ProfileAddressSurface implements AddressSurface {
  readonly id = 'S7' as const;
  readonly label = 'Perfil · Direcciones (alta/edición)';
  readonly fieldLocator = SURFACE_LOCATORS.profileAddress;
  private resolved = '';
  /** Tipo elegido para habilitar el campo (va al reporte). */
  chosenType = '';

  async navigate(port: SurfacePort): Promise<SurfaceReach> {
    if (!ADDRESSES_URL_RE.test(await port.url())) {
      if (!(await goHome(port))) {
        return {
          reachable: false,
          reason: 'No se pudo llevar la app al home (flecha / pestaña Inicio).'
        };
      }
      if (!(await port.openSideMenu())) {
        return { reachable: false, reason: 'No se pudo abrir el menú lateral («Mi cuenta»).' };
      }
      await port.pause(2000);
      if (!(await port.tapByText(firstSelector('menuAddresses'), 'direccion', 6000))) {
        return {
          reachable: false,
          reason: 'No se encontró el ítem «Mis Direcciones» del menú lateral.'
        };
      }
      await port.pause(2500);
      if (!ADDRESSES_URL_RE.test(await port.url())) {
        return {
          reachable: false,
          reason: 'Se tocó «Mis Direcciones» pero no se abrió /AddressesPage.'
        };
      }
    }

    this.chosenType = await this.ensureType(port);
    if (!this.chosenType) {
      return {
        reachable: false,
        reason: 'No se pudo elegir un «Tipo» para habilitar el campo Dirección.'
      };
    }
    const input = await port.findProfileAddressInput();
    if (!input) {
      return { reachable: false, reason: 'Con el Tipo elegido no apareció el input de Dirección.' };
    }
    this.resolved = input;
    return {
      reachable: true,
      fieldSelector: input,
      detail: `${this.label} · Tipo «${this.chosenType}»`
    };
  }

  private async ensureType(port: SurfacePort): Promise<string> {
    const already = await port.readAddressType();
    if (already) return already;
    const picked = await port.pickFirstAddressTypeOption();
    await port.pause(1800);
    return picked;
  }

  async cleanup(port: SurfacePort): Promise<void> {
    // No se guarda nada: se sale del formulario sin confirmar para no crear direcciones en UAT.
    await clearField(port, this.resolved || PROFILE_ADDRESS_SELECTOR);
    await port.tapBackArrow().catch(() => false);
    await port.pause(1500);
  }
}
