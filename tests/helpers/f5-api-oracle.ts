// tests/helpers/f5-api-oracle.ts
// Oráculo F5 SOLO-API (modo UAT UI+API, sin DB): deriva el esperado del GET toTravelsSurrender y verifica
// identidades contables internas del propio GET contra el lote del GET toSurrend. No reemplaza al oráculo
// de DB de TEST (no hay hechos independientes por viaje): lo complementa con lo que SÍ es contrastable por
// API (cantidades por medio de pago, totalBilling, forma de los campos F5, comisiones por actor presentes,
// efectivo a rendir = totalCash + NC + impuestos) y alimenta el body del POST y las filas del Clearing PDF.
import {
  getTaxesCash,
  paymentKind,
  readNcField,
  type F5Expected,
  type F5GetTotals,
  type F5Money
} from './f5-surrender-oracle.js';
import type { Mismatch, OracleVerdict } from './oracle-result.js';

const c2 = (n: number): number => Math.round(n * 100) / 100;
const verdict = (mismatches: Mismatch[]): OracleVerdict => ({
  ok: mismatches.length === 0,
  mismatches
});
const near = (a: number, b: number): boolean => Math.round(a * 100) === Math.round(b * 100);

function money(get: F5GetTotals, key: string): F5Money | null {
  const v = get[key];
  if (typeof v !== 'object' || v === null) return null;
  const { amount, quantity } = v as { amount?: unknown; quantity?: unknown };
  return typeof amount === 'number' && typeof quantity === 'number' ? { amount, quantity } : null;
}

/** Comisiones por actor del GET (chofer · agencia · propietario); ausente = null. */
export const COMMISSION_KEYS = [
  'commissionSum',
  'agencyTotalCommission',
  'ownerTotalCommission'
] as const;

/** Esperado F5 derivado del GET (sin DB). Lanza si falta un campo imprescindible (no asume 0). */
export function expectedFromGet(get: F5GetTotals): F5Expected {
  const cash = money(get, 'totalCash');
  const cc = money(get, 'totalCheckingAccount');
  const card = money(get, 'totalCreditCard');
  const nc = readNcField(get).field;
  if (!cash || !cc || !card || !nc) {
    throw new Error(
      '[f5-api-oracle] el GET toTravelsSurrender no trae totalCash/totalCheckingAccount/totalCreditCard/totalCashOtherCostNoCommissionable con forma {amount, quantity}'
    );
  }
  const ccNc = get.checkingAccountAgencyProfitDiff;
  const taxesCash = getTaxesCash(get);
  const totalBilling = c2(cash.amount + cc.amount + card.amount);
  return {
    totalCash: cash,
    totalCheckingAccount: cc,
    totalCreditCard: card,
    ncCash: nc,
    ncCheckingAccount: { amount: typeof ccNc === 'number' ? ccNc : 0, quantity: 0 },
    taxesCash,
    totalBilling,
    totalCollected: c2(totalBilling + nc.amount + taxesCash),
    cashToSurrender: c2(cash.amount + nc.amount + taxesCash)
  };
}

/**
 * Identidades del GET (capa API, valen en cualquier ambiente):
 * - cantidades por medio de pago = filas del lote de toSurrend por medio de pago;
 * - `totalBilling` (si viene) = totalCash + totalCheckingAccount + totalCreditCard (sin NC);
 * - NC efectivo: monto ≥ 0, cantidad ≥ 0, cantidad ≤ viajes en efectivo y (monto > 0 ⇔ cantidad > 0);
 * - `checkingAccountAgencyProfitDiff` presente y numérico (AC-F5-16; no se asume 0);
 * - comisiones por actor presentes y numéricas.
 */
export function evaluateGetInternal(
  get: F5GetTotals,
  rows: ReadonlyArray<{ paymentMethod?: string | null }>
): OracleVerdict {
  const m: Mismatch[] = [];
  const count = { cash: 0, checkingAccount: 0, creditCard: 0 };
  for (const r of rows) {
    if (typeof r.paymentMethod !== 'string') {
      m.push({
        field: 'toSurrend fila.paymentMethod',
        expected: 'string',
        actual: r.paymentMethod ?? 'ausente'
      });
      continue;
    }
    count[paymentKind(r.paymentMethod)] += 1;
  }
  const pairs: Array<[string, number]> = [
    ['totalCash', count.cash],
    ['totalCheckingAccount', count.checkingAccount],
    ['totalCreditCard', count.creditCard]
  ];
  for (const [key, want] of pairs) {
    const got = money(get, key);
    if (!got)
      m.push({
        field: `GET ${key}`,
        expected: '{amount, quantity}',
        actual: get[key] ?? 'ausente'
      });
    else if (got.quantity !== want) {
      m.push({
        field: `GET ${key}.quantity vs filas de toSurrend`,
        expected: want,
        actual: got.quantity
      });
    }
  }
  const cash = money(get, 'totalCash');
  const cc = money(get, 'totalCheckingAccount');
  const card = money(get, 'totalCreditCard');
  if (typeof get.totalBilling === 'number' && cash && cc && card) {
    const sum = c2(cash.amount + cc.amount + card.amount);
    if (!near(get.totalBilling, sum)) {
      m.push({
        field: 'GET totalBilling = totalCash + CC + tarjeta (sin NC)',
        expected: sum,
        actual: get.totalBilling
      });
    }
  }
  const nc = readNcField(get);
  m.push(...nc.verdict.mismatches);
  if (nc.field) {
    if (nc.field.amount < 0 || nc.field.quantity < 0) {
      m.push({ field: 'GET NC no negativo', expected: '>= 0', actual: nc.field });
    }
    if (nc.field.quantity > count.cash) {
      m.push({
        field: 'GET NC.quantity <= viajes en efectivo',
        expected: `<= ${count.cash}`,
        actual: nc.field.quantity
      });
    }
    if (nc.field.amount > 0 !== nc.field.quantity > 0) {
      m.push({
        field: 'GET NC: monto > 0 sii cantidad > 0',
        expected: 'coherente',
        actual: nc.field
      });
    }
  }
  if (typeof get.checkingAccountAgencyProfitDiff !== 'number') {
    m.push({
      field: 'GET checkingAccountAgencyProfitDiff',
      expected: 'number',
      actual: get.checkingAccountAgencyProfitDiff ?? 'ausente'
    });
  }
  for (const key of COMMISSION_KEYS) {
    if (typeof get[key] !== 'number')
      m.push({ field: `GET ${key}`, expected: 'number', actual: get[key] ?? 'ausente' });
  }
  return verdict(m);
}
