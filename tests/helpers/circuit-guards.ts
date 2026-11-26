// tests/helpers/circuit-guards.ts
// Guardas del circuito administrativo multi-carrier (plan docs/qa/f5-admin-circuit-multicarrier-plan.md §2 D6/D9,
// riesgo R1 «UAT compartido»: incidente 723585, un finalizeAdmin con un chofer ajeno por regex parcial).
// Puras y sin `expect` (los helpers devuelven veredictos o lanzan; el spec asevera):
// - el ambiente del perfil coincide con ENV,
// - el par es PROPIO de QA (`qaOwned`),
// - el chofer del detalle cerrado es exactamente el del par,
// - el flujo de preparacion no contiene «Send Service», autodispatch ni el boton «A».
import {
  assertProfileEnv,
  prepPair,
  type CarrierProfile,
  type PrepCost,
  type PrepPair
} from '../config/carrier-profiles.js';
import type { PrepScenario } from '../data/carrier-v2/trips/prep-scenarios.js';
import type { TravelDetail } from '../api/clients/travels.client.js';

/** El perfil pertenece al ambiente activo (un perfil UAT nunca corre con ENV=test y viceversa). */
export function assertEnvMatchesProfile(
  profile: CarrierProfile,
  env: NodeJS.ProcessEnv = process.env
): void {
  assertProfileEnv(profile, env);
}

/** Par PROPIO del perfil (`qaOwned`); lanza si no esta declarado. Devuelve la clave y el par. */
export function assertOwnPair(
  profile: CarrierProfile,
  key?: string
): { key: string; pair: PrepPair } {
  return prepPair(profile, key);
}

/** DRIVER.ID del detalle del viaje (`driverId` o `driver.id`); null si el detalle no lo expone. */
export function detailDriverId(detail: TravelDetail): number | null {
  const nested = detail.driver;
  const candidate =
    detail.driverId ??
    (typeof nested === 'object' && nested !== null ? (nested as { id?: unknown }).id : undefined);
  const id = Number(candidate);
  return candidate !== null && candidate !== undefined && Number.isInteger(id) && id > 0
    ? id
    : null;
}

/** El chofer asignado debe ser EXACTAMENTE el del par: un chofer ajeno (723585: 6013 != 6437) lanza. */
export function assertDriverMatchesPair(actualDriverId: number | null, pair: PrepPair): void {
  if (actualDriverId !== pair.driverId) {
    throw new Error(
      `[circuit-guards] chofer ajeno: el viaje quedo con DRIVER.ID ${String(actualDriverId)} y el par propio es ${pair.driverId}`
    );
  }
}

export type ClosureMismatch = { field: string; expected: unknown; actual: unknown };

const STATE_DONE = /^(DONE|6)$/i;
const PAYMENT_CASH = /cash/i;
const PAYMENT_ACCOUNT = /checking|account|credit/i;

/**
 * Veredicto del viaje tras el cierre administrativo: estado cerrado, chofer = par, medio de pago esperado y
 * conceptos de otros costos esperados (por nombre). Devuelve las diferencias (vacio = OK); el spec asevera.
 */
export function evaluatePrepClosure(
  detail: TravelDetail,
  expected: { pair: PrepPair; scenario: PrepScenario; costs: readonly PrepCost[] }
): ClosureMismatch[] {
  const out: ClosureMismatch[] = [];
  const state = String(detail.state ?? '');
  if (!STATE_DONE.test(state)) out.push({ field: 'state', expected: 'DONE', actual: state });

  const driverId = detailDriverId(detail);
  if (driverId !== expected.pair.driverId) {
    out.push({ field: 'driver.id', expected: expected.pair.driverId, actual: driverId });
  }

  const payment = String(detail.paymentMethod ?? '');
  const wantPayment = expected.scenario.payment === 'account' ? PAYMENT_ACCOUNT : PAYMENT_CASH;
  if (expected.scenario.payment !== null && !wantPayment.test(payment)) {
    out.push({ field: 'paymentMethod', expected: String(wantPayment), actual: payment });
  }

  const names = Array.isArray(detail.otherCostList)
    ? detail.otherCostList.map((c) => String(c.name ?? ''))
    : [];
  for (const cost of expected.costs) {
    if (!names.includes(cost.name)) {
      out.push({ field: `otherCostList[${cost.name}]`, expected: 'presente', actual: names });
    }
  }
  if (expected.costs.length === 0 && names.length > 0) {
    out.push({ field: 'otherCostList', expected: 'vacia', actual: names });
  }
  return out;
}

/** Texto legible de las diferencias (mensajes de aserto). */
export function formatClosureMismatches(mismatches: readonly ClosureMismatch[]): string {
  return mismatches
    .map(
      (m) =>
        `${m.field}: esperado ${JSON.stringify(m.expected)}, obtenido ${JSON.stringify(m.actual)}`
    )
    .join('; ');
}

const FORBIDDEN_FLOW: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'sendService(', re: /\bsendService\s*\(/ },
  { name: 'Send Service', re: /send\s+service/i },
  { name: 'autoDispatch / autodispatch', re: /auto-?dispatch/i },
  { name: 'boton «A» (asignacion automatica)', re: /button[^\n]*name:\s*\/\^A\$\//i }
];

/**
 * Escaneo de FUENTE: el flujo de preparacion no debe usar «Send Service», autodispatch ni el boton «A». Recibe el
 * texto de un archivo y devuelve las violaciones (con numero de linea). Los comentarios (de linea y de bloque/JSDoc) no cuentan.
 */
export function findForbiddenFlow(source: string): string[] {
  const out: string[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\*|\/\*)/.test(line)) return; // comentario de bloque / JSDoc
    const code = line.replace(/\/\/.*$/, '');
    for (const f of FORBIDDEN_FLOW) {
      if (f.re.test(code)) out.push(`linea ${i + 1}: ${f.name}`);
    }
  });
  return out;
}

/** Lanza si el fuente usa algo prohibido en la preparacion (ver `findForbiddenFlow`). */
export function assertNoForbiddenFlow(source: string, label = 'fuente'): void {
  const violations = findForbiddenFlow(source);
  if (violations.length > 0) {
    throw new Error(
      `[circuit-guards] ${label} usa flujos prohibidos en la preparacion: ${violations.join(', ')}`
    );
  }
}
