// tests/specs/reports/daily-report-units.spec.ts
// MG-1190 · TC8 · TM-1312 — Reportes › Administrativos › Diario (`/carrier/#/reports/daily`): los
// cuatro widgets de distancia (total, por viaje, por vehículo, por chofer) muestran el crudo en km
// que el front pide, convertido a millas (carrier imperial) o sin convertir (carrier métrico).
//
// ORÁCULO: respuesta pasiva de `GET /carriers/{id}/travels/surrendersSummarizedTotals?dateFrom=
// &dateTo=` (campos `statistics.totalKms | kmsPerTravel | kmsPerVehicle | kmsPerDriver`). La pata
// de base de datos queda en los ATR manuales (scope-rules §1: este repo no valida base).
// SOLO LECTURA: no guarda, no envía, no crea nada.
//
// AMBIENTES (docs/qa/unidades-medida-mg1189/PROGRESO-RONDA1.md):
//   ENV=uat  → carrier 1481 (imperial), día 06/05/2026 (13 viajes, 14,73 km; DWH estable).
//   ENV=test → carrier 1521 (imperial) y carrier 1040 (métrico, sesión de región AR).
//   Ejecutar: npx cross-env ENV=uat REUSE_STORAGE_STATE=1 npx playwright test \
//             tests/specs/reports/daily-report-units.spec.ts --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { ReportsDailyPage } from '../../pages/carrier-v2/reports/ReportsDailyPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import {
  DISTANCE_METRICS,
  METRIC_RAW_FIELD
} from '../../pages/carrier-v2/reports/summarizedTotals.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { makeAnnotate } from '../../utils/traceability.js';
import {
  decimalHint,
  expectDisplayedDistance,
  expectDisplayedRatio,
  ratioRule
} from '../../utils/unitsAssert.js';
import { unitLabel } from '../../utils/units.js';

const ROUTE = '/carrier/#/reports/daily';
const TM_1312 = 'TM-1312';

test.describe('@P2 @functional MG-1190 Reporte Diario - widgets de distancia en la unidad del carrier', () => {
  for (const carrier of unitsCarriers()) {
    test(`TM-1312: debería mostrar las 4 distancias del Reporte Diario en ${unitLabel(carrier.system)} (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1312, ROUTE)('TC8', 'HP');
      const page = await carrierPage(carrier.region);
      const shell = new ShellPage(page);
      const daily = new ReportsDailyPage(page);

      await daily.gotoLoaded();
      const statistics = await daily.selectDate(carrier.day);

      // Precondición de datos (anti-vacuidad): el día elegido debe tener km > 0, si no la
      // conversión no discrimina y el caso pasaría sin probar nada.
      expect(
        statistics.totalKms,
        `precondición: ${carrier.day} en ${carrier.key} debe tener ≥ 1 viaje con km > 0 (totalKms=${statistics.totalKms})`
      ).toBeGreaterThan(0);

      const medidos: string[] = [];
      for (const language of ['en', 'es'] as const) {
        await shell.setLanguage(language);
        for (const metric of DISTANCE_METRICS) {
          const rawKm = statistics[METRIC_RAW_FIELD[metric]];
          const reading = await expectDisplayedDistance({
            label: `${metric} (${language.toUpperCase()}, ${carrier.key})`,
            read: () => daily.readDistance(metric),
            readText: () => daily.distanceRowText(metric),
            rawKm,
            system: carrier.system
          });
          medidos.push(
            `${language.toUpperCase()} ${metric}: crudo ${rawKm} km → ${reading.value} ${reading.unit}`
          );
        }
      }

      await shell.setLanguage('en');
      await attachXrayEvidence(testInfo, page, {
        name: `reporte-diario-distancias-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} el día ${carrier.day} (ENV=${process.env.ENV ?? 'test'}). ` +
          `Los 4 widgets de distancia coinciden con el crudo de surrendersSummarizedTotals, ` +
          `en ${unitLabel(carrier.system)} y sin el rótulo de la otra unidad, en EN y en ES sin recargar. ` +
          medidos.join(' · ')
      });
    });

    test(`TM-1312: debería mostrar «$ /${unitLabel(carrier.system)}» y «Min/${unitLabel(carrier.system)}» del Reporte Diario por ${unitLabel(carrier.system)} (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1312, ROUTE)('TC8', 'HP');
      const page = await carrierPage(carrier.region);
      const shell = new ShellPage(page);
      const daily = new ReportsDailyPage(page);
      const day = carrier.ratiosDay ?? carrier.day;

      await daily.gotoLoaded();
      const statistics = await daily.selectDate(day);

      // Precondición anti-vacuidad: con facturado o minutos en cero la razón vale 0 en ambos
      // sistemas y el caso no distinguiría «por Mi» de «por Km» (H-8 pasaría en vacío).
      expect(
        statistics.valuePerKm,
        `precondición: ${day} en ${carrier.key} debe tener facturado > 0 (valuePerKm=${statistics.valuePerKm})`
      ).toBeGreaterThan(0.05);
      expect(
        statistics.minsPerKm,
        `precondición: ${day} en ${carrier.key} debe tener minutos > 0 (minsPerKm=${statistics.minsPerKm})`
      ).toBeGreaterThan(0.05);

      const ratios = [
        { ratio: 'moneyPerDistance', raw: statistics.valuePerKm, name: '$ /' },
        { ratio: 'minutesPerDistance', raw: statistics.minsPerKm, name: 'Min/' }
      ] as const;
      const medidos: string[] = [];
      for (const language of ['en', 'es'] as const) {
        await shell.setLanguage(language);
        for (const { ratio, raw, name } of ratios) {
          // Facturado ÷ Mi = valor por km × 1,60934; minutos ÷ Mi = minutos por km × 1,60934.
          // Métrico: el valor por km sin tocar (H-8 solo afectaba al imperial).
          const label = `${name}${unitLabel(carrier.system)} (${language.toUpperCase()}, ${carrier.key}, ${day})`;
          const shown = await expectDisplayedRatio({
            label,
            read: () => daily.readRatio(ratio, decimalHint(carrier.system)),
            rawPerKm: raw,
            system: carrier.system
          });
          medidos.push(`${language.toUpperCase()} ${label}: crudo/km ${raw} → ${shown}`);
        }
      }

      await shell.setLanguage('en');
      await attachXrayEvidence(testInfo, page, {
        name: `reporte-diario-razones-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} el día ${day} (ENV=${process.env.ENV ?? 'test'}). ` +
          `«$ /${unitLabel(carrier.system)}» y «Min/${unitLabel(carrier.system)}» = ` +
          ratioRule(carrier.system) +
          `, EN y ES sin recargar. ` +
          medidos.join(' · ')
      });
    });
  }
});
