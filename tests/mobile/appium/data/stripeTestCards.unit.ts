// Unit de las tarjetas de prueba de la billetera PAX. Run: npx tsx --test tests/mobile/appium/data/stripeTestCards.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  passesLuhn,
  WALLET_CARD_DELETE,
  WALLET_CARD_MANAGEMENT,
  WALLET_TEST_CARDS
} from './stripeTestCards.js';

describe('stripeTestCards', () => {
  it('todos los PAN pasan Luhn y su last4 sale del número', () => {
    for (const c of WALLET_TEST_CARDS) {
      assert.equal(passesLuhn(c.number), true, c.id);
      assert.equal(c.last4, c.number.slice(-4));
      assert.equal(c.threeDs, false);
    }
  });
  it('los specs usan last4 distintos y ninguno es 4242', () => {
    assert.notEqual(WALLET_CARD_MANAGEMENT.last4, WALLET_CARD_DELETE.last4);
    for (const c of WALLET_TEST_CARDS) assert.notEqual(c.last4, '4242');
  });
  it('el titular cumple la validación de la app (letras, máx. 30)', () => {
    for (const c of WALLET_TEST_CARDS) {
      assert.match(c.holderName, /^[a-zA-Z-' ]+$/);
      assert.ok(c.holderName.length <= 30);
    }
  });
  it('passesLuhn rechaza un número alterado', () => {
    assert.equal(passesLuhn('5200828282828211'), false);
    assert.equal(passesLuhn('123'), false);
  });
});
