// tests/helpers/f5-confirm-acceptance.ts
// ACs propios de la CONFIRMACION irreversible F5 (AC-F5-17..20). Mismo patron que `verifyF5` (step +
// anotacion `ac` + adjunto JSON) pero con registro aparte: `f5-acceptance.ts` queda intacto (lo comparten
// los carriles de solo lectura). Si el equipo lo prefiere, estos ids se pueden mover a `F5_AC`.
import { test, type TestInfo } from '@playwright/test';

export const F5_CONFIRM_AC = {
  'AC-F5-17':
    'Confirmacion: exactamente UN POST toTravelsSurrender (aun con doble clic), 200, y Confirm deja de estar disponible',
  'AC-F5-18':
    'Libro del propietario de la rendicion: TDDV (comision − costo financiero), TDCF (fija de agencia) y TDDG (gasto varios) al centavo; sin TDOC',
  'AC-F5-19':
    'DB: TRAVELSSURRENDER (comisiones por actor, netos, fija) = calculo independiente; viajes del lote SURRENDERED=1 con ese TRAVELSSURRENDER_ID; cabecera chofer/vehiculo',
  'AC-F5-20':
    'PDFs: filas ancladas al rotulo (Clearing de la respuesta del POST y Reporte Chofer si se descarga) = esperado',
  'AC-F5-21': 'Tarifa 0 (R05): pantalla, GET, body del POST y PDFs sin NaN/Infinity; comisiones 0',
  'AC-F5-22':
    'Acciones del operador antes del clic (entrega parcial, gastos varios, saldo del chofer): saldo y Confirm habilitado = calculo independiente'
} as const;
export type F5ConfirmAcId = keyof typeof F5_CONFIRM_AC;

/** Ejecuta `fn` en `test.step('AC-F5-NN: ...')`, anota `ac: AC-F5-NN PASS|FAIL` y adjunta la evidencia. */
export async function verifyF5Confirm<T extends Record<string, unknown> | void>(
  testInfo: TestInfo,
  id: F5ConfirmAcId,
  fn: () => Promise<T> | T
): Promise<T | undefined> {
  const softBefore = testInfo.errors.length;
  let evidence: T | undefined;
  let failure: unknown;
  try {
    await test.step(`${id}: ${F5_CONFIRM_AC[id]}`, async () => {
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
        title: F5_CONFIRM_AC[id],
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
