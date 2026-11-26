// tests/fixtures/referencePointTripFixture.ts
// Fixture de los tests de viaje con puntos de referencia (MG-1132 PK-5). EXTIENDE waypointsFixture sin
// tocarlo. `flow` = ReferencePointTripFlow del test; su limpieza (viajes cancelados) corre aunque el test
// falle y ANTES de la baja de los puntos (el fixture waypointsApi se desarma despues).
//   import { test, expect } from '../../fixtures/referencePointTripFixture.js';
import { test as base, expect } from './waypointsFixture.js';
import { ReferencePointTripFlow } from '../steps/trips/referencePointTrip.steps.js';
import { redactApiText } from '../api/clients/carrierSession.js';

type TripFixtures = { flow: ReferencePointTripFlow };

export const test = base.extend<TripFixtures>({
  flow: async ({ page, carrierSession, travelsApi, db, runId }, use, testInfo) => {
    const flow = new ReferencePointTripFlow(page, testInfo, carrierSession, travelsApi, db, runId);
    await use(flow);
    try {
      await flow.cleanup();
    } catch (cleanupError) {
      // La falla del test original no se tapa con la de limpieza (X4): si el test ya fallo, se informa y sigue.
      if (testInfo.errors.length === 0) throw cleanupError;
      console.warn(
        `[flow] limpieza con errores: ${redactApiText(String(cleanupError)).slice(0, 300)}`
      );
    }
  }
});

export { expect };
