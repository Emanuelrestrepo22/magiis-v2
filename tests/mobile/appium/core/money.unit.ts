// Unit de money (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/core/money.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyText } from './money.js';

test('parseMoneyText: formatos AR/US/FR', () => {
  assert.equal(parseMoneyText('$1,645.00'), 1645);
  assert.equal(parseMoneyText('$ 1.645,00'), 1645);
  assert.equal(parseMoneyText('1.645,00'), 1645);
  assert.equal(parseMoneyText('1 645,00 €'), 1645);
  assert.equal(parseMoneyText('1 645,50 €'), 1645.5);
  assert.equal(parseMoneyText('€ 12,5'), 12.5);
  assert.equal(parseMoneyText('€ 12,50'), 12.5);
  assert.equal(parseMoneyText('$1,645'), 1645);
  assert.equal(parseMoneyText('$0.00'), 0);
});

test('parseMoneyText: vacío o no interpretable devuelve null', () => {
  assert.equal(parseMoneyText(''), null);
  assert.equal(parseMoneyText('sin monto'), null);
});
