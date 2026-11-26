// tests/helpers/f5-surrender-oracle.ts
// Oraculo puro de la rendicion del chofer con otros costos NO comisionables (Universal F5: MG-1024 BE +
// MG-1027 FE). Sin Playwright ni DB: recibe hechos y devuelve veredictos (`OracleVerdict`), el spec decide.
//
// Reglas F5 (oraculo manual 2026-11-05, FR 1901 rendicion 14181 y AR 1040 lote A):
// - totalCash / totalCheckingAccount del GET YA NO incluyen el no comisionable (NC):
//   totalCash = suma(final - peaje - estacionamiento - NC) de los viajes en efectivo.
// - totalCashOtherCostNoCommissionable {amount, quantity} = suma NC de viajes en EFECTIVO (el NC de un viaje
//   en CC no suma al efectivo ni se muestra en pantalla).
// - efectivo a rendir = totalCash + NC efectivo + impuestos/cargos fijos efectivo.
// - total recaudado en pantalla = totalCash + CC + tarjeta + NC efectivo + impuestos/cargos fijos efectivo.
// - la base de comision de cada actor excluye el NC (comision = pct × totalCash/CC, nunca sobre el NC).
import { parseMoney } from '../utils/money.js';
import { expectedCommissions } from './db-oracle-eval.js';
import { textContainsAmount } from './report-parse.js';
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';

const cents = (n: number): number => Math.round(n * 100) / 100;
/** Igualdad exacta al centavo: se comparan los centavos redondeados como enteros (sin tolerancia). */
const near = (a: number, b: number): boolean => Math.round(a * 100) === Math.round(b * 100);
const verdict = (mismatches: Mismatch[]): OracleVerdict => ({
  ok: mismatches.length === 0,
  mismatches
});

export { formatMismatches };

export type F5Money = { amount: number; quantity: number };
export type F5PaymentKind = 'cash' | 'checkingAccount' | 'creditCard';

/** Hechos de un viaje del lote (DB: FINALPRICEI/PRICEADDITIONAL; medio de pago: GET toSurrend). */
export type F5TripFacts = {
  travelId: number;
  /** `paymentMethod` crudo del lote (`CASH`, `CHECKING_ACCOUNT`, `CREDIT_CARD`). */
  paymentMethod: string;
  finalPrice: number;
  toll: number;
  parking: number;
  /** PRICEADDITIONAL.OTHER_COST_TOTAL_NOCOM (NULL = 0). */
  noCom: number;
  /** PRICEADDITIONAL.TAXES_COST (impuestos/cargos fijos; NULL = 0). */
  taxes: number;
  /** TRAVEL.FINAL_COST_PRICE (costo final). Solo lo usa `checkingAccountProfitDiff` (H-02); ausente = desconocido. */
  costPrice?: number | null;
  /**
   * true si la cuenta corriente de este viaje se liquida POR COSTO (no por venta). Lo declara quien arma los
   * hechos (target/perfil); `undefined`/false = por venta (comportamiento histórico, regla validada en TEST).
   */
  ccByCost?: boolean;
};

export function paymentKind(paymentMethod: string): F5PaymentKind {
  const p = paymentMethod.toUpperCase();
  if (p.includes('CHECKING')) return 'checkingAccount';
  if (p.includes('CARD')) return 'creditCard';
  if (p.includes('CASH')) return 'cash';
  throw new Error(`[f5-oracle] medio de pago desconocido: ${paymentMethod}`);
}

export type F5Expected = {
  totalCash: F5Money;
  totalCheckingAccount: F5Money;
  totalCreditCard: F5Money;
  /** NC de viajes en efectivo (cantidad = viajes en efectivo con NC > 0). */
  ncCash: F5Money;
  /**
   * NC de viajes en CUENTA CORRIENTE (cantidad = viajes CC con NC > 0). Regla validada en DB (rendiciones
   * 14181-14188, 06/11): TRAVELSSURRENDER.TOTALOTHERCOST_NOCOM / TOTALOTHERCOSTQTY_NOCOM y
   * CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF (GET `checkingAccountAgencyProfitDiff`) = este importe. No se
   * muestra en pantalla (Q10). El NC de viajes en tarjeta no tiene dato en DB (0 en todas): no se asevera.
   */
  ncCheckingAccount: F5Money;
  /** Impuestos/cargos fijos de viajes en efectivo. */
  taxesCash: number;
  /** totalCash + CC + tarjeta (sin NC): lo que informa el GET como totalBilling. */
  totalBilling: number;
  /** Total recaudado en pantalla (incluye NC efectivo e impuestos efectivo). */
  totalCollected: number;
  /** Efectivo a rendir = totalCash + NC efectivo + impuestos efectivo. */
  cashToSurrender: number;
  /**
   * H-02: esperado de `checkingAccountAgencyProfitDiff` (GET) / CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF (DB). NO es
   * siempre el NC: con CC por venta = suma NC de viajes CC; con CC por costo = venta − costo (R02 US 71563:
   * 57,9 vs NC 4). `amount === null` = indeterminado (CC por costo sin costo conocido): no se asevera el valor.
   * Ausente (esperado derivado del GET, sin hechos por viaje) = se usa el NC, como antes.
   */
  checkingAccountProfitDiff?: { amount: number | null; basis: F5CcBasis };
  /** H-04: definición de TOTALCASH con la que se calculó el esperado. */
  totalCashDefinition?: F5TotalCashDefinition;
  /** Observaciones de reglas aún no definidas que aplican a este lote (no son PASS/FAIL). */
  observations?: string[];
};

/** Base de liquidación de la CC de un lote: por venta, por costo, mezcla o desconocida. */
export type F5CcBasis = 'none' | 'sale' | 'cost' | 'mixed' | 'indeterminate';

/**
 * H-04: definición de TOTALCASH. `excludeTollParking` (F5, medido en 14181-14188: final − peaje − estac. − NC) vs
 * `includeTollParking` (rendición automática FR: final − NC; la base de comisión sí los resta). Sin medición con
 * peaje > 0 (D-6) la regla está abierta: el valor por defecto es el histórico de F5.
 */
