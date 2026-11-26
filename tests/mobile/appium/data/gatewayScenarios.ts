/**
 * Escenarios de la pasarela (Stripe, sin 3DS) para la app Pasajero: reemplazo de los datasets de V1
 * (`passenger-personal-no3ds-scenarios` / `passenger-business-scenarios`) reducidos a lo que V2 puede afirmar hoy.
 * Datos puros, sin lógica por carrier y sin leer `process.env` (el spec pasa el texto de la variable).
 *
 * `active: false` = el escenario necesita la fase del Chofer (asignación/viaje en curso); se documenta pero el spec
 * lo saltea con motivo (futuro: handoff con el actor Chofer).
 *
 * Tarjeta: se usa SIEMPRE una tarjeta YA existente en la billetera elegida por últimos 4 (nunca se agrega ni se
 * elimina desde este flujo). El valor por defecto es la Visa de prueba pública de Stripe (4242); puede sobreescribirse
 * con la variable que lee el spec (`parseGatewayCardLast4`).
 */

/** Mismos valores que el modo de perfil de la app (PassengerProfileMode): Personal o Compañía (business). */
export type GatewayProfileMode = 'personal' | 'company';

export type GatewayScenario = {
  /** Clave estable para citar el escenario en logs y en el título del test. */
  id: string;
  /** Casos de origen en V1 (trazabilidad; no se usan como Test Xray). */
  sourceCaseIds: readonly string[];
  mode: GatewayProfileMode;
  title: string;
  active: boolean;
  /** Motivo por el que está inactivo (obligatorio si `active` es `false`). */
  inactiveReason?: string;
};

/** Visa de prueba pública de Stripe (4242 4242 4242 4242): sin 3DS, sin rechazo. Solo los últimos 4. */
export const GATEWAY_NO3DS_DEFAULT_LAST4 = '4242';

export const GATEWAY_SCENARIOS: readonly GatewayScenario[] = [
  {
    id: 'PAX-GW-PERSONAL-NO3DS-TRIP-CREATE',
    sourceCaseIds: ['TC-PAX-09'],
    mode: 'personal',
    title: 'pedir un viaje en modo Personal con tarjeta sin 3DS',
    active: true
  },
  {
    id: 'PAX-GW-PERSONAL-NO3DS-TRIP-ASSIGNED',
    sourceCaseIds: ['TC-PAX-10'],
    mode: 'personal',
    title: 'ver el viaje con conductor asignado en modo Personal',
    active: false,
    inactiveReason:
      'requiere que el actor Chofer acepte el viaje (handoff Pasajero → Chofer, trabajo futuro)'
  },
  {
    id: 'PAX-GW-BUSINESS-NO3DS-TRIP-CREATE',
    sourceCaseIds: ['TC-PAX-BIZ-03'],
    mode: 'company',
    title: 'pedir un viaje en modo Compañía con tarjeta sin 3DS',
    active: true
  },
  {
    id: 'PAX-GW-BUSINESS-NO3DS-TRIP-ASSIGNED',
    sourceCaseIds: ['TC-PAX-BIZ-04'],
    mode: 'company',
    title: 'ver el viaje con conductor asignado en modo Compañía',
    active: false,
    inactiveReason:
      'requiere que el actor Chofer acepte el viaje (handoff Pasajero → Chofer, trabajo futuro)'
  }
];

/** Pura: escenarios del modo pedido (orden de la lista). */
export function gatewayScenariosFor(mode: GatewayProfileMode): GatewayScenario[] {
  return GATEWAY_SCENARIOS.filter((s) => s.mode === mode);
}

/**
 * Pura: últimos 4 de la tarjeta existente a usar. `raw` es el texto de la variable (puede traer espacios o más
 * dígitos: se toman los últimos 4 de los dígitos). Vacío/`undefined` -> el valor por defecto. Con texto que no
 * tiene al menos 4 dígitos devuelve `null` (el spec lo saltea en vez de adivinar).
 */
export function parseGatewayCardLast4(raw: string | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text === '') return GATEWAY_NO3DS_DEFAULT_LAST4;
  const digits = text.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}
