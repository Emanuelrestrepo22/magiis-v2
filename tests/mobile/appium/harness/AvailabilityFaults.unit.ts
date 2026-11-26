// Unit de AvailabilityFaults (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/harness/AvailabilityFaults.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebViewNetworkCaptureRecord } from '../core/WebViewNetworkCaptureTypes.js';
import {
  AVAILABILITY_ENDPOINT_PATTERN,
  AVAILABILITY_ERROR_BRANCHES,
  anySucceeded,
  buildAvailabilityFaultRule,
  endpointTail,
  findAvailabilityRequests,
  summarizeRequests
} from './AvailabilityFaults.js';

const rec = (over: Partial<WebViewNetworkCaptureRecord>): WebViewNetworkCaptureRecord => ({
  id: 1,
  kind: 'fetch',
  method: 'PUT',
  url: 'https://api.example.test/v1/driver/setFromAppDriverStatus?token=SECRET',
  startedAt: '2026-11-13T00:00:00Z',
  ...over
});

test('ramas de error: 400, 428 y 409 (en ese orden)', () => {
  assert.deepEqual(
    AVAILABILITY_ERROR_BRANCHES.map((b) => b.status),
    [400, 428, 409]
  );
});

test('buildAvailabilityFaultRule: una falla HTTP, times=1, id estable, body JSON', () => {
  const rule = buildAvailabilityFaultRule(428);
  assert.equal(rule.id, 'availability-http-428');
  assert.equal(rule.urlPattern, AVAILABILITY_ENDPOINT_PATTERN);
  assert.equal(rule.mode, 'status');
  assert.equal(rule.status, 428);
  assert.equal(rule.times, 1);
  assert.equal(JSON.parse(rule.body!).injected, true);
});

test('buildAvailabilityFaultRule: status que no es error HTTP o patrón vacío fallan', () => {
  assert.throws(() => buildAvailabilityFaultRule(200), /400-599/);
  assert.throws(() => buildAvailabilityFaultRule(0), /400-599/);
  assert.throws(() => buildAvailabilityFaultRule(409.5), /400-599/);
  assert.throws(() => buildAvailabilityFaultRule(409, '  '), /vacío/);
});

test('findAvailabilityRequests / anySucceeded: ignoran inyectadas por defecto y miran solo 2xx', () => {
  const entries = [
    rec({ id: 1, status: 200 }),
    rec({ id: 2, status: 409, injected: true }),
    rec({ id: 3, url: 'https://api.example.test/other' })
  ];
  assert.equal(findAvailabilityRequests(entries).length, 1);
  assert.equal(findAvailabilityRequests(entries, { includeInjected: true }).length, 2);
  assert.equal(anySucceeded(findAvailabilityRequests(entries)), true);
  assert.equal(anySucceeded([rec({ status: 500 }), rec({})]), false);
});

test('endpointTail / summarizeRequests: sin query ni token', () => {
  assert.equal(endpointTail('https://h/a/b/c?token=SECRET'), 'b/c');
  const lines = summarizeRequests([
    rec({ status: 200 }),
    rec({ id: 2, status: 409, injected: true })
  ]);
  assert.deepEqual(lines, [
    'PUT 200 driver/setFromAppDriverStatus',
    'PUT 409 driver/setFromAppDriverStatus [inyectada]'
  ]);
  assert.ok(!lines.join().includes('SECRET'));
});
