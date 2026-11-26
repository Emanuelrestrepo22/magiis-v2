/**
 * DRV-ADDR-SURFACES — guards de regresión del buscador de direcciones de la app Chofer (MG-117, «Editar viaje» ›
 * Destino). Migración V1 -> V2 de `driver-address-surfaces` (tareas D-18 + D-19 del plan de migración Appium).
 *
 * ORIGEN. Campaña MG-117 del 13/08/2026 (ATR TM-668, 17/17 en TEST y revalidado en UAT sobre
 * `com.magiis.app.uat.driver` 2.6.15). Entran los casos deterministas y observables por red; TM-652 / TM-658 /
 * TM-659 dependen del catálogo del ambiente (mejor en `magiis-api-e2e`), TM-653 / TM-660 exigen datos de viaje,
 * TM-661 no es verificable en dispositivo (el sesgo sale del origen del viaje, no del GPS) y TM-666 es la corrida
 * completa de la batería.
 *
 * QUÉ AFIRMA (un test por caso; la batería corre UNA vez y cada test lee su resultado)
 *   TM-650  consulta el endpoint propio (`places/autocomplete`) y cero tráfico a Google, por DOS canales
 *           (fetch/XHR + Resource Timing: el SDK de Places no pasa por fetch/XHR).
 *   TM-651  el request lleva address + latitude + longitude y NO lleva radius ni language.
 *   TM-654  el tecleo continuo colapsa en UNA llamada ~300 ms tras la última tecla (ráfaga con intervalos sellados).
 *   TM-655  un término repetido no dispara una llamada nueva (distinctUntilChanged).
 *   TM-656  con 2 caracteres no consulta (exige prueba de vida: alguna longitud >= 3 sí consultó).
 *   TM-657  con exactamente 3 caracteres sí consulta (habilita el IATA).
 *   TM-662  todas las llamadas de la sesión de búsqueda comparten sessionToken.
 *   TM-663  tras seleccionar una predicción, la búsqueda siguiente usa un sessionToken nuevo.
 *   TM-664  un término sin resultados muestra un estado vacío controlado (HTTP 200, sin spinner ni error).
 *   TM-665  ante 5xx / error de red degrada de forma controlada y no cae a Google (MECANISMO: falla inyectada).
 *   ORDEN   las direcciones de caché van por delante de los aeropuertos lejanos. SIN KEY DE XRAY a propósito: en PAX
 *           es TM-727, en el Chofer el Test nunca se creó (hueco anotado en MG-931). No se inventa una key.
 *
 * PLAN DE CORRIDA
 *   Comando:    ENV=uat npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/driver/specs/driver-address-surfaces.spec.ts
 *   Dispositivo: emulador/teléfono con la app Chofer de UAT (`com.magiis.app.uat.driver`), Appium arriba
 *               (APPIUM_SERVER_URL). FÍSICO recomendado (V1 calibró en Samsung A05): en emulador los resultados que
 *               dependen de GPS / Places / red pueden diferir y NO son concluyentes.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (debe ser `uat`),
 *               ANDROID_DRIVER_UDID (o ANDROID_UDID), ANDROID_DRIVER_SYSTEM_PORT (si hay otro dispositivo en el
 *               mismo servidor Appium), MOBILE_CREDENTIALS_FILE (solo si la app está deslogueada: el spec
 *               inicia sesión por el kit y NO toca la disponibilidad), DRIVER_PROFILE / F5_CARRIER / CIRCUIT_CARRIER.
 *   Duración:   ~4-6 min con viaje en curso (11 casos x ventanas de 4,2 s); con la precondición ausente, < 1 min.
 *   Precondición: la app logueada y un VIAJE EN CURSO con origen definido y lápiz de edición visible (el buscador vive
 *               dentro de «Editar viaje»; viajes con costo fijo, alquiler o afiliado no lo muestran). SIN viaje en
 *               curso, TODOS los tests se saltean con el motivo: NO ejercido, nunca verde.
 *   Efectos:    SOLO LECTURA. No crea ni cierra viajes, no acepta ofertas, no cambia la disponibilidad, no guarda
 *               direcciones y NUNCA toca «Confirmar» de «Editar viaje». TM-663 elige una predicción (cambia solo el
 *               borrador del modal); el `finally` sale con la flecha y «Cancelar».
 *   Seguridad:  corre solo con ENV=uat; contra otro ambiente o contra un paquete que no sea de UAT se saltea.
 *   Evidencia:  UN PNG por caso, tomado en el instante del veredicto (`evidence/uat/mobile/<runLabel>/`, ignorado
 *               por git).
 *   Xray:       las keys TM van como annotation `tms` (xrayKeyAnnotations); el caso ORDEN no lleva.
 *   Hallazgos:  los veredictos de TM-654 y TM-665 se apoyan en eventos / fallas SINTÉTICOS (nivel `mechanism`): un
 *               FAIL NO es reportable como bug sin reproducción con la UI real.
 */

