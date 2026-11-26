// Unit de B4 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/DistinctUntilChangedProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDistinctUntilChanged,
  type DistinctMeasurements
} from './DistinctUntilChangedProbe.js';

const sano: DistinctMeasurements = {
  term: 'libertad 479',
  callsFirstRound: 1,
  retyped: true,
  callsOnRepeat: 0,
  livenessTerm: 'libertad 479 2',
  livenessTyped: true,
  livenessCalls: 1
};
const m = (over: Partial<DistinctMeasurements>): DistinctMeasurements => ({ ...sano, ...over });

test('B4 PASS: no repite y la prueba de vida confirma el campo vivo', () => {
  assert.equal(evaluateDistinctUntilChanged(sano).status, 'PASS');
});

test('B4 FAIL: reescribir el mismo texto reconsulta', () => {
  const r = evaluateDistinctUntilChanged(m({ callsOnRepeat: 2 }));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /2 request/);
});

test('B4 SIN_DATOS: la primera ronda no consultó (campo inerte desde el arranque)', () => {
  assert.equal(evaluateDistinctUntilChanged(m({ callsFirstRound: 0 })).status, 'SIN_DATOS');
});

test('B4 SIN_DATOS: el campo no aceptó la reescritura', () => {
  assert.equal(evaluateDistinctUntilChanged(m({ retyped: false })).status, 'SIN_DATOS');
});

test('B4 SIN_DATOS: cero al repetir PERO cero con texto distinto (campo muerto entre rondas)', () => {
  const r = evaluateDistinctUntilChanged(m({ livenessCalls: 0 }));
  assert.equal(r.status, 'SIN_DATOS');
  assert.match(r.detail, /inerte/);
});

test('B4 SIN_DATOS: la prueba de vida ni siquiera pudo escribirse', () => {
  assert.equal(
    evaluateDistinctUntilChanged(m({ livenessTyped: false, livenessCalls: 0 })).status,
    'SIN_DATOS'
  );
});

test('B4 FAIL gana sobre la prueba de vida: si repite, es FAIL aunque la sonda no haya salido', () => {
  assert.equal(
    evaluateDistinctUntilChanged(m({ callsOnRepeat: 1, livenessCalls: 0 })).status,
    'FAIL'
  );
});