export type F5TotalCashDefinition = 'excludeTollParking' | 'includeTollParking';

/**
 * Observación de la regla abierta H-04 (TOTALCASH con peaje/estacionamiento): texto si algún viaje EN EFECTIVO
 * trae peaje o estacionamiento > 0, `null` si no aplica. Nunca es PASS/FAIL: se anota como `observation`.
 */
export function totalCashOpenQuestion(trips: readonly F5TripFacts[]): string | null {
  const withExtras = trips.filter(
    (t) => paymentKind(t.paymentMethod) === 'cash' && (t.toll > 0 || t.parking > 0)
  );
  if (withExtras.length === 0) return null;
  const ids = withExtras.map((t) => t.travelId).join(', ');
  return (
    `H-04 regla abierta (D-6): viajes en efectivo con peaje/estacionamiento > 0 (${ids}). TOTALCASH puede ` +
    'excluirlos (definición F5 medida: final − peaje − estacionamiento − NC) o incluirlos (rendición automática ' +
    'FR: final − NC). Sin medición real no se juzga; se registra con qué definición coincide el sistema.'
  );
}

/** Qué definición de TOTALCASH sigue el GET (`totalCash.amount`) para el lote; `ninguna` si no coincide con ninguna. */
export function matchedTotalCashDefinition(
  get: F5GetTotals,
  trips: readonly F5TripFacts[]
): F5TotalCashDefinition | 'ninguna' {
  const raw = get.totalCash;
  const amount =
    typeof raw === 'object' && raw !== null ? (raw as { amount?: unknown }).amount : undefined;
  if (typeof amount !== 'number') return 'ninguna';
  for (const def of ['excludeTollParking', 'includeTollParking'] as const) {
    if (near(amount, expectedF5(trips, { totalCashDefinition: def }).totalCash.amount)) return def;
  }
  return 'ninguna';
}

/**
 * H-02: importe esperado de `checkingAccountAgencyProfitDiff` / CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF.
 * `amount === null` = indeterminado (no se asevera). Sin `checkingAccountProfitDiff` en el esperado (derivado
 * del GET) cae al NC de viajes CC, como antes.
 */
export function expectedCcProfitDiff(expected: F5Expected): {
  amount: number | null;
  basis: F5CcBasis;
} {
  return (
    expected.checkingAccountProfitDiff ?? {
      amount: expected.ncCheckingAccount.amount,
      basis: 'sale'
    }
  );
}

/** Esperado F5 del lote a partir de los hechos de cada viaje. Lanza con un lote vacio. */
export function expectedF5(
  trips: readonly F5TripFacts[],
  options: { totalCashDefinition?: F5TotalCashDefinition } = {}
): F5Expected {
  if (trips.length === 0) throw new Error('[f5-oracle] expectedF5 sin viajes');
  const definition = options.totalCashDefinition ?? 'excludeTollParking';
  let ccSale = 0;
  let ccCost = 0;
  let ccCostUnknown = false;
  let ccSaleTrips = 0;
  let ccCostTrips = 0;
  const acc = {
    cash: { amount: 0, quantity: 0 },
    checkingAccount: { amount: 0, quantity: 0 },
    creditCard: { amount: 0, quantity: 0 },
    nc: { amount: 0, quantity: 0 },
    ncCc: { amount: 0, quantity: 0 },
    taxesCash: 0
  };
  for (const t of trips) {
    const kind = paymentKind(t.paymentMethod);
    const tollParking = definition === 'excludeTollParking' ? t.toll + t.parking : 0;
    const base = cents(t.finalPrice - tollParking - t.noCom);
    acc[kind].amount = cents(acc[kind].amount + base);
    acc[kind].quantity += 1;
    if (kind === 'checkingAccount' && t.noCom > 0) {
      acc.ncCc.amount = cents(acc.ncCc.amount + t.noCom);
      acc.ncCc.quantity += 1;
    }
    if (kind === 'checkingAccount') {
      if (t.ccByCost === true) {
        ccCostTrips += 1;
        if (typeof t.costPrice === 'number') ccCost = cents(ccCost + (t.finalPrice - t.costPrice));
        else ccCostUnknown = true;
      } else {
        ccSaleTrips += 1;
        ccSale = cents(ccSale + t.noCom);
      }
    }
    if (kind === 'cash') {
      acc.taxesCash = cents(acc.taxesCash + t.taxes);
      if (t.noCom > 0) {
        acc.nc.amount = cents(acc.nc.amount + t.noCom);
        acc.nc.quantity += 1;
      }
    }
  }
  const totalBilling = cents(acc.cash.amount + acc.checkingAccount.amount + acc.creditCard.amount);
  const ccBasis: F5CcBasis =
    ccSaleTrips + ccCostTrips === 0
      ? 'none'
      : ccCostUnknown
        ? 'indeterminate'
        : ccCostTrips === 0
          ? 'sale'
          : ccSaleTrips === 0
            ? 'cost'
            : 'mixed';
  const open = totalCashOpenQuestion(trips);
  return {
    totalCash: acc.cash,
    totalCheckingAccount: acc.checkingAccount,
    totalCreditCard: acc.creditCard,
    ncCash: acc.nc,
    ncCheckingAccount: acc.ncCc,
    taxesCash: acc.taxesCash,
    totalBilling,
    totalCollected: cents(totalBilling + acc.nc.amount + acc.taxesCash),
    cashToSurrender: cents(acc.cash.amount + acc.nc.amount + acc.taxesCash),
    checkingAccountProfitDiff: {
      amount: ccBasis === 'indeterminate' ? null : cents(ccSale + ccCost),
      basis: ccBasis
    },
    totalCashDefinition: definition,
    ...(open !== null ? { observations: [open] } : {})
  };
}

/** Base de comision en efectivo/CC: el NC queda fuera (comision = pct × base). */
export function commissionBases(expected: F5Expected): {
  cash: number;
  checkingAccount: number;
  creditCard: number;
} {
  return {
    cash: expected.totalCash.amount,
    checkingAccount: expected.totalCheckingAccount.amount,
    creditCard: expected.totalCreditCard.amount
  };
}

