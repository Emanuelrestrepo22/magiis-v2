/**
 * surfaceFieldTarget — adaptador entre las SUPERFICIES (P-40: dónde vive el campo y cómo llegar) y las PROBES
 * (P-41: qué conducta mide el campo). Las probes consumen un `AddressFieldTarget`; las superficies producen un
 * `SurfaceReach` con el selector ya resuelto. Este archivo los une sin tocar ninguno de los dos contratos.
 *
 * Llegar (`navigate`) y limpiar (`cleanup`) NO entran acá: los orquesta el spec antes/después de la batería, y el
 * selector se toma del `reach` de ESA llegada (casi todas las superficies lo resuelven dentro de `navigate`).
 *
 * El `driver` se recibe aparte: el `SurfacePort` es una fachada de gestos y no lo expone.
 */

import type { Browser } from 'webdriverio';
import { firstSelector } from './surfaces/surfaceSteps.js';
import type { AddressSurface, SurfacePort, SurfaceReach } from './surfaces/index.js';
import type { AddressFieldTarget } from './probes/types.js';

/** Rótulo cuando el campo no refleja el texto elegido (la app puede dejar el input vacío tras seleccionar). */
export const FIRST_PREDICTION_FALLBACK_LABEL = 'primera predicción';

export type ReachedSurface = Extract<SurfaceReach, { reachable: true }>;

export function surfaceToFieldTarget(
  surface: Pick<AddressSurface, 'id' | 'label'>,
  port: SurfacePort,
  reach: ReachedSurface,
  driver: Browser
): AddressFieldTarget {
  const selector = reach.fieldSelector;
  return {
    id: surface.id,
    label: surface.label,
    driver,
    fieldSelector: () => selector,
    async selectFirstPrediction(): Promise<string | null> {
      // Tap NATIVO (no `click()` programático: no dispara el handler de Ionic). `tapCss` trae el elemento a la vista.
      if (!(await port.tapCss(firstSelector('prediction')))) return null;
      const state = await port.fieldState(selector);
      return state.value.trim() || FIRST_PREDICTION_FALLBACK_LABEL;
    }
  };
}
