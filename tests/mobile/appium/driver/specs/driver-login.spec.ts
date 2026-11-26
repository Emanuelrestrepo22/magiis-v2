/**
 * DRV-LOGIN — validar el login de la app Chofer: formulario -> pre-home -> home con el control de disponibilidad.
 * Reemplaza como oráculo a los scripts de login que solo imprimían (`driver-login-smoke`, `driver-relogin-and-home`).
 *
 * QUÉ AFIRMA (todo contra el estado real de la app, no solo visibilidad):
 *   1. Cierre de sesión previo: el menú «Cerrar sesión» lleva a `/login` y el formulario queda visible.
 *   2. Login con las credenciales del perfil: sale de `/login`, atraviesa `/pre-home` (aceptar) y termina en
 *      `/navigator/home` (URL), sin volver a `/login`.
 *   3. En el home existe `#availability` visible y su etiqueta es «Disponible» o «No disponible» del locale
 *      (i18n, no solo «hay un botón»).
 *   4. Identidad: el chofer logueado es el esperado (nombre visible en el header, app en primer plano = la del
 *      ambiente, sin viaje en curso) — `DriverSessionPBO.ensureLoggedIn`, que NO vuelve a loguear.
 *
 * PLAN DE CORRIDA
 *   Comando:    npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/driver/specs/driver-login.spec.ts
 *   Dispositivo: emulador/teléfono con la app Chofer instalada (paquete del ambiente, p. ej.
 *               com.magiis.app.test.driver en TEST), Appium arriba (APPIUM_SERVER_URL).
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (test|uat),
 *               ANDROID_DRIVER_UDID (o ANDROID_UDID), MOBILE_CREDENTIALS_FILE (archivo externo con las credenciales
 *               del chofer; las claves salen del perfil, por defecto DRIVER_EMAIL / DRIVER_PASSWORD).
 *               Selectores opcionales: DRIVER_PROFILE (perfil de V1) o F5_CARRIER / CIRCUIT_CARRIER (perfil de
 *               carrier V2 cuya app Chofer se usa; default 1521), APP_LOCALE (es|en|fr) si el idioma del
 *               dispositivo difiere del perfil, MOBILE_ENV_OVERLAY para el overlay de dispositivo.
 *   Duración:   ~1,5-3 min (logout + login + pre-home «Cargando Servicios…» que puede tardar hasta ~40 s).
 *   Precondición: chofer SIN viaje en curso (con viaje abierto el spec aborta sin cerrar sesión: SessionBusyError);
 *               la app puede estar logueada o deslogueada.
 *   Efectos y restauración: la app deja la sesión INICIADA. Cerrar sesión pone al chofer «No disponible»; si al empezar
 *               estaba «Disponible» el spec lo vuelve a dejar «Disponible» en el `finally`. Seguro de re-ejecutar.
 *   Fuera de alcance: credenciales inválidas (no se prueba contra cuentas reales por riesgo de bloqueo), sesión
 *               vencida con popup (MG-001/002/003), recuperar contraseña.
 *   Xray: `@no-xray`. Todavía no existe un Test de Xray para el login del chofer (decisión pendiente), por lo que
 *               no se emite annotation `tms`. El comentario de medición (`xray_comment`) y ≥1 PNG se adjuntan igual.
 *               TODO(G-03): resolver la key TM (reutilizar un Test existente), declararla con
 *               `makeAnnotate('TM-nnn', ROUTE)` (key literal, CONVENTIONS §5) y quitar `@no-xray`.
 */

import { test, expect } from '@playwright/test';
import type { AvailabilityState } from '../../screens/driver/HomeScreen.js';
import {
  attachEvidence,
  closeDriverSpec,
  credentialsSkipReason,
  environmentSkipReason,
  openDriverSpec,
  resolveDriverSpecProfile
} from '../../harness/DriverSpecKit.js';
import type { DriverSpecContext } from '../../harness/DriverSpecKit.js';
import { getDriverAppConfig } from '../../config/appiumRuntime.js';

