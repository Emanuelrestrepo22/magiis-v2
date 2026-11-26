// tests/helpers/api-evidence.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { measurementHtml, redactMeasurement } from './api-evidence.js';

describe('api-evidence', () => {
  it('escapa HTML y dibuja una fila por clave', () => {
    const html = measurementHtml('t<1>', { a: '<b>x</b>', n: 2 });
    assert.ok(html.includes('t&lt;1&gt;'));
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
    assert.equal((html.match(/<tr>/g) ?? []).length, 2);
  });
  it('tacha Bearer en la medicion', () => {
    const out = redactMeasurement({ h: 'Authorization: Bearer abc.def.ghi' });
    assert.ok(!JSON.stringify(out).includes('abc.def.ghi'));
  });
});
