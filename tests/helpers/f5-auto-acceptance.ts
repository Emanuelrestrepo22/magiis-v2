// tests/helpers/f5-auto-acceptance.ts
// Registro propio de los ACs de la rendicion AUTOMATICA con NC (F5 fase 2, W3; Xray TM-1700 / TC16) y su `verifyF5Auto`. Mismo
// patron que `verifyF5` (step + anotacion `ac` + adjunto JSON) con ids `AC-F5A-NN`, sin tocar el registro `AC-F5-NN` (W1).
import { test, type TestInfo } from '@playwright/test';

export const F5_AUTO_AC = {
  'AC-F5A-01':
    'Pre-check: lote exacto (1 fila del vehiculo con viajes y saldo declarados), propietario dedicado o aprobado, ficha sin vehiculos ajenos y sin armado previo',
  'AC-F5A-02': 'Armado: PUT vehicleOwners 2xx y GET cashCollector = true',
  'AC-F5A-03':
    'Disparo: modal de rendicion automatica, PUT travelsSurrender 200 `true` y ninguna escritura fuera de la allowlist',
  'AC-F5A-04':
    'Pending (Daily Clearing) del propietario vacio por API (y por UI en la verificacion)',
  'AC-F5A-05':
    'TRAVELSSURRENDER (DB): DRIVER_ID NULL, propietario/vehiculo, TOTALCASH sin NC, NC, efectivo a rendir, comisiones sobre base sin NC, AGENCY_NETPAID 0, lote exacto',
  'AC-F5A-06':
    'Libro del propietario: TDCV credito = comision de agencia; TDOC = NC (NC > 0) o ausente (NC = 0)',
  'AC-F5A-07': 'Libro del chofer sin movimientos de la rendicion automatica (Q7b)',
  'AC-F5A-08':
    'Liquidaciones > Propietarios: To Settle sube OWNER_TOTALCOMMISSION + COMMISSIONSUM (MX-4716)',
  'AC-F5A-09':
    'Desarmado: PUT 2xx, GET cashCollector = false y ficha sin cambios (vehiculos con sus valores)'
} as const;

export type F5AutoAcId = keyof typeof F5_AUTO_AC;
export type F5AutoEvidence = Record<string, unknown>;

export function f5AutoLabel(id: F5AutoAcId): string {
  return `${id}: ${F5_AUTO_AC[id]}`;
}

/** Ejecuta `fn` en `test.step`, anota `ac: AC-F5A-NN PASS|FAIL` y adjunta la evidencia (`ac-AC-F5A-NN`). */
export async function verifyF5Auto<T extends F5AutoEvidence | void>(
  testInfo: TestInfo,
  id: F5AutoAcId,
  fn: () => Promise<T> | T
): Promise<T | undefined> {
  const softBefore = testInfo.errors.length;
  let evidence: T | undefined;
  let failure: unknown;
  try {
    await test.step(f5AutoLabel(id), async () => {
      evidence = await fn();
    });
  } catch (error) {
    failure = error;
  }
  const status = failure !== undefined || testInfo.errors.length > softBefore ? 'FAIL' : 'PASS';
  testInfo.annotations.push({ type: 'ac', description: `${id} ${status}` });
  await testInfo.attach(`ac-${id}`, {
    body: JSON.stringify(
      {
        id,
        title: F5_AUTO_AC[id],
        status,
        evidence: evidence ?? null,
        error:
          failure === undefined
            ? null
            : failure instanceof Error
              ? failure.message
              : String(failure)
      },
      null,
      2
    ),
    contentType: 'application/json'
  });
  if (failure !== undefined) throw failure;
  return evidence;
}

/** Un AC que NO aplica en este ambiente/capa (p. ej. DB en UAT): anotacion `ac-na`, nunca cuenta como PASS. */
export function f5AutoNotApplicable(testInfo: TestInfo, id: F5AutoAcId, reason: string): void {
  testInfo.annotations.push({ type: 'ac-na', description: `${id}: ${reason}` });
}

/** Observacion abierta (no se asevera): queda anotada para el informe (C2, OBS-FR-01, OBS-FR-02, H-04, H-AUTO-03). */
export function f5AutoObservation(testInfo: TestInfo, tag: string, note: string): void {
  testInfo.annotations.push({ type: 'observation', description: `${tag}: ${note}` });
}
