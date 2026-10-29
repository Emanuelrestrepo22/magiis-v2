// tests/specs/trips/new-trip-context.spec.ts
// Casos de MG-19 cuyo sujeto es el CONTEXTO DEL NAVEGADOR, no el formulario: permisos y
// zona horaria. Viven aparte porque necesitan `test.use()` a nivel de describe (opciones de
// contexto), que no se puede variar dentro de un archivo compartido.
//
// TRAZABILIDAD: TC242 / TM-817 del ATR TM-830 (Ronda 2). Ninguno muta el entorno.
// Cruce del ATR y plan: docs/qa/mg19-new-trip/TM-830-COBERTURA-Y-PLAN.md.
//
// Por que TC189/TC190/TC253 (timezone del pickup, AC4) NO estan aca: se midio en vivo que el
// formulario ancla fecha, hora y opciones de hora al reloj del NAVEGADOR y no re-ancla al
// pickup, asi que el formulario no es un oraculo de AC4. Detalle y las dos vias posibles:
// docs/qa/mg19-new-trip/IMPLEMENTATION-NOTES.md.
import type { Page } from '@playwright/test';
import { test, expect, attachXrayEvidence } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';
const TM_TC242 = 'TM-817';

/** Texto de busqueda de cliente. Mismo patron que el resto de los specs de MG-19. */
const CLIENT_QUERY = process.env.MG19_CLIENT_QUERY ?? 'test';

/**
 * Espia `navigator.geolocation.getCurrentPosition` y acumula el resultado en `window.__geo`.
 *
 * Existe para que la precondicion del caso sea MEDIDA y no supuesta: sin esto, "el permiso
 * esta denegado" seria una creencia sobre el default de Playwright, y un test que afirma que
 * la pantalla funciona sin comprobar que el permiso se pidio y se nego no prueba el caso.
 */
const GEO_SPY = `
  window.__geo = { calls: 0, results: [] };
  const g = navigator.geolocation;
  if (g) {
    const orig = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = function (ok, err, opts) {
      window.__geo.calls++;
      return orig(
        (pos) => {
          window.__geo.results.push({ ok: true });
          if (ok) ok(pos);
        },
        (e) => {
          window.__geo.results.push({ ok: false, code: e.code });
          if (err) err(e);
        },
        opts
      );
    };
  }
`;

type GeoSpy = { calls: number; results: { ok: boolean; code?: number }[] };

/** Lee el espia. `code: 1` es PERMISSION_DENIED del estandar de geolocalizacion. */
function readGeoSpy(page: Page): Promise<GeoSpy> {
  return page.evaluate(() => (window as unknown as { __geo: GeoSpy }).__geo);
}

/**
 * "Opera con normalidad" = se puede recorrer el formulario hasta el punto en que el viaje
 * seria cotizable. Se para justo antes de cotizar: mas alla no agrega nada al caso y empieza
 * a depender de tarifas y de servicios externos.
 */
async function recorrerFormulario(page: Page): Promise<void> {
  const p = new NewTripPage(page);
  await p.goto();
  await p.expectMainSectionsReady();

  await p.selectClient(CLIENT_QUERY);
  // La cascada del cliente autocompleta el Pick-Up con la direccion registrada del pasajero:
  // es el paso que MAS sospecha de depender de la ubicacion del navegador, y el que prueba
  // que negar el permiso no rompe el arranque de la ruta.
  await expect(p.resolvedOriginValue, 'la cascada debe resolver el origen').toHaveCount(1);

  await p.fillFirstDestination('Centro');
  await expect(p.selectVehicleButton, 'el viaje debe quedar cotizable').toBeVisible({
    timeout: 25_000
  });
}

test.describe('@P1 @functional @MG-19 Nuevo Viaje - contexto del navegador', () => {
  test.describe('con el permiso de ubicacion denegado', () => {
    // Sin `permissions`, el contexto no concede geolocalizacion y Chromium responde
    // PERMISSION_DENIED sin prompt. Se declara explicito igual: el caso ES la denegacion, y
    // dejarlo al default haria que un cambio de config del proyecto lo desactivara en silencio.
    test.use({ permissions: [] });

    test('TC242 Con el permiso de ubicacion denegado la pantalla opera con normalidad', async ({
      page
    }, testInfo) => {
      makeAnnotate(TM_TC242, ROUTE)('TC242', 'EC');
      await page.addInitScript(GEO_SPY);

      await recorrerFormulario(page);

      // La precondicion, medida: la pantalla PIDE la ubicacion y el navegador la NIEGA.
      const geo = await readGeoSpy(page);
      expect(geo.calls, 'la pantalla debe pedir la ubicacion').toBeGreaterThan(0);
      expect(
        geo.results.every((r) => r.ok === false && r.code === 1),
        'toda peticion de ubicacion debe resolver PERMISSION_DENIED'
      ).toBe(true);
      // Evidencia publicable (evidence-conventions §4): captura + medición.
      await attachXrayEvidence(testInfo, page, {
        name: 'geolocalizacion-denegada',
        comment: `Medido: con el permiso de ubicación denegado la pantalla pidió la ubicación ${geo.calls} vez/veces y todas resolvieron PERMISSION_DENIED (code 1); el formulario resolvió el origen y dejó el viaje cotizable.`
      });
    });
  });

  test.describe('con el permiso de ubicacion concedido', () => {
    test.use({
      permissions: ['geolocation'],
      // Obelisco, Buenos Aires — misma region que el cliente de prueba.
      geolocation: { latitude: -34.6037, longitude: -58.3816 }
    });

    // CONTROL del test de arriba, sin key TM: no es un caso del catalogo. Prueba que el espia
    // DISCRIMINA — si tambien reportara `ok: false` con el permiso concedido, el assert de
    // PERMISSION_DENIED del TC242 estaria pasando por estar roto, no por estar denegado.
    test('El espia de geolocalizacion distingue permiso concedido de denegado', async ({
      page
    }, testInfo) => {
      await page.addInitScript(GEO_SPY);

      await recorrerFormulario(page);

      const geo = await readGeoSpy(page);
      expect(geo.calls, 'la pantalla debe pedir la ubicacion').toBeGreaterThan(0);
      expect(
        geo.results.some((r) => r.ok === true),
        'con el permiso concedido la ubicacion debe resolver OK'
      ).toBe(true);
      // Evidencia publicable (evidence-conventions §4): captura + medición.
      await attachXrayEvidence(testInfo, page, {
        name: 'geolocalizacion-concedida-control',
        comment: `Medido (control): con el permiso concedido la pantalla pidió la ubicación ${geo.calls} vez/veces y al menos una resolvió OK; el espía distingue concedido de denegado.`
      });
    });
  });
});
