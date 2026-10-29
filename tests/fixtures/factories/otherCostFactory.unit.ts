// tests/fixtures/factories/otherCostFactory.unit.ts
// Unit test de otherCostFactory (node:test — sin runner de Playwright ni red).
// Cubre: nombre con prefijo y runId, Regla G (Costo OFF espeja la venta), Costo ON por tipo,
// VAR con ambos topes (contrato vigente de TM-1277), apply con CARRIER, negativos solo explicitos.
// Run: npx tsx --test tests/fixtures/factories/otherCostFactory.unit.ts
/* eslint-disable playwright/expect-expect */
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOtherCostName,
  fixedOtherCost,
  isSweepCandidate,
  makeRunId,
  OTHER_COST_NAME_MAX_LENGTH,
  parseOtherCostNameTimestamp,
  percentageOtherCost,
  quantityOtherCost,
  variableOtherCost,
  type OtherCostContext
} from './otherCostFactory.js';

const NOW = Date.UTC(2026, 8, 29, 15, 0, 0);
const RUN_ID = makeRunId(NOW, () => 0.5);
const ctx: OtherCostContext = { carrierId: 1481, userId: 11111, currencyId: 9, runId: RUN_ID };

nodeTest('makeRunId produce 8 caracteres [0-9A-Z] que codifican el instante', () => {
  assert.match(RUN_ID, /^[0-9A-Z]{8}$/);
  const name = buildOtherCostName('FIX', RUN_ID);
  assert.equal(parseOtherCostNameTimestamp(name), Math.floor(NOW / 1000) * 1000);
});

