// Unit de la composición (puro: solo summarizeMatrix y las constantes). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/runProbeBattery.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMON_BEHAVIORS, SINGLE_SURFACE_BEHAVIORS, summarizeMatrix } from './runProbeBattery.js';
import { toResult } from './measure.js';
import type { BehaviorId, SurfaceProbeReport, Verdict } from './types.js';

const res = (behavior: BehaviorId, status: Verdict) =>
  toResult({ behavior, title: 't' }, { status, detail: 'd' }, {});

test('las conductas comunes son B1-B6 y las de una sola superficie B7-B9', () => {
  assert.deepEqual([...COMMON_BEHAVIORS], ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
  assert.deepEqual([...SINGLE_SURFACE_BEHAVIORS], ['B7', 'B8', 'B9']);
});

test('summarizeMatrix: PASS/FAIL/n-e/— por celda y — para conductas ausentes', () => {
  const reports: SurfaceProbeReport[] = [
    {
      surfaceId: 'S1',
      surfaceLabel: 'Home · Origen',
      fieldSelector: 'input',
      results: [
        res('B1', 'PASS'),
        res('B2', 'FAIL'),
        res('B3', 'NO_EJERCIDO'),
        res('B4', 'SIN_DATOS')
      ]
    }
  ];
  const lines = summarizeMatrix(reports);
  assert.equal(lines[0], '| Superficie | B1 | B2 | B3 | B4 | B5 | B6 |');
  assert.equal(lines[2], '| S1 Home · Origen | PASS | FAIL | n/e | — | — | — |');
});
