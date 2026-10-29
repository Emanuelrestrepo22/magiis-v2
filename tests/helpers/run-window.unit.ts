import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertOutsideCronWindow, cronWindowStatus } from './run-window.js';

const at = (h: number, min: number, sec = 0) => new Date(Date.UTC(2026, 9, 21, h, min, sec));
const NO_ENV: NodeJS.ProcessEnv = {};

describe('run-window', () => {
  it('cronWindowStatus: default 13:00-13:20 UTC; 12:59:59 fuera, 13:00 y 13:19:59 dentro, 13:20 fuera', () => {
    assert.equal(cronWindowStatus(at(12, 59, 59), { env: NO_ENV }).inWindow, false);
    assert.equal(cronWindowStatus(at(13, 0), { env: NO_ENV }).inWindow, true);
    assert.equal(cronWindowStatus(at(13, 19, 59), { env: NO_ENV }).inWindow, true);
    assert.equal(cronWindowStatus(at(13, 20), { env: NO_ENV }).inWindow, false);
  });

  it('cronWindowStatus: minutesToWindow y fechas de ventana', () => {
    const before = cronWindowStatus(at(12, 0), { env: NO_ENV });
    assert.equal(before.minutesToWindow, 60);
    assert.equal(before.windowStartUtc.toISOString(), at(13, 0).toISOString());
    assert.equal(before.windowEndUtc.toISOString(), at(13, 20).toISOString());
    assert.equal(cronWindowStatus(at(13, 5), { env: NO_ENV }).minutesToWindow, 0);
    const after = cronWindowStatus(at(14, 0), { env: NO_ENV });
    assert.equal(after.inWindow, false);
    assert.equal(after.windowStartUtc.toISOString(), '2026-10-22T13:00:00.000Z');
    assert.equal(after.minutesToWindow, 23 * 60);
  });

  it('cronWindowStatus: FR_CRON_WINDOW_UTC personalizada', () => {
    const env = { FR_CRON_WINDOW_UTC: '09:30-09:45' };
    assert.equal(cronWindowStatus(at(9, 35), { env }).inWindow, true);
    assert.equal(cronWindowStatus(at(13, 5), { env }).inWindow, false);
  });

  it('cronWindowStatus: FR_CRON_WINDOW_UTC invalida lanza', () => {
    assert.throws(
      () => cronWindowStatus(at(9, 0), { env: { FR_CRON_WINDOW_UTC: '9-10' } }),
      /HH:MM-HH:MM/
    );
    assert.throws(
      () => cronWindowStatus(at(9, 0), { env: { FR_CRON_WINDOW_UTC: '10:00-09:00' } }),
      /despues/
    );
  });

  it('assertOutsideCronWindow: flag 0 dentro de ventana -> ok', () => {
    assert.equal(
      assertOutsideCronWindow({ now: at(13, 5), cashCollectorFlag: 0, env: NO_ENV }).inWindow,
      true
    );
  });

  it('assertOutsideCronWindow: flag null dentro de ventana -> ok', () => {
    assert.equal(
      assertOutsideCronWindow({ now: at(13, 5), cashCollectorFlag: null, env: NO_ENV }).inWindow,
      true
    );
  });

  it('assertOutsideCronWindow: flag 1 dentro de ventana -> lanza nombrando ventana y flag', () => {
    assert.throws(
      () => assertOutsideCronWindow({ now: at(13, 5), cashCollectorFlag: 1, env: NO_ENV }),
      (err: Error) => /13:00-13:20 UTC/.test(err.message) && /CASHCOLLECTOR=1/.test(err.message)
    );
  });

  it('assertOutsideCronWindow: flag 1 fuera de ventana -> ok', () => {
    assert.equal(
      assertOutsideCronWindow({ now: at(10, 5), cashCollectorFlag: 1, env: NO_ENV }).inWindow,
      false
    );
  });

  it('assertOutsideCronWindow: FR_IGNORE_CRON_WINDOW=1 no lanza', () => {
    const env = { FR_IGNORE_CRON_WINDOW: '1' };
    assert.equal(
      assertOutsideCronWindow({ now: at(13, 5), cashCollectorFlag: 1, env }).inWindow,
      true
    );
  });

  it('assertOutsideCronWindow: respeta FR_CRON_WINDOW_UTC personalizada', () => {
    const env = { FR_CRON_WINDOW_UTC: '09:30-09:45' };
    assert.throws(
      () => assertOutsideCronWindow({ now: at(9, 35), cashCollectorFlag: 1, env }),
      /09:30-09:45 UTC/
    );
    assert.equal(
      assertOutsideCronWindow({ now: at(13, 5), cashCollectorFlag: 1, env }).inWindow,
      false
    );
  });
});
