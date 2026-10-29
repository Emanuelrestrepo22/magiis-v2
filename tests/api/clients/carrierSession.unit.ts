import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { APIResponse } from '@playwright/test';
import { sendGetOk, sendOk } from './carrierSession.js';

const okResponse = {
  status: () => 200,
  ok: () => true,
  text: async () => ''
} as unknown as APIResponse;
const noSleep = async (): Promise<void> => {};

function flaky(
  failures: number,
  message: string
): { call: () => Promise<APIResponse>; calls: () => number } {
  let n = 0;
  return {
    call: async () => {
      n += 1;
      if (n <= failures) throw new Error(message);
      return okResponse;
    },
    calls: () => n
  };
}

describe('sendGetOk (reintento idempotente)', () => {
  it('reintenta hasta 2 veces ante socket hang up y termina OK', async () => {
    const f = flaky(2, 'apiRequestContext.get: socket hang up');
    const delays: number[] = [];
    await sendGetOk('x', f.call, { sleep: async (ms) => void delays.push(ms), backoffMs: 10 });
    assert.equal(f.calls(), 3);
    assert.deepEqual(delays, [10, 20]);
  });

  it('falla tras agotar los 2 reintentos (3 intentos en total)', async () => {
    const f = flaky(5, 'read ECONNRESET');
    await assert.rejects(sendGetOk('x', f.call, { sleep: noSleep }), /fallo sin respuesta/);
    assert.equal(f.calls(), 3);
  });

  it('no reintenta errores que no son de red', async () => {
    const f = flaky(5, 'Timeout 30000ms exceeded');
    await assert.rejects(sendGetOk('x', f.call, { sleep: noSleep }), /fallo sin respuesta/);
    assert.equal(f.calls(), 1);
  });
});

describe('sendOk (POST/PUT/DELETE: sin reintentos)', () => {
  it('un socket hang up falla al primer intento', async () => {
    const f = flaky(1, 'socket hang up');
    await assert.rejects(sendOk('x', f.call), /fallo sin respuesta/);
    assert.equal(f.calls(), 1);
  });
});
