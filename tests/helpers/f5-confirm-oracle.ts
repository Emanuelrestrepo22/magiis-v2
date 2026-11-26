// tests/helpers/f5-confirm-oracle.ts
// Oraculo PURO de la CONFIRMACION irreversible de la rendicion F5 (MG-1024 BE + MG-1027 FE): lote a consumir,
// comisiones por actor (calculo independiente), body del POST, columnas de TRAVELSSURRENDER, libro del
// propietario (TDDV / TDCF / TDDG / sin TDOC), conteo de POST y filas ancladas de los PDFs. Sin Playwright ni
// DB. Fuente: oraculos manuales 14185-14188 (TM-1655/1656/1657/1660, `.session/regression-testing/
// 2026-11-05-f5-rendicion-liquidacion/evidence/ar-1040/`) y SELECT en DB TEST del 06/11/2026.
import { expectedCommissions } from './db-oracle-eval.js';
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';
import {
  expectedSurrenderPost,
  type F5CommissionInputs,
  type F5Expected,
  type F5ExpectedPost,
  type F5OwnerBookRow
} from './f5-surrender-oracle.js';
import { textContainsAmount } from './report-parse.js';

export { formatMismatches };

const cents = (n: number): number => Math.round(n * 100) / 100;
const near = (a: number, b: number): boolean => Math.round(a * 100) === Math.round(b * 100);
const verdict = (mismatches: Mismatch[]): OracleVerdict => ({
  ok: mismatches.length === 0,
  mismatches
});

// ───────────────────────────── Lote a consumir ─────────────────────────────

/** `F5_CONFIRM_TRIPS=72154,72155` -> ids. Una confirmacion es irreversible: el lote se declara, no se infiere. */
export function parseConfirmTrips(raw: string | undefined): number[] {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number);
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(
      `[F5 confirm] F5_CONFIRM_TRIPS invalido o vacio ("${raw ?? ''}"): declarar los ids de viaje a rendir (csv)`
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`[F5 confirm] F5_CONFIRM_TRIPS con ids repetidos: ${ids.join(', ')}`);
  }
  return ids.sort((a, b) => a - b);
}

/** Pendientes reales del par == lote declarado: cualquier viaje ajeno (o faltante) bloquea la confirmacion. */
export function evaluatePendingSet(
  actual: readonly number[],
  declared: readonly number[]
): OracleVerdict {
  const a = new Set(actual);
  const d = new Set(declared);
  const foreign = [...a].filter((id) => !d.has(id)).sort((x, y) => x - y);
  const missing = [...d].filter((id) => !a.has(id)).sort((x, y) => x - y);
  const m: Mismatch[] = [];
  if (foreign.length > 0) {
    m.push({
      field: 'viajes pendientes AJENOS al lote declarado',
      expected: 'ninguno',
      actual: foreign
    });
  }
  if (missing.length > 0) {
    m.push({
      field: 'viajes del lote declarado que no estan pendientes',
      expected: 'todos pendientes',
      actual: missing
    });
  }
  return verdict(m);
}

// ───────────────────────────── Esperado de la confirmacion ─────────────────────────────

export type F5ConfirmPostInput = {
  cashToSurrender: number;
  driverCommission: number;
  fuelVoucher?: number;
  miscellanyVoucher?: number;
  /** Importe tecleado en «Entregar»; ausente = precarga (todo lo adeudado). */
  deliver?: number;
};

/**
 * Body esperado del POST con las acciones del operador (R03 entrega parcial, R04 gastos varios, R06 saldo del
 * chofer). Con saldo de la empresa (neto >= 0): `surrendered` = efectivo a rendir y `agencyNetPaid` = lo ENTREGADO
 * (precarga = neto; parcial = lo tecleado, p. ej. 47.250 / 28.350). Con saldo del chofer no hay «Entregar»: el body
 * sale del oraculo base. Una entrega mayor al neto es el caso Q9 (regla no definida): no es contrato y lanza.
 */
