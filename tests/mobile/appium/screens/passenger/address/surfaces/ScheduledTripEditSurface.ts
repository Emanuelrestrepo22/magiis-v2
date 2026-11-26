/**
 * S6 — campo de dirección de la EDICIÓN de un viaje programado (`/travel-edit`).
 *
 * CÓMO SE LLEGA (censado en vivo en V1; coincide con `develop`): pestaña «Actividad» -> segmento «Programados»
 * -> el control de edición de la tarjeta, `ion-col.col-edit > div.edit`: un div SIN texto (el rótulo es un SVG),
 * vecino de `button.btn.outline` («Cancelar viaje»), que NUNCA se toca. Buscar la palabra «Editar» no lo
 * encuentra jamás y dejaba la superficie inalcanzable con el producto sano.
 *
 * PRECONDICIÓN DE DATO: al menos un viaje programado preexistente (fixture del carrier de UAT). Con
 * «Programados» vacío devuelve `reachable:false` con motivo: NO_EJERCIDO, nunca defecto. Esta superficie no crea
 * viajes.
 *
 * En `travel-edit` valen las mismas filas del home (`TravelDestinationsComponent` con `travelToEdit`, que agrega
 * una fila vacía final): se toma la primera editable. Se sale SIN guardar.
 */

import { resolveWebSelectors } from '../../../../core/Locator.js';
import {
  ORIGIN_SELECTOR,
  DESTINATION_SELECTOR,
  STOP_SELECTOR,
  SURFACE_LOCATORS,
  TRAVEL_EDIT_URL_RE
} from './surfaceLocators.js';
import { clearField, firstEditable, firstSelector } from './surfaceSteps.js';
import type { AddressSurface, SurfacePort, SurfaceReach } from './types.js';

const CANDIDATES = [
  STOP_SELECTOR,
  DESTINATION_SELECTOR,
  ORIGIN_SELECTOR,
  'input[name="input-from"]'
];

export class ScheduledTripEditSurface implements AddressSurface {
  readonly id = 'S6' as const;
  readonly label = 'Editar viaje programado';
  readonly fieldLocator = SURFACE_LOCATORS.scheduledEdit;
  private resolved = '';

  async navigate(port: SurfacePort): Promise<SurfaceReach> {
    if (!TRAVEL_EDIT_URL_RE.test(await port.url())) {
      if (!(await port.tapByText(firstSelector('tabButton'), 'actividad', 8000))) {
        return { reachable: false, reason: 'No se encontró la pestaña «Actividad».' };
      }
      await port.pause(2500);
      if (!(await port.tapByText(firstSelector('scheduledSegment'), 'programados', 6000))) {
        return { reachable: false, reason: 'No se encontró el segmento «Programados».' };
      }
      await port.pause(2500);

      const selectors = resolveWebSelectors(SURFACE_LOCATORS.scheduledEditIcon);
      let tapped = false;
      for (const selector of selectors) {
        if (await port.tapCss(selector)) {
          tapped = true;
          break;
        }
      }
      if (!tapped) {
        return {
          reachable: false,
          reason:
            'Sin viaje programado en este entorno (precondición de dato): no hay icono de edición.'
        };
      }
      await port.pause(3500);
      if (!TRAVEL_EDIT_URL_RE.test(await port.url())) {
        return {
          reachable: false,
          reason: 'Se tocó el icono de edición pero no se abrió /travel-edit.'
        };
      }
    }

    const field = await firstEditable(port, CANDIDATES);
    if (!field) {
      return {
        reachable: false,
        reason: 'En /travel-edit no hay ninguna fila de dirección editable.'
      };
    }
    this.resolved = field;
    return { reachable: true, fieldSelector: field, detail: `${this.label} · campo ${field}` };
  }

  async cleanup(port: SurfacePort): Promise<void> {
    // Se sale SIN guardar: la edición no debe alterar el viaje programado que sirve de fixture.
    await clearField(port, this.resolved);
    await port.tapBackArrow().catch(() => false);
  }
}
