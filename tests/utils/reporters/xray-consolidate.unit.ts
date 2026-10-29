// tests/utils/reporters/xray-consolidate.unit.ts
// Unit test del consolidador puro de filas Xray (node:test — sin runner de Playwright).
// Sufijo .unit.ts para que Playwright (testDir ./tests, testMatch por defecto) NO lo
// recoja como spec — nunca pasa por el global-setup de login.
// `test` se importa como `nodeTest`: eslint-plugin-playwright (playwright/expect-expect)
// detecta cualquier llamada con forma test(titulo, fn) como spec de Playwright, sin
// mirar de donde se importo `test` ni si el body usa expect() o assert. Con node:assert
// sigue marcando "Test has no assertions" -> eslint-disable puntual por caso (no se puede
// tocar eslint.config.js, fuera del alcance de este fix).
// Run: npm run test:unit:reporters
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { consolidateRows } from './xray-consolidate.js';
import type { RowResult } from './xray-consolidate.js';

function row(
  partial: Partial<RowResult> & Pick<RowResult, 'status' | 'skipped' | 'title'>
): RowResult {
  return {
    start: undefined,
    finish: undefined,
    comment: undefined,
    skipReason: undefined,
    ...partial
  };
}

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('todas las filas PASSED -> PASSED', () => {
  const result = consolidateRows([
    row({ status: 'PASSED', skipped: false, title: 'fila 1' }),
    row({ status: 'PASSED', skipped: false, title: 'fila 2' })
  ]);
  assert.equal(result.status, 'PASSED');
  assert.equal(result.comment, undefined);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'PASSED + skip estructural -> PASSED, con nota de fila omitida y motivo en comment',
  () => {
    const result = consolidateRows([
      row({ status: 'PASSED', skipped: false, title: 'fila ejecutada' }),
      row({
        status: 'TODO',
        skipped: true,
        title: 'fila omitida',
        skipReason: 'no aplica en este entorno'
      })
    ]);
    assert.equal(result.status, 'PASSED');
    assert.match(result.comment ?? '', /Filas omitidas por entorno \(1\)/);
    assert.match(result.comment ?? '', /fila omitida: no aplica en este entorno/);
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('PASSED + FAILED -> FAILED conservando el comment de error', () => {
  const result = consolidateRows([
    row({ status: 'PASSED', skipped: false, title: 'fila ok' }),
    row({
      status: 'FAILED',
      skipped: false,
      title: 'fila rota',
      comment: 'expect(x).toBe(y) fallo'
    })
  ]);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.comment, 'expect(x).toBe(y) fallo');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('todas las filas skip -> TODO con nota de todas las filas omitidas', () => {
  const result = consolidateRows([
    row({ status: 'TODO', skipped: true, title: 'fila A', skipReason: 'motivo A' }),
    row({ status: 'TODO', skipped: true, title: 'fila B', skipReason: 'motivo B' })
  ]);
  assert.equal(result.status, 'TODO');
  assert.match(result.comment ?? '', /Filas omitidas por entorno \(2\)/);
  assert.match(result.comment ?? '', /fila A: motivo A/);
  assert.match(result.comment ?? '', /fila B: motivo B/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('ABORTED + PASSED -> ABORTED (peor estado entre ejecutadas)', () => {
  const result = consolidateRows([
    row({ status: 'PASSED', skipped: false, title: 'fila ok' }),
    row({
      status: 'ABORTED',
      skipped: false,
      title: 'fila interrumpida',
      comment: 'status=interrupted'
    })
  ]);
  assert.equal(result.status, 'ABORTED');
  assert.equal(result.comment, 'status=interrupted');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('start/finish: minimo y maximo SOLO entre las filas ejecutadas', () => {
  const result = consolidateRows([
    row({
      status: 'PASSED',
      skipped: false,
      title: 'fila 1',
      start: '2026-01-01T00:00:05.000Z',
      finish: '2026-01-01T00:00:06.000Z'
    }),
    row({
      status: 'PASSED',
      skipped: false,
      title: 'fila 2',
      start: '2026-01-01T00:00:01.000Z',
      finish: '2026-01-01T00:00:09.000Z'
    }),
    row({
      status: 'TODO',
      skipped: true,
      title: 'fila omitida',
      skipReason: 'no aplica',
      start: '2026-01-01T00:00:00.000Z',
      finish: '2026-01-01T00:00:10.000Z'
    })
  ]);
  assert.equal(result.status, 'PASSED');
  assert.equal(result.start, '2026-01-01T00:00:01.000Z');
  assert.equal(result.finish, '2026-01-01T00:00:09.000Z');
});
