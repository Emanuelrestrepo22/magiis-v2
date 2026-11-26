// Unit de la parte ligada al driver del pre-flight, con un driver falso (sin Appium ni dispositivo).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Browser } from 'webdriverio';
import { assertDriverPreflight } from './driverPreflight.js';

const PKG = 'com.magiis.app.test.driver';

/** Driver falso: sin WebView, solo paquete en primer plano. */
function fakeDriver(pkg: string): Browser {
  return {
    getCurrentPackage: async () => pkg,
    getContexts: async () => ['NATIVE_APP'],
    pause: async () => undefined
  } as unknown as Browser;
}

describe('assertDriverPreflight (driver falso)', () => {
  it('sin WebView no hay header: aborta por identidad', async () => {
    await assert.rejects(
      assertDriverPreflight(
        fakeDriver(PKG),
        {
          appPackage: PKG,
          driverDisplayName: 'Chofer Prueba'
        },
        { identitySettleMs: 0 }
      ),
      /Pre-flight del Driver abortado.*chofer esperado/
    );
  });

  it('paquete equivocado aborta nombrando ambos paquetes', async () => {
    await assert.rejects(
      assertDriverPreflight(fakeDriver('com.otra'), { appPackage: PKG, driverDisplayName: 'X' }),
      /"com\.otra" != esperada/
    );
  });

  it('con el header vacío reintenta la lectura hasta el tope antes de abortar por identidad', async () => {
    let pauses = 0;
    const driver = {
      getCurrentPackage: async () => PKG,
      getContexts: async () => ['NATIVE_APP'],
      pause: async () => void (pauses += 1)
    } as unknown as Browser;
    await assert.rejects(
      assertDriverPreflight(
        driver,
        { appPackage: PKG, driverDisplayName: 'X' },
        { identitySettleMs: 50 }
      ),
      /chofer esperado/
    );
    assert.ok(pauses >= 1, 'debe haber reintentado al menos una vez');
  });
});