export function expectedConfirmPost(input: F5ConfirmPostInput): F5ExpectedPost {
  const base = expectedSurrenderPost({
    cashToSurrender: input.cashToSurrender,
    driverCommission: input.driverCommission,
    fuelVoucher: input.fuelVoucher ?? 0,
    miscellanyVoucher: input.miscellanyVoucher ?? 0
  });
  if (input.deliver === undefined || base.agencyNetPaid === 0) return base;
  const deliver = cents(input.deliver);
  if (!(deliver > 0) || deliver > base.agencyNetPaid) {
    throw new Error(
      `[F5 confirm] entrega ${deliver} fuera de (0, ${base.agencyNetPaid}]: 0 o mayor a lo adeudado es el caso Q9, no contrato`
    );
  }
  return { ...base, agencyNetPaid: deliver };
}

export type F5ConfirmInput = {
  expected: F5Expected;
  /** pct de cada actor (TRAVEL.*_COMMISSION_PCT) y fija por dia (regla del dia ya cubierto). */
  inputs: F5CommissionInputs;
  /** Costo financiero del propietario (GET: ownerCheckingAccountFinancialCost + ownerCreditCardFinancialCost). */
  ownerFinancialCost: number;
  /** Importes tipeados en la pantalla (0 si no se tocaron). */
  fuelVoucher?: number;
  miscellanyVoucher?: number;
  /** Entrega parcial tecleada en «Entregar» (R03): reemplaza a `agencyNetPaid` si el saldo es de la empresa. */
  deliver?: number;
};

export type F5ConfirmExpected = {
  commissions: ReturnType<typeof expectedCommissions>;
  post: F5ExpectedPost;
  ownerBook: { tddv: number; tdcf: number; tddg: number };
};

/**
 * Todo lo que la confirmacion debe producir, calculado SIN leer el resultado: comisiones = pct x base sin NC
 * (+ fija), body del POST segun el lado del saldo, libro del propietario:
 *  - TDDV (debito) = comision del propietario - costo financiero (14185: 1.843,60 - 88 = 1.755,60).
 *  - TDCF (credito) = fija de AGENCIA del dia (14186: 122); sin fija, sin fila.
 *  - TDDG (credito) = gasto varios del propietario (14187: 100); sin gasto, sin fila.
 *  - TDOC nunca en rendicion manual (lo juzga `evaluateOwnerTdoc`).
 * La fija del PROPIETARIO > 0 no tiene oraculo validado: lanza en lugar de adivinar el asiento.
 */
export function expectedConfirmation(input: F5ConfirmInput): F5ConfirmExpected {
  if (input.inputs.ownerFixed > 0) {
    throw new Error(
      '[F5 confirm] comision fija del PROPIETARIO > 0: no hay oraculo validado de su asiento en el libro (no se asevera a ciegas)'
    );
  }
  const bases = {
    cash: input.expected.totalCash.amount,
    checkingAccount: input.expected.totalCheckingAccount.amount,
    creditCard: input.expected.totalCreditCard.amount
  };
  const commissions = expectedCommissions({
    cashBase: bases.cash,
    checkingAccountBase: bases.checkingAccount,
    creditCardBase: bases.creditCard,
    pctOwner: input.inputs.pctOwner,
    pctAgency: input.inputs.pctAgency,
    pctDriver: input.inputs.pctDriver,
    ownerFixed: input.inputs.ownerFixed,
    agencyFixed: input.inputs.agencyFixed
  });
  const misc = input.miscellanyVoucher ?? 0;
  const post = expectedConfirmPost({
    cashToSurrender: input.expected.cashToSurrender,
    driverCommission: commissions.COMMISSIONSUM as number,
    fuelVoucher: input.fuelVoucher ?? 0,
    miscellanyVoucher: misc,
    deliver: input.deliver
  });
  return {
    commissions,
    post,
    ownerBook: {
      tddv: cents((commissions.OWNER_TOTALCOMMISSION as number) - input.ownerFinancialCost),
      tdcf: input.inputs.agencyFixed,
      tddg: misc
    }
  };
}

