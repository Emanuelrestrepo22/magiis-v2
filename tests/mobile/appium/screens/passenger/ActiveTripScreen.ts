/**
 * ActiveTripScreen (POM, PAX) — SOLO LECTURA: ¿la app muestra la pantalla de un viaje activo? No toca ningún
 * control (ni «Cancelar Viaje»): lee URL y texto visible del WebView. Sin aserciones de negocio.
 *
 * Relevado del código (develop, repo magiis-mobile-passenger-v2); validación en vivo pendiente (login PAX
 * bloqueado en emuladores por FCM):
 *  - Al entrar al home, `HomePage.checkStatus()` (home.page.ts:2452) pide `GET /passengers/{id}/currentTrip`
 *    (status.service.ts:15). Si hay viaje, `NotificationService.notificationManager` (notification.service.ts:78+)
 *    navega FUERA del home: `SEARCHING_DRIVER` / `WITH_DRIVER_ASSIGNED` -> `/navigator/DriverAvailablePages`
 *    («Buscando servicio...» / «We are looking for vehicles», `travel_status.searching_driver`);
 *    `GOING_TO_CLIENT` / `CANDIDATE_CONFIRM` / `GOING_TO_DESTINATION` / `TRAVEL_STARTED` / `CLOSING_TRAVEL`
 *    -> `/navigator/travel-in-progress`.
 *  - Es decir: con un viaje activo que `currentTrip` devuelve, el formulario de nuevo viaje NO es alcanzable.
 */

import type { MobileSession } from '../../core/MobileSession.js';
import { normalizeForMatch } from './LoginScreen.js';
import { webDriver, webUrl } from './passengerWeb.js';

export type ActiveTripKind = 'searching-driver' | 'in-progress';
export type ActiveTripSnapshot = { url: string; text: string };

/** Pura: clasifica la pantalla por URL (preferente) o por el texto de «Buscando servicio». `null` si no es de viaje activo. */
export function classifyActiveTrip(url: string, visibleText = ''): ActiveTripKind | null {
  if (/DriverAvailablePages/i.test(url)) return 'searching-driver';
  if (/travel-in-progress/i.test(url)) return 'in-progress';
  const t = normalizeForMatch(visibleText);
  if (t.includes('buscando servicio') || t.includes('we are looking for vehicles')) {
    return 'searching-driver';
  }
  return null;
}

export class ActiveTripScreen {
  constructor(private readonly session: MobileSession) {}

  /** URL + texto visible del WebView. No toca nada. */
  async readSnapshot(): Promise<ActiveTripSnapshot> {
    const driver = await webDriver(this.session);
    const url = await webUrl(this.session);
    const text = await driver
      .execute<string, []>(() => String(document.body?.innerText ?? ''))
      .catch(() => '');
    return { url, text };
  }
}
