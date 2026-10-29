// tests/helpers/acceptance.ts
// Registro tipado de los ACs del circuito FR (carrier 1901 TEST, no Universal) y helpers para que todos los
// specs los validen igual. Fuente de verdad documental:
// docs/qa/automation-stock/fr-1901/criterios-aceptacion-circuito-fr-2026-10-21.md (repo agentic-qa-boilerplate).
// El bloque del registro lo regenera la fuente unica del documento: no editar los titulos a mano.
import { test, type TestInfo } from '@playwright/test';

export const AC = {
  /* AC-REGISTRY:BEGIN */
  'AC-FR-01': 'Cotización simulada > 0 e igual a FR_EXPECTED_QUOTE',
  'AC-FR-02': 'Moneda de la cotización y del viaje creado = EUR',
  'AC-FR-03':
    'Otro costo PCT «QA City Taxes»: línea en resumen, 10 % de la base y total = base + otros + fijos + impuestos',
  'AC-FR-04': 'Chofer 4965 (DRIVER.ID) asignado y visible en el detalle',
  'AC-FR-05': 'El viaje recién creado no entra al lote de rendición hasta cerrarse',
  'AC-FR-06': 'Cierre admin (cancel + finalizeAdmin con DRIVER.ID) deja el viaje DONE',
  'AC-FR-07': 'Cierre admin sin cambios: precio final = cotización',
  'AC-FR-08': 'Costo = venta en los cinco pares (tarifa, espera, otros costos, ítem, total)',
  'AC-FR-09': 'Cierre por app: precio final > 0 en EUR',
  'AC-FR-10':
    'Cierre por app recalcula con km/tiempo medidos; final ≠ cotización es válido y se registra',
  'AC-FR-11': 'City taxes tras cierre por app = 10 % de la base final',
  'AC-FR-12': 'Con peaje/estacionamiento el total costo es la suma de partes, no copia de la venta',
  'AC-FR-13':
    'Cerrar de nuevo un viaje ya rendido es rechazado (ACTION_NOT_ALLOWED observado; TRAVEL_SURRENDERED valido)',
  'AC-FR-14': 'Cancelar deja el viaje en CANCELLED',
  'AC-FR-15': 'Cancelación sin cargo: sin FINALPRICEI, amount null o 0',
  'AC-FR-16': 'El cancelado no figura en el lote de rendición',
  'AC-FR-17': 'Sin movimientos ni delta de saldo en libros de chofer y propietario',
  'AC-FR-18': 'Sin movimiento de CC del cliente del viaje ni delta de saldo',
  'AC-FR-19': 'Cancelado: TRAVELSSURRENDER_ID NULL y SURRENDERED = 0',
  'AC-FR-20': 'Lote vacío antes de armar el caso (aislamiento)',
  'AC-FR-21': 'Lote exacto = viajes cerrados pendientes del chofer/vehículo (UI = API = esperado)',
  'AC-FR-22': 'travelAmount del lote = precio final del viaje',
  'AC-FR-23': 'Columna de pago del lote: efectivo = Cash, CC ≠ Cash',
  'AC-FR-24':
    'Comisiones de la vista previa 40/40/20 sobre base = final − peajes − estacionamiento (city tax comisionable)',
  'AC-FR-25':
    'POST toTravelsSurrender responde 2xx (500 por PDF FR = known issue, rendición persistida)',
  'AC-FR-26': 'Tras confirmar el lote queda vacío',
  'AC-FR-27': 'Movimientos nuevos de libros pertenecen a UNA sola rendición (origin único)',
  'AC-FR-28': 'Libros: propietario recibe 40 % de la base y chofer 40 % de la base',
  'AC-FR-29':
    'Códigos de libro: chofer CASH_COMMISSION + CASH_PAYMENT_COMM (efectivo) o CHECKING_ACCOUNT_COMM (CC); propietario TDDV',
  'AC-FR-30':
    'Columnas TRAVELSSURRENDER del baseline: DRIVER_ID, comisiones 40/40/20, agencia 20 % sin fila de libro',
  'AC-FR-31': 'Saldos de libros: balanceDelta = suma de las filas nuevas',
  'AC-FR-32': 'Aislamiento: CASHCOLLECTOR esperado y lote pendiente del vehículo = handoff',
  'AC-FR-33':
    'Disparo V2 (edición del propietario → PUT travelsSurrender) = 200 `true`, sin requests abortados por el firewall',
  'AC-FR-34': 'Una sola rendición automática con exactamente los viajes cerrados del lote',
  'AC-FR-35': 'Cabecera: DRIVER_ID NULL; VEHICLE_ID, VEHICLEOWNERID y CARRIER_ID poblados',
  'AC-FR-36':
    'Comisión de la fila: propietario 40 % / agencia 20 % sobre la base (surrenderRowOracle)',
  'AC-FR-37': 'Libro propietario: TDCV (efectivo) y TDDC (CC) según fórmula',
  'AC-FR-38': 'Libro del chofer sin filas de la rendición',
  'AC-FR-39':
    'El vehículo sigue vinculado (DRIVER_VEHICLES, VEHICLEOWNERID) y queda sin pendientes',
  'AC-FR-40': 'Flag CASHCOLLECTOR revertido a Company (0) tras disarm',
  'AC-FR-41':
    'Guarda de cron: armar exige > 20 min a las 13:10 UTC y viajes sin cerrar no entran al lote',
  'AC-FR-42':
    'Observación PO H-AUTO-01: comisión del chofer 40 % no se acredita; propietario sin TDDV, solo TDCV 20 %',
  'AC-FR-43':
    'Observación PO H-AUTO-03: AGENCY_NETPAID = 0 en automáticas vs = TOTAL_COLLECTED en manuales',
  'AC-FR-44': 'Observación PO H-AUTO-05: SETTLEMENT_OWNER difiere entre automáticas (1 vs 0)',
  'AC-FR-45':
    'Observación PO: texto del modal «pending settlements» vs acción real (rendición sin desvincular)',
  'AC-FR-46': 'El alta CC no genera movimientos del viaje (el débito se genera al cerrar)',
  'AC-FR-47': 'Al cerrar la CC tiene exactamente UN cobro TIVR del viaje (sin duplicados)',
  'AC-FR-48': 'Débito del cobro = precio final y crédito = 0',
  'AC-FR-49': 'Saldo de la CC del cliente varía exactamente el débito (signo API ≠ DB)',
  'AC-FR-50': 'El cobro de CC por cierre de app es AUTOMATIC y no se duplica al rendir',
  'AC-FR-51': 'Un viaje en efectivo no genera movimientos en la CC del cliente',
  'AC-FR-52': 'Viaje rendido y NO liquidado: la edición de precios se acepta (PUT 2xx)',
  'AC-FR-53': 'Una edición no aceptada nunca es silenciosa (la UI muestra mensaje)',
  'AC-FR-54':
    'El campo editado cambia exactamente el delta pedido; el final sube/baja lo editado (+ colaterales registrados)',
  'AC-FR-55':
    'Base comisionable c = difTarifa + difEspera + difOtroComisionable; peaje, estacionamiento y NOCOM no entran',
  'AC-FR-56':
    'Columnas TRAVELSSURRENDER con el delta esperado (efectivo/CC, comisiones 0,4/0,4/0,2, a rendir, SURRENDERDIFFERENCE)',
  'AC-FR-57':
    'Libros: filas de ajuste nuevas (TCEA/TCES, TDEA/TDES, «(NC)» para peaje/estacionamiento), cantidad y monto',
  'AC-FR-58':
    'CC: el movimiento TIVR se reescribe en el lugar (uno solo, MOUNT +total), sin duplicados',
  'AC-FR-59': 'El lote pendiente sigue vacío tras editar',
  'AC-FR-60': 'La edición no duplica filas de rendición ya existentes en los libros',
  'AC-FR-61': 'Costo final = venta final tras la edición (no Universal)',
  'AC-FR-62':
    'Viaje liquidado: PUT updateFinalPrices = 409 TRAVEL_LIQUIDATED (o alerta UI previa sin PUT); ningún importe cambia',
  'AC-FR-63':
    'UI detalle: badge «Read only» en DONE y botón «Editar precios» visible con permiso TMG.1',
  'AC-FR-64': 'Observación PO Q1: al editar tarifa el PCT «QA City Taxes» no se recalcula',
  'AC-FR-65':
    'Observación PO Q2/Q3/Q4/Q6/Q7: NOCOM, distancia, peaje/estacionamiento, impuestos y efectivo+rendición automática',
  'AC-FR-66': 'Pendientes del chofer: ids de rendiciones API = DB',
  'AC-FR-67': 'comNeta por rendición (chofer) = fórmula del oráculo',
  'AC-FR-68':
    'Total a crear = Σ comNeta; columna «A liquidar» = fórmula propia (sin peajes/estacionamiento)',
  'AC-FR-69':
    'Propietario: pendientes API = DB; total y columna = oráculo (comisión sin chofer incluida)',
  'AC-FR-70': 'UI: filas = oráculo, total sin tildar = 0, total tildado = oráculo',
  'AC-FR-71':
    'Crear liquidación: existe en DB, total = fórmula, rendición queda en liquidación PAID (STATUS=1) y SETTLEMENT_DRIVER/OWNER = 1',
  'AC-FR-72': 'La liquidación no modifica los libros (filas, saldos ni STATUS)',
  'AC-FR-73': 'Detalle del viaje liquidado: liquidationDriver/liquidationOwner según corresponda',
  'AC-FR-74': 'La alerta de edición nombra chofer y/o propietario según corresponda',
  'AC-FR-75': 'Las rendiciones liquidadas salen de pendientes (no se puede liquidar dos veces)',
  'AC-FR-76':
    'Observación PO: el BE no recalcula el total (lo envía el FE) y TRAVEL.ISLIQUIDATED no cambia al liquidar',
  'AC-FR-77': 'R1 Trip List: filas = DB (importe, estado, método de pago)',
  'AC-FR-78': 'R1 Trip List: totales por método de pago = DB',
  'AC-FR-79': 'R2 Closed surrenders: filas = TRAVELSSURRENDER y comisiones 40/40/20',
  'AC-FR-80': 'R2 Closed surrenders: totales de pantalla = DB',
  'AC-FR-81': 'R3 CC: saldos de cliente, chofer y propietario = DB; continuidad de libros',
  'AC-FR-82': 'R4 Aging: CSV = grilla = totales 067T; saldo vs libro del propietario a confirmar',
  'AC-FR-83': 'R5 Company commissions = comisión de agencia de las rendiciones del rango',
  'AC-FR-84': 'R6 Cash flow (016) y Taxes & Fees (094) responden 200',
  'AC-FR-85': 'R7 Payment Movements vacío solo si la DB no tiene pagos/liquidaciones',
  'AC-FR-86': 'R8 Individual CA travels: viajes CC del cliente = DB',
  'AC-FR-87': 'R9 Settlements: saldos de chofer, propietario y pasajero = DB',
  'AC-FR-88': 'Descargas: PDF con cabecera %PDF y tamaño válido; contenido del PDF validado',
  'AC-FR-89': 'R5/R8 re-validados tras refresh de mviews (VM_HeatMap, VM_TRAVEL_HISTORY)',
  'AC-FR-90':
    'KI: THOUSANDS_SEPARATOR=SPACE en FR → 500 en la confirmación tras el commit y PDF de rendición de 0 bytes',
  'AC-FR-91':
    'KI: PDF de detalle de CC (cliente/chofer/propietario) y «Download Last Settlement» devuelven HTTP 500',
  'AC-FR-92':
    'KI: Cash flow y Taxes & Fees → 400 BAD_FILTER_NAME «CURRENCY_ID» (el front no lo envía)',
  'AC-FR-93': 'KI: PDF Trip List imprime minutos «10» y miles partidos en dos renglones',
  'AC-FR-94':
    'KI: Closed surrenders omite las rendiciones automáticas (DRIVER_ID NULL, p. ej. 13861)',
  'AC-FR-95':
    'KI: App Driver 2.6.17 conserva la oferta de un viaje cancelado asignado a mano (Firebase huérfano)',
  'AC-FR-96':
    'KI: par de movimientos residual 11.312.004 (viaje 71533) en libros de propietario y chofer'
  /* AC-REGISTRY:END */
} as const satisfies Record<`AC-FR-${string}`, string>;