/** Mismo esperado con la entrega parcial ya conocida (lo adeudado es el `agencyNetPaid` de la precarga). */
export function withDeliver(want: F5ConfirmExpected, deliver: number): F5ConfirmExpected {
  const due = want.post.agencyNetPaid;
  const d = cents(deliver);
  if (due === 0 || !(d > 0) || d > due) {
    throw new Error(
      `[F5 confirm] entrega ${d} fuera de (0, ${due}]: sin saldo de la empresa, 0 o mayor a lo adeudado (Q9) no es contrato`
    );
  }
  return { ...want, post: { ...want.post, agencyNetPaid: d } };
}

// ───────────────────────────── TRAVELSSURRENDER ─────────────────────────────

export const F5_CONFIRM_COLUMNS = [
  'SURRENDERED',
  'AGENCY_NETPAID',
  'NETPAID',
  'OWNER_NETPAID',
  'COMMISSIONSUM',
  'OWNER_TOTALCOMMISSION',
  'AGENCY_TOTALCOMMISSION',
  'AGENCY_FIXED_COMM',
  'OWNER_FIXED_COMM',
  'MISCELLANYAMOUNT'
] as const;
export type F5ConfirmColumn = (typeof F5_CONFIRM_COLUMNS)[number];
export type F5ConfirmRow = Record<F5ConfirmColumn, number | null>;

/** Fila de TRAVELSSURRENDER contra el esperado, al centavo. NULL falla (las columnas existen y valen 0). */
export function evaluateConfirmRow(row: F5ConfirmRow, want: F5ConfirmExpected): OracleVerdict {
  const c = want.commissions;
  const wants: Record<F5ConfirmColumn, number> = {
    SURRENDERED: want.post.surrendered,
    AGENCY_NETPAID: want.post.agencyNetPaid,
    NETPAID: want.post.netPaid,
    OWNER_NETPAID: want.post.ownerNetPaid,
    COMMISSIONSUM: c.COMMISSIONSUM as number,
    OWNER_TOTALCOMMISSION: c.OWNER_TOTALCOMMISSION as number,
    AGENCY_TOTALCOMMISSION: c.AGENCY_TOTALCOMMISSION as number,
    AGENCY_FIXED_COMM: want.ownerBook.tdcf,
    OWNER_FIXED_COMM: 0,
    MISCELLANYAMOUNT: want.post.miscellanyVoucher
  };
  const m: Mismatch[] = [];
  for (const col of F5_CONFIRM_COLUMNS) {
    const got = row[col];
    if (got === null || !near(got, wants[col])) {
      m.push({ field: `TRAVELSSURRENDER.${col}`, expected: wants[col], actual: got });
    }
  }
  return verdict(m);
}

// ───────────────────────────── Libro del propietario ─────────────────────────────

/**
 * TDDV (debito neto), TDCF y TDDG (credito neto) del libro de ESTA rendicion contra el esperado. Un importe
 * esperado 0 exige ausencia de filas con importe. Los codigos que el oraculo no conoce (otros que TDDV/TDCF/
 * TDDG/TDOC) no se aseveran: se devuelven en `otherCodes` para la evidencia. TDOC lo juzga `evaluateOwnerTdoc`.
 */
