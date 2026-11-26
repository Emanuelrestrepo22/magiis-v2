/**
 * driverWeb — helpers mínimos de WebView compartidos por las screens de sesión del Driver
 * (login, pre-home, home, menú lateral). Solo contexto + URL + clasificación pura de URL.
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

export const isLoginUrl = (url: string): boolean => /\/login/i.test(url);
export const isPreHomeUrl = (url: string): boolean => /pre-home/i.test(url);
/** Cualquier ruta `/navigator/*` (home, TravelConfirmPage, ...): ya se pasó login y pre-home. */
export const isNavigatorUrl = (url: string): boolean => /\/navigator\//i.test(url);
/** Home: `/navigator/home;FROM_LOGIN=true` · `;FROM_TRAVEL_CLOSED=true`. */
export const isHomeUrl = (url: string): boolean => /\/navigator\/home/i.test(url);
