// tests/helpers/f5-app-acceptance.ts
// Registro propio de los ACs del circuito «cierre por app Chofer -> lote de rendicion» (W5a, MG-1027 F5) y su
// `verifyF5App`. Mismo patron que `verifyF5` (step + anotacion `ac` + adjunto JSON) con ids `AC-F5A-NN`: archivo
// propio para no tocar el registro de W1 (`f5-acceptance.ts`).
import { test, type TestInfo } from '@playwright/test';

export const F5_APP_AC = {
  'AC-F5A-01':
    'Alta en efectivo: cotización > 0, origen y destino distintos, total = base + otros costos del escenario',
  'AC-F5A-02':
    'Asignación directa por driverId al chofer del par (no difusión, sin botón «A»): detalle con ese chofer y estado abierto',
  'AC-F5A-03': 'Antes del cierre, el viaje no integra el lote de rendición del par',
  'AC-F5A-04': 'La app Chofer cierra el viaje: el backend lo deja en DONE con el chofer asignado',
  'AC-F5A-05':
    'Precio final > 0; el cierre por app recalcula, por eso NO se compara contra la cotización (solo se registra)',
  'AC-F5A-06': 'Km del backend dentro de la tolerancia de la ruta medida por el runner',
  'AC-F5A-07': 'Costo 0 hasta F7 (diferido-f7): se registra como observation, nunca como falla',
  'AC-F5A-08':
    'Lote de rendición del par = exactamente [travelId] (API + vista previa por UI, solo lectura)',
  'AC-F5A-09':
    'AC-95 (App Driver 2.6.17 conserva la oferta de un viaje cancelado asignado a mano): known-issue, solo anotado'
} as const;

export type F5AppAcId = keyof typeof F5_APP_AC;
export type F5AppEvidence = Record<string, unknown>;

export function f5AppLabel(id: F5AppAcId): string {
  return `${id}: ${F5_APP_AC[id]}`;
}

/** Ejecuta `fn` en un step, anota `ac: AC-F5A-NN PASS|FAIL` y adjunta la evidencia JSON (`ac-AC-F5A-NN`). */
export async function verifyF5App<T extends F5AppEvidence | void>(
  testInfo: TestInfo,
  id: F5AppAcId,
  fn: () => Promise<T> | T
): Promise<T | undefined> {
  const softBefore = testInfo.errors.length;
  let evidence: T | undefined;
  let failure: unknown;
  try {
    await test.step(f5AppLabel(id), async () => {
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
        title: F5_APP_AC[id],
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

export function f5AppNote(
  testInfo: TestInfo,
  type: 'known-issue' | 'observation',
  id: F5AppAcId,
  note: string
): void {
  testInfo.annotations.push({ type, description: `${id} ${F5_APP_AC[id]}: ${note}` });
}
