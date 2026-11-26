// Unit de la matriz MG-116 (datos + decisión de fila + guarda de corrida). Sin Appium.
// Run: npx tsx --test tests/mobile/appium/screens/passenger/address/behaviorMatrix.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATRIX_ROWS,
  REQUIRED_TM_KEYS,
  SURFACE_ORDER,
  evaluateRow,
  expectedFloorFor,
  isEmulatorUdid,
  rowId,
  rowTitle,
  rowsForSurface,
  runGuardReason
} from './behaviorMatrix.js';
import type { MatrixRow, RunGuardInput } from './behaviorMatrix.js';
import type { ProbeResult } from './probes/types.js';

const row = (surface: string, behavior: string, variant?: string): MatrixRow =>
  MATRIX_ROWS.find(
    (r) => r.surface === surface && r.behavior === behavior && r.variant === variant
  ) as MatrixRow;

const result = (over: Partial<ProbeResult>): ProbeResult => ({
  behavior: 'B1',
  title: 't',
  level: 'real-ui',
  reportableAsBug: true,
  status: 'PASS',
  detail: 'd',
  measured: {},
  ...over
});

test('cada key TM requerida está acreditada por al menos una fila', () => {
  const covered = new Set(MATRIX_ROWS.flatMap((r) => r.tms));
  for (const key of REQUIRED_TM_KEYS) assert.ok(covered.has(key), `falta ${key}`);
  for (const key of covered) assert.ok(REQUIRED_TM_KEYS.includes(key), `key inesperada ${key}`);
});

test('no hay filas duplicadas (superficie, conducta, variante) ni títulos repetidos', () => {
  const ids = MATRIX_ROWS.map(rowId);
  assert.equal(new Set(ids).size, ids.length);
  const titles = MATRIX_ROWS.map(rowTitle);
  assert.equal(new Set(titles).size, titles.length);
});

test('la matriz tiene 34 filas: 6 comunes x 5 superficies + 4 de conducta única en S1', () => {
  assert.equal(MATRIX_ROWS.length, 34);
  for (const s of SURFACE_ORDER) assert.equal(rowsForSurface(s).length, s === 'S1' ? 10 : 6);
  const single = MATRIX_ROWS.filter((r) => ['B7', 'B8', 'B9'].includes(r.behavior));
  assert.ok(single.every((r) => r.surface === 'S1'));
});

test('toda fila espera PASS (el oráculo es el AC) y los known FAIL llevan motivo y base', () => {
  for (const r of MATRIX_ROWS) {
    assert.equal(r.expected, 'PASS');
    if (r.knownFail) {
      assert.ok(r.knownFail.reason.trim().length > 20, `${rowId(r)} sin motivo`);
      assert.ok(r.knownFail.basis);
    }
    if (r.suspected !== undefined) assert.ok(r.suspected.trim().length > 20);
  }
});

test('known FAIL documentados: debounce S1/S5/S7 (V1) y TM-729 en S7', () => {
  const known = MATRIX_ROWS.filter((r) => r.knownFail)
    .map(rowId)
    .sort();
  assert.deepEqual(known, ['S1-B2', 'S5-B2', 'S7-B1', 'S7-B2']);
  assert.match(row('S5', 'B2').knownFail!.reason, /dispararon 5 requests/);
  assert.equal(row('S7', 'B1').knownFail!.basis, 'build-viejo');
});

test('TM-733 y TM-734 sólo en Perfil; TM-678/680/681 sólo en alta de viaje', () => {
  assert.deepEqual(row('S7', 'B2').tms, ['TM-733']);
  assert.deepEqual(row('S7', 'B3').tms, ['TM-734']);
  assert.deepEqual(row('S3', 'B2').tms, ['TM-678']);
  assert.deepEqual(row('S3', 'B3').tms, ['TM-680', 'TM-681']);
  assert.equal(expectedFloorFor('S7'), 4);
  assert.equal(row('S7', 'B3').expectedMinLength, 4);
  assert.equal(row('S6', 'B3').expectedMinLength, 3);
});

