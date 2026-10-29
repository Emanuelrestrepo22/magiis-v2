// tests/specs/reports/owner-report-units.spec.ts
// MG-1193 · TC7 · TM-1356 — Tablero gerencial (`/carrier/#/owner-report`): sus cuatro métricas de
// distancia (total, por viaje, por vehículo, por chofer) coinciden con el resumen diario del mismo
// día y con el crudo en km de `surrendersSummarizedTotals` convertido a la unidad del carrier.
//
// FUERA DE ALCANCE (decisión Q3/D-6 del plan, observación): «$/Km» y «Min/Km» del tablero siguen
// diciendo «Km» en un carrier imperial; este spec NO los afirma ni los niega.
// El gráfico 026/016T da 400 en TEST (`BAD_FILTER_NAME`): no es parte de las 4 métricas, el spec no
// depende de que los gráficos carguen.
// ORÁCULO: respuesta pasiva de la llamada que el propio front dispara; sin requests propios, sin
// mocks, sin base de datos (la pata DB queda en los ATR manuales). SOLO LECTURA.
//
// AMBIENTES: ENV=uat → carrier 1481 (06/05/2026 y mayo/2026) · ENV=test → 1521 (imperial) y 1040
// (métrico, sesión de región AR). Ejecutar:
//   npx cross-env ENV=uat REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/reports/owner-report-units.spec.ts --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { OwnerReportPage } from '../../pages/carrier-v2/reports/OwnerReportPage.js';
import { ReportsDailyPage } from '../../pages/carrier-v2/reports/ReportsDailyPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import {
  DISTANCE_METRICS,
  METRIC_RAW_FIELD
} from '../../pages/carrier-v2/reports/summarizedTotals.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { makeAnnotate } from '../../utils/traceability.js';
import { expectDisplayedDistance } from '../../utils/unitsAssert.js';
import { unitLabel, type DistanceReading } from '../../utils/units.js';

const ROUTE = '/carrier/#/owner-report';
const TM_1356 = 'TM-1356';

test.describe('@P1 @functional MG-1193 Tablero gerencial - distancias en la unidad del carrier', () => {
  for (const carrier of unitsCarriers()) {
    test(`TM-1356: debería mostrar en el tablero gerencial las mismas 4 distancias que el resumen diario, en ${unitLabel(carrier.system)} (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1356, ROUTE)('TC7', 'HP');
      const page = await carrierPage(carrier.region);
      const shell = new ShellPage(page);
      const daily = new ReportsDailyPage(page);
      const owner = new OwnerReportPage(page);

      // 1) Resumen diario del día elegido: las lecturas que el tablero debe igualar.
      await daily.gotoLoaded();
      const dailyStats = await daily.selectDate(carrier.day);
      expect(
        dailyStats.totalKms,
        `precondición: ${carrier.day} en ${carrier.key} debe tener km > 0 (totalKms=${dailyStats.totalKms})`
      ).toBeGreaterThan(0);
      const dailyReadings = new Map<string, DistanceReading>();
      for (const metric of DISTANCE_METRICS) {
        dailyReadings.set(
          metric,
          await expectDisplayedDistance({
            label: `diario · ${metric} (${carrier.key})`,
            read: () => daily.readDistance(metric),
            rawKm: dailyStats[METRIC_RAW_FIELD[metric]],
            system: carrier.system
          })
        );
      }

      // 2) Tablero gerencial sobre el MISMO día: mismo número y misma unidad que el diario.
      await owner.goto();
      const ownerDayStats = await owner.selectRange(carrier.day, carrier.day);
      const medidos: string[] = [];
      for (const metric of DISTANCE_METRICS) {
        const rawKm = ownerDayStats[METRIC_RAW_FIELD[metric]];
        expect(
          rawKm,
          `el tablero y el diario deben pedir el mismo crudo para ${metric} el ${carrier.day}`
        ).toBe(dailyStats[METRIC_RAW_FIELD[metric]]);
        const reading = await expectDisplayedDistance({
          label: `tablero · ${metric} (${carrier.key}, ${carrier.day})`,
          read: () => owner.readDistance(metric),
          readText: () => owner.distanceText(metric),
          rawKm,
          system: carrier.system
        });
        expect(reading, `tablero ≠ diario en ${metric}`).toEqual(dailyReadings.get(metric));
        medidos.push(`día ${metric}: ${rawKm} km → ${reading.value} ${reading.unit}`);
      }

      // 3) Tablero sobre el rango (varios días): crudo del rango convertido, EN y ES sin recargar.
      const rangeStats = await owner.selectRange(carrier.range.from, carrier.range.to);
      expect(
        rangeStats.totalKms,
        `precondición: el rango ${carrier.range.from}..${carrier.range.to} de ${carrier.key} debe tener km > 0`
      ).toBeGreaterThan(0);
      for (const language of ['en', 'es'] as const) {
        await shell.setLanguage(language);
        for (const metric of DISTANCE_METRICS) {
          const rawKm = rangeStats[METRIC_RAW_FIELD[metric]];
          const reading = await expectDisplayedDistance({
            label: `tablero · ${metric} (${language.toUpperCase()}, rango, ${carrier.key})`,
            read: () => owner.readDistance(metric),
            readText: () => owner.distanceText(metric),
            rawKm,
            system: carrier.system
          });
          medidos.push(
            `rango ${language.toUpperCase()} ${metric}: ${rawKm} km → ${reading.value} ${reading.unit}`
          );
        }
      }

      await shell.setLanguage('en');
      await attachXrayEvidence(testInfo, page, {
        name: `tablero-gerencial-distancias-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}). Día ${carrier.day}: las 4 distancias del ` +
          `tablero gerencial son idénticas (número y unidad) a las del resumen diario. Rango ` +
          `${carrier.range.from}..${carrier.range.to}: coinciden con el crudo de surrendersSummarizedTotals en ` +
          `${unitLabel(carrier.system)}, EN y ES sin recargar. ` +
          medidos.join(' · ')
      });
    });
  }
});
