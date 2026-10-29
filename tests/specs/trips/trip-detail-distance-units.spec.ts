// tests/specs/trips/trip-detail-distance-units.spec.ts
// MG-1190 · TC1 · TM-1305 — Detalle de viaje (`/carrier/#/travel/detail/:id`), card «Datos
// Finales», en sus DOS disposiciones, detectadas explícitamente por el POM (sin lectura de
// reserva; si no hay ninguna, falla): tarjeta `.fd-metric` «Distancia · 6.81 · Mi» (rediseño,
// TEST) o renglón en línea «Distance: 6.38 Mi» (anterior, UAT build adabeaba…). Las aserciones
// son idénticas para ambas y la disposición validada queda anotada en el reporte.
// La distancia es el crudo en km del viaje convertido a millas (carrier imperial) o sin convertir
// con «km» (métrico), con el separador del carrier.
//
// ORÁCULO: `GET /carriers/{id}/travels/{travelId}` (clave top-level `kilometers`), observada
// pasivamente. Tres lecturas por viaje, como las filas del Test: carga, cambio de idioma EN↔ES
// SIN recargar, y F5 (recarga). SOLO LECTURA.
//
// FUERA DE ALCANCE (a propósito): la píldora «Datos Presupuestados» NO se asevera. En el carrier
// métrico imprime «34.07 km» (punto) en vez de «34,07 km»: H-1190-12 abierto; codificarlo como
// esperado dejaría pasar el defecto. Cuando se corrija, agregar la píldora con el separador del
// carrier.
//
// AMBIENTES: ENV=test → 1521 (70667) y 1040 (69794, 60003, sesión de región AR); ENV=uat → 1481
// (722269, sin re-verificar el 08/10: UAT caído). Ejecutar:
//   npx cross-env ENV=test REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/trips/trip-detail-distance-units.spec.ts --project=carrier-v2-desktop --workers=1
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import {
  TravelDetailPage,
  type FinalDistanceLayout
} from '../../pages/carrier-v2/trips/TravelDetailPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { makeAnnotate } from '../../utils/traceability.js';
import { decimalHint, expectDisplayedDistance } from '../../utils/unitsAssert.js';
import { unitLabel } from '../../utils/units.js';

const ROUTE = '/carrier/#/travel/detail/:id';
const TM_1305 = 'TM-1305';

/** Disposición de «Datos Finales» que validó la corrida (queda en las anotaciones del reporte). */
const LAYOUT_LABEL: Record<FinalDistanceLayout, string> = {
  cards: 'tarjetas .fd-metric (rediseño, TEST)',
  inline: 'renglón en línea «Distance: N Mi» (anterior, UAT)'
};

/** Espera el GET del detalle de un viaje (solo se observa; el front lo dispara). */
function waitForTravelDetail(page: Page, travelId: string): Promise<number> {
  return page
    .waitForResponse(
      (r) =>
        new RegExp(String.raw`/carriers/\d+/travels/${travelId}(\?|$)`).test(r.url()) &&
        r.request().method() === 'GET',
      { timeout: 30_000 }
    )
    .then(async (response) => {
      if (!response.ok()) {
        throw new Error(
          `precondición: GET travels/${travelId} respondió ${response.status()} (el viaje de QA ya no existe o no es del carrier)`
        );
      }
      const body = (await response.json()) as { kilometers?: number };
      if (typeof body.kilometers !== 'number') {
        throw new Error(`precondición: GET travels/${travelId} no trae «kilometers» numérico`);
      }
      return body.kilometers;
    });
}

test.describe('@P1 @functional MG-1190 Detalle de viaje - distancia final en la unidad del carrier', () => {
  for (const carrier of unitsCarriers()) {
    for (const travelId of carrier.detailTripIds) {
      test(`TM-1305: debería mostrar la distancia final del viaje ${travelId} en ${unitLabel(carrier.system)} (${carrier.key})`, async ({
        carrierPage
      }, testInfo) => {
        makeAnnotate(TM_1305, ROUTE)('TC1', 'HP');
        const page = await carrierPage(carrier.region);
        const shell = new ShellPage(page);
        const detail = new TravelDetailPage(page);
        const hint = decimalHint(carrier.system);

        const rawPromise = waitForTravelDetail(page, travelId);
        await detail.goto(travelId);
        const rawKm = await rawPromise;
        // Precondición anti-vacuidad: con 0 km la conversión no discrimina.
        expect(
          rawKm,
          `precondición: el viaje ${travelId} de ${carrier.key} debe tener kilometers > 0 (kilometers=${rawKm})`
        ).toBeGreaterThan(0);

        const measured: string[] = [];
        const check = async (moment: string): Promise<void> => {
          const reading = await expectDisplayedDistance({
            label: `Datos Finales › Distancia (${moment}, viaje ${travelId}, ${carrier.key})`,
            read: () => detail.readFinalDistance(hint),
            readText: () => detail.finalDistanceText(),
            rawKm,
            system: carrier.system
          });
          measured.push(`${moment}: ${reading.value} ${reading.unit}`);
        };

        await check('carga');
        // Disposición validada (no hay lectura de reserva: si no hay ninguna, el POM ya falló).
        const layout = await detail.finalDistanceLayout();
        expect(layout, 'debe haber una disposición de «Datos Finales» reconocida').not.toBeNull();
        const layoutLabel = LAYOUT_LABEL[layout as FinalDistanceLayout];
        testInfo.annotations.push({ type: 'disposicion-datos-finales', description: layoutLabel });
        await shell.setLanguage('es');
        await check('ES sin recargar');
        await shell.setLanguage('en');
        await check('EN sin recargar');
        await page.reload();
        await expect(detail.tripCode, 'F5: el detalle debe volver a cargar los datos').toBeVisible({
          timeout: 30_000
        });
        await check('F5');

        await attachXrayEvidence(testInfo, page, {
          name: `detalle-viaje-distancia-${carrier.key}-${travelId}`,
          comment:
            `Medido en ${carrier.key}, viaje ${travelId} (ENV=${process.env.ENV ?? 'test'}). ` +
            `Disposición de «Datos Finales»: ${layoutLabel}. GET travels/${travelId}: kilometers=${rawKm}. «Datos Finales › Distancia» = ` +
            `${unitLabel(carrier.system)} del crudo, sin el rótulo de la otra unidad, en carga, ` +
            `cambio de idioma sin recargar y F5. ${measured.join(' · ')}. ` +
            `La píldora presupuestada no se asevera (H-1190-12 abierto).`
        });
      });
    }
  }
});
