/**
 * PAX-ADDR-SURFACES — guards de regresión de los campos de dirección de la app Pasajero (MG-116): cuatro hallazgos
 * de la campaña UAT del 18/08/2026 (ATR TM-728).
 *
 * QUÉ AFIRMA (un guard por hallazgo, en este orden)
 *   TM-730  CONTROL. Editar un viaje programado consulta el endpoint propio (`places/autocomplete`) y no a Google.
 *   TM-729  Perfil › Mis Direcciones consulta el endpoint propio y NO a Google directo. Sobre v2.5.19 es un defecto
 *           del build (0 llamadas al endpoint propio); `develop` ya migró la pantalla (MG-116 2.ª etapa), así que
 *           en builds nuevos el guard debe quedar verde.
 *   TM-727  Con el texto «corr», las direcciones locales de CACHE se rankean por delante de los aeropuertos
 *           lejanos (reproducido en 5 entornos ⇒ backend; no bloqueante).
 *   TM-731  travel-info sobrevive a una recarga de la WebView (la URL serializa el estado del viaje, ~4.000
 *           caracteres; 3 de 3 en UAT la recarga mata la app). ÚLTIMO a propósito: deja el dispositivo relanzado.
 *
 * POR QUÉ TM-729 MIDE POR DOS CANALES (no es opcional): el SDK JS de Places usa transporte propio y NO pasa por
 * `fetch`/XHR. Un guard que sólo mire fetch/XHR da VERDE sobre la pantalla defectuosa. El segundo canal es
 * Resource Timing (`performance.getEntriesByType('resource')`).
 *
 * PLAN DE CORRIDA
 *   Comando:    ENV=uat npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-address-surfaces.spec.ts
 *   Dispositivo: FÍSICO recomendado (calibrado en Samsung A05). En emulador Places/geolocalización/red pueden
 *               diferir: el resultado NO es concluyente.
 *   Claves de entorno (solo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (debe ser `uat`),
 *               ANDROID_UDID, ANDROID_PASSENGER_APP_PACKAGE (si el paquete por defecto no es el de UAT).
 *   Precondición: app PAX con SESIÓN iniciada en UAT (`noReset`); si el estado no es el home se saltea con motivo.
 *               TM-730 necesita un viaje programado preexistente (fixture del carrier de UAT). Con la sesión en
 *               `/login` NO se intenta loguear: es otro spec (pax-login).
 *   Efectos:    SOLO LECTURA. No crea viajes, no guarda direcciones, no toca la wallet. Se escribe texto en los
 *               campos y se sale sin guardar. TM-731 recarga la WebView a propósito y la app se relanza al final.
 *   Superficie inalcanzable ⇒ `test.skip` con motivo, NUNCA rojo (el guard queda «no ejercido»).
 *   Seguridad:  corre sólo con ENV=uat; contra `prod` u otro ambiente se saltea.
 *   Fuera de alcance: matriz conducta × superficie (pax-address-behaviors), alta de direcciones, creación de viajes.
 *   TM-731: la recarga la dispara JS (`window.location.reload()`); es un guard del MECANISMO (URL con el estado
 *               serializado), no una acción de usuario. Un hallazgo de este caso NO es reportable como bug sin
 *               reproducción por la UI real.
 *   Xray:       las keys TM van como annotation `tms` (reporter con XRAY=1). Sin `@no-xray`: los cuatro Tests existen.
 */

import { test, expect } from '@playwright/test';
import type { Browser } from 'webdriverio';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import { xrayKeyAnnotations } from '../../harness/DriverSpecKit.js';
import {
  attachEvidence,
  closePassengerSpec,
  environmentSkipReason,
  openPassengerSpec
} from '../../harness/PassengerSpecKit.js';
import type { PassengerSpecContext } from '../../harness/PassengerSpecKit.js';
import { sleep } from '../../core/Waits.js';
import {
  DESTINATION_SELECTOR,
  ProfileAddressSurface,
  STOP_SELECTOR,
  ScheduledTripEditSurface,
  goHome,
  surfacePortFor
} from '../../screens/passenger/address/surfaces/index.js';
import type { SurfaceReach } from '../../screens/passenger/address/surfaces/index.js';
import { webUrl } from '../../screens/passenger/passengerWeb.js';

const SETTLE_MS = 5200;
const TERM = 'ciudad de la paz 2238';

