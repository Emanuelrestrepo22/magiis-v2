// tests/helpers/f5-acceptance.ts
// Registro propio de los ACs de la rendicion F5 (MG-1024 BE + MG-1027 FE) y su `verifyF5`. Mismo patron
// que `verifyAc` (step + anotacion `ac` + adjunto JSON) pero con ids `AC-F5-NN`: el registro `AC-FR-NN`
// es consecutivo y se regenera desde el boilerplate, por eso F5 no lo toca.
import { test, type TestInfo } from '@playwright/test';

export const F5_AC = {
  'AC-F5-01': 'GET toTravelsSurrender trae totalCashOtherCostNoCommissionable {amount, quantity}',
  'AC-F5-02':
    'Pantalla: línea de no comisionables (efectivo) separada, presente solo si vale > 0, = GET',
  'AC-F5-03':
    'Pantalla: Total Cash (efectivo a rendir) = efectivo + no comisionables + impuestos/cargos fijos efectivo',
  'AC-F5-04': 'Pantalla: Total Amount Collected incluye el no comisionable en efectivo',
  'AC-F5-05': 'Comisiones de la pantalla = GET (base sin no comisionables)',
  'AC-F5-06':
    'La vista previa no emite escrituras (POST toTravelsSurrender / PUT travelsSurrender)',
  'AC-F5-07':
    'Lote resuelto en runtime (GET/DB): no vacío y la tarjeta de viajes de la pantalla = totalElements del GET',
  'AC-F5-08':
    'GET = esperado derivado de DB (totales por medio de pago sin NC, NC {amount, quantity})',
  'AC-F5-09':
    'TRAVELSSURRENDER: TOTALCASHOTHERCOST_NOCOM, TOTALCASHOTHERCOSTQTY_NOCOM, TAXES_COST_CASH, TOTALCASHTOSURRENDER',
  'AC-F5-10':
    'Libro del propietario: TDOC = NC efectivo solo en rendición automática; manual sin TDOC',
  'AC-F5-11': 'Clearing PDF: fila «Other Cost NO Commission (Cash Trips)» con el importe del NC',
  'AC-F5-12':
    'Body del POST: surrendered/netPaid/agencyNetPaid según efectivo a rendir y comisión del chofer (saldo a favor = surrendered 0)',
  'AC-F5-13':
    'Entregar (contrato HP-01): Confirmar según el importe; 3.er decimal frenado (tipeado y pegado), «-» y letras descartados',
  'AC-F5-14':
    'Comisiones del GET = pct × base SIN no comisionables (cálculo independiente desde DB) + fija por día no cubierto',
  'AC-F5-15': 'Formato de importes de la pantalla según el locale del carrier',
  'AC-F5-16':
    'NC de viajes en cuenta corriente: TOTALOTHERCOST_NOCOM (+ QTY) = CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF = GET checkingAccountAgencyProfitDiff = suma NC de los viajes CC'
} as const;

export type F5AcId = keyof typeof F5_AC;
export type F5AcStatus = 'PASS' | 'FAIL';
export type F5Evidence = Record<string, unknown>;

export function f5Label(id: F5AcId): string {
  return `${id}: ${F5_AC[id]}`;
}

/**
 * Ejecuta `fn` dentro de `test.step('AC-F5-NN: titulo')`, anota `ac: AC-F5-NN PASS|FAIL` y adjunta la
 * evidencia (`ac-AC-F5-NN`). Los `expect.soft` acumulados durante `fn` tambien marcan FAIL.
 */
export async function verifyF5<T extends F5Evidence | void>(
  testInfo: TestInfo,
  id: F5AcId,
  fn: () => Promise<T> | T
): Promise<T | undefined> {
  const softBefore = testInfo.errors.length;
  let evidence: T | undefined;
  let failure: unknown;
  try {
    await test.step(f5Label(id), async () => {
      evidence = await fn();
    });
  } catch (error) {
    failure = error;
  }
  const status: F5AcStatus =
    failure !== undefined || testInfo.errors.length > softBefore ? 'FAIL' : 'PASS';
  testInfo.annotations.push({ type: 'ac', description: `${id} ${status}` });
  await testInfo.attach(`ac-${id}`, {
    body: JSON.stringify(
      {
        id,
        title: F5_AC[id],
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

/** Observación abierta (no se asevera): queda anotada para el informe. */
export function f5Observation(testInfo: TestInfo, id: F5AcId, note: string): void {
  testInfo.annotations.push({ type: 'observation', description: `${id} ${F5_AC[id]}: ${note}` });
}