export function evaluateOwnerBook(
  rows: readonly F5OwnerBookRow[],
  want: F5ConfirmExpected['ownerBook']
): OracleVerdict & { otherCodes: string[] } {
  const net = (code: string, side: 'debit' | 'credit'): number =>
    cents(
      rows
        .filter((r) => r.CHECKINGACCOUNTCODE === code)
        .reduce(
          (s, r) =>
            s +
            (side === 'debit'
              ? (r.DEBIT ?? 0) - (r.CREDIT ?? 0)
              : (r.CREDIT ?? 0) - (r.DEBIT ?? 0)),
          0
        )
    );
  const m: Mismatch[] = [];
  const checks: Array<[string, 'debit' | 'credit', number]> = [
    ['TDDV', 'debit', want.tddv],
    ['TDCF', 'credit', want.tdcf],
    ['TDDG', 'credit', want.tddg]
  ];
  for (const [code, side, w] of checks) {
    const got = net(code, side);
    if (!near(got, w)) {
      m.push({
        field: `libro propietario ${code} (${side === 'debit' ? 'debito' : 'credito'} neto)`,
        expected: w,
        actual: got
      });
    }
  }
  const known = new Set(['TDDV', 'TDCF', 'TDDG', 'TDOC']);
  const otherCodes = [
    ...new Set(rows.map((r) => r.CHECKINGACCOUNTCODE ?? 'NULL').filter((c) => !known.has(c)))
  ];
  return { ...verdict(m), otherCodes };
}

// ───────────────────────────── POST unico ─────────────────────────────

/** Cantidad de POST toTravelsSurrender intentados desde la pantalla: exactamente 1 (doble envio = FAIL). */
export function evaluatePostAttempts(attempts: number): OracleVerdict {
  return verdict(
    attempts === 1
      ? []
      : [{ field: 'POST toTravelsSurrender intentados', expected: 1, actual: attempts }]
  );
}

// ───────────────────────────── Filas ancladas de los PDFs ─────────────────────────────

export type AnchoredRow = { field: string; label: RegExp; amount: number };

/**
 * Cada fila: el rotulo debe existir y su importe estar en el MISMO renglon (a la derecha del rotulo); si ese
 * renglon no trae ningun digito (corte de celda de pdftotext) se miran los 2 siguientes. Nunca en todo el
 * documento (falsos positivos con fechas/cantidades). Algun renglon con el rotulo que cumpla basta.
 */
export function evaluateAnchoredRows(text: string, rows: readonly AnchoredRow[]): OracleVerdict {
  const lines = text.split(/\r?\n/);
  const m: Mismatch[] = [];
  for (const row of rows) {
    const idx = lines.flatMap((l, i) => (row.label.test(l) ? [i] : []));
    if (idx.length === 0) {
      m.push({ field: `${row.field}: rotulo`, expected: 'presente', actual: 'ausente' });
      continue;
    }
    const ok = idx.some((i) => {
      const rest = lines[i].replace(row.label, ' ');
      const window = /\d/.test(rest)
        ? rest
        : lines
            .slice(i, i + 3)
            .join('\n')
            .replace(row.label, ' ');
      return textContainsAmount(window, row.amount);
    });
    if (!ok) {
      m.push({
        field: `${row.field}: importe en el renglon del rotulo`,
        expected: row.amount,
        actual: 'ausente'
      });
    }
  }
  return verdict(m);
}

/** Filas del Clearing (es-AR observado en 14185/14186/14188; rotulos en ingles). Cantidad 0 = sin fila. */
export function clearingRows(expected: F5Expected, post: F5ExpectedPost): AnchoredRow[] {
  const rows: AnchoredRow[] = [];
  if (expected.totalCash.quantity > 0) {
    rows.push({
      field: 'Clearing Cash Trips',
      label: /^\s*Cash Trips\b/i,
      amount: expected.totalCash.amount
    });
  }
  if (expected.totalCheckingAccount.quantity > 0) {
    rows.push({
      field: 'Clearing Credit Account',
      label: /^\s*Credit Account\b/i,
      amount: expected.totalCheckingAccount.amount
    });
  }
  if (expected.taxesCash > 0) {
    rows.push({ field: 'Clearing Taxes', label: /^\s*Taxes\b/i, amount: expected.taxesCash });
  }
  rows.push({ field: 'Clearing TOTAL', label: /^\s*TOTAL\b/, amount: expected.totalCollected });
  if (post.agencyNetPaid > 0) {
    rows.push({
      field: 'Clearing Payment to Company',
      label: /Payment to Company/i,
      amount: post.agencyNetPaid
    });
  }
  return rows;
}

