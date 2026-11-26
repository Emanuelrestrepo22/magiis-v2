/**
 * Chequeo previo de la corrida LOCAL (npm run doctor:local [-- --hybrid]).
 *
 * Responde "¿puedo correr la suite en esta máquina, ahora?" antes de gastar 30-60 min en una
 * corrida que va a fallar por infraestructura (Appium caído, emulador apagado, .env incompleto,
 * TEST fuera de servicio). Solo lee: no levanta servicios, no loguea, no imprime valores de .env.
 *
 *   base     → carriles unit / web / visual / a11y (Node, .env, navegador, TEST arriba)
 *   --hybrid → además carril híbrido: servidor Appium, emuladores/dispositivos adb y apps del ambiente
 *
 * Sale con 1 si hay algún FAIL (bloqueante); los WARN no cortan pero degradan la corrida
 * (tests que se omiten o fallan por precondición). Runbook: docs/ci/COMO-CORRER-LOS-TESTS.md.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { getCurrentEnv, getEnvFile, resolveBaseURL } from '../tests/config/runtime.js';
import { validateEnv } from '../tests/utils/envSchema.js';
import { availabilityUrls, probeEnvironment } from '../tests/utils/envAvailability.js';

type Status = 'OK' | 'WARN' | 'FAIL';
interface Check {
  name: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];
const add = (name: string, status: Status, detail: string): void => {
  checks.push({ name, status, detail });
};
const hasEnv = (name: string): boolean => Boolean(process.env[name]?.trim());

/** Paquetes de las apps por ambiente, medidos con `adb shell pm list packages` (2026-11-11). */
const APP_PACKAGES: Record<string, { driver: string; passenger: string }> = {
  test: { driver: 'com.magiis.app.test.driver', passenger: 'com.magiis.app.test.passenger' },
  uat: { driver: 'com.magiis.app.uat.driver', passenger: 'com.magiis.app.uat.passenger' },
  // Supuesto: prod sin segmento de ambiente (com.magiis.app.driver está instalado en los AVD).
  prod: { driver: 'com.magiis.app.driver', passenger: 'com.magiis.app.passenger' }
};

async function checkBase(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  add('Node >= 20', major >= 20 ? 'OK' : 'FAIL', `v${process.versions.node}`);

  add(
    'Repo fuera de OneDrive',
    /onedrive/i.test(process.cwd()) ? 'WARN' : 'OK',
    /onedrive/i.test(process.cwd())
      ? 'npm más lento y ALLURE=1 falla (errno -4094): clonar en p. ej. C:\\dev'
      : process.cwd()
  );

  const envFile = getEnvFile();
  if (!existsSync(envFile)) {
    add(`Archivo ${envFile}`, 'FAIL', 'no existe: copiar .env.example y completar credenciales');
    return;
  }
  try {
    validateEnv();
    add(`Archivo ${envFile}`, 'OK', `ENV=${getCurrentEnv()} validado contra envSchema`);
  } catch (error) {
    add(
      `Archivo ${envFile}`,
      'FAIL',
      (error as Error).message.trim().split('\n').slice(1).join(' ')
    );
    return;
  }

  for (const region of ['US', 'AR']) {
    add(
      `Credenciales carrier ${region}`,
      hasEnv(`USER_CARRIER_${region}`) && hasEnv(`PASS_CARRIER_${region}`) ? 'OK' : 'WARN',
      `USER_CARRIER_${region}/PASS_CARRIER_${region}` +
        (region === 'AR' ? ' (specs de unidades MG-1189/1190/1193 con REGION_SESSIONS=AR)' : '')
    );
  }

  const browser = chromium.executablePath();
  add(
    'Navegador Chromium de Playwright',
    existsSync(browser) ? 'OK' : 'FAIL',
    existsSync(browser) ? browser : 'falta: npx playwright install chromium'
  );

  const probe = await probeEnvironment({
    urls: availabilityUrls(resolveBaseURL()),
    backoffMs: [0],
    timeoutMs: 10_000
  });
  add(
    `Ambiente ${getCurrentEnv()} disponible`,
    probe.ok ? 'OK' : 'FAIL',
    probe.attempts.map((a) => `${new URL(a.url).pathname} -> ${a.outcome}`).join(' | ')
  );
}

