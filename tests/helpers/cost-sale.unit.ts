import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TravelDetail } from '../api/clients/travels.client.js';
import { evaluateCostEqualsSale, tariffEvidence } from './cost-sale.js';

// Shape measured on trip 71124 (admin, MEET AND GREET 10) in TEST on 2026-10-13.
const ok = (): TravelDetail => ({
  amount: 57.22,
  amountCost: 57.22,
  tourPrice: 47.22,
  tourPriceCost: 47.22,
  waitTimePrice: 0,
  waitTotalPriceCost: 0,
  otherCost: 10,
  otherCostPriceCost: 10,
  otherCostNoCom: 0,
  otherCostPriceCostNoCom: 0
});

describe('evaluateCostEqualsSale', () => {
  it('passes and returns every pair when cost equals sale', () => {
    const verdict = evaluateCostEqualsSale({ detail: ok(), label: 't', expectOtherCost: true });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.mismatches, []);
    const { pairs } = verdict;
    assert.deepEqual(
      pairs.map((p) => p.pair),
      ['amount', 'tourPrice', 'waitTime', 'otherCost', 'otherCostNoCom']
    );
    assert.equal(pairs[0]?.sale, 57.22);
  });

  it('treats null as 0 for optional pairs (trip without other costs)', () => {
    const d = {
      ...ok(),
      amount: 47.22,
      amountCost: 47.22,
      otherCost: null,
      otherCostPriceCost: null,
      waitTimePrice: null
    };
    assert.equal(evaluateCostEqualsSale({ detail: d, label: 't' }).ok, true);
  });

  it('does not throw: a cost differing from the sale is reported, naming the pair, with the pairs', () => {
    const d = { ...ok(), tourPriceCost: 31.5 };
    const v = evaluateCostEqualsSale({ detail: d, label: 'row-6204' });
    assert.equal(v.ok, false);
    assert.match(v.message, /row-6204] cost = sale/);
    assert.match(
      v.message,
      /tourPrice: cost \(tourPriceCost\) vs sale \(tourPrice\): obtenido 31.5 vs esperado 47.22/
    );
    assert.equal(v.pairs.find((p) => p.pair === 'tourPrice')?.cost, 31.5);
  });

  it('rejects a vacuous 0/0 main pair', () => {
    const d = { ...ok(), amount: 0, amountCost: 0 };
    const v = evaluateCostEqualsSale({ detail: d, label: 't' });
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => /^amount: sale/.test(m.field) && m.expected === '> 0'));
  });

  it('requires other cost > 0 only when expected', () => {
    const d = { ...ok(), amount: 47.22, amountCost: 47.22, otherCost: 0, otherCostPriceCost: 0 };
    assert.equal(evaluateCostEqualsSale({ detail: d, label: 't' }).ok, true);
    const v = evaluateCostEqualsSale({ detail: d, label: 't', expectOtherCost: true });
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => /^otherCost: sale/.test(m.field)));
  });

  it('requires wait time > 0 only when expected', () => {
    const v = evaluateCostEqualsSale({ detail: ok(), label: 't', expectWaitTime: true });
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => /^waitTime: sale/.test(m.field)));
  });

  it('fails when the non-commissionable pair is not 0/0', () => {
    const d = { ...ok(), otherCostNoCom: 5, otherCostPriceCostNoCom: 5 };
    const v = evaluateCostEqualsSale({ detail: d, label: 't' });
    assert.equal(v.ok, false);
    assert.match(v.message, /otherCostNoCom/);
  });

  it('fails on a non-numeric field instead of coercing it', () => {
    const d = { ...ok(), amountCost: '57.22' as unknown as number };
    const v = evaluateCostEqualsSale({ detail: d, label: 't' });
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.field === 'amountCost' && m.expected === 'finite number'));
  });

  it('fails when amountCost is not the sum of its commissionable parts', () => {
    // every sale/cost pair matches, but 60 != 47.22 + 0 + 10
    const d = { ...ok(), amount: 60, amountCost: 60 };
    const v = evaluateCostEqualsSale({ detail: d, label: 'row-sum' });
    assert.equal(v.ok, false);
    assert.match(v.message, /row-sum[^]*amountCost vs tourPriceCost/);
    assert.equal(v.mismatches.length, 1);
  });
});

describe('tariffEvidence', () => {
  it('records unverified when the detail does not expose the tariff (measured on 71230/71228)', () => {
    const d: TravelDetail = {
      isCorporate: true,
      simulationPrice: { rateId: null, rateName: null, carrierRateByCost: false }
    };
    assert.deepEqual(tariffEvidence(d, 6204), {
      tariffExpected: 6204,
      tariffSource: 'unverified',
      rateId: null,
      rateName: null,
      carrierRateByCost: false,
      isCorporate: true
    });
  });

  it('reports the detail as the source only when rateId equals the expected tariff', () => {
    const d: TravelDetail = { simulationPrice: { rateId: 6204, rateName: 'QA F2 Venta' } };
    assert.equal(tariffEvidence(d, 6204).tariffSource, 'detail.simulationPrice.rateId');
    assert.equal(tariffEvidence(d, 2261).tariffSource, 'unverified');
  });
});
