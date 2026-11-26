/**
 * DRV-AVAIL — validar el toggle «Disponible» / «No disponible» de la app Chofer, con ramas de error HTTP.
 * Si el chofer no está «Disponible», la asignación del carrier falla con `DRIVER_IS_NOT_AVAILABLE`: este control
 * es precondición de todo el circuito de viajes.
 *
 * QUÉ AFIRMA
 *   1. Toggle exitoso: la etiqueta pasa al estado opuesto (i18n del locale), el control vuelve a habilitarse, la
 *      request de estado (`AVAILABILITY_ENDPOINT_PATTERN`) se observa con 2xx en el capture de red del WebView y el
 *      estado PERSISTE en el backend: se lee del log de arranque de la app tras recargarla (core/AppStatusLog.ts),
 *      no de la etiqueta, que puede no coincidir con el backend (operability tardía, medido 24/11/2026).
 *   2. Ramas 400 / 428 / 409 (un test por rama): con una respuesta HTTP sintética inyectada en la request de estado
 *      (no toca el backend) el estado mostrado NO cambia, el control NO queda bloqueado (se libera en 30 s) y la
 *      regla de inyección hizo match (si no, el endpoint supuesto es incorrecto y falla explícito). Un aviso, si
 *      aparece, se registra como observación sin exigirlo: el `catch` del toggle en la app no abre modal
 *      (magiis-mobile-driver-v2@develop, home.page.ts `toggleAvailability`, leído 24/11/2026).
 *
 * PLAN DE CORRIDA
 *   Comando:    npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/driver/specs/driver-availability.spec.ts
 *   Dispositivo: emulador/teléfono con la app Chofer del ambiente, Appium arriba (APPIUM_SERVER_URL). UN chofer por
 *               dispositivo; sin otra sesión usando al mismo chofer.
 *   Claves de entorno (solo nombres): APPIUM_SERVER_URL, ENV (test|uat), ANDROID_DRIVER_UDID (o ANDROID_UDID),
 *               MOBILE_CREDENTIALS_FILE; opcionales DRIVER_PROFILE / F5_CARRIER / CIRCUIT_CARRIER, APP_LOCALE,
 *               MOBILE_ENV_OVERLAY.
 *   Duración:   ~3-8 min en total (cada test abre su propia sesión; el pre-home puede tardar ~40 s).
 *   Precondición: chofer SIN viaje en curso (con viaje abierto aborta: SessionBusyError). Mientras está «Disponible»
 *               el dispatcher puede ofrecerle viajes reales: correr en horario de baja actividad o en un carrier de
 *               QA sin tráfico. ESTE SPEC NUNCA ACEPTA OFERTAS NI INICIA VIAJES.
 *   Restauración: el `finally` de CADA test limpia las reglas de inyección, cierra avisos y devuelve la disponibilidad
 *               a la inicial de ese test, también si el test falló (si arrancó «No disponible» no queda «Disponible»).
 *   Fuera de alcance: gate de versión desactualizada, cambio de estado con viaje asignado, verificación en backend
 *               por API del carrier.
 *   Xray: `@no-xray`. Sin Test de Xray todavía.
 *               TODO(G-03): resolver las keys TM (reutilizar Tests existentes), declararlas con
 *               `makeAnnotate('TM-nnn', ROUTE)` (key literal, CONVENTIONS §5) y quitar `@no-xray`.
 */

import { test, expect } from '@playwright/test';
import type { AvailabilityState } from '../../screens/driver/HomeScreen.js';
import {
  AVAILABILITY_ENDPOINT_PATTERN,
  AVAILABILITY_ERROR_BRANCHES,
  anySucceeded,
  availabilityRuleId,
  buildAvailabilityFaultRule,
  findAvailabilityRequests,
  summarizeRequests
} from '../../harness/AvailabilityFaults.js';
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
import { Waits } from '../../core/Waits.js';
import {
  readBackendDriverStatus,
  toAvailability,
  type BackendDriverStatus
} from '../../core/AppStatusLog.js';
import {
  clearWebViewFaultInjection,
  installWebViewFaultInjection,
  readWebViewFaultInjectionState
} from '../../core/WebViewFaultInjection.js';
import {
  clearWebViewNetworkCapture,
  installWebViewNetworkCapture,
  readWebViewNetworkCapture
} from '../../core/WebViewNetworkCapture.js';

