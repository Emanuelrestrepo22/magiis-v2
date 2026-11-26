// Unit de los helpers puros de la billetera PAX (sin Appium).
// Run: npx tsx --test tests/mobile/appium/screens/passenger/walletScreens.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidHolderName, normalizeExpiry } from './WalletCardFormScreen.js';
import {
  isAddCardLabel,
  isAddSuccessText,
  isSaveCardLabel,
  isWalletMenuLabel,
  isWalletUrl,
  last4Of,
  parseCardLabel,
  parseRemovalToast,
  sameLast4Multiset
} from './walletParsing.js';

describe('walletParsing: etiquetas es/en', () => {
  it('menú: Billetera / Wallet (sin tildes ni mayúsculas)', () => {
    assert.equal(isWalletMenuLabel('Billetera'), true);
    assert.equal(isWalletMenuLabel(' WALLET '), true);
    assert.equal(isWalletMenuLabel('Mis Direcciones'), false);
  });
  it('agregar: AGREGAR / ADD PAYMENT METHOD (el botón va en mayúsculas)', () => {
    assert.equal(isAddCardLabel('AGREGAR'), true);
    assert.equal(isAddCardLabel('ADD PAYMENT METHOD'), true);
    assert.equal(isAddCardLabel('Guardar'), false);
  });
  it('guardar: GUARDAR / SAVE', () => {
    assert.equal(isSaveCardLabel('GUARDAR'), true);
    assert.equal(isSaveCardLabel('Save'), true);
    assert.equal(isSaveCardLabel('AGREGAR'), false);
  });
});

describe('walletParsing: URL', () => {
  it('/cards con o sin parámetros; no confunde otras rutas', () => {
    assert.equal(isWalletUrl('https://app.example/cards'), true);
    assert.equal(isWalletUrl('https://app.example/cards?fromTravelInfo=true'), true);
    assert.equal(isWalletUrl('https://app.example/navigator/HomePage'), false);
    assert.equal(isWalletUrl('https://app.example/cardsx'), false);
    assert.equal(isWalletUrl(''), false);
  });
});

describe('walletParsing: tarjeta', () => {
  it('last4Of acepta etiqueta, last4 y PAN; null con menos de 4 dígitos', () => {
    assert.equal(last4Of('VISA ...4242'), '4242');
    assert.equal(last4Of('5200 8282 8282 8210'), '8210');
    assert.equal(last4Of('12'), null);
  });
  it('parseCardLabel separa marca y last4 (incluida una marca terminada en x)', () => {
    assert.deepEqual(parseCardLabel('VISA ...4242'), { brand: 'VISA', last4: '4242' });
    assert.deepEqual(parseCardLabel('  mastercard   ...  8210 '), {
      brand: 'MASTERCARD',
      last4: '8210'
    });
    assert.deepEqual(parseCardLabel('AMEX 0005'), { brand: 'AMEX', last4: '0005' });
    assert.equal(parseCardLabel('sin digitos'), null);
  });
  it('sameLast4Multiset ignora el orden y cuenta repetidos', () => {
    assert.equal(
      sameLast4Multiset([{ last4: '1' }, { last4: '2' }], [{ last4: '2' }, { last4: '1' }]),
      true
    );
    assert.equal(sameLast4Multiset([{ last4: '1' }, { last4: '1' }], [{ last4: '1' }]), false);
    assert.equal(sameLast4Multiset([{ last4: '1' }], [{ last4: '2' }]), false);
    assert.equal(sameLast4Multiset([], []), true);
  });
});

describe('walletParsing: toasts', () => {
  it('alta correcta es/en', () => {
    assert.equal(isAddSuccessText('Se añadió su tarjeta de crédito correctamente.'), true);
    assert.equal(isAddSuccessText('Your credit card was successfully added.'), true);
    assert.equal(isAddSuccessText('Error al establecer su tarjeta principal'), false);
  });
  it('baja correcta es/en devuelve el last4 citado', () => {
    assert.equal(
      parseRemovalToast('El método de pago  mastercard ...8210  ha sido eliminado'),
      '8210'
    );
    assert.equal(parseRemovalToast('Payment Method VISA ...5556 has been removed'), '5556');
    assert.equal(parseRemovalToast('Se añadió su tarjeta de crédito correctamente.'), null);
  });
});

describe('WalletCardFormScreen: datos puros', () => {
  it('normalizeExpiry: MM/AA y MM/AAAA; falla con formato inválido', () => {
    assert.equal(normalizeExpiry('12/34'), '12/34');
    assert.equal(normalizeExpiry('1/2034'), '01/34');
    assert.throws(() => normalizeExpiry('1234'), /Vencimiento inválido/);
  });
  it('isValidHolderName: letras, espacios, guion, apóstrofo; máx. 30', () => {
    assert.equal(isValidHolderName('QA Wallet Test'), true);
    assert.equal(isValidHolderName("O'Brien-Smith"), true);
    assert.equal(isValidHolderName('QA 123'), false);
    assert.equal(isValidHolderName(''), false);
    assert.equal(isValidHolderName('a'.repeat(31)), false);
  });
});
