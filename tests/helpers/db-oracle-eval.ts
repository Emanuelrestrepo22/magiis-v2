// tests/helpers/db-oracle-eval.ts
// Evaluacion PURA (sin DB, sin Playwright) de las reglas de negocio de la pata DB del circuito carrier
// no-Universal: pares costo = venta, formula de comision, 1 MOVEMENT por viaje CC. Las consultas viven
// en tests/steps/trips/dbOracles.steps.ts (solo leen y devuelven datos); la decision pass/fail la
// ejecuta el spec: estas funciones NO lanzan; devuelven `ok` + `mismatches` (columna, esperado,
// obtenido) y el spec asevera con `formatMismatches`.
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';

export { formatMismatches, type Mismatch, type OracleVerdict };

const TOLERANCE = 0.01;
const cents = (n: number): number => Math.round(n * 100) / 100;
const asNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const zero = (v: number | null | undefined): number => v ?? 0;

/** Registra la diferencia (columna y tabla) cuando `actual` difiere de `expected` mas de la tolerancia. */
function checkNear(
  failures: Mismatch[],
  column: string,
  actual: number | null,
  expected: number | null
): void {
  if (actual === null || expected === null || Math.abs(actual - expected) > TOLERANCE) {
    failures.push({ field: column, expected, actual });
  }
}

// ───────────────────────── saleCostDbOracle ─────────────────────────

export type SaleCostRow = {
  SRC: 'TRAVEL' | 'TRAVEL_HISTORY';
  ADDITIONAL_ID: number | null;
  FINALPRICE: number | null;
  FINAL_COST_PRICE: number | null;
  TOTALCOSTPARTIAL: number | null;
  TOTALCOSTPARTIAL_COST: number | null;
  KM: number | null;
  WAITTIMEPRICE: number | null;
  WAIT_TOTAL_PRICE_COST: number | null;
  OTHERCOST: number | null;
  OTHER_COST_TOTAL_PRICE_COST: number | null;
  OTHER_COST_TOTAL_NOCOM: number | null;
  OTHER_COST_PRICE_COST_NOCOM: number | null;
  TOOLPRICE: number | null;
  PARKING: number | null;
  FIX_CONCEPT_COST: number | null;
  TAXES_COST: number | null;
};

export type OtherCostItemRow = {
  ID: number;
  NAME: string;
  PRICE: number | null;
  PRICE_COST: number | null;
  IS_COMMISIONABLE: number | null;
};

export type SaleCostResult = OracleVerdict & {
  travelId: number;
  source: SaleCostRow['SRC'];
  /** Valores observados y no juzgados (alcance fuera de la igualdad). */
  notes: string[];
};

/**
 * Evaluacion pura de las reglas de pares (tarifador de venta, no por costo):
 *  1. Ninguna columna de costo es NULL (FINAL_COST_PRICE, TOTALCOSTPARTIAL_COST,
 *     WAIT_TOTAL_PRICE_COST, OTHER_COST_TOTAL_PRICE_COST).
 *  2. TOTALCOSTPARTIAL = TOTALCOSTPARTIAL_COST.  3. WAITTIMEPRICE = WAIT_TOTAL_PRICE_COST.
 *  4. Otros costos comisionables: cada item PRICE = PRICE_COST y la suma de PRICE_COST de los
 *     comisionables (IS_COMMISIONABLE NULL cuenta como 1) = OTHER_COST_TOTAL_PRICE_COST.
 *  5. FINAL_COST_PRICE = TOTALCOSTPARTIAL_COST + WAIT_TOTAL_PRICE_COST + OTHER_COST_TOTAL_PRICE_COST
 *     (+-0,01); NO es copia de la venta porque esta arrastra peaje/estacionamiento. Solo cuando no hay
 *     peaje, estacionamiento, no comisionables, conceptos fijos ni impuestos se exige ademas
 *     FINALPRICE = FINAL_COST_PRICE; si no, se anota en `notes`.
 */
