/**
 * TripCancelScreen (POM, PAX) — taps de la CANCELACIÓN del viaje activo: botón «Cancelar Viaje» y botón de
 * confirmación del diálogo («Si» / «Yes»). Sin aserciones de negocio.
 *
 * REGLA DE SEGURIDAD: `tapCancelCta` y `tapDialogConfirm` son taps de bajo nivel IRREVERSIBLES; NO deben llamarse
 * desde un spec. Solo `pbo/TripCancelPBO` los invoca, tras `assertConfirmed` (`{ confirmed: true }`).
 * `readCancelDialog` es de solo lectura.
 *
 * Relevado del código (develop) y V1; validación en vivo pendiente (login PAX bloqueado por FCM):
 *  - `DriverAvailablePages`: el botón llama `back()` -> `cancel()` (driver-available.page.ts:271-290), que abre
 *    `messageService.showConfirmModal('driver_available.alert_cancel.title'/'.message', onConfirm,
 *    'in_progress.alert_cancel.button_accept' («Si»/«Yes»), 'in_progress.alert_cancel.button_cancel' («No»))`.
 *    Confirmar -> `rejectTravel()` (:218) -> `travelService.cancelTravel()` (travel.service.ts:583; cuerpo
 *    `{ reasonForCancellation: undefined, canceledBy: 'PASSENGER' }`, cancel-travel.command.ts) -> `navigateToHome`
 *    (:231) -> `/navigator/HomePage`. NO hay selector de motivo ni aviso de costo en este camino.
 *  - `travel-in-progress` (solo `!paxPickedUp`): `userCancel()` (travel-in-progress.page.ts:1151) consulta
 *    `getTaxForCancelling`; si `cancellationCost != 0` agrega al mensaje `in_progress.message_canceled_price`
 *    («La cancelación del Viaje incluye un costo de » / «Trip Cancellation Includes a cost of $») + monto. Mismos
 *    botones «Si»/«No»; confirmar -> `cancelTravel()` -> `gotoHome()`.
 *  - El modal es `app-confirm-modal`: `button.btn.primary` (confirmar) y `button.btn-outlined-red` (cancelar).
 */

import { defineLocator, resolveWebSelectors, type Locator } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { normalizeForMatch } from './LoginScreen.js';
import { webDriver } from './passengerWeb.js';
import { isCancelCtaLabel, TRIP_STATUS_LOCATORS } from './TripStatusScreen.js';

export type CancelDialogInfo = { text: string; buttons: string[] };
export type CancellationCostWarning = { text: string; amount: string | null };