/** Sello de tipeo + contador de llamadas al endpoint propio, instalados dentro de la página (canal fetch/XHR). */
const INSTALL_PROBES = `
  (function () {
    var w = window;
    if (w.__mgProbed) { w.__mgOwn = []; return; }
    w.__mgProbed = true;
    w.__mgOwn = [];
    var push = function (u) {
      if (String(u).indexOf('places/autocomplete') !== -1) {
        w.__mgOwn.push({ url: String(u), atEpochMs: Date.now() });
      }
    };
    var of = w.fetch;
    w.fetch = function () { try { push(arguments[0]); } catch (e) {} return of.apply(this, arguments); };
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { try { push(u); } catch (e) {} return oo.apply(this, arguments); };
  })();
`;

/** Captura el CUERPO de la respuesta de `places/autocomplete` por fetch y XHR (el request puede salir por cualquiera). */
const INSTALL_BODY_CAPTURE = `
  (function () {
    var w = window; w.__mgBodies = [];
    var of = w.fetch;
    w.fetch = function () {
      var u = String(arguments[0]);
      var p = of.apply(this, arguments);
      if (u.indexOf('places/autocomplete') !== -1) {
        p.then(function (r) { try { r.clone().text().then(function (t) { w.__mgBodies.push(t); }); } catch (e) {} });
      }
      return p;
    };
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      if (String(u).indexOf('places/autocomplete') !== -1) {
        this.addEventListener('load', function () { try { w.__mgBodies.push(this.responseText); } catch (e) {} });
      }
      return oo.apply(this, arguments);
    };
  })();
`;

type PlaceRow = { source?: string; mainText?: string };

async function ownCalls(driver: Browser): Promise<number> {
  return driver.execute(
    () => ((window as unknown as { __mgOwn?: unknown[] }).__mgOwn ?? []).length
  );
}

/** Recursos de Google vistos por Resource Timing (segundo canal: el SDK de Places no usa fetch/XHR). */
async function googleResources(driver: Browser): Promise<number> {
  return driver.execute(
    () =>
      performance
        .getEntriesByType('resource')
        .filter((e) => /maps\.googleapis\.com|places\.googleapis\.com/i.test(e.name)).length
  );
}

/** Guardas comunes: Appium disponible, sólo `uat` (nunca prod). */
function guards(): void {
  test.skip(
    !process.env.APPIUM_SERVER_URL,
    'Requiere APPIUM_SERVER_URL y el dispositivo conectado.'
  );
  const config = getPassengerAppConfig();
  const prod = environmentSkipReason(config.environment);
  test.skip(prod !== null, prod ?? '');
  test.skip(
    config.environment !== 'uat',
    `Guards calibrados en UAT: requieren ENV=uat (ambiente actual: ${config.environment}).`
  );
}

/** Abre sesión y exige el home; sin sesión iniciada el guard queda no ejercido (no se loguea acá). */
async function openAtHome(spec: string): Promise<PassengerSpecContext> {
  const ctx = await openPassengerSpec(spec);
  const state = await ctx.pbo.waitForStableSessionState();
  if (state.kind !== 'home') {
    await closePassengerSpec(ctx);
    test.skip(
      true,
      `Requiere sesión iniciada en el home (estado: ${state.kind}): guard no ejercido.`
    );
  }
  return ctx;
}

function skipUnreachable(
  reach: SurfaceReach
): asserts reach is Extract<SurfaceReach, { reachable: true }> {
  if (!reach.reachable) test.skip(true, `${reach.reason} Guard no ejercido.`);
}