import { test, expect } from '@playwright/test';
import { getDriverAppConfig } from '../../config/appiumRuntime.js';
import { I18n } from '../../core/I18n.js';
import { MobileSession } from '../../core/MobileSession.js';
import type { Evidence } from '../../core/Evidence.js';
import type { ScreenshotRef } from '../../core/ScreenEvidence.js';
import {
  closeDriverSpec,
  credentialsSkipReason,
  environmentSkipReason,
  newRunLabel,
  openDriverSpec,
  resolveDriverSpecProfile,
  xrayKeyAnnotations
} from '../../harness/DriverSpecKit.js';
import type { DriverSpecContext } from '../../harness/DriverSpecKit.js';
import { DriverAddressSearchPBO } from '../../pbo/DriverAddressSearchPBO.js';
import { DriverSessionPBO } from '../../pbo/DriverSessionPBO.js';
import { AddressSearchScreen } from '../../screens/driver/address/AddressSearchScreen.js';
import { ORDER_CASE_KEY } from '../../screens/driver/address/driverAddressVerdicts.js';
import type { DriverCaseResult } from '../../screens/driver/address/driverAddressVerdicts.js';

const REAL_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

let RESULTS: DriverCaseResult[] = [];
/** Si no es null, TODOS los tests se saltean con este motivo (precondición ausente, nunca un verde). */
let SKIP_REASON: string | null = null;
const SHOTS = new Map<string, ScreenshotRef[]>();