export function evaluateSaleCostPairs(
  travelId: number,
  row: SaleCostRow,
  items: readonly OtherCostItemRow[]
): SaleCostResult {
  const failures: Mismatch[] = [];
  const costColumns: Array<[string, number | null]> = [
    ['FINALPRICEI.FINAL_COST_PRICE', row.FINAL_COST_PRICE],
    ['FINALPRICEI.TOTALCOSTPARTIAL_COST', row.TOTALCOSTPARTIAL_COST],
    ['PRICEADDITIONAL.WAIT_TOTAL_PRICE_COST', row.WAIT_TOTAL_PRICE_COST],
    ['PRICEADDITIONAL.OTHER_COST_TOTAL_PRICE_COST', row.OTHER_COST_TOTAL_PRICE_COST]
  ];
  for (const [name, value] of costColumns) {
    if (value === null) {
      failures.push({
        field: name,
        expected: 'no NULL (el costo no puede quedar sin valor)',
        actual: null
      });
    }
  }

  checkNear(
    failures,
    'FINALPRICEI.TOTALCOSTPARTIAL vs TOTALCOSTPARTIAL_COST',
    row.TOTALCOSTPARTIAL,
    row.TOTALCOSTPARTIAL_COST
  );
  checkNear(
    failures,
    'PRICEADDITIONAL.WAITTIMEPRICE vs WAIT_TOTAL_PRICE_COST',
    zero(row.WAITTIMEPRICE),
    row.WAIT_TOTAL_PRICE_COST
  );

  const commissionable = items.filter((i) => i.IS_COMMISIONABLE !== 0);
  for (const item of items) {
    checkNear(
      failures,
      `TRAVEL_OTHERCOST[${item.ID}] PRICE vs PRICE_COST`,
      asNum(item.PRICE),
      asNum(item.PRICE_COST)
    );
  }
  checkNear(
    failures,
    'PRICEADDITIONAL.OTHER_COST_TOTAL_PRICE_COST vs suma PRICE_COST comisionables',
    row.OTHER_COST_TOTAL_PRICE_COST,
    cents(commissionable.reduce((s, i) => s + zero(asNum(i.PRICE_COST)), 0))
  );

  checkNear(
    failures,
    'FINALPRICEI.FINAL_COST_PRICE vs TOTALCOSTPARTIAL_COST + WAIT_TOTAL_PRICE_COST + OTHER_COST_TOTAL_PRICE_COST',
    row.FINAL_COST_PRICE,
    cents(
      zero(row.TOTALCOSTPARTIAL_COST) +
        zero(row.WAIT_TOTAL_PRICE_COST) +
        zero(row.OTHER_COST_TOTAL_PRICE_COST)
    )
  );

  const notes: string[] = [];
  const passThrough =
    zero(row.TOOLPRICE) +
    zero(row.PARKING) +
    zero(row.OTHER_COST_TOTAL_NOCOM) +
    zero(row.FIX_CONCEPT_COST) +
    zero(row.TAXES_COST);
  if (passThrough === 0) {
    checkNear(
      failures,
      'FINALPRICEI.FINALPRICE vs FINAL_COST_PRICE',
      row.FINALPRICE,
      row.FINAL_COST_PRICE
    );
  } else {
    notes.push(
      `FINALPRICE ${row.FINALPRICE ?? 'NULL'} vs FINAL_COST_PRICE ${row.FINAL_COST_PRICE ?? 'NULL'} no se compara: ` +
        `hay peaje/estacionamiento/no comisionables/fijos/impuestos (suma ${cents(passThrough)}).`
    );
  }
  notes.push(
    `NOCOM (null≡0, Q3 abierta): venta ${row.OTHER_COST_TOTAL_NOCOM ?? 'NULL'} / costo ${row.OTHER_COST_PRICE_COST_NOCOM ?? 'NULL'}`
  );

  return { ok: failures.length === 0, mismatches: failures, travelId, source: row.SRC, notes };
}

// ───────────────────────── surrenderRowOracle ─────────────────────────

/** Las 8 columnas gate de TRAVELSSURRENDER (plan CA-CRIT-01 c). */
export const SURRENDER_GATE_COLUMNS = [
  'CASHCOMMISSION',
  'CHECKINGACCOUNTCOMMISSION',
  'CREDITCARDCOMMISSION',
  'COMMISSIONSUM',
  'OWNER_TOTALCOMMISSION',
  'AGENCY_TOTALCOMMISSION',
  'TOTALOTHERCOST',
  'TOTALOTHERCOST_NOCOM'
] as const;

/** Controles adicionales del plan (totales por medio de pago, billing, neto). */
export const SURRENDER_CONTROL_COLUMNS = [
  'TOTALCASH',
  'TOTALCASHQTY',
  'TOTALCHECKINGACCOUNT',
  'TOTALCHECKACCQTY',
  'TOTALCREDITCARD',
  'TOTALCREDCARDQTY',
  'TOTALBILLING',
  'OWNER_FIXED_COMM',
  'TOTAL_COLLECTED',
  'NETPAID'
] as const;

export type SurrenderColumn =
  | (typeof SURRENDER_GATE_COLUMNS)[number]
  | (typeof SURRENDER_CONTROL_COLUMNS)[number];
export type SurrenderRow = Record<SurrenderColumn, number | null>;
export type SurrenderExpected = Partial<Record<SurrenderColumn, number | null>>;

export const SURRENDER_COLUMNS: readonly SurrenderColumn[] = [
  ...SURRENDER_GATE_COLUMNS,
  ...SURRENDER_CONTROL_COLUMNS
];

/** Columnas donde NULL equivale a 0 (Q3 declarada: el baseline de _NOCOM puede venir NULL). */
const NULL_AS_ZERO = new Set<SurrenderColumn>(['TOTALOTHERCOST_NOCOM']);

