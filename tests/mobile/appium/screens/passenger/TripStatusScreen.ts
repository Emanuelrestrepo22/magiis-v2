/**
 * TripStatusScreen (POM, PAX) — SOLO LECTURA del estado del viaje activo: estado normalizado, código del viaje (si
 * se ve) y presencia del CTA «Cancelar Viaje». NO toca ningún control (los taps de cancelación viven en
 * `TripCancelScreen`) y no tiene aserciones de negocio. Extiende la clasificación de `ActiveTripScreen` (que solo
 * distingue «buscando» / «en curso») con el estado fino.
 *
 * Relevado del código (develop, repo magiis-mobile-passenger-v2) y V1; validación en vivo pendiente (login PAX
 * bloqueado en emuladores por FCM):
 *  - `DriverAvailablePages` (driver-available.page.html:~19-36): etiqueta `travel_status.searching_driver`
 *    («Buscando servicio...» / «We are looking for vehicles») + botón `button.btn.outline` con
 *    `commons.cancel_warning.title` («Cancelar Viaje» / «Cancel Trip»). La app también navega acá con
 *    `WITH_DRIVER_ASSIGNED` (notification.service.ts:~100), por eso la URL sola no distingue.
 *  - `travel-in-progress` (travel-in-progress.page.html:19-21,106): `<h1>` `travel_status.with_assigned_driver`
 *    («Servicio Asignado» / «Driver Assigned») mientras el pasajero no fue recogido; `traveling.label_message`
 *    («¡Viaje en curso!» / «Trip in Progress!») y `traveling.label_message_closing` («¡Cerrando Viaje!» / «Closing
 *    Trip!») después. El botón «Cancelar Viaje» solo existe con `*ngIf="!paxPickedUp"` (línea 106).
 *  - Código del viaje: `<n>-<letra>` si aparece en el texto (no siempre se muestra).
 */

import { defineLocator, resolveWebSelectors, type Locator } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { normalizeForMatch } from './LoginScreen.js';
import { webDriver, webUrl } from './passengerWeb.js';
import { collectTripCodes } from './TripConfirmScreen.js';

export type TripState =
  | 'SEARCHING_DRIVER'
  | 'WITH_DRIVER_ASSIGNED'
  | 'GOING_TO_CLIENT'
  | 'IN_PROGRESS'
  | 'CLOSING_TRAVEL'
  | 'NONE'
  | 'UNKNOWN';

export type TripStatus = {
  url: string;
  state: TripState;
  tripCode: string | null;
  /** Hay un botón «Cancelar Viaje» visible (sin tocarlo). */
  cancelCtaVisible: boolean;
};

export const TRIP_STATUS_LOCATORS = {
  // relevado del código (develop) y V1, pendiente de validar en vivo: botón «Cancelar Viaje» (driver-available y travel-in-progress)
  cancelCta: defineLocator({
    id: 'passenger.tripStatus.cancelCta',
    web: ['button.btn.outline', 'ion-content button']
  })
} as const satisfies Record<string, Locator>;

/** Fragmentos (normalizados, es/en) del botón de cancelación. */
export const CANCEL_CTA_TEXTS = ['cancelar viaje', 'cancel trip'] as const;

export function isCancelCtaLabel(label: string): boolean {
  const t = normalizeForMatch(label);
  return CANCEL_CTA_TEXTS.some((f) => t.includes(f));
}

/**
 * Pura: estado normalizado desde URL + texto visible (es/en). Home -> `NONE`. En `travel-in-progress` el texto
 * manda (cerrando > en curso > asignado) y, sin texto legible, el `statusPage` de la URL; `DriverAvailablePages`
 * o «Buscando servicio» -> `SEARCHING_DRIVER`. Cualquier otra pantalla -> `UNKNOWN`.
 */
export function normalizeTripState(url: string, visibleText = ''): TripState {
  const t = normalizeForMatch(visibleText);
  if (/travel-in-progress/i.test(url)) {
    if (t.includes('cerrando viaje') || t.includes('closing trip')) return 'CLOSING_TRAVEL';
    if (t.includes('viaje en curso') || t.includes('trip in progress')) return 'IN_PROGRESS';
    if (t.includes('servicio asignado') || t.includes('driver assigned')) {
      return 'WITH_DRIVER_ASSIGNED';
    }
    if (/statusPage=(GOING_TO_CLIENT|CANDIDATE_CONFIRM)/i.test(url)) return 'GOING_TO_CLIENT';
    if (/statusPage=(GOING_TO_DESTINATION|TRAVEL_STARTED)/i.test(url)) return 'IN_PROGRESS';
    if (/statusPage=CLOSING_TRAVEL/i.test(url)) return 'CLOSING_TRAVEL';
    return 'UNKNOWN';
  }
  if (
    /DriverAvailablePages/i.test(url) ||
    t.includes('buscando servicio') ||
    t.includes('we are looking for vehicles')
  ) {
    return 'SEARCHING_DRIVER';
  }
  if (/\/navigator\/HomePage/i.test(url)) return 'NONE';
  return 'UNKNOWN';
}

/** Pura: primer código de viaje `<n>-<letra>` del texto, o `null`. */
export function readTripCode(visibleText: string): string | null {
  return collectTripCodes(visibleText)[0] ?? null;
}

export class TripStatusScreen {
  constructor(private readonly session: MobileSession) {}

  /** URL + texto + presencia del CTA «Cancelar Viaje». No toca nada. */
  async readStatus(): Promise<TripStatus> {
    const driver = await webDriver(this.session);
    const url = await webUrl(this.session);
    const text = await driver
      .execute<string, []>(() => String(document.body?.innerText ?? ''))
      .catch(() => '');
    let cancelCtaVisible = false;
    for (const selector of resolveWebSelectors(TRIP_STATUS_LOCATORS.cancelCta)) {
      let found: WebdriverIO.Element[] = [];
      try {
        found = Array.from((await driver.$$(selector)) as Iterable<WebdriverIO.Element>);
      } catch {
        found = [];
      }
      for (const el of found) {
        if (!(await el.isDisplayed().catch(() => false))) continue;
        if (isCancelCtaLabel(String(await el.getText().catch(() => '')))) cancelCtaVisible = true;
      }
      if (cancelCtaVisible) break;
    }
    return {
      url,
      state: normalizeTripState(url, text),
      tripCode: readTripCode(text),
      cancelCtaVisible
    };
  }
}