/** Motivo para saltear por perfil no resoluble o credenciales ilegibles (null = legibles). */
function credentialsReason(): string | null {
  try {
    return credentialsSkipReason(resolveDriverSpecProfile(process.env));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Guardas previas a abrir sesión: Appium, ambiente UAT y paquete de UAT (nunca PROD). */
function preflightSkipReason(): string | null {
  if (!process.env.APPIUM_SERVER_URL)
    return 'Requiere APPIUM_SERVER_URL y el dispositivo conectado.';
  const config = getDriverAppConfig();
  const env = environmentSkipReason(config.environment);
  if (env) return env;
  if (config.environment !== 'uat') {
    return `Guards calibrados en UAT: requieren ENV=uat (ambiente actual: ${config.environment}).`;
  }
  if (!config.appPackage?.includes('.uat.')) {
    return 'El paquete de la app Chofer no es el de UAT: este spec no corre contra otro paquete.';
  }
  return null;
}

type Opened = {
  session: MobileSession;
  evidence: Evidence;
  sessionPbo: DriverSessionPBO;
  /** Solo con credenciales legibles: permite iniciar sesión si la app está deslogueada. */
  kit: DriverSpecContext | null;
  log: (m: string) => void;
};

/** Abre la sesión Appium. Con credenciales legibles usa el kit; sin ellas, una sesión de solo lectura. */
async function open(): Promise<Opened> {
  const log = (m: string): void => console.info(`[driver-address-surfaces] ${m}`);
  if (credentialsReason() === null) {
    const kit = await openDriverSpec('driver-address-surfaces');
    return { session: kit.session, evidence: kit.evidence, sessionPbo: kit.pbo, kit, log };
  }
  const config = getDriverAppConfig();
  const session = new MobileSession(config, { log });
  await session.start();
  const evidence = session.evidence(newRunLabel('driver-address-surfaces'));
  const sessionPbo = DriverSessionPBO.forSession(session, new I18n('es'), log);
  return { session, evidence, sessionPbo, kit: null, log };
}

test.describe('@mobile App Chofer · guards del buscador de direcciones (MG-117)', () => {
  // Sesión Appium (~15 s) + navegación con taps nativos + 11 casos con ventanas de 4,2 s + 3 escenarios de falla.
  test.describe.configure({ timeout: 900_000 });

  // La batería corre UNA vez: un solo recorrido del dispositivo y cada test lee su resultado. Alternativa
  // descartada: una sesión por caso (PAX): el costo de sesión + navegación se pagaría once veces.
  test.beforeAll(async () => {
    SKIP_REASON = preflightSkipReason();
    if (SKIP_REASON) return;

    let opened: Opened | null = null;
    let screen: AddressSearchScreen | null = null;
    try {
      opened = await open();
      const { session, evidence, sessionPbo, kit, log } = opened;
      let state = await sessionPbo.waitForStableSessionState();
      if (state.kind === 'login') {
        if (!kit) {
          SKIP_REASON = `Sesión en /login y sin credenciales legibles (${credentialsReason() ?? 'MOBILE_CREDENTIALS_FILE'}): precondición no cumplida.`;
          return;
        }
        // Solo inicia sesión; NO toca la disponibilidad (a diferencia de `startSession`).
        await kit.pbo.ensureLoggedIn(kit.expectation);
        state = await sessionPbo.waitForStableSessionState();
      }
      screen = new AddressSearchScreen(session);
      const reach = await screen.reachSearch();
      if (!reach.reachable) {
        SKIP_REASON = `${reach.reason} (estado de sesión: ${state.kind}).`;
        await evidence.capture('00-sin-precondicion').catch(() => undefined);
        SHOTS.set('00', evidence.all());
        return;
      }
      await evidence.capture('00-buscador-abierto').catch(() => undefined);
      const pbo = new DriverAddressSearchPBO(screen, session.driver, {
        log,
        // La captura se toma ACÁ, con la pantalla en el estado que produjo el veredicto.
        onCase: async (r) => {
          const ref = await evidence.capture(
            `${r.key}-${r.status}`.replace(/[^a-zA-Z0-9._-]/g, '_')
          );
          SHOTS.set(r.key, [ref]);
        }
      });
      RESULTS = await pbo.runAll();
    } catch (e) {
      SKIP_REASON = `Setup no completado: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      await screen?.leaveWithoutSaving();
      if (opened) {
        await opened.evidence.capture('99-final').catch(() => undefined);
        if (opened.kit) await closeDriverSpec(opened.kit);
        else await opened.session.end();
      }
    }
  });

  /** Convierte el resultado de un caso en aserción. SIN_DATOS / NO_EJERCIDO son skip, no verde. */
  function guard(key: string, descripcion: string, tags: string[]): void {
    const annotation = REAL_KEY.test(key) ? xrayKeyAnnotations(key) : [];

    test(
      `DRV-ADDR-validar-${key} · ${descripcion}`,
      { annotation, tag: ['@mobile', '@mg117', ...tags] },
      async ({}, testInfo) => {
        test.skip(SKIP_REASON !== null, SKIP_REASON ?? '');
        const r = RESULTS.find((x) => x.key === key);
        test.skip(!r, `La batería no produjo resultado para ${key}.`);
        const found = r as DriverCaseResult;
        for (const shot of SHOTS.get(key) ?? []) {
          await testInfo.attach(shot.label, { path: shot.relPath, contentType: 'image/png' });
        }
        const detalle = `${found.verdict}\n  medido: ${JSON.stringify(found.measured)}`;
        testInfo.annotations.push({
          type: 'xray_comment',
          description: `[${found.status}] ${detalle}`.slice(0, 1500)
        });
        test.skip(
          found.status === 'SIN_DATOS' || found.status === 'NO_EJERCIDO',
          `${found.status}: ${detalle}`
        );
        expect(found.status, detalle).toBe('PASS');
      }
    );
  }

  // Precondición: si hay más de un buscador abierto la batería aborta y todo queda sin ejercer.
  test('DRV-ADDR-validar-precondicion · Validar que hay un solo buscador abierto', async () => {
    test.skip(SKIP_REASON !== null, SKIP_REASON ?? '');
    const abort = RESULTS.find((r) => r.key === 'PRECONDICION');
    expect(abort, abort?.verdict ?? 'sin abort').toBeUndefined();
  });

  // ── Gates del ATP (prioridad high) ──
  guard('TM-650', 'TC1 · consulta el endpoint propio y cero tráfico nuevo a Google (dos canales)', [
    '@high'
  ]);
  guard('TM-651', 'TC2 · el request lleva address y coordenadas, y no lleva radius ni language', [
    '@high'
  ]);
  guard(
    'TM-654',
    'TC5 · el tecleo continuo colapsa en una sola llamada ~300 ms tras la última tecla',
    ['@high']
  );
  guard('TM-656', 'TC7 · con 2 caracteres no consulta', ['@high']);
  guard('TM-657', 'TC8 · con 3 caracteres sí consulta', ['@high']);
  guard('TM-662', 'TC13 · todas las llamadas de la sesión comparten sessionToken', ['@high']);
  guard('TM-665', 'TC16 · ante 5xx o error de red degrada controlado y no cae a Google', ['@high']);

  // ── Resto de la batería (prioridad medium) ──
  guard('TM-655', 'TC6 · un término repetido no dispara una nueva llamada', ['@medium']);
  guard('TM-663', 'TC14 · tras seleccionar, la búsqueda siguiente usa un sessionToken nuevo', [
    '@medium'
  ]);
  guard('TM-664', 'TC15 · un término sin resultados muestra un estado vacío controlado', [
    '@medium'
  ]);

  // ── Hueco de cobertura del Chofer, sin Test en Xray todavía ──
  guard(ORDER_CASE_KEY, 'las direcciones de caché van por delante de aeropuertos lejanos', [
    '@medium'
  ]);

  test.afterAll(() => {
    if (SKIP_REASON) {
      console.info(`\n[driver-address-surfaces] sin ejercer: ${SKIP_REASON}`);
      return;
    }
    console.info('\n[driver-address-surfaces] resumen de la batería:');
    for (const r of RESULTS)
      console.info(`  ${r.key.padEnd(16)} ${r.status.padEnd(11)} ${r.verdict}`);
  });
});
