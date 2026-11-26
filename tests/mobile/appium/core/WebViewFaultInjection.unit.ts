// Unit de WebViewFaultInjection (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/core/WebViewFaultInjection.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeFaultRules } from './WebViewFaultInjection.js';
import type { WebViewFaultInjectionRule } from './WebViewNetworkCaptureTypes.js';

test('serializeFaultRules: id posicional por defecto y valores normalizados', () => {
  const [a, b] = serializeFaultRules([
    { urlPattern: '/x', mode: 'timeout', delayMs: 500 },
    {
      id: 'mi-regla',
      urlPattern: '^/y',
      mode: 'status',
      status: 409,
      matchMode: 'regex',
      kinds: ['xhr'],
      times: 1
    }
  ]);
  assert.equal(a!.id, 'rule-1');
  assert.equal(a!.matchMode, 'substring');
  assert.equal(a!.status, null);
  assert.equal(a!.delayMs, 500);
  assert.deepEqual(a!.kinds, []);
  assert.equal(b!.id, 'mi-regla');
  assert.equal(b!.matchMode, 'regex');
  assert.deepEqual(b!.kinds, ['xhr']);
  assert.equal(b!.times, 1);
});

test('serializeFaultRules: status fuera de 200-599 o modo desconocido fallan', () => {
  assert.throws(
    () => serializeFaultRules([{ urlPattern: '/x', mode: 'status', status: 0 }]),
    /200-599/
  );
  assert.throws(
    () => serializeFaultRules([{ urlPattern: '/x', mode: 'status', status: 600 }]),
    /200-599/
  );
  const bad = { urlPattern: '/x', mode: 'timeoutt' } as unknown as WebViewFaultInjectionRule;
  assert.throws(() => serializeFaultRules([bad]), /Valid modes/);
});
