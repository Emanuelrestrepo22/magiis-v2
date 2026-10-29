// tests/specs/reports/ranking-vehicles-units.spec.ts
// MG-1193 · TC3 · TM-1352 — Reportes › Vehículos › Ranking de vehículos
// (`/carrier/#/reports/ranking-vehicles`): las columnas «Dist/Viaje» y «Dist. Ocupada» (filas y
// totales) muestran el crudo en km del reporte genérico 001 / 001T, convertido a millas (carrier
// imperial) o sin convertir (métrico), con la unidad en la sub-cabecera y sin la otra unidad.
//
// ORÁCULO: `POST /data/genericReport/001/paginated` (`Col7` Dist/Viaje, `Col11` Dist. Ocupada,
// `Col2` dominio) y `001T` (`Col13`, `Col9`), observados pasivamente. SIEMPRE se fija el rango.
// El dominio «MAGIIS6» aparece dos veces en UAT (categorías Standard / Premium): las filas se
// emparejan con la API POR POSICIÓN y se verifica el dominio de cada una (un emparejamiento por
// dominio dio un falso FAIL en la corrida manual, uat-1193-results.md §5). SOLO LECTURA.
//
// AMBIENTES: ENV=uat → carrier 1481, mayo/2026 · ENV=test → 1521 (agosto) y 1040 (métrico,
// septiembre). Ejecutar:
//   npx cross-env ENV=uat REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/reports/ranking-vehicles-units.spec.ts --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { ReportRankingVehiclesPage } from '../../pages/carrier-v2/reports/ReportRankingVehiclesPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { makeAnnotate } from '../../utils/traceability.js';
import {
  expectRankingDistances,
  rankingDistinguishes,
  type RankingColumns
} from '../../utils/rankingUnits.js';
import { unitLabel } from '../../utils/units.js';

const ROUTE = '/carrier/#/reports/ranking-vehicles';
const TM_1352 = 'TM-1352';

// Reporte 001: Col7 = Dist/Viaje, Col11 = Dist. Ocupada, Col2 = dominio; 001T: Col13 / Col9.
const COLUMNS: RankingColumns = {
  rowPerTrip: 'Col7',
  rowBusy: 'Col11',
  totalPerTrip: 'Col13',
  totalBusy: 'Col9',
  identity: 'Col2'
};

test.describe('@P1 @functional MG-1193 Ranking de vehículos - distancias en la unidad del carrier', () => {
  for (const carrier of unitsCarriers()) {
    test(`TM-1352: debería mostrar Dist/Viaje y Dist. Ocupada del ranking de vehículos en ${unitLabel(carrier.system)} (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1352, ROUTE)('TC3', 'HP');
      const page = await carrierPage(carrier.region);
      const shell = new ShellPage(page);
      const ranking = new ReportRankingVehiclesPage(page);

      await ranking.gotoLoaded();
      const raw = await ranking.selectRange(carrier.range.from, carrier.range.to);

      // Precondición de datos (anti-vacuidad): ≥ 1 vehículo con distancia cruda > 0.
      expect(
        rankingDistinguishes(raw, COLUMNS),
        `precondición: ${carrier.range.from}..${carrier.range.to} en ${carrier.key} debe tener ≥ 1 vehículo con distancia > 0 (${raw.rows.length} filas)`
      ).toBe(true);

      const measured: string[] = [];
      for (const language of ['en', 'es'] as const) {
        await shell.setLanguage(language);
        const lines = await expectRankingDistances({
          ranking,
          raw,
          columns: COLUMNS,
          system: carrier.system,
          context: `${language.toUpperCase()} · ${carrier.key}`
        });
        measured.push(...lines.map((line) => `${language.toUpperCase()} ${line}`));
      }

      await shell.setLanguage('en');
      await attachXrayEvidence(testInfo, page, {
        name: `ranking-vehiculos-distancias-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}), rango ${carrier.range.from}..${carrier.range.to}, ` +
          `${raw.rows.length} vehículos. Cada celda «Dist/Viaje» y «Dist. Ocupada» (filas y totales) coincide con el crudo ` +
          `de genericReport 001/001T en ${unitLabel(carrier.system)}, EN y ES sin recargar. ` +
          measured.slice(0, 14).join(' · ')
      });
    });
  }
});