test('B8/B9 son evidencia de mecanismo; el resto, de UI real', () => {
  for (const r of MATRIX_ROWS) {
    assert.equal(r.level, ['B8', 'B9'].includes(r.behavior) ? 'mechanism' : 'real-ui', rowId(r));
  }
});

test('evaluateRow: PASS, FAIL y SIN_DATOS/NO_EJERCIDO -> pass, fail y skip', () => {
  const r = row('S3', 'B4');
  assert.equal(evaluateRow(r, [result({ behavior: 'B4', status: 'PASS' })]).kind, 'pass');
  const fail = evaluateRow(r, [result({ behavior: 'B4', status: 'FAIL', detail: '3 requests' })]);
  assert.equal(fail.kind, 'fail');
  assert.match(fail.message, /3 requests/);
  for (const status of ['SIN_DATOS', 'NO_EJERCIDO'] as const) {
    const out = evaluateRow(r, [result({ behavior: 'B4', status })]);
    assert.equal(out.kind, 'skip');
    assert.equal(out.status, status);
  }
});

test('evaluateRow: sin resultado para la conducta -> skip, nunca pass', () => {
  const out = evaluateRow(row('S3', 'B4'), [result({ behavior: 'B1' })]);
  assert.equal(out.kind, 'skip');
  assert.equal(out.status, 'SIN_RESULTADO');
});

test('evaluateRow: B8 distingue la variante', () => {
  const results = [
    result({ behavior: 'B8', variant: 'status', status: 'PASS' }),
    result({ behavior: 'B8', variant: 'timeout', status: 'FAIL' })
  ];
  assert.equal(evaluateRow(row('S1', 'B8', 'status'), results).kind, 'pass');
  assert.equal(evaluateRow(row('S1', 'B8', 'timeout'), results).kind, 'fail');
});

test('evaluateRow: B1b decide con requestParams de B1, independiente del veredicto de B1', () => {
  const r = row('S3', 'B1b');
  const pass = evaluateRow(r, [
    result({
      behavior: 'B1',
      status: 'FAIL',
      measured: { requestParams: { status: 'PASS', detail: 'ok' } }
    })
  ]);
  assert.equal(pass.kind, 'pass');
  const fail = evaluateRow(r, [
    result({
      behavior: 'B1',
      status: 'PASS',
      measured: { requestParams: { status: 'FAIL', detail: 'sin latitude' } }
    })
  ]);
  assert.equal(fail.kind, 'fail');
  assert.match(fail.message, /sin latitude/);
  assert.equal(evaluateRow(r, [result({ behavior: 'B1', measured: {} })]).kind, 'skip');
});

const guardInput = (over: Partial<RunGuardInput> = {}): RunGuardInput => ({
  appiumServerUrl: 'http://localhost:4723',
  environmentReason: null,
  environment: 'uat',
  udid: 'R92XB0B8F3J',
  xray: undefined,
  ...over
});

test('runGuardReason: corre en UAT con dispositivo físico', () => {
  assert.equal(runGuardReason(guardInput()), null);
  assert.equal(runGuardReason(guardInput({ xray: '1' })), null);
});

test('runGuardReason: sin Appium, producción u otro ambiente -> skip con motivo', () => {
  assert.match(runGuardReason(guardInput({ appiumServerUrl: ' ' }))!, /APPIUM_SERVER_URL/);
  assert.equal(runGuardReason(guardInput({ environmentReason: 'prod vedado' })), 'prod vedado');
  assert.match(runGuardReason(guardInput({ environment: 'test' }))!, /ENV=uat/);
});

test('runGuardReason: emulador con XRAY activo -> skip; emulador sin XRAY corre', () => {
  assert.match(
    runGuardReason(guardInput({ udid: 'emulator-5554', xray: '1' }))!,
    /NO es concluyente/
  );
  assert.equal(runGuardReason(guardInput({ udid: 'emulator-5554' })), null);
  assert.equal(isEmulatorUdid('Emulator-5556'), true);
  assert.equal(isEmulatorUdid(null), false);
});
