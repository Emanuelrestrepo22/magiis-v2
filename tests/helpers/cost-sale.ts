// tests/helpers/cost-sale.ts
// Oracle for sale-only tariffs (PLAN-REGRESION-COSTO-VENTA-2026-10-13): in the trip detail every
// sale amount has a cost pair, and for a sale-only tariff both sides must match.
// Fields measured in TEST on 2026-10-13 (trips 71124 and 71106), see docs/plans/COST-SALE-REGRESSION-DATA.md.
import type { TravelDetail } from '../api/clients/travels.client.js';
import { formatMismatches, type Mismatch, type OracleVerdict } from './oracle-result.js';

/** One sale/cost pair read from the detail; backend `null` is normalised to 0. */
export type CostSalePair = { pair: string; sale: number; cost: number };

export type CostSaleOptions = {
  detail: TravelDetail;
  /** Run/row label used in error messages (e.g. `TC-01 tariff 6204`). */
  label: string;
  /** Require sale > 0 on the wait-time pair (the scenario generated wait time). Default false. */
  expectWaitTime?: boolean;
  /** Require sale > 0 on the other-cost pair (the scenario added an other cost). Default false. */
  expectOtherCost?: boolean;
};

const toCents = (n: number): number => Math.round(n * 100);

/** Run-comment note: the equality only covers commissionable items (deduped across rows by the reporter). */
export const COST_SALE_SCOPE_NOTE =
  'Alcance: la igualdad costo = venta cubre solo los conceptos comisionables; los *_NOCOM quedan fuera ' +
  '(ej. viaje 71212: venta 51.73 vs costo 42.73).';

/** What the trip detail says about the effective tariff of the trip (see `tariffEvidence`). */
export type TariffEvidence = {
  tariffExpected: number;
  /** `detail.simulationPrice.rateId` when it matches the expectation; otherwise `unverified`. */
  tariffSource: 'detail.simulationPrice.rateId' | 'unverified';
  rateId: number | string | null;
  rateName: string | null;
  carrierRateByCost: boolean | null;
  isCorporate: boolean | null;
};

/**
 * Records the tariff evidence of a trip. Measured in TEST on 2026-10-13 (trips 71230 = tariff 6204,
 * 71228 = tariff 2261): the detail does NOT expose the tariff (`simulationPrice.rateId`/`rateName` and
 * `serviceTypeDetail.carrierRateId` are null, `carrierRateByCost` is false on both), so the source is
 * `unverified` and the expected tariff is only a declaration of the row. Nothing is inferred.
 */
export function tariffEvidence(detail: TravelDetail, expectedTariff: number): TariffEvidence {
  const sim = (detail.simulationPrice ?? {}) as Record<string, unknown>;
  const rateId = (sim.rateId ?? null) as number | string | null;
  const rateName = typeof sim.rateName === 'string' ? sim.rateName : null;
  return {
    tariffExpected: expectedTariff,
    tariffSource:
      rateId !== null && String(rateId) === String(expectedTariff)
        ? 'detail.simulationPrice.rateId'
        : 'unverified',
    rateId,
    rateName,
    carrierRateByCost: typeof sim.carrierRateByCost === 'boolean' ? sim.carrierRateByCost : null,
    isCorporate: typeof detail.isCorporate === 'boolean' ? detail.isCorporate : null
  };
}

function read(detail: TravelDetail, field: string, errors: Mismatch[]): number {
  const value = detail[field];
  if (value === null || value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ field, expected: 'finite number', actual: value });
    return 0;
  }
  return value;
}

/** Verdict of the cost = sale oracle: the measured pairs always come back, pass or fail. */
export type CostSaleVerdict = OracleVerdict & {
  pairs: CostSalePair[];
  /** Ready-made assertion message (label + every mismatch) for `expect(ok, message)`. */
  message: string;
};

/**
 * Pure evaluator (does not throw, does not assert): checks cost === sale for every pair of the trip
 * detail and returns the measured pairs (for the measurement JSON) plus every mismatch. `amount` and
 * `tourPrice` must be > 0 (a 0/0 pair would be a vacuous oracle); wait-time and other-cost sales must
 * be > 0 only when the scenario asked for them; the non-commissionable other-cost pair must be 0/0.
 * The spec asserts `expect(verdict.ok, verdict.message).toBe(true)`.
 */
export function evaluateCostEqualsSale(options: CostSaleOptions): CostSaleVerdict {
  const { detail, label, expectWaitTime = false, expectOtherCost = false } = options;
  const errors: Mismatch[] = [];
  const spec = [
    { pair: 'amount', saleField: 'amount', costField: 'amountCost', positive: true },
    { pair: 'tourPrice', saleField: 'tourPrice', costField: 'tourPriceCost', positive: true },
    {
      pair: 'waitTime',
      saleField: 'waitTimePrice',
      costField: 'waitTotalPriceCost',
      positive: expectWaitTime
    },
    {
      pair: 'otherCost',
      saleField: 'otherCost',
      costField: 'otherCostPriceCost',
      positive: expectOtherCost
    }
  ];
  const pairs: CostSalePair[] = [];
  for (const s of spec) {
    const sale = read(detail, s.saleField, errors);
    const cost = read(detail, s.costField, errors);
    pairs.push({ pair: s.pair, sale, cost });
    if (s.positive && !(sale > 0)) {
      errors.push({ field: `${s.pair}: sale (${s.saleField})`, expected: '> 0', actual: sale });
    }
    if (toCents(sale) !== toCents(cost)) {
      errors.push({
        field: `${s.pair}: cost (${s.costField}) vs sale (${s.saleField})`,
        expected: sale,
        actual: cost
      });
    }
  }
  // Internal consistency of the cost side: amountCost = tour + wait + other (commissionable only).
  const costOf = (pair: string): number => pairs.find((x) => x.pair === pair)?.cost ?? 0;
  const costParts =
    toCents(costOf('tourPrice')) + toCents(costOf('waitTime')) + toCents(costOf('otherCost'));
  if (toCents(costOf('amount')) !== costParts) {
    errors.push({
      field: 'amountCost vs tourPriceCost + waitTotalPriceCost + otherCostPriceCost',
      expected: costParts / 100,
      actual: costOf('amount')
    });
  }
  const noComSale = read(detail, 'otherCostNoCom', errors);
  const noComCost = read(detail, 'otherCostPriceCostNoCom', errors);
  pairs.push({ pair: 'otherCostNoCom', sale: noComSale, cost: noComCost });
  if (noComSale !== 0 || noComCost !== 0) {
    errors.push({
      field: 'otherCostNoCom (sale and cost must both be 0)',
      expected: { sale: 0, cost: 0 },
      actual: { sale: noComSale, cost: noComCost }
    });
  }
  return {
    ok: errors.length === 0,
    mismatches: errors,
    pairs,
    message: formatMismatches(`[${label}] cost = sale`, errors)
  };
}
