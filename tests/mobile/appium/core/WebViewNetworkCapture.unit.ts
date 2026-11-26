// Unit de WebViewNetworkCapture (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/core/WebViewNetworkCapture.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBody, formatHeaders, safeLabel } from './WebViewNetworkCapture.js';

test('safeLabel: reemplaza caracteres no seguros para nombre de archivo y recorta guiones bajos', () => {
  assert.equal(safeLabel('Pax / paso 1: login!'), 'Pax_paso_1_login');
  assert.equal(safeLabel('a.b-c_d'), 'a.b-c_d');
  assert.equal(safeLabel('///'), '');
});

test('formatHeaders / formatBody: marcadores para vacío y JSON indentado', () => {
  assert.equal(formatHeaders(undefined), '<none>');
  assert.equal(formatHeaders({}), '<none>');
  assert.equal(formatHeaders({ a: '1' }), JSON.stringify({ a: '1' }, null, 2));
  assert.equal(formatBody(undefined), '<empty>');
  assert.equal(formatBody(''), '<empty>');
  assert.equal(formatBody('{"x":1}'), '{"x":1}');
});
