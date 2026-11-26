/**
 * S3 — «Agregar otro destino» (parada) del home. El campo NO existe en el estado inicial: aparece después de
 * fijar un destino. Por eso `navigate` primero carga un destino (`seedDestination`) y elige la primera predicción.
 *
 * `seedDestination` lo inyecta el spec (clave `MG116_SEED_DESTINATION`): la surface no lee `process.env`.
 *
 * `develop` (`TravelDestinationsComponent.isMultipleStops`): la fila de parada sólo se monta si hay más de 2
 * waypoints Y (no hay servicio elegido O `lastServiceSelected.allowStops`). Un carrier/servicio sin paradas hace
 * la superficie inalcanzable: es del dato, no un defecto. Selector: PROBADO UAT v2.5.19, coincide con `develop`.
 */

import { resolveWebSelectors } from '../../../../core/Locator.js';
import { DESTINATION_SELECTOR, SURFACE_LOCATORS } from './surfaceLocators.js';
import {
  clearField,
  ensureEditable,
  firstSelector,
  goHome,
  placeholderSelector
} from './surfaceSteps.js';
import type { AddressSurface, SurfacePort, SurfaceReach } from './types.js';

export class HomeStopSurface implements AddressSurface {
  readonly id = 'S3' as const;
  readonly label = 'Home · Agregar otro destino (parada)';
  readonly fieldLocator = SURFACE_LOCATORS.homeStop;
  private resolved = resolveWebSelectors(SURFACE_LOCATORS.homeStop)[0]!;

  constructor(private readonly seedDestination: string) {}

  async navigate(port: SurfacePort): Promise<SurfaceReach> {
    if (!this.seedDestination.trim()) {
      return {
        reachable: false,
        reason: 'Sin dirección semilla (MG116_SEED_DESTINATION) para fijar el destino.'
      };
    }
    if (!(await goHome(port))) {
      return {
        reachable: false,
        reason: 'No se pudo llevar la app al home (flecha / pestaña Inicio).'
      };
    }
    if (!(await ensureEditable(port, DESTINATION_SELECTOR))) {
      return { reachable: false, reason: 'El campo «Destino» no existe o no quedó editable.' };
    }

    // Cargar destino y elegir la primera predicción: sin selección, la fila de parada no aparece.
    if (!(await port.setValue(DESTINATION_SELECTOR, this.seedDestination))) {
      return { reachable: false, reason: 'No se pudo escribir el destino semilla.' };
    }
    await port.pause(4500);
    await port.tapByText(firstSelector('prediction'), '', 6000);
    await port.pause(2500);

    const placeholder = await port.findPlaceholderStartingWith('agregar otro destino');
    if (!placeholder) {
      return {
        reachable: false,
        reason:
          'La fila «Agregar otro destino» no apareció: el servicio del carrier puede no permitir paradas ' +
          '(allowStops) o la dirección semilla no devolvió predicciones.'
      };
    }
    // El placeholder exacto sale del DOM, con su espacio final si lo tiene.
    this.resolved = placeholderSelector(placeholder);
    return { reachable: true, fieldSelector: this.resolved, detail: this.label };
  }

  async cleanup(port: SurfacePort): Promise<void> {
    await clearField(port, this.resolved);
    await clearField(port, DESTINATION_SELECTOR);
  }
}