/** Filas del Reporte Chofer (en-US observado en 14185). */
export function driverReportRows(expected: F5Expected): AnchoredRow[] {
  const rows: AnchoredRow[] = [
    {
      field: 'Reporte Chofer Total Cash',
      label: /^\s*Total Cash\b/i,
      amount: expected.cashToSurrender
    }
  ];
  if (expected.totalCash.quantity > 0) {
    rows.push({
      field: 'Reporte Chofer Cash Trips',
      label: /^\s*Cash Trips\b/i,
      amount: expected.totalCash.amount
    });
  }
  if (expected.ncCash.amount > 0) {
    rows.push({
      field: 'Reporte Chofer Other Costs No Commissionable',
      label: /Other Costs? No Commissionable/i,
      amount: expected.ncCash.amount
    });
  }
  if (expected.taxesCash > 0) {
    rows.push({ field: 'Reporte Chofer Taxes', label: /^\s*Taxes\b/i, amount: expected.taxesCash });
  }
  return rows;
}

// ───────────────────────────── R05 / R06 / saldo previo al clic ─────────────────────────────

/** Texto con `NaN` / `Infinity` / `undefined` / `null` como importe (R05: tarifa 0 no debe romper ninguna superficie). */
export function evaluateNoNaN(surface: string, text: string): OracleVerdict {
  const bad = /\b(NaN|-?Infinity|undefined)\b/.exec(text);
  return verdict(
    bad
      ? [
          {
            field: `${surface}: valor no numerico visible`,
            expected: 'importes numericos',
            actual: bad[0]
          }
        ]
      : []
  );
}

/** R05: con tarifa 0 las comisiones del GET son 0 (sin base no hay comision) y ninguna es NaN. */
export function evaluateZeroFareCommissions(get: Record<string, unknown>): OracleVerdict {
  const m: Mismatch[] = [];
  for (const key of ['commissionSum', 'agencyTotalCommission', 'ownerTotalCommission']) {
    const v = get[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || !near(v, 0)) {
      m.push({ field: `GET ${key} con tarifa 0`, expected: 0, actual: v ?? 'ausente' });
    }
  }
  return verdict(m);
}

export type DueState = { kind: 'Company' | 'Driver' | null; amount: number | null };

/**
 * Estado previo al clic en Confirm: quien recibe el saldo y cuanto, contra el calculo independiente
 * (`base` = monto a entregar de la tarjeta ya con gastos; `delivered` = lo tecleado en «Entregar», 0 si no hay
 * «Entregar» porque el saldo es del chofer). `kind` esperado null = no se asevera quien recibe (saldo 0).
 */
export function evaluateDueBeforeConfirm(
  actual: DueState,
  want: { kind: 'Company' | 'Driver'; amount: number }
): OracleVerdict {
  const m: Mismatch[] = [];
  if (want.amount !== 0 && actual.kind !== want.kind) {
    m.push({
      field: 'saldo: a quien corresponde',
      expected: want.kind,
      actual: actual.kind ?? 'ausente'
    });
  }
  if (actual.amount === null || !near(actual.amount, want.amount)) {
    m.push({ field: 'saldo: importe', expected: want.amount, actual: actual.amount ?? 'ausente' });
  }
  return verdict(m);
}

/** Observacion Q2 (abierta con el PO): fila NC del Clearing con NC efectivo = 0. null = nada que anotar. */
export function clearingNcObservation(text: string, ncCash: number): string | null {
  if (ncCash !== 0) return null;
  const line = text.split(/\r?\n/).find((l) => /Other Cost NO Commission/i.test(l));
  return `AC-F5-11 Q2: NC efectivo = 0; fila NC del Clearing ${line === undefined ? 'ausente' : `presente: «${line.trim()}»`}`;
}
