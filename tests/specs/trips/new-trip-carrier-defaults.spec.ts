// tests/specs/trips/new-trip-carrier-defaults.spec.ts
// TM-501 (TC60, MG-19): "toma de las preferencias del carrier los valores por defecto de
// peajes, autopistas y tipo de ruta" al abrir Nuevo Viaje.
//
// Contrato verificado: pantalla <-> API, no un valor fijo del carrier. `new-trip.component.ts`
// carga los tres toggles desde la respuesta de `GET carriers/{id}/parameters`
// (`generalParametersService.getParameters()`, confirmado en el fuente real de
// magiis-fe-carrier-v2 vía GitLab MCP -- ver `read-parameters.command.ts`:
// `urlSections = ['carriers', carrierId, 'parameters']`) dentro del mismo subscribe que
// resuelve `migrated` -- es decir, antes y con independencia de elegir cliente. Por eso el
// caso no hardcodea el valor esperado de avoidTolls/avoidHighways/fastestRoute: captura la
// respuesta real de esa llamada durante el propio goto() y afirma que los tres controles de
// pantalla terminan reflejando EXACTAMENTE lo que el servidor devolvió, sea cual sea el dato
// del carrier en el ambiente. Así el test sigue siendo válido si el parámetro cambia.
//
// No crea viajes: corta apenas se cargan los toggles, antes de elegir cliente o cotizar. Por
// eso corre siempre (sin gate de entorno) y lleva @P1 @functional -- candidato a smoke por PR.
import { test, expect } from '../../TestBase.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ROUTE = '/carrier/#/travel/create';

type CarrierRouteFlags = {
  avoidTolls: boolean;
  avoidHighways: boolean;
  fastestRoute: boolean;
};

test.describe('@functional @P1 MG-19 Nuevo Viaje - defaults de ruta del carrier', () => {
  test('TM-501: debería reflejar en los controles de peajes, autopistas y tipo de ruta el valor que devuelve el parámetro del carrier al abrir Nuevo Viaje', async ({
    page
  }, testInfo) => {
    makeAnnotate('TM-501', ROUTE)('TC60', 'HP');
    const p = new NewTripPage(page);

    // El llamado a `carriers/{id}/parameters` sale como parte de la inicialización de la
    // pantalla (dentro del subscribe que resuelve `migrated`), disparado por el propio
    // goto() -- no hace falta elegir cliente ni cargar direcciones para que corra.
    const [parametersResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          /\/carriers\/\d+\/parameters(?:\?.*)?$/.test(res.url()) &&
          res.request().method() === 'GET',
        { timeout: 30_000 }
      ),
      p.goto()
    ]);

    expect(
      parametersResponse.ok(),
      'la carga de parámetros del carrier debe responder 2xx para que el resto del caso sea válido'
    ).toBeTruthy();

    const body = (await parametersResponse.json()) as Record<string, unknown>;

    // Un parámetro ausente o nulo se renderiza apagado: el front hace
    // `myForm.get('avoidTolls').setValue(res.avoidTolls)` (new-trip.component.ts:1874-1876,
    // release/v2.0.14) y un checkbox con valor nulo queda sin marcar. El esperado se deriva
    // de la respuesta solo para saber qué debe mostrar la pantalla; el oráculo es la pantalla.
    const expected: CarrierRouteFlags = {
      avoidTolls: body.avoidTolls === true,
      avoidHighways: body.avoidHighways === true,
      fastestRoute: body.fastestRoute === true
    };

    await p.expectMainSectionsReady();

    const controls = [
      ['avoidTolls', p.avoidTollsCheckbox],
      ['avoidHighways', p.avoidHighwaysCheckbox],
      ['fastestRoute', p.fastestRouteSwitch]
    ] as const;
    for (const [flag, control] of controls) {
      await expect(control, `${flag} debe reflejar el parámetro del carrier`).toBeChecked({
        checked: expected[flag]
      });
    }

    await testInfo.attach('ruta-defaults', {
      body: await page.screenshot(),
      contentType: 'image/png'
    });
    const raw = (flag: keyof CarrierRouteFlags): string => String(body[flag]);
    testInfo.annotations.push({
      type: 'xray_comment',
      description: `Medido: avoidTolls=${expected.avoidTolls} · avoidHighways=${expected.avoidHighways} · fastestRoute=${expected.fastestRoute} (parámetro del carrier: avoidTolls=${raw('avoidTolls')}, avoidHighways=${raw('avoidHighways')}, fastestRoute=${raw('fastestRoute')}) — pantalla coincide`
    });
  });
});
