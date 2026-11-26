/**
 * S1 — campo «Origen» del home. Puede llegar `readonly` con el pick-up ya geolocalizado (MG-552): se toca la fila
 * (como un dedo) para habilitarlo. Selector: PROBADO UAT v2.5.19, coincide con `develop`.
 *
 * Efecto: en `develop` tocar el wrapper del origen resuelto lo LIMPIA (`onWrapperClick`), sólo en memoria de la app.
 */

import { resolveWebSelectors } from '../../../../core/Locator.js';
import { SURFACE_LOCATORS } from './surfaceLocators.js';
import { clearField, ensureEditable, goHome } from './surfaceSteps.js';
import type { AddressSurface, SurfacePort, SurfaceReach } from './types.js';

export class HomeOriginSurface implements AddressSurface {
  readonly id = 'S1' as const;
  readonly label = 'Home · Origen';
  readonly fieldLocator = SURFACE_LOCATORS.homeOrigin;

  private get selector(): string {
    return resolveWebSelectors(this.fieldLocator)[0]!;
  }

  async navigate(port: SurfacePort): Promise<SurfaceReach> {
    if (!(await goHome(port))) {
      return {
        reachable: false,
        reason: 'No se pudo llevar la app al home (flecha / pestaña Inicio).'
      };
    }
    if (!(await ensureEditable(port, this.selector))) {
      return {
        reachable: false,
        reason: 'El campo «Origen» no existe o no se pudo dejar editable tocando su fila.'
      };
    }
    return { reachable: true, fieldSelector: this.selector, detail: this.label };
  }

  async cleanup(port: SurfacePort): Promise<void> {
    await clearField(port, this.selector);
  }
}