type Stable = 'available' | 'notAvailable';

const OPPOSITE: Record<Stable, Stable> = { available: 'notAvailable', notAvailable: 'available' };

/** Motivo para saltear por perfil no resoluble o credenciales ilegibles (null = se puede correr). */
function profileSkipReason(): string | null {
  try {
    return credentialsSkipReason(resolveDriverSpecProfile(process.env));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Guardas de entorno comunes; saltea (no falla) si faltan prerequisitos. */
function guard(): void {
  test.skip(
    !process.env.APPIUM_SERVER_URL,
    'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
  );
  const envReason = environmentSkipReason(getDriverAppConfig().environment);
  test.skip(envReason !== null, envReason ?? '');
  const profileReason = profileSkipReason();
  test.skip(profileReason !== null, `Perfil del chofer no utilizable: ${profileReason ?? ''}`);
}

function isStable(state: AvailabilityState): state is Stable {
  return state === 'available' || state === 'notAvailable';
}

/**
 * Estado PERSISTIDO según el backend: recarga la app y lee el estado que pidió al backend al arrancar (log de
 * arranque, ver `core/AppStatusLog.ts`). La etiqueta NO es oráculo: tras recargar puede pintar «No Disponible» con
 * el backend en ONLINE (medido 24/11/2026). Devuelve también la etiqueta para registrar si no coincide.
 */
async function readPersisted(ctx: DriverSpecContext): Promise<{
  backend: BackendDriverStatus;
  state: Stable | null;
  uiState: AvailabilityState;
  label: string;
}> {
  const backend = await readBackendDriverStatus(ctx.session);
  const ui = await ctx.pbo.reachHome(ctx.expectation, { timeoutMs: 120_000 });
  return { backend, state: toAvailability(backend), uiState: ui.state, label: ui.label };
}

/** Registra (sin fallar) si la etiqueta no coincide con el backend: candidato a hallazgo de producto. */
function noteLabelMismatch(
  persisted: Awaited<ReturnType<typeof readPersisted>>,
  notes: string[],
  when: string
): void {
  if (persisted.state && persisted.uiState !== persisted.state) {
    notes.push(
      `OBSERVACIÓN ${when}: backend ${persisted.backend} pero la etiqueta muestra «${persisted.label}» (${persisted.uiState})`
    );
  }
}

/**
 * Limpieza garantizada: borra reglas de inyección, cierra avisos y devuelve la disponibilidad a `initial`,
 * VERIFICANDO el estado persistido tras recargar (hasta 2 intentos). Nunca lanza (no tapa el error del test);
 * devuelve si quedó verificada y lo registra en `notes`.
 */
async function restore(
  ctx: DriverSpecContext,
  initial: Stable | null,
  notes: string[]
): Promise<boolean> {
  try {
    // Si el test murió tras relanzar la app, chromedriver puede seguir pegado a la página vieja: re-enganchar
    // primero, o la restauración falla y el chofer queda «Disponible» (medido 24/11/2026).
    if ((await ctx.session.driver.getUrl().catch(() => null)) === null) {
      const web = await ctx.session.reattachWebview({ timeoutMs: 45_000 });
      notes.push(`limpieza: WebView re-enganchada (${web ?? 'sin WebView'})`);
    }
    await clearWebViewFaultInjection(ctx.session.driver).catch(() => undefined);
    await ctx.pbo.acknowledgeAlert().catch(() => undefined);
    if (!initial) return true;
    // La verdad es el backend (log de arranque), nunca la etiqueta.
    let persisted = await readPersisted(ctx);
    noteLabelMismatch(persisted, notes, 'en la limpieza');
    for (let attempt = 1; attempt <= 3 && persisted.state !== initial; attempt++) {
      // Si la etiqueta ya muestra el estado inicial pero el backend no lo tiene, el control «cree» que no hay nada
      // que cambiar y un toque reenvía el estado actual: ese primer toque solo resincroniza la etiqueta con el
      // backend (medido 24/11/2026). Después se pide el estado inicial y se verifica de nuevo en el backend.
      if (persisted.uiState === initial) {
        await ctx.pbo.toggleAvailability({ timeoutMs: 60_000 });
        notes.push('limpieza: toque de resincronización (la etiqueta no coincidía con el backend)');
      }
      await ctx.pbo.setAvailability(initial, { timeoutMs: 60_000 });
      persisted = await readPersisted(ctx);
      noteLabelMismatch(persisted, notes, `en la limpieza (intento ${attempt})`);
    }
    if (persisted.state === initial) {
      notes.push(`limpieza verificada en el backend: ${persisted.backend}`);
      return true;
    }
    notes.push(
      `limpieza NO VERIFICADA: el chofer no quedó «${initial}» en el backend (revisar a mano)`
    );
    return false;
  } catch (error) {
    notes.push(
      `limpieza INCOMPLETA (revisar el chofer a mano): ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

function commentOf(ctx: DriverSpecContext, lines: string[]): string {
  return [
    `Ejecución automatizada (Appium) · ${ctx.config.environment.toUpperCase()} · ${ctx.config.appPackage} en ${ctx.config.udid} · perfil ${ctx.profile.id} · locale ${ctx.i18n.locale}`,
    ...lines
  ]
    .join('\n')
    .slice(0, 1500);
}

test.describe('@mobile @no-xray App Chofer · disponibilidad', () => {
  // Sin modo serial: cada test abre su propia sesión y restaura en su `finally`, así que una rama que falla no
  // debe saltear las otras. El orden igual es secuencial (workers: 1 en playwright.mobile.config.ts).
  test.describe.configure({ timeout: 360_000 });

  test('DRV-AVAIL-validar-toggle-disponibilidad · Validar que el cambio de disponibilidad se refleja en la etiqueta, llega al backend y persiste al recargar la app', async ({}, testInfo) => {
    guard();
    let ctx: DriverSpecContext | null = null;
    let initial: Stable | null = null;
    const lines: string[] = [];

    try {
      ctx = await openDriverSpec('driver-availability');
      const c = ctx;
      const driver = c.session.driver;

      await test.step('Dado el chofer en el home con el capture de red del WebView activo', async () => {
        // Estado inicial según el BACKEND (log de arranque), no la etiqueta que haya dejado una corrida anterior.
        const persisted = await readPersisted(c);
        expect(
          persisted.state,
          `el backend informa ${persisted.backend}: solo se prueba desde ONLINE u OFFLINE (sin viaje en curso)`
        ).not.toBeNull();
        initial = persisted.state;
        lines.push(
          `estado inicial en el backend: ${persisted.backend}; etiqueta «${persisted.label}»`
        );
        noteLabelMismatch(persisted, lines, 'al inicio');
        // El toggle parte de lo que muestra la etiqueta: si no coincide con el backend no se puede ejercer.
        expect(
          persisted.uiState,
          'la etiqueta debe coincidir con el backend antes de tocar el control'
        ).toBe(persisted.state);
        await installWebViewNetworkCapture(driver);
        await clearWebViewNetworkCapture(driver);
        await c.evidence.capture(`01-inicial-${persisted.uiState}`);
      });

      const start = initial as Stable | null;
      if (!start) throw new Error('disponibilidad inicial no determinada');
      const target = OPPOSITE[start];

      await test.step(`Cuando toca el control: la etiqueta pasa a «${target}» y el control se libera`, async () => {
        const out = await c.pbo.toggleAvailability({ timeoutMs: 60_000 });
        lines.push(
          `toggle: «${out.labelBefore}» -> «${out.labelAfter}» (cambió=${out.changed}, liberado=${out.released})`
        );
        await c.evidence.capture(`02-tras-toggle-${out.after}`);
        expect(out.changed, 'la etiqueta debe cambiar al estado opuesto').toBe(true);
        expect(out.after).toBe(target);
        expect(out.released, 'el control debe quedar habilitado (no bloqueado)').toBe(true);
        expect(
          c.i18n.matches(
            out.labelAfter,
            target === 'available' ? 'driver.home.available' : 'driver.home.notAvailable'
          )
        ).toBe(true);
      });

      await test.step('Entonces la request de estado se observó en el WebView con 2xx', async () => {
        const dump = await readWebViewNetworkCapture(driver);
        const hits = findAvailabilityRequests(dump.entries);
        lines.push(
          `requests «${AVAILABILITY_ENDPOINT_PATTERN}»: ${hits.length} (2xx=${anySucceeded(hits)})`
        );
        expect(
          hits.length,
          `ninguna request contiene «${AVAILABILITY_ENDPOINT_PATTERN}»; el endpoint supuesto es incorrecto. Vistas: ${summarizeRequests(dump.entries).join(' | ')}`
        ).toBeGreaterThan(0);
        expect(anySucceeded(hits), 'la request de estado debe terminar con 2xx').toBe(true);
      });

      await test.step('Y al recargar la app el estado persiste en el backend (log de arranque)', async () => {
        const persisted = await readPersisted(c);
        lines.push(`tras recargar: backend ${persisted.backend}; etiqueta «${persisted.label}»`);
        noteLabelMismatch(persisted, lines, 'tras recargar');
        await c.evidence.capture(`03-tras-recargar-${persisted.uiState}`);
        expect(persisted.state, 'el estado nuevo debe persistir en el backend').toBe(target);
        // Sin aserción sobre la etiqueta tras ESTA recarga: es por JavaScript (mecanismo del oráculo, no un gesto de
        // usuario) y ahí la etiqueta puede desfasarse por `operability` tardía (3/3). Con gestos reales — cerrar desde
        // Recientes o Forzar detención y reabrir — coincidió 10/10 (24/11/2026): riesgo técnico, no defecto
        // (docs/analysis/appium-migration/H-APP-DRV-01-etiqueta-disponibilidad.md). Se registra como observación.
      });
    } finally {
      if (ctx) {
        const live = ctx;

        await test.step(`Limpieza: volver a «${initial ?? 'sin determinar'}»`, async () => {
          const verified = await restore(live, initial, lines);
          const now = await live.pbo.readAvailability().catch(() => null);
          if (now) await live.evidence.capture(`04-restaurado-${now.state}`).catch(() => undefined);
          expect
            .soft(
              verified,
              'la limpieza debe dejar la disponibilidad inicial PERSISTIDA (verificada tras recargar)'
            )
            .toBe(true);
        });

        await attachEvidence(testInfo, live.evidence);
        testInfo.annotations.push({ type: 'xray_comment', description: commentOf(live, lines) });
        await closeDriverSpec(live);
      }
    }
  });

  for (const branch of AVAILABILITY_ERROR_BRANCHES) {
    test(`DRV-AVAIL-validar-error-http-${branch.status} · Validar que un error ${branch.status} (${branch.meaning}) no cambia el estado y no deja el control bloqueado`, async ({}, testInfo) => {
      // fixme hasta que la inyección llegue a la app. Medido 24/11/2026 (build 2.6.18): la regla hace match pero
      // la respuesta sintética nunca le llega al HttpClient de Angular; la request termina por el timeout propio
      // de la app (connection.service.ts `timeOut = 75000`): el catch corre a los 75 s exactos del toque (consola
      // del WebView). El escenario ejercido sería «timeout», no «HTTP <status>», así que el test no prueba lo que
      // dice. Siguiente paso: inyectar a nivel navegador (CDP Fetch) o provocar el error real (409 DRIVER_CONCURRENCY).
      test.fixme(
        true,
        `La falla HTTP ${branch.status} inyectada no llega a la app (termina por timeout de 75 s): no prueba esta rama.`
      );
      guard();
      let ctx: DriverSpecContext | null = null;
      let initial: Stable | null = null;
      const lines: string[] = [];

      try {
        ctx = await openDriverSpec('driver-availability');
        const c = ctx;
        const driver = c.session.driver;
        const ruleId = availabilityRuleId(branch.status);
        let before: Stable | null = null;

        await test.step('Dado el chofer en el home con el control habilitado y una falla HTTP armada para la request de estado', async () => {
          const snapshot = await c.pbo.reachHome(c.expectation);
          expect(
            ['available', 'notAvailable'],
            `etiqueta «${snapshot.label}» no reconocida para el locale ${c.i18n.locale}`
          ).toContain(snapshot.state);
          if (isStable(snapshot.state)) {
            initial = snapshot.state;
            before = snapshot.state;
          }
          await c.pbo.acknowledgeAlert().catch(() => undefined);
          await c.pbo.waitUntilAvailabilityIdle(30_000);
          lines.push(
            `estado antes: ${before}; falla inyectada: HTTP ${branch.status} sobre «${AVAILABILITY_ENDPOINT_PATTERN}» (1 vez)`
          );
          // installWebViewFaultInjection instala también el capture de red.
          await installWebViewFaultInjection(driver, [buildAvailabilityFaultRule(branch.status)]);
          await c.evidence.capture(`01-antes-${before}`);
        });

        await test.step('Cuando toca el control: la regla hace match (el endpoint supuesto es el real)', async () => {
          await c.pbo.tapAvailability();
          const matched = await Waits.tryUntil(
            async () => {
              const state = await readWebViewFaultInjectionState(driver);
              return (state.rules.find((r) => r.id === ruleId)?.hitsSinceInstall ?? 0) >= 1;
            },
            { timeout: 20_000, label: `regla ${ruleId} con al menos un match` }
          );
          const seen = summarizeRequests((await readWebViewNetworkCapture(driver)).entries);
          expect(
            matched,
            `la regla ${ruleId} no hizo match con ninguna request: el patrón «${AVAILABILITY_ENDPOINT_PATTERN}» no es el endpoint real. Vistas: ${seen.join(' | ')}`
          ).toBeTruthy();
        });

        await test.step('Entonces se registra si la app muestra algún aviso (observación, sin exigir modal)', async () => {
          const alert = await Waits.tryUntil(
            async () => {
              const a = await c.pbo.readAlert();
              return a.shown ? a : false;
            },
            { timeout: 10_000, label: 'aviso de error visible' }
          );
          lines.push(
            alert ? `aviso observado: «${alert.text}»` : 'aviso observado: ninguno en 10 s'
          );
          await c.evidence.capture(
            `02-error-${branch.status}-${alert ? 'con-aviso' : 'sin-aviso'}`
          );
          // Sin aserción: según el código de la app (magiis-mobile-driver-v2@develop, home.page.ts
          // `toggleAvailability`), el `catch` de `setStatusService` solo apaga el loading y refresca el botón; no
          // abre modal. La expectativa «errores -> modales» de V1 no aplica a este flujo (verificado 24/11/2026).
          if (alert) await c.pbo.acknowledgeAlert();
        });

        await test.step(`Y el estado sigue «${before}» y el control se libera (no queda bloqueado)`, async () => {
          let released = true;
          let idle: Awaited<ReturnType<typeof c.pbo.readAvailability>>;
          try {
            idle = await c.pbo.waitUntilAvailabilityIdle(30_000);
          } catch {
            released = false;
            idle = await c.pbo.readAvailability();
          }
          lines.push(
            `estado después: ${idle.state} («${idle.label}»), control liberado: ${released}`
          );
          await c.evidence.capture(`03-despues-${idle.state}`);
          expect(
            released,
            'el control no debe quedar deshabilitado tras un error (riesgo de botón muerto)'
          ).toBe(true);
          expect(idle.state, 'un cambio rechazado no debe cambiar el estado mostrado').toBe(before);
        });
      } finally {
        if (ctx) {
          const live = ctx;

          await test.step('Limpieza: borrar la regla de inyección y restaurar la disponibilidad inicial', async () => {
            const verified = await restore(live, initial, lines);
            expect
              .soft(
                verified,
                'la limpieza debe dejar la disponibilidad inicial PERSISTIDA (verificada tras recargar)'
              )
              .toBe(true);
          });

          await attachEvidence(testInfo, live.evidence);
          testInfo.annotations.push({ type: 'xray_comment', description: commentOf(live, lines) });
          await closeDriverSpec(live);
        }
      }
    });
  }
});
