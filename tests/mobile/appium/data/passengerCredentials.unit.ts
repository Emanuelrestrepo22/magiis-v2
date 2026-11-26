import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReadMobileCredentialsOptions } from '../config/deviceEnv.js';
import { passengerCredentialKeys, resolvePassengerCredentials } from './passengerCredentials.js';

type Reader = Parameters<typeof resolvePassengerCredentials>[1];

/** Lector falso: simula un archivo con `values`; registra toda clave consultada. */
function fakeReader(values: Record<string, string>): { reader: Reader; asked: string[] } {
  const asked: string[] = [];
  const reader: Reader = (o: ReadMobileCredentialsOptions) => {
    const ek = [o.emailKey, ...(o.emailFallbackKeys ?? [])];
    const pk = [o.passwordKey, ...(o.passwordFallbackKeys ?? [])];
    asked.push(...ek, ...pk);
    const email = ek.map((k) => values[k]).find((v) => v !== undefined && v.trim() !== '');
    const password = pk.map((k) => values[k]).find((v) => v !== undefined && v.trim() !== '');
    if (email === undefined) throw new Error(`Falta la clave de email: ${ek.join(' | ')}`);
    if (password === undefined) throw new Error(`Falta la clave de password: ${pk.join(' | ')}`);
    return { email, password };
  };
  return { reader, asked };
}

describe('resolvePassengerCredentials', () => {
  it('orden de la cadena de email y password', () => {
    assert.deepEqual(passengerCredentialKeys('uat').email, [
      'PASSENGER_EMAIL_UAT',
      'USER_PASSENGER_UAT',
      'PASSENGER_EMAIL',
      'USER_PASSENGER'
    ]);
    assert.deepEqual(passengerCredentialKeys('uat').password, [
      'PASSENGER_PASSWORD_UAT',
      'PASS_PASSENGER_UAT',
      'PASSENGER_PASSWORD',
      'PASS_PASSENGER'
    ]);
  });

  it('gana la clave específica del ambiente sobre las genéricas', () => {
    const { reader } = fakeReader({
      PASSENGER_EMAIL_UAT: 'a@x',
      USER_PASSENGER_UAT: 'b@x',
      PASSENGER_EMAIL: 'c@x',
      PASSENGER_PASSWORD_UAT: 'p1',
      PASSENGER_PASSWORD: 'p2'
    });
    assert.deepEqual(resolvePassengerCredentials('uat', reader), { email: 'a@x', password: 'p1' });
  });

  it('cae a USER_PASSENGER cuando PASSENGER_EMAIL viene vacía', () => {
    const { reader } = fakeReader({
      PASSENGER_EMAIL: '',
      USER_PASSENGER: 'u@x',
      PASS_PASSENGER: 'pp'
    });
    assert.deepEqual(resolvePassengerCredentials('uat', reader), { email: 'u@x', password: 'pp' });
  });

  it('aislamiento: uat nunca consulta ni toma claves _TEST', () => {
    const { reader, asked } = fakeReader({
      PASSENGER_EMAIL_TEST: 'test@x',
      PASSENGER_PASSWORD_TEST: 'ptest',
      PASSENGER_EMAIL_UAT: 'uat@x',
      PASSENGER_PASSWORD_UAT: 'puat'
    });
    assert.deepEqual(resolvePassengerCredentials('uat', reader), {
      email: 'uat@x',
      password: 'puat'
    });
    assert.equal(
      asked.some((k) => k.endsWith('_TEST')),
      false
    );
    assert.equal(resolvePassengerCredentials('test', reader).email, 'test@x');
  });

  it('error por claves faltantes: lista nombres y no valores', () => {
    const { reader } = fakeReader({ PASSENGER_PASSWORD_UAT: 'SECRETO-123' });
    assert.throws(
      () => resolvePassengerCredentials('uat', reader),
      (e: Error) =>
        e.message.includes('PASSENGER_EMAIL_UAT') &&
        e.message.includes('USER_PASSENGER') &&
        !e.message.includes('SECRETO-123')
    );
  });

  it('sin fallback DRIVER_*: nunca se consulta una clave DRIVER', () => {
    const { reader, asked } = fakeReader({ DRIVER_EMAIL: 'd@x', DRIVER_PASSWORD: 'dp' });
    assert.throws(() => resolvePassengerCredentials('test', reader));
    assert.equal(
      asked.some((k) => k.startsWith('DRIVER')),
      false
    );
    assert.equal(asked.length > 0, true);
  });
});