/** Porcentajes (fracciones, TRAVEL.*_COMMISSION_PCT) y fija ya ajustada por dias (ver `fixedCommissionDays`). */
export type F5CommissionInputs = {
  pctOwner: number;
  pctDriver: number;
  pctAgency: number;
  ownerFixed: number;
  agencyFixed: number;
};

/**
 * B3: comisiones del GET contra el calculo INDEPENDIENTE pct × base sin NC (la base sale de `expected`,
 * derivado de DB). Si el GET calculara la comision sobre una base con NC, esto falla aunque la UI repita
 * el mismo error. Igualdad al centavo.
 */
export function evaluateCommissionsAgainstGet(
  get: F5GetTotals,
  expected: F5Expected,
  inputs: F5CommissionInputs
): OracleVerdict {
  const m: Mismatch[] = [];
  const bases = commissionBases(expected);
  const want = expectedCommissions({
    cashBase: bases.cash,
    checkingAccountBase: bases.checkingAccount,
    creditCardBase: bases.creditCard,
    pctOwner: inputs.pctOwner,
    pctAgency: inputs.pctAgency,
    pctDriver: inputs.pctDriver,
    ownerFixed: inputs.ownerFixed,
    agencyFixed: inputs.agencyFixed
  });
  const pairs: Array<[string, number]> = [
    ['commissionSum', want.COMMISSIONSUM as number],
    ['ownerTotalCommission', want.OWNER_TOTALCOMMISSION as number],
    ['agencyTotalCommission', want.AGENCY_TOTALCOMMISSION as number]
  ];
  for (const [key, w] of pairs) {
    const got = get[key];
    if (typeof got !== 'number') {
      m.push({ field: `GET ${key}`, expected: w, actual: got ?? 'ausente' });
    } else if (!near(got, w)) {
      m.push({
        field: `GET ${key} vs pct × base sin NC (base efectivo ${bases.cash}, CC ${bases.checkingAccount})`,
        expected: w,
        actual: got
      });
    }
  }
  return verdict(m);
}

// ───────────────────────────── Formato de importes por locale ─────────────────────────────

export type F5MoneyFormat = {
  thousands: '.' | ',' | 'none';
  decimal: ',' | '.';
};

/** AR es-AR `1.645,00` · US `1,645.00` · FR 1901 sin miles y con coma `3015,80`. */
export const F5_FORMATS = {
  AR: { thousands: '.', decimal: ',' },
  US: { thousands: ',', decimal: '.' },
  FR: { thousands: 'none', decimal: ',' }
} as const satisfies Record<string, F5MoneyFormat>;

const escChar = (c: string): string => `\\${c}`;

/** Parte numerica de un importe de pantalla (sin simbolo ni signo; un espacio INTERNO invalida el formato). */
function numericPart(raw: string): string | null {
  const m = /\d[\d.,\s  ]*\d|\d/.exec(raw);
  return m ? m[0] : null;
}

/** true si el importe crudo respeta EXACTAMENTE el formato del locale (siempre 2 decimales). */
export function matchesMoneyFormat(raw: string, fmt: F5MoneyFormat): boolean {
  const body = numericPart(raw);
  if (body === null) return false;
  const dec = escChar(fmt.decimal);
  const re =
    fmt.thousands === 'none'
      ? new RegExp(`^\\d+${dec}\\d{2}$`)
      : new RegExp(`^\\d{1,3}(?:${escChar(fmt.thousands)}\\d{3})*${dec}\\d{2}$`);
  return re.test(body);
}

/** Diferencias de formato de las cadenas crudas de pantalla; ausente = falla (no se omite en silencio). */
export function evaluateUiFormats(
  raw: Partial<Record<keyof F5UiReading, string>>,
  fmt: F5MoneyFormat,
  required: ReadonlyArray<keyof F5UiReading>
): OracleVerdict {
  const m: Mismatch[] = [];
  for (const key of required) {
    const v = raw[key];
    if (v === undefined) {
      m.push({ field: `formato UI ${key}`, expected: 'importe presente', actual: 'ausente' });
    } else if (!matchesMoneyFormat(v, fmt)) {
      m.push({
        field: `formato UI ${key}`,
        expected: `miles «${fmt.thousands}» decimal «${fmt.decimal}»`,
        actual: v
      });
    }
  }
  return verdict(m);
}

// ───────────────────────────── «Entregar» ─────────────────────────────

/**
 * Saldo esperado al entregar `amount` sobre la base `total` del saldo (`parseDeliverBase().base`, NO «Total Cash»):
 * quien recibe y cuanto.
 */
export function expectedDeliverBalance(
  total: number,
  amount: number
): { kind: 'Company' | 'Driver'; balance: number } {
  const diff = cents(total - amount);
  return diff >= 0 ? { kind: 'Company', balance: diff } : { kind: 'Driver', balance: cents(-diff) };
}

/** Lectura de la tarjeta de balance de la pantalla de rendicion (importes ya con signo de formula aplicado). */
export type DeliverBalanceBase = {
  totalCash: number;
  deductions: number;
  commissions: number;
  financialCosts: number;
  /** Importe «Amount due to <Company|Driver>» mostrado (sin signo) y a quien corresponde. */
  dueKind: 'Company' | 'Driver' | null;
  dueAmount: number | null;
  /** Base real del saldo: totalCash − deducciones − comisiones&propinas + costos financieros. */
  base: number;
};

/**
 * Lee de la tarjeta de balance los importes de la formula del saldo. Los marcadores «(-)», «(+)» y «( 0.00%)»
 * que preceden al importe se descartan (un «-» de marcador no es un importe negativo). Devuelve null si falta
 * algun renglon: nunca adivina. La base NO es «Total Cash»: en 1521 la comision del chofer baja la base
 * (22,35 − 6,82 = 15,53) y solo en 1040 coincide porque esa comision es 0.
 */
