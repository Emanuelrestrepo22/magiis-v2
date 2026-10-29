// tests/utils/envAvailability.unit.ts
// Unit test del gate de disponibilidad y del detector de errores de red (node:test, sin red real).
// Run: npx tsx --test tests/utils/envAvailability.unit.ts
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityUrls,
  EnvironmentUnavailableError,
  isNavigationNetworkError,
  networkErrorCode,
  probeEnvironment
} from './envAvailability.js';

const GOTO_TIMEOUT =
  'page.goto: net::ERR_TIMED_OUT at https://apps-test.magiis.com/carrier/#/travel/create\nCall log: ...';

const noSleep = (): Promise<void> => Promise.resolve();

function fakeFetch(plan: Array<number | 'throw' | 'hang'>): {
  impl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  const impl = ((url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    const step = plan[Math.min(i++, plan.length - 1)];
    if (step === 'throw') return Promise.reject(new Error('getaddrinfo ENOTFOUND apps-test'));
    if (step === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve({ status: step } as Response);
  }) as typeof fetch;
  return { impl, calls };
}

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('detecta el goto sin respuesta del 06/10 como error de red de navegacion', () => {
  assert.equal(isNavigationNetworkError(GOTO_TIMEOUT), true);
  assert.equal(networkErrorCode(GOTO_TIMEOUT), 'net::ERR_TIMED_OUT');
  assert.equal(
    isNavigationNetworkError('page.goto: net::ERR_CONNECTION_REFUSED at https://x/'),
    true
  );
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('no confunde fallas del test ni del producto con errores de red', () => {
  // Asercion que expira: es falla del test o del producto, nunca del ambiente.
  assert.equal(
    isNavigationNetworkError('expect(locator).toBeEnabled() failed\nTimeout: 5000ms'),
    false
  );
  // Error de red fuera de una navegacion (p. ej. un request API): no lo reintenta BasePage.
  assert.equal(isNavigationNetworkError('apiRequestContext.get: net::ERR_TIMED_OUT'), false);
  // Certificado invalido: no es "servidor sin respuesta".
  assert.equal(isNavigationNetworkError('page.goto: net::ERR_CERT_AUTHORITY_INVALID'), false);
  assert.equal(isNavigationNetworkError(undefined), false);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('el gate da OK al primer intento si las dos URLs responden < 500', async () => {
  const { impl, calls } = fakeFetch([200, 401]);
  const result = await probeEnvironment({
    urls: availabilityUrls('https://apps-test.magiis.com'),
    fetchImpl: impl,
    sleep: noSleep
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    'https://apps-test.magiis.com/carrier/',
    'https://apps-test.magiis.com/magiis-v0.2/config/serverInfo'
  ]);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('el gate reintenta con backoff y se recupera si el ambiente vuelve', async () => {
  const waits: number[] = [];
  const { impl } = fakeFetch(['throw', 503, 200, 200]);
  const result = await probeEnvironment({
    urls: ['https://a/', 'https://b/'],
    backoffMs: [0, 5, 15],
    fetchImpl: impl,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(waits, [5, 15]);
  assert.deepEqual(
    result.attempts.map((a) => [a.attempt, a.ok]),
    [
      [1, false],
      [2, false],
      [3, true],
      [3, true]
    ]
  );
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('el gate falla con timeout por request y el error explica que no se publica', async () => {
  const { impl } = fakeFetch(['hang']);
  const result = await probeEnvironment({
    urls: ['https://apps-test.magiis.com/carrier/'],
    backoffMs: [0, 0],
    timeoutMs: 10,
    fetchImpl: impl,
    sleep: noSleep
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[1].outcome, 'timeout 10ms');
  const error = new EnvironmentUnavailableError('https://apps-test.magiis.com', result.attempts);
  assert.equal(error.code, 'ENVIRONMENT_DOWN');
  assert.match(error.message, /\[ENVIRONMENT_DOWN\].*ni se publica nada en Xray/);
});
