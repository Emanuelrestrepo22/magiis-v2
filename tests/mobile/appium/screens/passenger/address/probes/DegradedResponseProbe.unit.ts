// Unit de B8 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/DegradedResponseProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDegradedResponse, type DegradedMeasurements } from './DegradedResponseProbe.js';
import { toResult } from './measure.js';

const sano: DegradedMeasurements = {
  mode: 'status',
  term: 'libertad 479',
  typedBaseline: true,
  typedUnderFault: true,
  faultHits: 1,
  typedAfter: true,
  recoveryCalls: 1
};
const m = (over: Partial<DegradedMeasurements>): DegradedMeasurements => ({ ...sano, ...over });

test('B8 PASS (status y timeout): sobrevive, la regla disparó y vuelve a consultar', () => {
  assert.equal(evaluateDegradedResponse(sano).status, 'PASS');
  const t = evaluateDegradedResponse(m({ mode: 'timeout' }));
  assert.equal(t.status, 'PASS');
  assert.match(t.detail, /un timeout/);
});

test('B8 FAIL: el campo dejó de aceptar texto bajo la falla (con prueba de vida previa)', () => {
  assert.equal(
    evaluateDegradedResponse(m({ typedUnderFault: false, faultHits: 0 })).status,
    'FAIL'
  );
});

test('B8 FAIL: tras la falla el campo no acepta texto', () => {
  assert.equal(evaluateDegradedResponse(m({ typedAfter: false })).status, 'FAIL');
});

test('B8 FAIL: acepta texto pero ya no consulta (suscripción rota)', () => {
  const r = evaluateDegradedResponse(m({ recoveryCalls: 0 }));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /suscripción quedó rota/);
});

test('B8 SIN_DATOS: el campo no aceptaba texto ni antes de la falla (harness)', () => {
  assert.equal(
    evaluateDegradedResponse(m({ typedBaseline: false, typedUnderFault: false })).status,
    'SIN_DATOS'
  );
});

test('B8 SIN_DATOS: estado de la inyección ilegible', () => {
  assert.equal(evaluateDegradedResponse(m({ faultHits: null })).status, 'SIN_DATOS');
});

test('B8 NO_EJERCIDO: la regla nunca disparó (no hay degradación que evaluar)', () => {
  assert.equal(evaluateDegradedResponse(m({ faultHits: 0 })).status, 'NO_EJERCIDO');
});

test('B8 es evidencia de MECANISMO: no reportable como bug sin repro real', () => {
  const res = toResult(
    { behavior: 'B8', variant: 'status', title: 't', level: 'mechanism' },
    evaluateDegradedResponse(m({ recoveryCalls: 0 })),
    {}
  );
  assert.equal(res.status, 'FAIL');
  assert.equal(res.level, 'mechanism');
  assert.equal(res.reportableAsBug, false);
});
