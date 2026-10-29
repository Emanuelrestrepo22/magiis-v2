// tests/specs/settings/branches-radius-units.spec.ts
// MG-1147 · Configuración › Sucursales (`/carrier/#/settings/branches/list`), carrier IMPERIAL:
//   TM-1325 (TC1) — «Operation Radius» de la grilla y del modal «Editar una sucursal» en millas.
//   TM-1330 (TC6) — el círculo del mapa del modal cubre el radio REAL (km × 1000 m, ±1 m).
//   TM-1331 (TC7) — el círculo se redibuja con valores de borde tipeados (0,5 · 1 · 12,345 · 6000 mi)
//                   y «Guardar» queda deshabilitado por debajo del mínimo 1 (decisión QA 05/10).
//
// SOLO LECTURA: el spec abre el modal, tipea (estado local del formulario) y CANCELA. No existe
// ningún click en «Guardar» ni en «Eliminar» (guardar reescribe OPERATION_RADIUS: deriva O-1).
// ORÁCULO: `GET /carriers/{id}/branches/paginated` (`operationRadius`, km) observado pasivamente; el
// radio del círculo se lee con el hook de `L.Circle` (tests/utils/leaflet.ts, aprobado por el owner
// el 07/10/2026: observa estado interno del front, no el backend).
// Los carriers MÉTRICOS quedan fuera de esta ola (TM-1326: el 1040 es un demo y el 1181 no tiene
// credenciales); la pata de base de datos queda en los ATR manuales.
//
// AMBIENTES: ENV=uat → carrier 1481 (sucursales 1752 y 2933) · ENV=test → carrier 1521 (1044 y
// 2184). Ejecutar:
//   npx cross-env ENV=uat REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/settings/branches-radius-units.spec.ts --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../fixtures/carrierRegionFixture.js';
import { attachXrayEvidence } from '../../TestBase.js';
import { BranchesListPage } from '../../pages/carrier-v2/settings/BranchesListPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { unitsCarriers } from '../../data/carrier-v2/units/mg1189.js';
import { clearCircles, installCircleHook, readCircleRadii } from '../../utils/leaflet.js';
import { makeAnnotate } from '../../utils/traceability.js';
import { expectDisplayedDistance, required } from '../../utils/unitsAssert.js';
import { KM_PER_MILE, containsUnit } from '../../utils/units.js';

const ROUTE = '/carrier/#/settings/branches/list';
const TM_1325 = 'TM-1325';
const TM_1330 = 'TM-1330';
const TM_1331 = 'TM-1331';

/** Tolerancia al comparar el radio del círculo con el esperado (metros). */
const RADIUS_TOLERANCE_M = 1;

/** Valores de borde del radio en millas (TM-1331): el mínimo definido es 1 (decisión QA 05/10). */
const EDGE_VALUES_MI = [
  { miles: 0.5, saveEnabled: false },
  { miles: 1, saveEnabled: true },
  { miles: 12.345, saveEnabled: true },
  { miles: 6000, saveEnabled: true }
] as const;

// Esta ola solo cubre carriers imperiales con sucursales de QA identificadas.
const carriers = unitsCarriers().filter((c) => c.system === 'imperial' && c.branchIds.length > 0);

