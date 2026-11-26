// tests/fixtures/hybridFixture.ts
// Fixture del flujo híbrido (fase 1): extiende carrierApiFixture con `driverChannel`, el canal por
// el que el chofer recorre el viaje. DRIVER_CHANNEL=api (default) usa la API; `app` queda reservado
// para la fase 2 (Appium in-process) y hoy falla explícito en vez de caer en silencio a la API.
// Uso:
//   import { test, expect } from '../../fixtures/hybridFixture.js';
//   test('…', async ({ driverChannel }) => { await driverChannel.ensureIdle(driverId); … });
import { ApiDriverChannel } from '../channels/ApiDriverChannel.js';
import { resolveDriverChannelKind, type DriverChannel } from '../channels/DriverChannel.js';
import { test as base, expect } from './carrierApiFixture.js';

type HybridFixtures = {
  driverChannel: DriverChannel;
};

export const test = base.extend<HybridFixtures>({
  driverChannel: async ({ driverTravelsApi, travelsApi }, use, testInfo) => {
    const kind = resolveDriverChannelKind();
    if (kind === 'app') {
      throw new Error(
        'DRIVER_CHANNEL=app todavía no está implementado (fase 2: Appium in-process); usar api'
      );
    }
    // Annotation para el reporte y Xray: qué canal ejerció el tramo del chofer en esta corrida.
    testInfo.annotations.push({ type: 'channel', description: kind });
    await use(
      new ApiDriverChannel(driverTravelsApi, async (travelId) =>
        String((await travelsApi.getDetail(travelId)).state ?? '')
      )
    );
  }
});

export { expect };