/** Motivo para saltear por perfil no resoluble o credenciales ilegibles (null = se puede correr). */
function profileSkipReason(): string | null {
  try {
    return credentialsSkipReason(resolveDriverSpecProfile(process.env));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

test.describe('@mobile @no-xray App Chofer · login', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('DRV-LOGIN · Validar el login de la app Chofer: credenciales válidas pasan por pre-home y llegan al home con disponibilidad', async ({}, testInfo) => {
    test.skip(
      !process.env.APPIUM_SERVER_URL,
      'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
    );
    const config = getDriverAppConfig();
    const envReason = environmentSkipReason(config.environment);
    test.skip(envReason !== null, envReason ?? '');
    const profileReason = profileSkipReason();
    test.skip(profileReason !== null, `Perfil del chofer no utilizable: ${profileReason ?? ''}`);

    let ctx: DriverSpecContext | null = null;
    let initialAvailability: AvailabilityState = 'unknown';
    const observations: string[] = [];
    const snap = async (label: string): Promise<void> => {
      await ctx!.evidence.capture(label);
    };

    try {
      ctx = await openDriverSpec('driver-login');
      const { pbo, expectation } = ctx;
      const credentials = expectation.credentials!;

      await test.step('Precondición: estado de la sesión y disponibilidad inicial', async () => {
        const state = await pbo.sessionState();
        observations.push(`estado inicial: ${state.kind}`);
        if (state.kind === 'pre-home') await pbo.dismissPreHome().catch(() => undefined);
        if ((await pbo.sessionState()).kind === 'home') {
          initialAvailability = (await pbo.readAvailability()).state;
        }
        observations.push(`disponibilidad inicial: ${initialAvailability}`);
      });

      await test.step('Dado que la sesión está cerrada: «Cerrar sesión» lleva a /login con el formulario visible', async () => {
        const out = await pbo.ensureLoggedOut();
        observations.push(`logout necesario: ${out.loggedOutNow}`);
        const state = await pbo.sessionState();
        expect(state.kind, 'tras cerrar sesión la app debe estar en /login').toBe('login');
        expect(state.url).toMatch(/\/login/i);
        await snap('01-login-form');
      });

      await test.step('Cuando inicia sesión con las credenciales del perfil: atraviesa pre-home y llega al home', async () => {
        const outcome = await pbo.login(credentials, { timeoutMs: 90_000 });
        observations.push(`pre-home visto: ${outcome.sawPreHome}`);
        expect(outcome.sawPreHome, 'tras el login la app pasa por el overlay /pre-home').toBe(true);
        expect(outcome.homeUrl).toMatch(/\/navigator\/home/i);
        expect(outcome.homeUrl).not.toMatch(/\/login/i);
        await snap('02-home-tras-login');
      });

      await test.step('Entonces el home muestra #availability con una etiqueta de disponibilidad válida del locale', async () => {
        const availability = await pbo.waitUntilAvailabilityIdle(30_000);
        expect(availability.visible, '#availability debe estar visible en el home').toBe(true);
        expect(
          ['available', 'notAvailable'],
          `etiqueta «${availability.label}» no reconocida para el locale ${ctx!.i18n.locale}`
        ).toContain(availability.state);
        observations.push(
          `disponibilidad tras login: ${availability.state} («${availability.label}»)`
        );
        await snap('03-disponibilidad');
      });

      await test.step('Y el chofer logueado es el esperado, en la app del ambiente y sin viaje en curso', async () => {
        const identity = await pbo.ensureLoggedIn(expectation);
        expect(identity.appPackage).toBe(config.appPackage);
        expect(identity.driverDisplayName).toBe(expectation.driverDisplayName);
        const state = await pbo.sessionState();
        expect(state.kind, 'sigue en el home (no se reabrió el login)').toBe('home');
      });
    } finally {
      if (ctx) {
        const live = ctx;

        await test.step('Limpieza: restaurar la disponibilidad inicial', async () => {
          try {
            const state = await live.pbo.sessionState();
            if (state.kind === 'pre-home') await live.pbo.dismissPreHome().catch(() => undefined);
            if ((await live.pbo.sessionState()).kind === 'login') {
              // El spec falló a mitad: se deja la app logueada para que el siguiente run no dependa de esto.
              await live.pbo.login(live.expectation.credentials!, { timeoutMs: 90_000 });
              observations.push('limpieza: sesión reabierta tras un fallo');
            }
            if (initialAvailability === 'available') {
              await live.pbo.waitUntilAvailabilityIdle(30_000);
              await live.pbo.setAvailability('available');
              observations.push('limpieza: disponibilidad restaurada a «Disponible»');
            }
          } catch (error) {
            observations.push(
              `limpieza INCOMPLETA: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        });

        await attachEvidence(testInfo, live.evidence);
        testInfo.annotations.push({
          type: 'xray_comment',
          description: [
            `Ejecución automatizada (Appium) · ${config.environment.toUpperCase()} · ${config.appPackage} en ${config.udid} · perfil ${live.profile.id} · locale ${live.i18n.locale}`,
            ...observations
          ]
            .join('\n')
            .slice(0, 1500)
        });
        await closeDriverSpec(live);
      }
    }
  });
});
