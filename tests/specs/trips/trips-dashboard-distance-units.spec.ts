// tests/specs/trips/trips-dashboard-distance-units.spec.ts
// MG-1190 · TC3 · TM-1307 — Gestión de Viajes (`/carrier/#/travel/dashboard`): la columna
// «Distancia al Pasajero» de cada pestaña (Asignar, Programados, En conflicto) muestra el crudo
// `distanceToPPUP` (km) de la fila convertido a millas (carrier imperial) o sin convertir (métrico),
// con el rótulo de la unidad del carrier y el separador del carrier. Cero ⇒ «0 Mi» / «0 km».
//
// ORÁCULO: `GET carriers/{id}/travels/paginated?size=20&state=…` (`page.content[].distanceToPPUP`,
// código visible = `travelIdForCarrier-channel`), observado pasivamente. Primera página (20 filas)
// de cada pestaña; EN y ES sin recargar. SOLO LECTURA: nunca se hace clic en una fila ni en el
// botón «A» (asignación automática) ni en el interruptor de asignación automática.
//
// DATOS: el tablero es volátil (viajes de terceros). Una pestaña sin filas se OMITE con el motivo
// nombrado (no pasa en vacío); la aserción es genérica por fila, no por valor. UAT trae solo
// ceros (uat-1190-results.md): corre en TEST, donde hay distancias > 0.
// Ejecutar: npx cross-env ENV=test REUSE_STORAGE_STATE=1 npx playwright test \
//   tests/specs/trips/trips-dashboard-distance-units.spec.ts --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import {
  TravelDashboardPage,
  type TravelTab
} from '../../pages/carrier-v2/trips/TravelDashboardPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { makeAnnotate } from '../../utils/traceability.js';
import { decimalHint, expectDisplayedDistance } from '../../utils/unitsAssert.js';
import { parseDistance, unitLabel } from '../../utils/units.js';

const ROUTE = '/carrier/#/travel/dashboard';
const TM_1307 = 'TM-1307';

const TABS: { tab: TravelTab; name: string }[] = [
  { tab: 'assign', name: 'Asignar' },
  { tab: 'programmed', name: 'Programados' },
  { tab: 'in-conflict', name: 'En conflicto' }
];

test.describe('@P1 @functional MG-1190 Gestión de Viajes - distancia al pasajero en la unidad del carrier', () => {
  for (const carrier of unitsCarriers()) {
    for (const { tab, name } of TABS) {
      test(`TM-1307: debería mostrar «Distancia al Pasajero» de la pestaña ${name} en ${unitLabel(carrier.system)} (${carrier.key})`, async ({
        carrierPage
      }, testInfo) => {
        makeAnnotate(TM_1307, ROUTE)('TC3', 'HP');
        const page = await carrierPage(carrier.region);
        const shell = new ShellPage(page);
        const dashboard = new TravelDashboardPage(page);
        const hint = decimalHint(carrier.system);

        const rows = await dashboard.gotoAndCapture(tab);

        // eslint-disable-next-line playwright/no-skipped-test -- omisión por precondición de datos, con motivo nombrado
        test.skip(
          rows.length === 0,
          `precondición de datos: la pestaña ${name} de ${carrier.key} no tiene viajes en ${process.env.ENV ?? 'test'}; sin filas no hay distancia que verificar`
        );

        const measured: string[] = [];
        for (const language of ['en', 'es'] as const) {
          await shell.setLanguage(language);
          for (const [position, row] of rows.entries()) {
            const { cell, code } = await dashboard.distanceToPassengerCellAt(position);
            // Emparejamiento por posición: se verifica que la fila sea la del viaje de la API.
            await expect(
              code,
              `${name}: la fila ${position + 1} debe ser el viaje ${row.code} (orden de la API)`
            ).toHaveText(row.codePattern);
            const reading = await expectDisplayedDistance({
              label: `${name} › ${row.code} › Distancia al Pasajero (${language.toUpperCase()}, ${carrier.key})`,
              read: async () => parseDistance((await cell.innerText()).trim(), hint),
              readText: async () => (await cell.innerText()).trim(),
              rawKm: row.distanceToPPUP ?? 0,
              system: carrier.system
            });
            measured.push(
              `${language.toUpperCase()} ${row.code}: ${row.distanceToPPUP ?? 0} km → ${reading.value} ${reading.unit}`
            );
          }
        }
        await shell.setLanguage('en');

        const discriminating = rows.filter((row) => (row.distanceToPPUP ?? 0) >= 1).length;
        testInfo.annotations.push({
          type: 'cobertura',
          description: `${rows.length} filas, ${discriminating} con distancia ≥ 1 km (las demás verifican el «0»)`
        });
        await attachXrayEvidence(testInfo, page, {
          name: `tablero-viajes-distancia-${tab}-${carrier.key}`,
          comment:
            `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}), pestaña ${name}: ${rows.length} filas ` +
            `(${discriminating} con distancia ≥ 1 km). «Distancia al Pasajero» = distanceToPPUP de ` +
            `travels/paginated en ${unitLabel(carrier.system)}, EN y ES sin recargar. ` +
            measured.slice(0, 12).join(' · ')
        });
      });
    }
  }
});