test.describe('@mobile App Pasajero · guards de direcciones (MG-116)', () => {
  // Sesión Appium (~15 s) + taps nativos + settle de 5 s + reload de 8 s + relanzamiento en el teardown.
  // SIN `mode: 'serial'` a propósito: serial CANCELA los restantes cuando uno falla, y esta suite tiene guards
  // que pueden estar EN ROJO por defectos vivos (TM-729 en builds viejos). La exclusión mutua del dispositivo la
  // da `workers: 1` de la config mobile.
  test.describe.configure({ timeout: 240_000 });

  test(
    'PAX-ADDR-SURFACES · Validar que editar un viaje programado consulta el endpoint propio y no a Google [TM-730 control]',
    { annotation: xrayKeyAnnotations('TM-730'), tag: ['@mobile', '@regression', '@mg116'] },
    async ({}, testInfo) => {
      guards();
      let ctx: PassengerSpecContext | null = null;
      try {
        ctx = await openAtHome('pax-addr-tm730');
        const driver = ctx.session.driver;
        // Llegar: Actividad -> Programados -> icono de edición del primer viaje. Sin viaje programado el guard se
        // declara no ejercido en vez de dar un falso verde.
        const reach = await new ScheduledTripEditSurface().navigate(surfacePortFor(ctx.session));
        skipUnreachable(reach);
        await ctx.evidence.capture('01-travel-edit');

        await driver.execute(INSTALL_PROBES);
        const rtBefore = await googleResources(driver);
        const typed = await surfacePortFor(ctx.session).setValue(reach.fieldSelector, TERM);
        expect(typed, 'el campo de dirección de travel-edit debe aceptar texto').toBe(true);
        await sleep(SETTLE_MS);

        const own = await ownCalls(driver);
        const rtNew = (await googleResources(driver)) - rtBefore;
        await ctx.evidence.capture('02-tras-tipeo');
        expect(own, 'debe consultar places/autocomplete').toBeGreaterThan(0);
        expect(rtNew, 'cero recursos de Google durante el tipeo (Resource Timing)').toBe(0);
      } finally {
        if (ctx) {
          await new ScheduledTripEditSurface()
            .cleanup(surfacePortFor(ctx.session))
            .catch(() => undefined);
          await attachEvidence(testInfo, ctx.evidence);
          await closePassengerSpec(ctx);
        }
      }
    }
  );

  test(
    'PAX-ADDR-SURFACES · Validar que Perfil › Mis Direcciones consulta el endpoint propio y no a Google directo [TM-729]',
    { annotation: xrayKeyAnnotations('TM-729'), tag: ['@mobile', '@regression', '@mg116'] },
    async ({}, testInfo) => {
      guards();
      let ctx: PassengerSpecContext | null = null;
      const surface = new ProfileAddressSurface();
      try {
        ctx = await openAtHome('pax-addr-tm729');
        const driver = ctx.session.driver;
        const port = surfacePortFor(ctx.session);
        // Mi cuenta -> Mis Direcciones; la superficie elige el primer «Tipo» (en UAT el campo lo exige).
        const reach = await surface.navigate(port);
        skipUnreachable(reach);
        await ctx.evidence.capture('01-mis-direcciones');

        await driver.execute(INSTALL_PROBES);
        const rtBefore = await googleResources(driver);
        const typed = await port.setValue(reach.fieldSelector, TERM);
        expect(
          typed,
          'el campo Dirección debe aceptar texto (en UAT exige elegir Tipo primero)'
        ).toBe(true);
        await sleep(SETTLE_MS);

        const own = await ownCalls(driver);
        const rtNew = (await googleResources(driver)) - rtBefore;
        await ctx.evidence.capture('02-tras-tipeo');

        // El doble canal ES el guard: rtNew > 0 significa Google directo aunque fetch/XHR esté limpio.
        expect(
          rtNew,
          'TM-729: esta pantalla consulta a Google directo (defecto del build 2.5.19; develop ya usa el endpoint propio)'
        ).toBe(0);
        expect(own, 'debe consultar places/autocomplete').toBeGreaterThan(0);
      } finally {
        if (ctx) {
          await surface.cleanup(surfacePortFor(ctx.session)).catch(() => undefined);
          await attachEvidence(testInfo, ctx.evidence);
          await closePassengerSpec(ctx);
        }
      }
    }
  );

  test(
    'PAX-ADDR-SURFACES · Validar que las direcciones locales de cache se rankean por encima de aeropuertos lejanos [TM-727]',
    { annotation: xrayKeyAnnotations('TM-727'), tag: ['@mobile', '@regression', '@mg116'] },
    async ({}, testInfo) => {
      guards();
      let ctx: PassengerSpecContext | null = null;
      try {
        ctx = await openAtHome('pax-addr-tm727');
        const driver = ctx.session.driver;
        const port = surfacePortFor(ctx.session);
        // SE CONSTRUYE la precondición (home), no se asume el estado que dejó otro test: cada test abre su propia
        // sesión, pero la app puede arrancar en una pantalla interna.
        test.skip(!(await goHome(port)), 'No se pudo llevar la app al home: guard no ejercido.');

        await driver.execute(INSTALL_BODY_CAPTURE);
        let typed = false;
        for (const selector of [STOP_SELECTOR, DESTINATION_SELECTOR]) {
          typed = await port.setValue(selector, 'corr');
          if (typed) break;
        }
        test.skip(!typed, 'Ningún campo de dirección editable en el home: guard no ejercido.');
        await sleep(SETTLE_MS);
        await ctx.evidence.capture('01-predicciones');

        const rows = await driver.execute((): PlaceRow[] => {
          const w = window as unknown as { __mgBodies?: string[] };
          for (const b of w.__mgBodies ?? []) {
            try {
              const j = JSON.parse(b) as unknown;
              if (Array.isArray(j) && j.length) return j as PlaceRow[];
            } catch {
              /* cuerpo no-JSON: se ignora */
            }
          }
          return [];
        });
        test.skip(
          rows.length === 0,
          'La respuesta no trajo filas para evaluar el orden: guard no ejercido.'
        );

        const firstAirport = rows.findIndex((r) => r.source === 'AIRPORT');
        const firstCache = rows.findIndex((r) => r.source === 'CACHE');
        // Sin aeropuertos no hay precedencia que evaluar.
        if (firstAirport === -1) return;
        expect(
          firstCache !== -1 && firstCache < firstAirport,
          `TM-727: fila 0 = ${rows[0]?.source} «${rows[0]?.mainText}» — un aeropuerto lejano por delante de las direcciones locales`
        ).toBe(true);
      } finally {
        if (ctx) {
          await attachEvidence(testInfo, ctx.evidence);
          await closePassengerSpec(ctx);
        }
      }
    }
  );

  test(
    'PAX-ADDR-SURFACES · Validar que travel-info sobrevive a una recarga de la WebView [TM-731]',
    { annotation: xrayKeyAnnotations('TM-731'), tag: ['@mobile', '@regression', '@mg116'] },
    async ({}, testInfo) => {
      guards();
      let ctx: PassengerSpecContext | null = null;
      try {
        ctx = await openAtHome('pax-addr-tm731');
        const driver = ctx.session.driver;
        const port = surfacePortFor(ctx.session);
        // Llegar a travel-info por el atajo «Llevame a Casa». Si este entorno no navega (pasa en test), el caso
        // queda NO EJERCIDO — nunca «no reproduce».
        test.skip(!(await goHome(port)), 'No se pudo llevar la app al home: guard no ejercido.');
        await port.tapByText('button.shortcut-btn, button', 'llevame a casa', 8000);
        await sleep(4000);
        const url = await webUrl(ctx.session);
        test.skip(
          !/travel-info/i.test(url),
          'No se alcanzó travel-info en este entorno: guard no ejercido.'
        );
        await ctx.evidence.capture('01-travel-info');

        // La causa medida: el estado del viaje serializado en la URL (~4.000 caracteres).
        expect(
          url.length,
          'la URL de travel-info sigue cargando el estado serializado'
        ).toBeGreaterThan(2000);

        // Recarga disparada por JS: guard del MECANISMO, no una acción de usuario.
        await driver.execute(() => window.location.reload()).catch(() => undefined);
        await sleep(8000);

        const after = await driver
          .execute(() => ({
            title: document.title,
            text: (document.body.innerText ?? '').slice(0, 200)
          }))
          .catch(() => null);
        const dead =
          !after ||
          /no disponible|ERR_HTTP_RESPONSE_CODE_FAILURE/i.test(`${after.title} ${after.text}`);
        expect(
          dead,
          'TM-731: recargar en travel-info deja la app en la página de error de Chrome'
        ).toBe(false);
      } finally {
        if (ctx) {
          // La app pudo quedar en la página de error: se relanza para dejar el dispositivo usable.
          const pkg = ctx.config.appPackage ?? '';
          if (pkg) {
            await ctx.session.driver.switchContext('NATIVE_APP').catch(() => undefined);
            await ctx.session.driver.terminateApp(pkg).catch(() => undefined);
            await ctx.session.driver.activateApp(pkg).catch(() => undefined);
          }
          await attachEvidence(testInfo, ctx.evidence).catch(() => []);
          await closePassengerSpec(ctx);
        }
      }
    }
  );
});