export const TRIP_CANCEL_LOCATORS = {
  // relevado del código (develop) y V1, pendiente de validar en vivo: modal de confirmación
  dialog: defineLocator({
    id: 'passenger.tripCancel.dialog',
    web: 'app-confirm-modal, ion-alert, .alert-wrapper'
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo: botones del modal
  dialogButtons: defineLocator({
    id: 'passenger.tripCancel.dialogButtons',
    web: 'button, ion-button'
  })
} as const satisfies Record<string, Locator>;

/** Etiquetas EXACTAS (normalizadas) del botón que confirma la cancelación; «No» (otro botón) nunca se toca. */
export const CANCEL_CONFIRM_LABELS = ['si', 'yes'] as const;

export function isCancelConfirmLabel(label: string): boolean {
  return (CANCEL_CONFIRM_LABELS as readonly string[]).includes(normalizeForMatch(label));
}

/** Pura: el diálogo es el de confirmar la cancelación (texto es/en de `alert_cancel`). */
export function isCancelDialogText(text: string): boolean {
  const t = normalizeForMatch(text);
  return (
    t.includes('cancelar el viaje') ||
    t.includes('cancel the trip') ||
    t.includes('cancelar viaje') ||
    t.includes('trip cancel') ||
    t.includes('cancel trip') ||
    t.includes('are you sure') ||
    t.includes('esta seguro')
  );
}

/**
 * Pura: aviso de costo de cancelación dentro del texto del diálogo (`in_progress.message_canceled_price`:
 * «…incluye un costo de <monto>» / «…includes a cost of $<monto>»). `null` si no hay aviso.
 */
export function parseCancellationCost(dialogText: string): CancellationCostWarning | null {
  const t = normalizeForMatch(dialogText);
  const m = /(?:incluye un costo de|includes a cost of)\s*\$?\s*(\d[\d.,]*)?/.exec(t);
  if (!m) return null;
  return { text: dialogText.replace(/\s+/g, ' ').trim(), amount: m[1] ?? null };
}

async function visibleDialogs(session: MobileSession): Promise<WebdriverIO.Element[]> {
  const driver = await webDriver(session);
  const out: WebdriverIO.Element[] = [];
  for (const selector of resolveWebSelectors(TRIP_CANCEL_LOCATORS.dialog)) {
    let found: WebdriverIO.Element[] = [];
    try {
      found = Array.from((await driver.$$(selector)) as Iterable<WebdriverIO.Element>);
    } catch {
      found = [];
    }
    for (const el of found) if (await el.isDisplayed().catch(() => false)) out.push(el);
  }
  return out;
}

async function visibleButtons(dialog: WebdriverIO.Element): Promise<WebdriverIO.Element[]> {
  const els = Array.from(
    (await dialog.$$(
      resolveWebSelectors(TRIP_CANCEL_LOCATORS.dialogButtons)[0]!
    )) as Iterable<WebdriverIO.Element>
  );
  const out: WebdriverIO.Element[] = [];
  for (const b of els) if (await b.isDisplayed().catch(() => false)) out.push(b);
  return out;
}

export class TripCancelScreen {
  constructor(private readonly session: MobileSession) {}

  /**
   * Tap NATIVO del botón «Cancelar Viaje». IRREVERSIBLE-ADYACENTE (abre el diálogo de confirmación): solo lo
   * llama `TripCancelPBO` tras la compuerta. `false` si no hay botón visible con ese texto.
   */
  async tapCancelCta(): Promise<boolean> {
    const driver = await webDriver(this.session);
    for (const selector of resolveWebSelectors(TRIP_STATUS_LOCATORS.cancelCta)) {
      let found: WebdriverIO.Element[] = [];
      try {
        found = Array.from((await driver.$$(selector)) as Iterable<WebdriverIO.Element>);
      } catch {
        found = [];
      }
      for (const el of found) {
        if (!(await el.isDisplayed().catch(() => false))) continue;
        if (!isCancelCtaLabel(String(await el.getText().catch(() => '')))) continue;
        try {
          await el.click();
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  /** SOLO LECTURA: diálogo de confirmación visible (texto + etiquetas de sus botones) o `null`. */
  async readCancelDialog(): Promise<CancelDialogInfo | null> {
    for (const dialog of await visibleDialogs(this.session)) {
      const text = String(await dialog.getText().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim();
      if (!text || !isCancelDialogText(text)) continue;
      const buttons: string[] = [];
      for (const b of await visibleButtons(dialog)) {
        const label = String(await b.getText().catch(() => '')).trim();
        if (label) buttons.push(label);
      }
      return { text, buttons };
    }
    return null;
  }

  /**
   * Tap NATIVO de «Si»/«Yes» del diálogo de cancelación (IRREVERSIBLE: cancela el viaje en el backend). Solo lo
   * llama `TripCancelPBO` tras la compuerta. `false` si no hay tal botón en un diálogo de cancelación visible.
   */
  async tapDialogConfirm(): Promise<boolean> {
    for (const dialog of await visibleDialogs(this.session)) {
      if (!isCancelDialogText(String(await dialog.getText().catch(() => '')))) continue;
      for (const b of await visibleButtons(dialog)) {
        if (!isCancelConfirmLabel(String(await b.getText().catch(() => '')))) continue;
        try {
          await b.click();
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }
}
