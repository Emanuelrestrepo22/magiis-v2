// tests/fixtures/carrierApiFixture.ts
// Fixture hibrido: extiende TestBase (no lo modifica; lo comparten todos los specs) con la capa
// API del carrier para precondiciones y oraculos. Uso:
//   import { test, expect } from '../../fixtures/carrierApiFixture.js';
//   test('…', async ({ page, otherCostsApi, travelsApi }) => { … });
// La sesion sale del storageState guardado (sin login con contrasena). La primera llamada del
// worker (otherCosts/search) prueba que el servidor acepta la sesion: 401/403 → STOP.
import type { APIRequestContext } from '@playwright/test';
import { test as base, expect } from '../TestBase.js';
import {
  loadCarrierSession,
  SUITE_MIN_SESSION_VALIDITY_MS,
  type CarrierSession
} from '../api/clients/carrierSession.js';
import { CheckingAccountClient } from '../api/clients/checkingAccount.client.js';
import { loginDriver, type DriverSession } from '../api/clients/driverSession.js';
import { DriverTravelsClient, newDriverApiContext } from '../api/clients/driverTravels.client.js';
import { OtherCostsClient } from '../api/clients/otherCosts.client.js';
import { TravelsClient } from '../api/clients/travels.client.js';
import { tryCreateOracleDb, type OracleDb } from '../db/OracleDb.js';

type CarrierApiWorkerFixtures = {
  carrierSession: CarrierSession;
  carrierApi: APIRequestContext;
};

type CarrierApiTestFixtures = {
  otherCostsApi: OtherCostsClient;
  travelsApi: TravelsClient;
  checkingAccountApi: CheckingAccountClient;
  /** Login del chofer (DRIVER_EMAIL/DRIVER_PASSWORD) solo si el test lo pide. */
  driverTravelsApi: DriverTravelsClient;
  /** Oracle SOLO LECTURA; null si el ambiente no tiene ORACLE_* (el spec debe declarar el skip). */
  db: OracleDb | null;
};

export const test = base.extend<CarrierApiTestFixtures, CarrierApiWorkerFixtures>({
  carrierSession: [
    async ({}, use) => {
      // Vigencia minima = duracion esperada de la suite: no arrancar con un token por vencer.
      await use(loadCarrierSession({ minValidityMs: SUITE_MIN_SESSION_VALIDITY_MS }));
    },
    { scope: 'worker' }
  ],
  carrierApi: [
    async ({ playwright, carrierSession }, use) => {
      const api = await carrierSession.newApiContext(playwright.request);
      try {
        // Probe de sesion del lado del servidor (solo lectura).
        await new OtherCostsClient(api, carrierSession).search();
        await use(api);
      } finally {
        await api.dispose();
      }
    },
    { scope: 'worker' }
  ],
  otherCostsApi: async ({ carrierApi, carrierSession }, use) => {
    await use(new OtherCostsClient(carrierApi, carrierSession));
  },
  travelsApi: async ({ carrierApi, carrierSession }, use) => {
    await use(new TravelsClient(carrierApi, carrierSession));
  },
  checkingAccountApi: async ({ carrierApi, carrierSession }, use) => {
    await use(new CheckingAccountClient(carrierApi, carrierSession));
  },
  db: async ({}, use) => {
    await use(tryCreateOracleDb());
  },
  driverTravelsApi: async ({ playwright, carrierSession }, use) => {
    const session: DriverSession = await loginDriver({
      factory: playwright.request,
      carrierSession
    });
    const api = await newDriverApiContext(playwright.request, session);
    try {
      await use(new DriverTravelsClient(api, session, carrierSession.carrierId));
    } finally {
      await api.dispose();
    }
  }
});

export { expect };