test.describe('@P1 @functional MG-1147 Sucursales - radio de operación en millas', () => {
  for (const carrier of carriers) {
    test(`TM-1325: debería mostrar el radio de operación en Mi en la grilla y en el modal de Sucursales (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1325, ROUTE)('TC1', 'HP');
      const page = await carrierPage(carrier.region);
      const shell = new ShellPage(page);
      const branches = new BranchesListPage(page);

      const raw = await branches.gotoAndCapture();
      const rawById = new Map(raw.map((b) => [b.id, b]));

      // Precondición de datos (anti-vacuidad): hace falta al menos una sucursal con radio ≥ 1 km
      // y las sucursales de QA tienen que estar en la primera página del listado.
      expect(
        raw.some((b) => b.operationRadius >= 1),
        `precondición: ${carrier.key} debe tener ≥ 1 sucursal con radio ≥ 1 km (${raw.length} sucursales)`
      ).toBe(true);
      for (const id of carrier.branchIds) {
        expect(
          rawById.has(id),
          `precondición: la sucursal ${id} debe estar en la primera página del listado de ${carrier.key}`
        ).toBe(true);
      }

      const measured: string[] = [];
      for (const language of ['en', 'es'] as const) {
        await shell.setLanguage(language);

        // Grilla: todas las filas de la página, en millas y sin ningún «km».
        for (const branch of raw) {
          const reading = await expectDisplayedDistance({
            label: `grilla ${language.toUpperCase()} · sucursal ${branch.id} (${carrier.key})`,
            read: () => branches.readGridRadius(branch.id),
            readText: () => branches.radiusCellText(branch.id),
            rawKm: branch.operationRadius,
            system: 'imperial'
          });
          measured.push(
            `${language.toUpperCase()} grilla ${branch.id}: ${branch.operationRadius} km → ${reading.value} ${reading.unit}`
          );
        }
        expect(
          containsUnit(await branches.allRadiusCellsText(), 'km'),
          `la columna de radio no debe mostrar «km» en ${carrier.key} (${language.toUpperCase()})`
        ).toBe(false);

        // Modal: radio en millas con 3 decimales y rótulo «Mi»; Cancelar deja la grilla igual.
        for (const id of carrier.branchIds) {
          const branch = required(rawById.get(id), `sucursal ${id} ausente del listado`);
          const before = await branches.radiusCellText(id);
          await branches.openEdit(id);
          const reading = await expectDisplayedDistance({
            label: `modal ${language.toUpperCase()} · sucursal ${id} (${carrier.key})`,
            read: () => branches.readModalRadius(),
            readText: async () =>
              `${await branches.radiusInput.inputValue()} ${await branches.radiusUnit.innerText()}`,
            rawKm: branch.operationRadius,
            system: 'imperial',
            decimals: 3
          });
          measured.push(
            `${language.toUpperCase()} modal ${id}: ${branch.operationRadius} km → ${reading.value} ${reading.unit}`
          );
          await branches.cancelModal();
          expect(
            await branches.radiusCellText(id),
            `tras Cancelar, la grilla de la sucursal ${id} no debe cambiar`
          ).toBe(before);
        }
      }

      await shell.setLanguage('en');
      await attachXrayEvidence(testInfo, page, {
        name: `sucursales-radio-millas-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}), ${raw.length} sucursales en la primera página. ` +
          `Grilla y modal en millas (Mi), ninguna fila en km, EN y ES sin recargar; Cancelar no altera la grilla. ` +
          measured.join(' · ')
      });
    });

    test(`TM-1330: debería dibujar el círculo del mapa con el radio real de la sucursal (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1330, ROUTE)('TC6', 'HP');
      const page = await carrierPage(carrier.region);
      await installCircleHook(page);
      const branches = new BranchesListPage(page);

      const raw = await branches.gotoAndCapture();
      const measured: string[] = [];
      for (const id of carrier.branchIds) {
        const branch = required(
          raw.find((b) => b.id === id),
          `precondición: la sucursal ${id} debe estar en el listado de ${carrier.key}`
        );
        const expectedMeters = branch.operationRadius * 1000;

        await clearCircles(page);
        await branches.openEdit(id);
        const modalMiles = (await branches.readModalRadius())?.value ?? Number.NaN;

        // El círculo se agrega al mapa después de abrir el modal: se reintenta hasta leerlo.
        let radius = Number.NaN;
        await expect(async () => {
          const radii = await readCircleRadii(page);
          expect(
            radii.length,
            `sucursal ${id}: el mapa del modal debe dibujar un círculo`
          ).toBeGreaterThan(0);
          radius = radii[radii.length - 1];
          expect(
            Math.abs(radius - expectedMeters),
            `sucursal ${id}: radio del círculo ${radius} m, esperado ${expectedMeters} m (±${RADIUS_TOLERANCE_M})`
          ).toBeLessThanOrEqual(RADIUS_TOLERANCE_M);
        }).toPass({ timeout: 15_000 });

        // Control positivo: el valor DEFECTUOSO (millas leídas como km: modal × 1000 m) difiere del
        // esperado; si no, el caso no discriminaría la regresión.
        const defectiveMeters = modalMiles * 1000;
        expect(
          Math.abs(defectiveMeters - expectedMeters),
          `control: el radio defectuoso (${defectiveMeters} m) debe diferir del real (${expectedMeters} m)`
        ).toBeGreaterThan(RADIUS_TOLERANCE_M);

        measured.push(
          `sucursal ${id}: modal ${modalMiles} Mi · círculo ${radius} m · real ${expectedMeters} m · defectuoso ${defectiveMeters} m`
        );
        await attachXrayEvidence(testInfo, page, {
          name: `sucursales-circulo-radio-${carrier.key}-${id}`,
          comment:
            `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}) con L.Circle.getRadius() en runtime (±${RADIUS_TOLERANCE_M} m). ` +
            `El círculo cubre el radio real en metros (km × 1000), no el valor del modal × 1000. ` +
            measured.join(' · ')
        });
        await branches.cancelModal();
      }
    });

    test(`TM-1331: debería redibujar el círculo del mapa al tipear valores de borde del radio en millas (${carrier.key})`, async ({
      carrierPage
    }, testInfo) => {
      makeAnnotate(TM_1331, ROUTE)('TC7', 'BVA');
      const page = await carrierPage(carrier.region);
      await installCircleHook(page);
      const branches = new BranchesListPage(page);

      const raw = await branches.gotoAndCapture();
      const id = carrier.branchIds[0];
      expect(
        raw.some((b) => b.id === id),
        `precondición: la sucursal ${id} debe estar en el listado de ${carrier.key}`
      ).toBe(true);

      await clearCircles(page);
      await branches.openEdit(id);
      await expect(async () => {
        expect(
          (await readCircleRadii(page)).length,
          'el mapa debe dibujar el círculo inicial'
        ).toBeGreaterThan(0);
      }).toPass({ timeout: 15_000 });

      const measured: string[] = [];
      for (const edge of EDGE_VALUES_MI) {
        // Solo se tipea (estado local del formulario): NO se guarda.
        await branches.radiusInput.fill(String(edge.miles));
        const expectedMeters = edge.miles * KM_PER_MILE * 1000;
        let radius = Number.NaN;
        await expect(async () => {
          const radii = await readCircleRadii(page);
          radius = radii[radii.length - 1];
          expect(
            Math.abs(radius - expectedMeters),
            `${edge.miles} Mi: radio del círculo ${radius} m, esperado ${expectedMeters} m (±${RADIUS_TOLERANCE_M})`
          ).toBeLessThanOrEqual(RADIUS_TOLERANCE_M);
        }).toPass({ timeout: 15_000 });
        await branches.expectSaveEnabled(edge.saveEnabled);
        measured.push(
          `${edge.miles} Mi → círculo ${radius} m (esperado ${Math.round(expectedMeters * 1000) / 1000} m) · Guardar ${edge.saveEnabled ? 'habilitado' : 'deshabilitado'}`
        );
      }

      await attachXrayEvidence(testInfo, page, {
        name: `sucursales-circulo-valores-borde-${carrier.key}`,
        comment:
          `Medido en ${carrier.key} (ENV=${process.env.ENV ?? 'test'}), sucursal ${id}, valores tipeados sin guardar. ` +
          `El círculo se redibuja con cada valor (L.Circle.getRadius(), ±${RADIUS_TOLERANCE_M} m) y «Guardar» queda ` +
          `deshabilitado solo por debajo del mínimo 1. ${measured.join(' · ')}`
      });
      await branches.cancelModal();
    });
  }
});