nodeTest(
  'buildOtherCostName arma «QA E2E OC <TIPO> <runId>[ <label>]» dentro del tope de largo',
  () => {
    assert.equal(buildOtherCostName('QTY', RUN_ID), `QA E2E OC QTY ${RUN_ID}`);
    const withLabel = buildOtherCostName('FIX', RUN_ID, 'D');
    assert.equal(withLabel, `QA E2E OC FIX ${RUN_ID} D`);
    assert.ok(buildOtherCostName('VAR', RUN_ID, 'AB').length <= OTHER_COST_NAME_MAX_LENGTH);
    assert.doesNotMatch(withLabel, /[-']/);
  }
);

nodeTest('buildOtherCostName rechaza runId o label fuera de formato', () => {
  assert.throws(() => buildOtherCostName('FIX', 'abc-123'), /runId invalido/);
  assert.throws(() => buildOtherCostName('FIX', RUN_ID, 'a-b'), /label invalido/);
  assert.throws(() => buildOtherCostName('FIX', RUN_ID, 'ABC'), /label invalido/);
});

nodeTest(
  'isSweepCandidate solo marca nombres de la factory con mas antiguedad que el umbral',
  () => {
    const name = buildOtherCostName('FIX', RUN_ID);
    const day = 24 * 60 * 60 * 1000;
    assert.equal(isSweepCandidate(name, NOW + day + 1000, day), true);
    assert.equal(isSweepCandidate(name, NOW + 1000, day), false);
    assert.equal(isSweepCandidate('MG991', NOW + 10 * day, day), false);
    assert.equal(isSweepCandidate('Test NO USAR', NOW + 10 * day, day), false);
    assert.equal(isSweepCandidate('QA E2E OC otro concepto manual', NOW + 10 * day, day), false);
  }
);

nodeTest('FIX con Costo apagado espeja la venta en el costo (Regla G)', () => {
  const p = fixedOtherCost(ctx, 15);
  assert.deepEqual(p, {
    carrierId: 1481,
    name: `QA E2E OC FIX ${RUN_ID}`,
    type: 'FIX',
    apply: ['CARRIER'],
    isCommisionable: true,
    userId: 11111,
    isByCost: false,
    currencyId: 9,
    conceptValue: 15,
    maxValue: null,
    conceptValueCost: 15,
    maxCostValue: 0
  });
  assert.equal(Object.keys(p).length, 12);
});

nodeTest('FIX con Costo encendido lleva su costo, incluido el costo 0', () => {
  const on = fixedOtherCost(ctx, 25, { cost: 8 });
  assert.equal(on.isByCost, true);
  assert.equal(on.conceptValue, 25);
  assert.equal(on.conceptValueCost, 8);
  assert.equal(on.maxCostValue, 0);
  const zero = fixedOtherCost(ctx, 30, { cost: 0 });
  assert.equal(zero.isByCost, true);
  assert.equal(zero.conceptValueCost, 0);
});

nodeTest('QTY y PCT siguen la misma regla de costo que FIX', () => {
  const qty = quantityOtherCost(ctx, 2, { cost: 1 });
  assert.equal(qty.type, 'QTY');
  assert.equal(qty.conceptValue, 2);
  assert.equal(qty.conceptValueCost, 1);
  const pct = percentageOtherCost(ctx, 20, { cost: 10 });
  assert.equal(pct.type, 'PCT');
  assert.equal(pct.conceptValue, 20);
  assert.equal(pct.conceptValueCost, 10);
  const pctOff = percentageOtherCost(ctx, 20);
  assert.equal(pctOff.conceptValueCost, 20);
});

nodeTest('PCT fuera de 0..100 o venta en cero se rechazan como en el ABM', () => {
  assert.throws(() => percentageOtherCost(ctx, 120), /entre 0 y 100/);
  assert.throws(() => percentageOtherCost(ctx, 20, { cost: 101 }), /entre 0 y 100/);
  assert.throws(() => fixedOtherCost(ctx, 0), /no puede ser 0/);
});

nodeTest('VAR con Costo encendido exige ambos topes y solo apply CARRIER', () => {
  const p = variableOtherCost(ctx, { maxSale: 1500, maxCost: 700 });
  assert.equal(p.type, 'VAR');
  assert.equal(p.isByCost, true);
  assert.equal(p.conceptValue, null);
  assert.equal(p.maxValue, 1500);
  assert.equal(p.conceptValueCost, 0);
  assert.equal(p.maxCostValue, 700);
  assert.deepEqual(p.apply, ['CARRIER']);
  assert.throws(() => variableOtherCost(ctx, { maxSale: 1500, maxCost: 0 }), /tope de costo/);
  assert.throws(() => variableOtherCost(ctx, { maxSale: 0, maxCost: 700 }), /tope de venta/);
  assert.throws(
    () =>
      variableOtherCost({ ...ctx, apply: ['DRIVER', 'CARRIER'] }, { maxSale: 1500, maxCost: 700 }),
    /solo admite apply CARRIER/
  );
});

nodeTest('VAR con Costo apagado espeja el tope de venta en el tope de costo (Regla G)', () => {
  const p = variableOtherCost({ ...ctx, apply: ['DRIVER', 'CARRIER'] }, { maxSale: 5000 });
  assert.equal(p.isByCost, false);
  assert.equal(p.maxValue, 5000);
  assert.equal(p.maxCostValue, 5000);
  assert.equal(p.conceptValueCost, 0);
  assert.throws(
    () => variableOtherCost({ ...ctx, apply: ['PAX', 'CARRIER'] }, { maxSale: 10 }),
    /no admite apply PAX/
  );
});

nodeTest('apply siempre incluye CARRIER y admite disponibilidad compartida', () => {
  assert.throws(() => fixedOtherCost({ ...ctx, apply: ['DRIVER'] }, 12), /debe incluir CARRIER/);
  const shared = fixedOtherCost({ ...ctx, apply: ['DRIVER', 'CARRIER'], label: 'C' }, 12);
  assert.deepEqual(shared.apply, ['DRIVER', 'CARRIER']);
});

nodeTest(
  'los negativos solo se generan con allowNegative explicito (dato legado de TM-1279)',
  () => {
    assert.throws(() => fixedOtherCost(ctx, -5), /negativo/);
    const legacy = fixedOtherCost({ ...ctx, label: 'D' }, -5, { allowNegative: true });
    assert.equal(legacy.conceptValue, -5);
    assert.equal(legacy.conceptValueCost, -5);
    assert.throws(() => variableOtherCost(ctx, { maxSale: -10, maxCost: 5 }), /negativo/);
  }
);

nodeTest(
  'la etiqueta SMK (smoke del ABM, ATR TM-1281) arma un nombre valido que el sweep reconoce',
  () => {
    const name = buildOtherCostName('SMK', RUN_ID);
    assert.equal(name, `QA E2E OC SMK ${RUN_ID}`);
    assert.ok(name.length <= OTHER_COST_NAME_MAX_LENGTH);
    assert.ok(buildOtherCostName('SMK', RUN_ID, 'AB').length <= OTHER_COST_NAME_MAX_LENGTH);
    assert.match(name, /^[A-Za-z0-9\s]+$/);
    assert.equal(parseOtherCostNameTimestamp(name), Math.floor(NOW / 1000) * 1000);
    const day = 24 * 60 * 60 * 1000;
    assert.equal(isSweepCandidate(name, NOW + day + 1000, day), true);
    assert.equal(isSweepCandidate(name, NOW + 1000, day), false);
    assert.equal(isSweepCandidate('QA E2E OC SMK manual', NOW + 10 * day, day), false);
  }
);

nodeTest('nameTag SMK reemplaza el tipo en el nombre sin cambiar el tipo del payload', () => {
  const payload = quantityOtherCost({ ...ctx, nameTag: 'SMK' }, 10, { cost: 6 });
  assert.equal(payload.name, `QA E2E OC SMK ${RUN_ID}`);
  assert.equal(payload.type, 'QTY');
  assert.equal(payload.conceptValueCost, 6);
});