export function parseDeliverBase(cardText: string): DeliverBalanceBase | null {
  const t = cardText.replace(/\s+/g, ' ');
  const grab = (label: string): number | null => {
    const m = new RegExp(
      String.raw`${label}:\s*(?:\([-+]\)\s*)?(?:\(\s*[\d.,]+\s*%\)\s*)?([^\s\d]{0,3}\s*\d[\d.,]*)`
    ).exec(t);
    return m ? parseMoney(m[1]) : null;
  };
  const totalCash = grab('Total Cash');
  const deductions = grab('Deductions & Expenses');
  const commissions = grab('Commissions & Tips');
  const financialCosts = grab('Financial Costs');
  if (
    totalCash === null ||
    deductions === null ||
    commissions === null ||
    financialCosts === null
  ) {
    return null;
  }
  const due = /Amount due to:\s*(Company|Driver):\s*([^\s\d]{0,3}\s*\d[\d.,]*)/.exec(t);
  return {
    totalCash,
    deductions,
    commissions,
    financialCosts,
    dueKind: due ? (due[1] as 'Company' | 'Driver') : null,
    dueAmount: due ? parseMoney(due[2]) : null,
    base: cents(totalCash - deductions - commissions + financialCosts)
  };
}

/**
 * Contrato HP-01 (FE 5693400f, MG-9/MG-996): el campo frena el 3.er decimal, descarta `-` y letras.
 * `dec` = separador decimal del locale. Escribir y pegar dan el mismo resultado.
 */
export function deliverContractCases(
  dec: ',' | '.'
): Array<{ raw: string; shown: string; confirmDisabled: boolean; amount: number | null }> {
  return [
    { raw: `1234${dec}567`, shown: `1234${dec}56`, confirmDisabled: false, amount: 1234.56 },
    { raw: '-10', shown: '10', confirmDisabled: false, amount: 10 },
    { raw: 'abc', shown: '', confirmDisabled: true, amount: null }
  ];
}

// ───────────────────────────── Body del POST de confirmacion ─────────────────────────────

export type F5ExpectedPost = {
  surrendered: number;
  netPaid: number;
  agencyNetPaid: number;
  ownerNetPaid: number;
  fuelVoucher: number;
  miscellanyVoucher: number;
};

/**
 * Body esperado de `toTravelsSurrender` (14181/14183/14184/14185): neto = efectivo a rendir − comision del
 * chofer − vouchers. neto ≥ 0 → `surrendered` = efectivo a rendir y `agencyNetPaid` = neto; neto < 0 (saldo
 * a favor del chofer) → `surrendered` 0, `netPaid` = −neto y `agencyNetPaid` 0.
 */
export function expectedSurrenderPost(input: {
  cashToSurrender: number;
  driverCommission: number;
  fuelVoucher?: number;
  miscellanyVoucher?: number;
}): F5ExpectedPost {
  const fuel = input.fuelVoucher ?? 0;
  const misc = input.miscellanyVoucher ?? 0;
  const net = cents(input.cashToSurrender - input.driverCommission - fuel - misc);
  return net >= 0
    ? {
        surrendered: input.cashToSurrender,
        netPaid: 0,
        agencyNetPaid: net,
        ownerNetPaid: 0,
        fuelVoucher: fuel,
        miscellanyVoucher: misc
      }
    : {
        surrendered: 0,
        netPaid: cents(-net),
        agencyNetPaid: 0,
        ownerNetPaid: 0,
        fuelVoucher: fuel,
        miscellanyVoucher: misc
      };
}

export function evaluateSurrenderPost(
  body: Record<string, unknown> | null,
  want: F5ExpectedPost
): OracleVerdict {
  if (body === null) {
    return verdict([{ field: 'body del POST', expected: 'JSON', actual: 'ausente' }]);
  }
  const m: Mismatch[] = [];
  const amountOf = (v: unknown): unknown =>
    typeof v === 'object' && v !== null ? (v as { amount?: unknown }).amount : v;
  const fields: Array<[string, unknown, number]> = [
    ['surrendered', body.surrendered, want.surrendered],
    ['netPaid', body.netPaid, want.netPaid],
    ['agencyNetPaid', body.agencyNetPaid, want.agencyNetPaid],
    ['ownerNetPaid', body.ownerNetPaid, want.ownerNetPaid],
    ['fuelVoucher.amount', amountOf(body.fuelVoucher), want.fuelVoucher],
    ['miscellanyVoucher.amount', amountOf(body.miscellanyVoucher), want.miscellanyVoucher]
  ];
  for (const [key, got, w] of fields) {
    if (typeof got !== 'number' || !near(got, w)) {
      m.push({ field: `POST ${key}`, expected: w, actual: got ?? 'ausente' });
    }
  }
  return verdict(m);
}

// ───────────────────────────── GET toTravelsSurrender ─────────────────────────────

export type F5GetTotals = Record<string, unknown>;

function moneyField(get: F5GetTotals, key: string, m: Mismatch[]): F5Money | null {
  const v = get[key];
  if (typeof v !== 'object' || v === null) {
    m.push({ field: `GET ${key}`, expected: '{amount, quantity}', actual: v ?? 'ausente' });
    return null;
  }
  const { amount, quantity } = v as { amount?: unknown; quantity?: unknown };
  if (typeof amount !== 'number' || typeof quantity !== 'number') {
    m.push({ field: `GET ${key}`, expected: '{amount:number, quantity:number}', actual: v });
    return null;
  }
  return { amount, quantity };
}

/** Lee `totalCashOtherCostNoCommissionable` (campo nuevo F5); falla si no esta o no tiene la forma. */
export function readNcField(get: F5GetTotals): { field: F5Money | null; verdict: OracleVerdict } {
  const m: Mismatch[] = [];
  const field = moneyField(get, 'totalCashOtherCostNoCommissionable', m);
  return { field, verdict: verdict(m) };
}

/** Impuestos/cargos fijos de efectivo del GET (`taxesCostCash` + `fixConceptCostCash`); ausente = 0. */
export function getTaxesCash(get: F5GetTotals): number {
  const n = (k: string): number => (typeof get[k] === 'number' ? (get[k] as number) : 0);
  return cents(n('taxesCostCash') + n('fixConceptCostCash'));
}

