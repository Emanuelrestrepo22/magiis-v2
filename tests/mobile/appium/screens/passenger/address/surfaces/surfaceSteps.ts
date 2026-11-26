/**
 * Pasos compartidos por las superficies (puros sobre `SurfacePort`): volver al home y volver editable una fila.
 *
 * REGLA DE SEGURIDAD: nunca se toca el icono lateral de una fila de dirección (en el home es una papelera que
 * elimina el origen/parada). Los únicos objetivos son el texto de la fila y el input. Ojo: en `develop`, tocar el
 * wrapper del ORIGEN ya resuelto lo LIMPIA y le da foco (`onWrapperClick`): es el efecto buscado, vive sólo en
 * memoria de la app (no persiste) y se deshace relanzando.
 */

import { resolveWebSelectors } from '../../../../core/Locator.js';
import { HOME_URL_RE, SURFACE_LOCATORS } from './surfaceLocators.js';
import type { FieldState, RowTapKind, SurfacePort } from './types.js';

export const firstSelector = (key: keyof typeof SURFACE_LOCATORS): string =>
  resolveWebSelectors(SURFACE_LOCATORS[key])[0]!;

/** Selector CSS de un input por placeholder EXACTO (los placeholders llevan espacio final). */
export const placeholderSelector = (placeholder: string): string =>
  `input[placeholder=${JSON.stringify(placeholder)}]`;

/**
 * Vuelve al home. Prueba las dos vías en el orden en que las usa una persona: la flecha del encabezado (en
 * `/AddressesPage` y `travel-edit` las tabs inferiores NO se renderizan) y la pestaña «Inicio».
 */
export async function goHome(port: SurfacePort, maxSteps = 5): Promise<boolean> {
  for (let i = 0; i < maxSteps; i++) {
    if (HOME_URL_RE.test(await port.url())) return true;
    if (await port.tapBackArrow()) continue;
    if (await port.tapByText(firstSelector('tabButton'), 'inicio', 3000)) continue;
    break;
  }
  return HOME_URL_RE.test(await port.url());
}

/** Orden en que se prueba tocar una fila: texto -> fila entera -> input (nunca el icono lateral). */
export const ROW_TAP_ORDER: readonly RowTapKind[] = ['text', 'row', 'input'];

/**
 * Deja el campo editable: si llega `readonly` toca la fila como un dedo y recién entonces verifica por DOM.
 * No asume que el tap sirvió. `false` si el campo no existe o no se pudo habilitar.
 */
export async function ensureEditable(port: SurfacePort, selector: string): Promise<boolean> {
  const before: FieldState = await port.fieldState(selector);
  if (!before.present) return false;
  if (!before.readOnly) return true;
  for (const kind of ROW_TAP_ORDER) {
    if (!(await port.tapField(selector, kind))) continue;
    await port.pause(2000);
    const after = await port.fieldState(selector);
    if (after.present && !after.readOnly) return true;
  }
  return false;
}

/** Primer selector de la lista cuyo campo se puede dejar editable (o `null`). */
export async function firstEditable(
  port: SurfacePort,
  selectors: readonly string[]
): Promise<string | null> {
  for (const selector of selectors) {
    if (await ensureEditable(port, selector)) return selector;
  }
  return null;
}

/** Limpia el campo sin tocar el resto del formulario (no-op si no hay selector). */
export async function clearField(port: SurfacePort, selector: string): Promise<void> {
  if (!selector) return;
  await port.setValue(selector, '');
  await port.pause(500);
}
