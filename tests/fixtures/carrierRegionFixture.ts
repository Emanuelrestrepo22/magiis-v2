// tests/fixtures/carrierRegionFixture.ts
// Fixture por spec para correr contra el carrier de OTRA región (p. ej. el métrico `AR`, solo en
// TEST) sin tocar `global-setup.ts` (hot file, un único storageState por ambiente).
//
// Reutiliza el mecanismo de sesión del repo: NO hace login. Abre un contexto nuevo con el
// storageState guardado de la región (`storage/state-carrier-<región>-<env>.json`; la región
// primaria usa `state-carrier-<env>.json`, el mismo que consume el project). Si el archivo no
// existe o la sesión venció, falla pidiendo login humano: el agente no teclea contraseñas.
//
// Uso:
//   import { test, expect } from '../../fixtures/carrierRegionFixture.js';
//   test('...', async ({ carrierPage }) => { const page = await carrierPage('AR'); ... });
import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test as base } from '../TestBase.js';
import {
  DEFAULT_LOCALE,
  getCurrentEnv,
  getStorageStatePath,
  type CarrierRegion
} from '../config/runtime.js';

/** Ruta del storageState de una región en el ambiente activo. */
export function regionStorageStatePath(region: CarrierRegion): string {
  const env = getCurrentEnv();
  return region
    ? `storage/state-carrier-${region.toLowerCase()}-${env}.json`
    : getStorageStatePath(env);
}

type RegionFixtures = {
  /** Abre una página autenticada como el carrier de la región (se cierra sola al terminar el test). */
  carrierPage: (region: CarrierRegion) => Promise<Page>;
};

export const test = base.extend<RegionFixtures>({
  carrierPage: async ({ browser, baseURL }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (region) => {
      const storageState = regionStorageStatePath(region);
      if (!existsSync(storageState)) {
        throw new Error(
          `[carrierRegionFixture] no existe ${storageState}: hace falta un login humano de la región ` +
            `"${region || 'primaria'}" en ${getCurrentEnv()} (el agente no hace login con contraseña).`
        );
      }
      const context = await browser.newContext({
        storageState,
        baseURL,
        locale: DEFAULT_LOCALE,
        viewport: { width: 1920, height: 1080 }
      });
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  }
});

export { expect } from '../TestBase.js';