/** GET contra el esperado derivado de DB: totales por medio de pago sin NC y NC efectivo {amount, quantity}. */
export function evaluateGetAgainstExpected(get: F5GetTotals, expected: F5Expected): OracleVerdict {
  const m: Mismatch[] = [];
  const pairs: Array<[string, F5Money]> = [
    ['totalCash', expected.totalCash],
    ['totalCheckingAccount', expected.totalCheckingAccount],
    ['totalCreditCard', expected.totalCreditCard],
    ['totalCashOtherCostNoCommissionable', expected.ncCash]
  ];
  for (const [key, want] of pairs) {
    const got = moneyField(get, key, m);
    if (!got) continue;
    if (!near(got.amount, want.amount)) {
      m.push({ field: `GET ${key}.amount`, expected: want.amount, actual: got.amount });
    }
    if (got.quantity !== want.quantity) {
      m.push({ field: `GET ${key}.quantity`, expected: want.quantity, actual: got.quantity });
    }
  }
  const taxes = getTaxesCash(get);
  if (!near(taxes, expected.taxesCash)) {
    m.push({
      field: 'GET taxesCostCash + fixConceptCostCash',
      expected: expected.taxesCash,
      actual: taxes
    });
  }
  return verdict(m);
}

/**
 * AC-F5-16 (GET): `checkingAccountAgencyProfitDiff` presente y numérico (no se asume 0) y igual al esperado
 * de `expectedCcProfitDiff` (H-02): NC de viajes CC si la CC va por venta; venta − costo si va por costo.
 * Con base indeterminada (CC por costo sin costo conocido) solo se exige presencia numérica.
 */
export function evaluateGetCcNc(get: F5GetTotals, expected: F5Expected): OracleVerdict {
  const raw = get.checkingAccountAgencyProfitDiff;
  const want = expectedCcProfitDiff(expected);
  if (typeof raw !== 'number') {
    return verdict([
      {
        field: 'GET checkingAccountAgencyProfitDiff',
        expected: want.amount ?? 'número (base indeterminada)',
        actual: raw ?? 'ausente'
      }
    ]);
  }
  if (want.amount === null || near(raw, want.amount)) return verdict([]);
  return verdict([
    {
      field: `GET checkingAccountAgencyProfitDiff (CC por ${want.basis === 'sale' ? 'venta = NC de viajes CC' : want.basis === 'cost' ? 'costo = venta − costo' : want.basis})`,
      expected: want.amount,
      actual: raw
    }
  ]);
}

// ───────────────────────────── Pantalla de confirmacion ─────────────────────────────

export type F5UiReading = {
  /** Linea «Other Costs No Commissionable (Cash Trips)»; null = ausente. */
  ncLine: number | null;
  /** Linea «Taxes and Fees (Cash Trips)»; null = ausente. */
  taxesLine: number | null;
  /** «Total Cash» del balance (efectivo a rendir). */
  totalCash: number | null;
  /** «Total Amount Collected». */
  totalCollected: number | null;
  /** «Cash Trips» del detalle de recaudado. */
  cashTrips: number | null;
  /** «Credit Account Trips». */
  checkingAccountTrips: number | null;
  driverCommissions: number | null;
  companyCommissions: number | null;
  ownerCommissions: number | null;
};

const LABELS: Record<keyof F5UiReading, RegExp> = {
  ncLine:
    /^(other costs? no commissionables?\b.*cash|otros costos? no comisionables?\b.*efectivo)/i,
  taxesLine: /^(taxes and fees\b.*cash|impuestos y cargos\b.*efectivo)/i,
  totalCash: /^(total cash:?|total efectivo:?)$/i,
  totalCollected: /^(total amount collected|total recaudado)$/i,
  cashTrips: /^(cash trips|viajes en efectivo)$/i,
  checkingAccountTrips: /^(credit account trips|viajes en cuenta corriente)$/i,
  driverCommissions: /^(total driver commissions|total comisiones? (del )?chofer)$/i,
  companyCommissions: /^(total company commissions|total comisiones? (de la )?compa[ñn][ií]a)$/i,
  ownerCommissions: /^(total owner commissions|total comisiones? (del )?propietario)$/i
};

const MONEY_LINE = /^[-\u2212]?\s*[^\d\s-]{0,4}\s*[-\u2212]?\s*\d[\d\s.,]*\d?\s*[^\d\s]{0,4}$/;

