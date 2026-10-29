import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pollUntil } from './poll.js';

describe('pollUntil', () => {
  it('converges at attempt N', async () => {
    let n = 0;
    const r = await pollUntil(
      async () => ++n,
      (v) => v >= 3,
      { timeoutMs: 1_000, intervalMs: 5 }
    );
    assert.equal(r.settled, true);
    assert.equal(r.value, 3);
    assert.equal(r.attempts, 3);
  });

  it('returns settled=false (no throw) when the timeout is exhausted', async () => {
    const r = await pollUntil(
      async () => 'x',
      () => false,
      { timeoutMs: 30, intervalMs: 10 }
    );
    assert.equal(r.settled, false);
    assert.equal(r.value, 'x');
    assert.ok(r.attempts >= 1);
  });

  it('propagates read errors', async () => {
    await assert.rejects(
      pollUntil(
        async () => {
          throw new Error('boom');
        },
        () => true,
        { timeoutMs: 50, intervalMs: 5 }
      ),
      /boom/
    );
  });
});
