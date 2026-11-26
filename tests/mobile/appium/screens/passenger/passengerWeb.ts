/**
 * passengerWeb — helpers mínimos de WebView para las screens de sesión de la app Pasajero (PAX).
 * Solo contexto + URL + clasificación pura de URL (espejo de `screens/driver/driverWeb.ts`).
 */

import type { Browser } from 'webdriverio';
import type { MobileSession } from '../../core/MobileSession.js';

/** Deja el contexto en WEBVIEW (lanza si no hay WebView disponible) y devuelve el driver. */
export async function webDriver(session: MobileSession): Promise<Browser> {
  if ((await session.context()) !== 'webview') await session.switchContext('webview');
  return session.driver;
}

/** URL actual del WebView ('' si no se pudo leer). */
export async function webUrl(session: MobileSession): Promise<string> {
  const driver = await webDriver(session);
  return driver.execute(() => window.location.href).catch(() => '');
}

/** Sin sesión: la URL contiene `/login` o `invalid_token=true` (son dos formas distintas). */
export const isLoginUrl = (url: string): boolean =>
  /\/login/i.test(url) || /[?&#]invalid_token=true/i.test(url);

/** Home PAX: `/navigator/HomePage`. */
export const isHomeUrl = (url: string): boolean => /\/navigator\/HomePage/i.test(url);