/**
 * Comisiones esperadas segun la formula verificada 56/56 en el baseline 2001: base por medio de pago
 * = Σ(FINALPRICE − peaje − estacionamiento); comision propietario = pctOwner · base; agencia =
 * pctAgency · (efectivo + cuenta corriente) (sin casos de tarjeta en la historia: no verificado para
 * agencia). Los porcentajes salen de TRAVEL.*_COMMISSION_PCT, NO de COMMISSIONSETTINGS.
 */
export function expectedCommissions(input: {
  cashBase: number;
  checkingAccountBase: number;
  creditCardBase: number;
  pctOwner: number;
  pctAgency: number;
}): Pick<
  SurrenderRow,
  | 'CASHCOMMISSION'
  | 'CHECKINGACCOUNTCOMMISSION'
  | 'CREDITCARDCOMMISSION'
  | 'COMMISSIONSUM'
  | 'OWNER_TOTALCOMMISSION'
  | 'AGENCY_TOTALCOMMISSION'
> {
  const cash = cents(input.pctOwner * input.cashBase);
  const checking = cents(input.pctOwner * input.checkingAccountBase);
  const card = cents(input.pctOwner * input.creditCardBase);
  const total = cents(cash + checking + card);
  return {
    CASHCOMMISSION: cash,
    CHECKINGACCOUNTCOMMISSION: checking,
    CREDITCARDCOMMISSION: card,
    COMMISSIONSUM: total,
    OWNER_TOTALCOMMISSION: total,
    AGENCY_TOTALCOMMISSION: cents(input.pctAgency * (input.cashBase + input.checkingAccountBase))
  };
}

/** Compara solo las columnas presentes en `expected`; una distinta falla nombrandola. */
export function evaluateSurrenderRow(
  row: SurrenderRow,
  expected: SurrenderExpected
): OracleVerdict {
  const failures: Mismatch[] = [];
  for (const [column, want] of Object.entries(expected) as Array<
    [SurrenderColumn, number | null]
  >) {
    const got = row[column];
    const zeroed = NULL_AS_ZERO.has(column);
    checkNear(
      failures,
      `TRAVELSSURRENDER.${column}`,
      zeroed ? zero(got) : got,
      zeroed ? zero(want) : want
    );
  }
  return { ok: failures.length === 0, mismatches: failures };
}

export type MovementRow = {
  ID: number;
  TRAVEL_ID: number | null;
  MOVEMENT_CODE: string | null;
  MOVEMENT_TYPE: string | null;
  MOUNT: number | null;
  CURRENCY_ID: number | null;
  MOVEMENTSTATUS: number | null;
  CREATIONDATE: Date | string | null;
};

/** Codigos del movimiento principal del viaje CC; TITX/TETX (impuestos) y TIPP quedan fuera. */
export const TRIP_MOVEMENT_CODES = ['TIVR', 'TEVR'] as const;

/**
 * Exige exactamente 1 movimiento AUTOMATIC (TIVR/TEVR) por viaje esperado, con `MOUNT` = importe de
 * venta del viaje; ningun viaje ajeno, sin duplicados (reintento). `CURRENCY_ID` NULL es el estado
 * preexistente (Q8) y no se juzga. Devuelve el movimiento de cada viaje.
 */
export type MovementVerdict = OracleVerdict & { found: Map<number, MovementRow> };

export function evaluateOneMovementPerTravel(
  rows: readonly MovementRow[],
  expected: ReadonlyArray<{ travelId: number; amount: number }>
): MovementVerdict {
  const failures: Mismatch[] = [];
  const main = rows.filter(
    (r) =>
      r.MOVEMENT_TYPE === 'AUTOMATIC' &&
      (TRIP_MOVEMENT_CODES as readonly string[]).includes(r.MOVEMENT_CODE ?? '')
  );
  const wanted = new Set(expected.map((e) => e.travelId));
  const found = new Map<number, MovementRow>();

  for (const { travelId, amount } of expected) {
    const own = main.filter((r) => r.TRAVEL_ID === travelId);
    if (own.length !== 1) {
      failures.push({
        field: `MOVEMENT del viaje ${travelId} (filas TIVR/TEVR AUTOMATIC)`,
        expected: 1,
        actual: own.length
      });
      continue;
    }
    const movement = own[0] as MovementRow;
    checkNear(failures, `MOVEMENT.MOUNT (viaje ${travelId})`, asNum(movement.MOUNT), amount);
    found.set(travelId, movement);
  }
  for (const r of main) {
    if (r.TRAVEL_ID === null || !wanted.has(r.TRAVEL_ID)) {
      failures.push({
        field: `MOVEMENT ${r.ID}: viaje ajeno en la CC desde el instante de referencia`,
        expected: 'ningun viaje fuera del lote',
        actual: r.TRAVEL_ID
      });
    }
  }
  return { ok: failures.length === 0, mismatches: failures, found };
}
