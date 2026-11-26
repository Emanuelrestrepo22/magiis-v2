// tests/fixtures/waypointsFixture.ts
// Fixture de Puntos de referencia (MG-1132). EXTIENDE carrierApiFixture sin tocarlo (hot file).
//   import { test, expect } from '../../fixtures/waypointsFixture.js';
//   test('…', async ({ page, waypointsApi, placesApi, runId }) => { … });
// - waypointsApi: cliente del carrier de la sesion; su cleanup() corre en el finally del fixture.
// - placesApi: autocomplete / getPlace / checkPlace.
// - otherCarrierWaypointsApi: SEGUNDA sesion (carrier 1040, region AR) para aislamiento entre carriers.
//   La sesion la crea global-setup con REGION_SESSIONS=AR (o un login humano previo); este fixture
//   NO hace login con contrasena: si falta el storageState falla pidiendo regenerarlo.
import type { APIRequestContext } from '@playwright/test';
import { test as base, expect } from './carrierApiFixture.js';
import {
  loadCarrierSession,
  SUITE_MIN_SESSION_VALIDITY_MS
} from '../api/clients/carrierSession.js';
import { PlacesClient } from '../api/clients/places.client.js';
import { WaypointsClient, waypointName } from '../api/clients/waypoints.client.js';
import { regionStorageStatePath } from '../config/runtime.js';
import { makeRunId } from './factories/otherCostFactory.js';

type WaypointsWorkerFixtures = {
  /** API autenticada como el carrier de la region AR (1040). */
  otherCarrierApi: APIRequestContext;
};

type WaypointsTestFixtures = {
  /** Id de corrida (8 caracteres [0-9A-Z]) que prefija todo dato propio del test. */
  runId: string;
  waypointsApi: WaypointsClient;
  placesApi: PlacesClient;
  otherCarrierWaypointsApi: WaypointsClient;
  /** carrierId de la sesion secundaria CARGADA (no de la config): lo que el servidor ve de verdad. */
  otherCarrierId: number;
  /** Nombre propio `QA AUTO <runId> <etiqueta>` (<= 50 caracteres). */
  nameFor: (label: string) => string;
};

export const test = base.extend<WaypointsTestFixtures, WaypointsWorkerFixtures>({
  otherCarrierApi: [
    async ({ playwright }, use) => {
      const session = loadCarrierSession({
        storageStatePath: regionStorageStatePath('AR'),
        minValidityMs: SUITE_MIN_SESSION_VALIDITY_MS
      });
      const api = await session.newApiContext(playwright.request);
      try {
        await use(api);
      } finally {
        await api.dispose();
      }
    },
    { scope: 'worker' }
  ],
  runId: async ({}, use) => {
    await use(makeRunId());
  },
  nameFor: async ({ runId }, use) => {
    await use((label: string) => waypointName(runId, label));
  },
  waypointsApi: async ({ carrierApi, carrierSession, runId }, use) => {
    const client = new WaypointsClient(carrierApi, carrierSession, runId);
    let testError: unknown;
    try {
      await use(client);
    } catch (error) {
      testError = error;
      throw error;
    } finally {
      try {
        await client.cleanup();
      } catch (cleanupError) {
        // La falla del test original no se tapa con la de limpieza.
        if (testError === undefined) throw cleanupError;
      }
    }
  },
  placesApi: async ({ carrierApi }, use) => {
    await use(new PlacesClient(carrierApi));
  },
  otherCarrierId: async ({}, use) => {
    await use(loadCarrierSession({ storageStatePath: regionStorageStatePath('AR') }).carrierId);
  },
  otherCarrierWaypointsApi: async ({ otherCarrierApi, runId }, use) => {
    const session = loadCarrierSession({ storageStatePath: regionStorageStatePath('AR') });
    const client = new WaypointsClient(otherCarrierApi, session, runId);
    // Barrido de datos propios viejos del carrier secundario (nadie mas los limpia).
    await client.sweep().catch((error: unknown) => {
      console.warn(
        `[waypoints] sweep del carrier secundario fallo: ${String(error).slice(0, 160)}`
      );
    });
    let testError: unknown;
    try {
      await use(client);
    } catch (error) {
      testError = error;
      throw error;
    } finally {
      try {
        await client.cleanup();
      } catch (cleanupError) {
        // La falla del test original no se tapa con la de limpieza.
        if (testError === undefined) throw cleanupError;
      }
    }
  }
});

export { expect };