function moneyOrNull(line: string): number | null {
  const t = line.trim();
  if (t === '' || /^#\s*\d+$/.test(t) || !MONEY_LINE.test(t)) return null;
  try {
    return parseMoney(t.replace(/(\d)\s+(?=\d)/g, '$1'));
  } catch {
    return null;
  }
}

/**
 * Lee los renglones de la pantalla (texto de la pagina, una linea por elemento). El importe de una
 * etiqueta es la primera linea con forma de importe en las 3 lineas siguientes (se saltea «# N» de
 * cantidad). Nunca adivina: sin etiqueta = null.
 */
export function parseF5Ui(lines: readonly string[]): F5UiReading {
  return scanF5Ui(lines).values;
}

/** Cadenas CRUDAS de los importes de pantalla (para aseverar el formato por locale). */
export function parseF5UiRaw(lines: readonly string[]): Partial<Record<keyof F5UiReading, string>> {
  return scanF5Ui(lines).raw;
}

function scanF5Ui(lines: readonly string[]): {
  values: F5UiReading;
  raw: Partial<Record<keyof F5UiReading, string>>;
} {
  const out = Object.fromEntries(Object.keys(LABELS).map((k) => [k, null])) as F5UiReading;
  const raw: Partial<Record<keyof F5UiReading, string>> = {};
  // El innerText del portal separa etiqueta / cantidad / importe con tabuladores dentro de un renglon:
  // cada celda se trata como una linea.
  const trimmed = lines
    .flatMap((l) => l.split('\t'))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
  (Object.keys(LABELS) as Array<keyof F5UiReading>).forEach((key) => {
    const idx = trimmed.findIndex((l) => LABELS[key].test(l.replace(/:\s*$/, '')));
    if (idx < 0) return;
    for (let j = idx + 1; j <= Math.min(idx + 3, trimmed.length - 1); j += 1) {
      const v = moneyOrNull(trimmed[j]);
      if (v !== null) {
        out[key] = v;
        raw[key] = trimmed[j];
        return;
      }
      // Otra etiqueta: el renglon de este rotulo no trae importe (no se toma el de la fila siguiente).
      if (!/^#\s*\d+$/.test(trimmed[j])) return;
    }
  });
  return { values: out, raw };
}

/**
 * UI contra GET: la linea NC aparece sii NC > 0 y vale lo del GET; «Total Cash» = efectivo + NC +
 * impuestos efectivo; «Total Amount Collected» = efectivo + CC + tarjeta + NC + impuestos efectivo.
 */
export function evaluateUiAgainstGet(ui: F5UiReading, get: F5GetTotals): OracleVerdict {
  const m: Mismatch[] = [];
  const nc = readNcField(get);
  m.push(...nc.verdict.mismatches);
  const ncAmount = nc.field?.amount ?? 0;
  if (ncAmount > 0) {
    if (ui.ncLine === null) {
      m.push({ field: 'UI linea NC (efectivo)', expected: ncAmount, actual: 'ausente' });
    } else if (!near(ui.ncLine, ncAmount)) {
      m.push({ field: 'UI linea NC (efectivo)', expected: ncAmount, actual: ui.ncLine });
    }
  } else if (ui.ncLine !== null) {
    // Con NC = 0 la linea se OCULTA (14184, TM-1664): ni «0,00» es valido en pantalla.
    m.push({ field: 'UI linea NC con NC = 0', expected: 'ausente', actual: ui.ncLine });
  }
  const cash = (get.totalCash as F5Money | undefined)?.amount;
  const cc = (get.totalCheckingAccount as F5Money | undefined)?.amount ?? 0;
  const card = (get.totalCreditCard as F5Money | undefined)?.amount ?? 0;
  const taxes = getTaxesCash(get);
  if (typeof cash !== 'number') {
    m.push({ field: 'GET totalCash', expected: '{amount}', actual: get.totalCash ?? 'ausente' });
  } else {
    const wantCash = cents(cash + ncAmount + taxes);
    if (ui.totalCash === null || !near(ui.totalCash, wantCash)) {
      m.push({
        field: 'UI Total Cash (efectivo a rendir = totalCash + NC + impuestos efectivo)',
        expected: wantCash,
        actual: ui.totalCash
      });
    }
    const wantCollected = cents(cash + cc + card + ncAmount + taxes);
    if (ui.totalCollected === null || !near(ui.totalCollected, wantCollected)) {
      m.push({
        field: 'UI Total Amount Collected (incluye NC efectivo)',
        expected: wantCollected,
        actual: ui.totalCollected
      });
    }
    if (ui.cashTrips !== null && !near(ui.cashTrips, cash)) {
      m.push({ field: 'UI Cash Trips (sin NC)', expected: cash, actual: ui.cashTrips });
    }
  }
  if (ui.checkingAccountTrips !== null && !near(ui.checkingAccountTrips, cc)) {
    m.push({
      field: 'UI Credit Account Trips (sin NC)',
      expected: cc,
      actual: ui.checkingAccountTrips
    });
  }
  if (taxes > 0) {
    if (ui.taxesLine === null || !near(ui.taxesLine, taxes)) {
      m.push({
        field: 'UI Taxes and Fees (Cash Trips)',
        expected: taxes,
        actual: ui.taxesLine ?? 'ausente'
      });
    }
  }
  const commissions: Array<[keyof F5UiReading, string]> = [
    ['driverCommissions', 'commissionSum'],
    ['companyCommissions', 'agencyTotalCommission'],
    ['ownerCommissions', 'ownerTotalCommission']
  ];
  const num = (k: string): number => (typeof get[k] === 'number' ? (get[k] as number) : 0);
  // Con costo financiero del propietario (1040: ownerCheckingAccountFinancialCost 88) la pantalla muestra
  // «Total Owner Commissions» NETO de ese costo (1.755,60 = 1.843,60 - 88; ar-1040-execution §3). Sin
  // costo financiero (FR 1901) el neto es igual al GET.
  const ownerFinancialCost =
    num('ownerCheckingAccountFinancialCost') + num('ownerCreditCardFinancialCost');
  for (const [uiKey, getKey] of commissions) {
    const raw = get[getKey];
    const got = ui[uiKey];
    if (typeof raw !== 'number') {
      m.push({ field: `GET ${getKey}`, expected: 'number', actual: raw ?? 'ausente' });
      continue;
    }
    if (got === null) {
      // Unica ausencia tolerada: la comision del CHOFER cuando el GET la informa en 0 (la pantalla de 1040,
      // chofer 0 %, no dibuja «Total Driver Commissions»). Cualquier otra ausencia es FALLO (B2).
      if (uiKey === 'driverCommissions' && raw === 0) continue;
      m.push({ field: `UI ${uiKey} vs GET ${getKey}`, expected: raw, actual: 'ausente' });
      continue;
    }
    const want = uiKey === 'ownerCommissions' ? cents(raw - ownerFinancialCost) : raw;
    if (!near(got, want)) {
      m.push({ field: `UI ${uiKey} vs GET ${getKey}`, expected: want, actual: got });
    }
  }
  return verdict(m);
}

// ───────────────────────────── TRAVELSSURRENDER (DB) ─────────────────────────────

/** Columnas F5 de TRAVELSSURRENDER (nuevas + las que cambian de significado). */
export const F5_SURRENDER_COLUMNS = [
  'TOTALCASH',
  'TOTALCASHOTHERCOST_NOCOM',
  'TOTALCASHOTHERCOSTQTY_NOCOM',
  'TAXES_COST_CASH',
  'TOTALCASHTOSURRENDER'
] as const;
export type F5SurrenderColumn = (typeof F5_SURRENDER_COLUMNS)[number];
export type F5SurrenderRow = Record<F5SurrenderColumn, number | null>;

/** Fila DB contra el esperado F5. NULL falla en las columnas NC; solo TAXES_COST_CASH acepta NULL como 0. */
export function evaluateF5SurrenderRow(row: F5SurrenderRow, expected: F5Expected): OracleVerdict {
  const m: Mismatch[] = [];
  const wants: Record<F5SurrenderColumn, number> = {
    TOTALCASH: expected.totalCash.amount,
    TOTALCASHOTHERCOST_NOCOM: expected.ncCash.amount,
    TOTALCASHOTHERCOSTQTY_NOCOM: expected.ncCash.quantity,
    TAXES_COST_CASH: expected.taxesCash,
    TOTALCASHTOSURRENDER: expected.cashToSurrender
  };
  // Las columnas NOCOM son nuevas (MG-1024): «existe y vale 0» es el contrato (TM-1664: 0, no NULL).
  // Solo TAXES_COST_CASH puede venir NULL en un baseline previo a su alta.
  const nullIsZero = new Set<F5SurrenderColumn>(['TAXES_COST_CASH']);
  for (const col of F5_SURRENDER_COLUMNS) {
    const raw = row[col];
    const got = raw === null && nullIsZero.has(col) ? 0 : raw;
    if (got === null || !near(got, wants[col])) {
      m.push({ field: `TRAVELSSURRENDER.${col}`, expected: wants[col], actual: got });
    }
  }
  return verdict(m);
}

/** Columnas de TRAVELSSURRENDER que reflejan el NC de los viajes en CUENTA CORRIENTE (AC-F5-16). */
export const F5_CC_NC_COLUMNS = [
  'TOTALOTHERCOST_NOCOM',
  'TOTALOTHERCOSTQTY_NOCOM',
  'CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF'
] as const;
export type F5CcNcColumn = (typeof F5_CC_NC_COLUMNS)[number];
export type F5CcNcRow = Record<F5CcNcColumn, number | null>;

/**
 * AC-F5-16 (DB): TOTALOTHERCOST_NOCOM = suma NC de viajes CC y TOTALOTHERCOSTQTY_NOCOM = viajes CC con NC
 * (siempre). CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF sigue `expectedCcProfitDiff` (H-02): = NC con CC por venta,
 * venta − costo con CC por costo; indeterminado = solo se exige no NULL. NULL falla (la columna existe y vale 0).
 */
export function evaluateCcNcRow(row: F5CcNcRow, expected: F5Expected): OracleVerdict {
  const profit = expectedCcProfitDiff(expected);
  const want: Record<F5CcNcColumn, number | null> = {
    TOTALOTHERCOST_NOCOM: expected.ncCheckingAccount.amount,
    TOTALOTHERCOSTQTY_NOCOM: expected.ncCheckingAccount.quantity,
    CHECKING_ACCOUNT_AGENCY_PROFIT_DIFF: profit.amount
  };
  const m: Mismatch[] = [];
  for (const col of F5_CC_NC_COLUMNS) {
    const got = row[col];
    const w = want[col];
    if (got === null || (w !== null && !near(got, w))) {
      m.push({ field: `TRAVELSSURRENDER.${col}`, expected: want[col], actual: got });
    }
  }
  return verdict(m);
}

// ───────────────────────────── H-01: modo de lectura del PDF ─────────────────────────────

/** Modo de `pdftotext`: `table` existe en xpdf 4 (no en poppler). */
export type F5PdfMode = 'layout' | 'raw' | 'table';
export const F5_PDF_MODES: readonly F5PdfMode[] = ['layout', 'raw', 'table'];

/** Valida `F5_PDF_MODE` (modo fijo del ambiente). Vacío/ausente = null (sin modo fijo); un valor inválido lanza. */
export function parseF5PdfMode(raw: string | undefined): F5PdfMode | null {
  const v = raw?.trim().toLowerCase();
  if (v === undefined || v === '') return null;
  if ((F5_PDF_MODES as readonly string[]).includes(v)) return v as F5PdfMode;
  throw new Error(`[f5] F5_PDF_MODE inválido: «${raw}» (layout|table|raw)`);
}

export type F5PdfDiagnostic = { mode: F5PdfMode; ok: boolean; mismatches: Mismatch[] };
export type F5PdfDecision<V extends { ok: boolean }> = {
  verdict: V;
  mode: F5PdfMode;
  /**
   * `fixed`: decidió SOLO el modo fijo del ambiente (los demás son diagnóstico). `fallback-any`: no hay modo
   * fijo; se aceptó el primer modo que ancla TODAS las filas (compatibilidad) y el resultado lo declara.
   */
  decidedBy: 'fixed' | 'fallback-any';
  /** Lectura de cada modo legible: sirve para registrar contradicciones entre modos. */
  diagnostics: F5PdfDiagnostic[];
  /** true si algún modo legible no coincide con el veredicto elegido (señal de PDF desalineado). */
  modesDisagree: boolean;
};

/**
 * H-01: decide el veredicto de un PDF a partir de la lectura de cada modo (`readings`, en orden de preferencia;
 * un modo ilegible no aparece). Con `fixedMode` decide únicamente ese modo: si falla, FALLA aunque otro modo
 * ancle (un PDF desalineado no se rescata con otra lectura) y los demás quedan como diagnóstico. Sin modo fijo
 * se conserva el comportamiento histórico (primer modo que ancla todas las filas, si no el primero legible) pero
 * se declara `fallback-any` y `modesDisagree` para que el spec lo anote. Lanza si no hay lecturas o si el modo
 * fijo no pudo leerse.
 */
export function decidePdfModes<V extends { ok: boolean; mismatches: Mismatch[] }>(
  readings: ReadonlyArray<{ mode: F5PdfMode; verdict: V }>,
  fixedMode: F5PdfMode | null = null
): F5PdfDecision<V> {
  if (readings.length === 0) throw new Error('[f5] ningún modo de pdftotext pudo leer el PDF');
  const diagnostics: F5PdfDiagnostic[] = readings.map((r) => ({
    mode: r.mode,
    ok: r.verdict.ok,
    mismatches: r.verdict.mismatches
  }));
  let chosen: { mode: F5PdfMode; verdict: V };
  let decidedBy: F5PdfDecision<V>['decidedBy'];
  if (fixedMode !== null) {
    const hit = readings.find((r) => r.mode === fixedMode);
    if (!hit) throw new Error(`[f5] el modo fijo de pdftotext «${fixedMode}» no pudo leer el PDF`);
    chosen = hit;
    decidedBy = 'fixed';
  } else {
    chosen = readings.find((r) => r.verdict.ok) ?? readings[0];
    decidedBy = 'fallback-any';
  }
  return {
    verdict: chosen.verdict,
    mode: chosen.mode,
    decidedBy,
    diagnostics,
    modesDisagree: readings.some((r) => r.verdict.ok !== chosen.verdict.ok)
  };
}

// ───────────────────────────── H-03: Q9 como observación ─────────────────────────────

/**
 * H-03: casos de «Entregar» separados en CONTRATO (definido: frena 3.er decimal, descarta letras) y
 * OBSERVACIÓN (regla no definida: «−10 → 10»). `deliverContractCases` se conserva sin cambios (consumidores
 * existentes); este reparto es el que usa la vista previa.
 */
export function splitDeliverCases(dec: ',' | '.'): {
  contract: ReturnType<typeof deliverContractCases>;
  observation: ReturnType<typeof deliverContractCases>;
} {
  const all = deliverContractCases(dec);
  return {
    contract: all.filter((c) => c.raw !== '-10'),
    observation: all.filter((c) => c.raw === '-10')
  };
}

/** Pregunta abierta Q9 (PREEXISTENTE en PROD) para un valor tecleado en «Entregar»; sirve de texto de `observation`. */
export function deliverQ9Question(raw: string, kind: 'zero' | 'overDue' | 'negativeSign'): string {
  const what =
    kind === 'zero'
      ? 'Entregar = 0'
      : kind === 'overDue'
        ? 'Entregar > adeudado'
        : 'signo «−» descartado («−10» → «10»)';
  return (
    `Q9 regla no definida (PREEXISTENTE en PROD): ${what} (valor «${raw}»). ¿Debe Confirmar permanecer ` +
    'deshabilitado o el saldo pasar a la otra parte? Se registra la conducta actual; no es PASS/FAIL.'
  );
}

// ───────────────────────────── Libro del propietario (TDOC) ─────────────────────────────

export type F5OwnerBookRow = {
  CHECKINGACCOUNTCODE: string | null;
  DEBIT: number | null;
  CREDIT: number | null;
};

/**
 * TDOC (otros costos NC al propietario): la rendicion AUTOMATICA acredita el NC efectivo; la MANUAL
 * nunca genera TDOC. Con NC = 0 no debe haber TDOC en ninguna. Signo: credito del propietario.
 */
export function evaluateOwnerTdoc(input: {
  rows: readonly F5OwnerBookRow[];
  automatic: boolean;
  ncCash: number;
}): OracleVerdict & { tdocCredit: number; tdocRows: number } {
  const tdoc = input.rows.filter((r) => r.CHECKINGACCOUNTCODE === 'TDOC');
  const credit = cents(tdoc.reduce((s, r) => s + (r.CREDIT ?? 0) - (r.DEBIT ?? 0), 0));
  const m: Mismatch[] = [];
  const want = input.automatic ? input.ncCash : 0;
  if (want > 0) {
    if (tdoc.length !== 1 || !near(credit, want)) {
      m.push({
        field: 'libro propietario TDOC (credito = NC efectivo, automatica)',
        expected: `1 fila, credito ${want}`,
        actual: `${tdoc.length} fila(s), credito neto ${credit}`
      });
    }
  } else if (tdoc.length > 0) {
    m.push({
      field: input.automatic
        ? 'libro propietario TDOC con NC efectivo = 0'
        : 'libro propietario TDOC en rendicion MANUAL',
      expected: 'sin filas TDOC',
      actual: `${tdoc.length} fila(s), credito neto ${credit}`
    });
  }
  return { ...verdict(m), tdocCredit: credit, tdocRows: tdoc.length };
}

// ───────────────────────────── Clearing PDF ─────────────────────────────

export const CLEARING_NC_LABEL =
  /Other Cost NO Commission \(Cash Trips\)|Otros? Costos? NO Comisionables?/i;

/**
 * Fila del Clearing: con NC efectivo > 0 el rotulo «Other Cost NO Commission (Cash Trips)» (ES «Otros Costos
 * NO Comisionable…») debe estar y el importe del NC debe figurar en el MISMO renglon del rotulo o en los 2
 * siguientes (texto `-layout`; cubre el corte de celda de pdftotext). Buscarlo en todo el documento daria
 * falsos positivos (fechas «15/11», cantidades). Con NC = 0 no se asevera (el PDF puede dibujar la fila en
 * 0,00: pregunta abierta Q2 con el PO; se registra con `labelPresent`).
 */
export function evaluateClearingNcRow(
  text: string,
  expected: { ncCash: number }
): OracleVerdict & { labelPresent: boolean } {
  const lines = text.split(/\r?\n/);
  const labelIdx = lines.flatMap((l, i) => (CLEARING_NC_LABEL.test(l) ? [i] : []));
  const labelPresent = labelIdx.length > 0;
  const m: Mismatch[] = [];
  if (expected.ncCash > 0) {
    if (!labelPresent) {
      m.push({
        field: 'Clearing: rotulo «Other Cost NO Commission (Cash Trips)»',
        expected: 'presente',
        actual: 'ausente'
      });
    } else {
      const anchored = labelIdx.some((i) =>
        textContainsAmount(
          lines
            .slice(i, i + 3)
            .join('\n')
            .replace(CLEARING_NC_LABEL, ' '),
          expected.ncCash
        )
      );
      if (!anchored) {
        m.push({
          field: 'Clearing: importe del NC efectivo en el renglon del rotulo (o los 2 siguientes)',
          expected: expected.ncCash,
          actual: 'ausente'
        });
      }
    }
  }
  return { ...verdict(m), labelPresent };
}
