/**
 * Reglas puras del pre-flight del Driver app (sin Appium, sin entorno).
 *
 * Portado de V1 `DriverTripPreflight.ts`: la evaluación es una función pura para poder testearla sin
 * dispositivo. La parte ligada al driver (captura del estado + login) vive en `pbo/driverPreflight.ts`.
 * Identidad: la app no expone el email logueado, así que se compara el NOMBRE visible en el header del
 * home contra el nombre esperado. Las credenciales solo viajan en la expectativa; nunca se imprimen.
 */

import { DRIVER_CHECKPOINT_SELECTORS } from '../screens/driver/checkpoints.js';

export type DriverPreflightExpectation = {
  /** Paquete que debe estar en primer plano (ej: com.magiis.app.test.driver). */
  appPackage: string;
  /** Nombre visible esperado del chofer en el header del home (comparación sin tildes/mayúsculas). */
  driverDisplayName: string;
  /**
   * Viaje ya asignado que la corrida va a operar. Si la app está en la oferta de ESE viaje, la
   * pantalla de confirmación no cuenta como "viaje en curso" (el home con el nombre no se ve ahí;
   * la identidad la garantiza la asignación al chofer).
   */
  expectedTravelId?: number;
  /** Credenciales a usar SOLO si la app está deslogueada. Nunca se imprimen. */
  credentials?: { email: string; password: string };
};

export type DriverPreflightSnapshot = {
  foregroundPackage: string;
  webUrl: string;
  headerTexts: string[];
  /** true si el WebView muestra el formulario de login (sin sesión). */
  loggedOut: boolean;
};

export function normalizeDriverText(v: string): string {
  return v.replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * true si el texto del header contiene todas las palabras del nombre esperado, sin importar el orden ni las comas.
 * El perfil V2 (`PrepApp.driverLabel`) guarda «Apellido, Nombre» y la app muestra «Nombre Apellido»
 * (medido 13/11/2026 con el chofer 3727 del carrier 1521).
 */
export function driverNameMatches(headerText: string, expectedName: string): boolean {
  const words = (v: string): string[] =>
    normalizeDriverText(v)
      .split(/[^a-z0-9ñ]+/)
      .filter(Boolean);
  const wanted = words(expectedName);
  if (wanted.length === 0) return false;
  const present = new Set(words(headerText));
  return wanted.every((w) => present.has(w));
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** true si la URL de la oferta (TripConfirm) corresponde al viaje `travelId` (parámetro URL-encoded). */
export function confirmUrlMatchesTravel(url: string, travelId: number): boolean {
  // Se exige que el siguiente carácter no sea dígito: 7000 no debe coincidir con 70001.
  const decoded = safeDecode(url);
  const needle = `"travelId":${travelId}`;
  for (let i = decoded.indexOf(needle); i !== -1; i = decoded.indexOf(needle, i + 1)) {
    const next = decoded.charAt(i + needle.length);
    if (!(next >= '0' && next <= '9')) return true;
  }
  return false;
}

/** Devuelve la lista de violaciones; vacía = OK. */
export function evaluateDriverPreflight(
  snapshot: DriverPreflightSnapshot,
  expected: DriverPreflightExpectation
): string[] {
  const violations: string[] = [];

  if (snapshot.loggedOut) violations.push('la app está deslogueada (formulario de login visible)');

  if (snapshot.foregroundPackage !== expected.appPackage) {
    violations.push(
      `app en primer plano "${snapshot.foregroundPackage || '<desconocida>'}" != esperada "${expected.appPackage}"`
    );
  }

  const confirmToken = DRIVER_CHECKPOINT_SELECTORS.confirm.urlTokens.find((t) =>
    snapshot.webUrl.includes(t)
  );
  const onExpectedOffer =
    !!confirmToken &&
    expected.expectedTravelId !== undefined &&
    confirmUrlMatchesTravel(snapshot.webUrl, expected.expectedTravelId);

  if (
    !onExpectedOffer &&
    !snapshot.headerTexts.some((t) => driverNameMatches(t, expected.driverDisplayName))
  ) {
    violations.push(
      'el chofer logueado no coincide con el chofer esperado (nombre no visible en el header del home)'
    );
  }

  const busyStages = ['confirm', 'in-progress', 'resume'] as const;
  for (const stage of busyStages) {
    if (stage === 'confirm' && onExpectedOffer) continue;
    const token = DRIVER_CHECKPOINT_SELECTORS[stage].urlTokens.find((t) =>
      snapshot.webUrl.includes(t)
    );
    if (token)
      violations.push(`ya hay un viaje en curso (stage "${stage}", URL contiene ${token})`);
  }

  return violations;
}
