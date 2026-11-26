// scripts/login-prc-r-session.ts
// Genera el storageState del usuario del perfil «Solo PRC R» del carrier 1040 (MG-1132, TM-1826).
// Lee USER_CARRIER_PRC_R_1040 / PASS_CARRIER_PRC_R_1040 de .env.<ENV> DENTRO del proceso: no imprime
// credenciales ni tokens. El spec NO hace login: usa este archivo (storage/ esta en .gitignore).
// Uso:  npx cross-env ENV=test npx tsx scripts/login-prc-r-session.ts
import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import { mkdirSync, rmSync } from 'node:fs';
import {
  DEFAULT_LOCALE,
  getCurrentEnv,
  getEnvFile,
  resolveBaseURL,
  resolveLoginPath
} from '../tests/config/runtime.js';
import { loadCarrierSession } from '../tests/api/clients/carrierSession.js';
import { waypointsDataFor } from '../tests/data/carrier-v2/waypoints/waypoints.env.js';
import { prcRStorageStatePath } from '../tests/data/carrier-v2/waypoints/prc-r-session.js';

async function main(): Promise<void> {
  dotenv.config({ path: getEnvFile() });
  const username = process.env.USER_CARRIER_PRC_R_1040?.trim();
  const password = process.env.PASS_CARRIER_PRC_R_1040?.trim();
  if (!username || !password) {
    throw new Error(
      'faltan USER_CARRIER_PRC_R_1040 / PASS_CARRIER_PRC_R_1040 en el .env del ambiente'
    );
  }
  const target = prcRStorageStatePath(getCurrentEnv());
  mkdirSync('storage', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: resolveBaseURL(), locale: DEFAULT_LOCALE });
    const page = await context.newPage();
    await page.goto(resolveLoginPath(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('input#email, input[formcontrolname="email"]').first().fill(username);
    await page
      .locator('input#password-input, input[formcontrolname="password"]')
      .first()
      .fill(password);
    await page
      .getByRole('button', { name: /sign\s*in|log\s*in|iniciar|ingresar/i })
      .first()
      .click();
    await page.waitForURL((url) => !/\/auth(entication)?\/|\/login/i.test(url.hash), {
      timeout: 45_000
    });
    await page.getByRole('banner').waitFor();
    await context.storageState({ path: target });
    // El archivo no puede quedar apuntando a otro carrier: se valida el id (solo el número) contra el 1040.
    const expected = waypointsDataFor(getCurrentEnv())?.secondary.carrierId;
    const actual = loadCarrierSession({ storageStatePath: target }).carrierId;
    if (actual !== expected) {
      rmSync(target, { force: true });
      throw new Error(
        `la sesion generada es del carrier ${actual}, se esperaba ${expected}: archivo descartado`
      );
    }
    console.info(`[prc-r] storageState del carrier ${actual} guardado en ${target}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(`[prc-r] ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  process.exit(1);
});
