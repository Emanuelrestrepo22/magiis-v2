import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHomeUrl, isLoginUrl } from './passengerWeb.js';

describe('passengerWeb: clasificación de URL', () => {
  it('isLoginUrl: /login', () => {
    assert.equal(isLoginUrl('https://app.example/#/login'), true);
    assert.equal(isLoginUrl('https://app.example/login?x=1'), true);
  });
  it('isLoginUrl: invalid_token=true sin /login', () => {
    assert.equal(isLoginUrl('https://app.example/navigator/HomePage?invalid_token=true'), true);
    assert.equal(isLoginUrl('https://app.example/x?a=1&invalid_token=true'), true);
  });
  it('isLoginUrl: false en home, vacío y invalid_token=false', () => {
    assert.equal(isLoginUrl('https://app.example/navigator/HomePage'), false);
    assert.equal(isLoginUrl(''), false);
    assert.equal(isLoginUrl('https://app.example/x?invalid_token=false'), false);
  });
  it('isHomeUrl: /navigator/HomePage', () => {
    assert.equal(isHomeUrl('https://app.example/navigator/HomePage'), true);
    assert.equal(isHomeUrl('https://app.example/navigator/HomePage;FROM_LOGIN=true'), true);
    assert.equal(isHomeUrl('https://app.example/login'), false);
    assert.equal(isHomeUrl('https://app.example/navigator/TravelConfirmPage'), false);
  });
});