function adb(args: string[]): string {
  return execFileSync('adb', args, { encoding: 'utf8', timeout: 15_000 });
}

async function checkHybrid(): Promise<void> {
  const appiumUrl = (process.env.APPIUM_SERVER_URL?.trim() || 'http://127.0.0.1:4723').replace(
    /\/$/,
    ''
  );
  try {
    const response = await fetch(`${appiumUrl}/status`, { signal: AbortSignal.timeout(5_000) });
    add(
      'Servidor Appium',
      response.ok ? 'OK' : 'FAIL',
      `${appiumUrl}/status -> HTTP ${response.status}`
    );
  } catch {
    add(
      'Servidor Appium',
      'FAIL',
      `${appiumUrl}/status sin respuesta: appium --port 4723 --base-path /`
    );
  }

  let devices: string[] = [];
  try {
    devices = adb(['devices'])
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([id, state]) => id && state === 'device')
      .map(([id]) => id);
  } catch {
    add('adb', 'FAIL', 'adb no está en el PATH (Android SDK platform-tools)');
    return;
  }
  // Android depura un solo WebView a la vez: chofer + pasajero necesitan dos dispositivos.
  add(
    'Dispositivos Android',
    devices.length >= 2 ? 'OK' : devices.length === 1 ? 'WARN' : 'FAIL',
    devices.length
      ? `${devices.join(', ')}${devices.length === 1 ? ' (1 solo: no alcanza para chofer + pasajero)' : ''}`
      : 'ninguno: iniciar un AVD (emulator -avd Pixel_7_QA) o conectar un teléfono'
  );

  const env = getCurrentEnv();
  const expected = {
    driver: process.env.ANDROID_DRIVER_APP_PACKAGE?.trim() || APP_PACKAGES[env].driver,
    passenger: process.env.ANDROID_PASSENGER_APP_PACKAGE?.trim() || APP_PACKAGES[env].passenger
  };
  for (const device of devices) {
    let installed: Set<string>;
    try {
      installed = new Set(
        adb(['-s', device, 'shell', 'pm', 'list', 'packages', 'com.magiis.app'])
          .split(/\r?\n/)
          .map((line) => line.replace(/^package:/, '').trim())
      );
    } catch {
      // `adb devices` lo lista como "device" pero el shell no contesta: emulador colgado.
      add(`Apps ${env} en ${device}`, 'FAIL', 'adb shell sin respuesta en 15s: reiniciar el AVD');
      continue;
    }
    const missing = Object.entries(expected)
      .filter(([, pkg]) => !installed.has(pkg))
      .map(([actor, pkg]) => `${actor} (${pkg})`);
    add(
      `Apps ${env} en ${device}`,
      missing.length === 0 ? 'OK' : 'WARN',
      missing.length === 0
        ? `${expected.driver}, ${expected.passenger}`
        : `faltan: ${missing.join(', ')}`
    );
  }

  add(
    'Credenciales chofer',
    hasEnv('DRIVER_EMAIL') && hasEnv('DRIVER_PASSWORD') ? 'OK' : 'WARN',
    'DRIVER_EMAIL/DRIVER_PASSWORD (canal chofer por API y por app)'
  );
}

async function main(): Promise<void> {
  const hybrid = process.argv.includes('--hybrid');
  await checkBase();
  if (hybrid) await checkHybrid();

  const icon: Record<Status, string> = { OK: '✓', WARN: '!', FAIL: '✗' };
  for (const c of checks)
    console.info(`${icon[c.status]} ${c.status.padEnd(4)} ${c.name}: ${c.detail}`);
  const fails = checks.filter((c) => c.status === 'FAIL').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  console.info(
    `\n${fails ? '✗' : '✓'} ${checks.length} chequeos: ${fails} FAIL, ${warns} WARN` +
      (hybrid ? '' : ' (carril híbrido: agregar --hybrid)')
  );
  process.exit(fails ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