export type AcId = keyof typeof AC;
export type AcStatus = 'PASS' | 'FAIL';
/** Evidencia opcional: lo que devuelve el cuerpo de verifyAc se adjunta como JSON. */
export type AcEvidence = Record<string, unknown>;
export type StepRunner = <T>(title: string, body: () => Promise<T>) => Promise<T>;

const defaultStepRunner: StepRunner = (title, body) => test.step(title, body);

export function acLabel(id: AcId): string {
  return `${id}: ${AC[id]}`;
}

export function acAnnotation(id: AcId, status: AcStatus): { type: string; description: string } {
  return { type: 'ac', description: `${id} ${status}` };
}

export function noteAnnotation(
  type: 'known-issue' | 'observation',
  id: AcId,
  note: string
): { type: string; description: string } {
  return { type, description: `${id} ${AC[id]}: ${note}` };
}

/**
 * Ejecuta `fn` dentro de `test.step('AC-FR-NN: titulo')`, anota `ac: AC-FR-NN PASS|FAIL` y adjunta la
 * evidencia (`ac-AC-FR-NN`). Si `fn` lanza se relanza tras anotar; los errores `expect.soft` acumulados
 * durante `fn` tambien marcan FAIL (el step no lanza en ese caso).
 */
export async function verifyAc<T extends AcEvidence | void>(
  testInfo: TestInfo,
  id: AcId,
  fn: () => Promise<T> | T,
  runStep: StepRunner = defaultStepRunner
): Promise<T | undefined> {
  const softBefore = testInfo.errors.length;
  let evidence: T | undefined;
  let failure: unknown;
  try {
    await runStep(acLabel(id), async () => {
      evidence = await fn();
    });
  } catch (error) {
    failure = error;
  }
  const failed = failure !== undefined || testInfo.errors.length > softBefore;
  const status: AcStatus = failed ? 'FAIL' : 'PASS';
  testInfo.annotations.push(acAnnotation(id, status));
  await testInfo.attach(`ac-${id}`, {
    body: JSON.stringify(
      {
        id,
        title: AC[id],
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

/** Defecto conocido de TEST: se tolera y se anota (nunca pasa en silencio). */
export function knownIssue(testInfo: TestInfo, id: AcId, note: string): void {
  testInfo.annotations.push(noteAnnotation('known-issue', id, note));
}

/** Pregunta abierta al PO: se registra lo observado y no se asevera. */
export function observation(testInfo: TestInfo, id: AcId, note: string): void {
  testInfo.annotations.push(noteAnnotation('observation', id, note));
}
