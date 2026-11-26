// Unit de WebViewGoogleActivity (sin dispositivo; driver simulado). Run: npx tsx --test tests/mobile/appium/core/WebViewGoogleActivity.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'webdriverio';
import { readWebViewGoogleActivity } from './WebViewGoogleActivity.js';

const fakeDriver = (contexts: string[], execute?: () => unknown): Browser =>
  ({
    getContext: async () => 'NATIVE_APP',
    getContexts: async () => contexts,
    switchContext: async () => undefined,
    pause: async () => undefined,
    execute: async () => (execute ? execute() : undefined)
  }) as unknown as Browser;

test('readWebViewGoogleActivity: sin WEBVIEW el reporte es available=false (no evidencia de «sin Google»)', async () => {
  const r = await readWebViewGoogleActivity(fakeDriver([]));
  assert.equal(r.available, false);
  assert.match(r.unavailableReason ?? '', /WEBVIEW/);
});

test('readWebViewGoogleActivity: error del probe => available=false; lectura limpia => available=true', async () => {
  const boom = await readWebViewGoogleActivity(
    fakeDriver(['WEBVIEW_x'], () => {
      throw new Error('boom');
    })
  );
  assert.equal(boom.available, false);
  assert.match(boom.unavailableReason ?? '', /boom/);

  const ok = await readWebViewGoogleActivity(
    fakeDriver(['WEBVIEW_x'], () => ({
      probeErrors: [],
      scriptTags: [],
      resourceEntries: [],
      sdkPresent: false
    }))
  );
  assert.equal(ok.available, true);

  const both = await readWebViewGoogleActivity(
    fakeDriver(['WEBVIEW_x'], () => ({
      probeErrors: ['a', 'b'],
      scriptTags: [],
      resourceEntries: [],
      sdkPresent: false
    }))
  );
  assert.equal(both.available, false);
});
