// tests/specs/reports/ranking-drivers-units.spec.ts
// MG-1193 · TC1 · TM-1350 — Reportes › Choferes › Ranking de choferes
// (`/carrier/#/reports/ranking-drivers`): las columnas «Dist/Viaje» y «Dist. Ocupada» (filas y
// totales) muestran el crudo en km del reporte genérico 002 / 002T, convertido a millas (carrier
// imperial) o sin convertir (métrico), con la unidad en la sub-cabecera y sin la otra unidad.
//
// ORÁCULO: `POST /data/genericReport/002/paginated` (`Col5` Dist/Viaje, `Col9` Dist. Ocupada,
// `Col2` nombre) y `002T` (`Col10`, `Col6`), observados pasivamente. SIEMPRE se fija el rango: el
// picker abre en «últimos 15 días» (`getLastDays(15)`), volátil. SOLO LECTURA, sin base de datos.
//
// AMBIENTES: ENV=uat → carrier 1481, mayo/2026 (5 choferes; filas en 0) · ENV=test → 1521 (agosto)
// y 1040 (métrico, septiembre; valores > 1 000: separador de miles). Ejecutar:
//   npx cross-env ENV=uat REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/reports/ranking-drivers-units.spec.ts --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { ReportRankingDriversPage } from '../../pages/carrier-v2/reports/ReportRankingDriversPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { makeAnnotate } from '../../utils/traceability.js';
import {
  expectRankingDistances,
  rankingDistinguishes,
  type RankingColumns
} from '../../utils/rankingUnits.js';
import { unitLabel } from '../../utils/units.js';

const ROUTE = '/carrier/#/reports/ranking-drivers';
const TM_1350 = 'TM-1350';

// Reporte 002: Col5 = Dist/Viaje, Col9 = Dist. Ocupada, Col2 = nombre; 002T: Col10 / Col6.
const COLUMNS: RankingColumns = {
  rowPerTrip: 'Col5',
  rowBusy: 'Col9',
  totalPerTrip: 'Col10',
  totalBusy: 'Col6',
  identity: 'Col2'
};

test.describe('@P1 @functional MG-1193 Ranking de choferes - distancias en la unidad del carrier', () => {
  for (const carrier of unitsCarriers()) {
    test(`TM-1350: debería mostrar Dist/Viaje y Dist. Ocupada del ranking de choferes en ${unitLabel(carrier.system)} (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1350, ROUTE)('TC1', 'HP');
      const page = await carrierPage(carrier.region);
      const shell = new ShellPage(page);
      const ranking = new ReportRankingDriversPage(page);

      await ranking.gotoLoaded();
      const raw = await ranking.selectRange(carrier.range.from, carrier.range.to);

      // Precondición de datos (anti-vacuidad): ≥ 1 chofer con distancia cruda > 0.
      expect(
        rankingDistinguishes(raw, COLUMNS),
        `precondición: ${carrier.range.from}..${carrier.range.to} en ${carrier.key} debe tener ≥ 1 chofer con distancia > 0 (${raw.rows.length} filas)`
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
        name: `ranking-choferes-distancias-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}), rango ${carrier.range.from}..${carrier.range.to}, ` +
          `${raw.rows.length} choferes. Cada celda «Dist/Viaje» y «Dist. Ocupada» (filas y totales) coincide con el crudo ` +
          `de genericReport 002/002T en ${unitLabel(carrier.system)}, EN y ES sin recargar. ` +
          measured.slice(0, 14).join(' · ')
      });
    });
  }
});
