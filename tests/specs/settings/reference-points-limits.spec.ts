// tests/specs/settings/reference-points-limits.spec.ts
// MG-1132 · ATP TM-1841 · PK-4 — límites del modal de alta de Puntos de referencia: longitud máxima de
// Nombre/Referencia (TM-1815) y alta con pin sobre camino rural sin nombre (TM-1863, MG-1757).
// 1 test() = 1 Test de Xray. Ambiente TEST (D2), carrier 1521. Datos propios «QA AUTO <runId> …»; los que
// crea la UI se registran por nombre exacto y se borran en afterEach por id leído de la lista. Sin viajes.
// Corrida local (sesión guardada, sin login con contraseña):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/settings/reference-points-limits.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import { WaypointsClient, type WaypointWriteResult } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { LOCATIONS, MIAMI } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { UiCreatedWaypoints } from '../../helpers/waypoint-ui-cleanup.js';
import { watchWaypointCalls, type WaypointCallWatch } from '../../helpers/waypoint-network.js';
import { parseWaypointPlaceId } from '../../helpers/waypoints-contract.js';
import { attachXrayEvidence } from '../../helpers/xray-evidence.js';
import { ReferencePointFormModalPage } from '../../pages/carrier-v2/settings/ReferencePointFormModalPage.js';
import { ReferencePointsPage } from '../../pages/carrier-v2/settings/ReferencePointsPage.js';
import { installMapHook } from '../../utils/leafletMap.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const ROUTE = '/carrier/#/settings/waypoints';
const DATA = waypointsDataFor(ENV);
const NAME_MAX = 50;
const REFERENCE_MAX = 240;
/** Tolerancia de la coordenada guardada respecto del clic (precondición 5 de TM-1863). */
const COORD_TOLERANCE = 5e-4;

test.describe('MG-1132 PK-4 ABM de Puntos de referencia: límites y camino rural', () => {
  test.skip(
    process.env.WAYPOINTS_CREATE_DATA !== '1',
    'crea y borra puntos de referencia reales; correr con WAYPOINTS_CREATE_DATA=1'
  );
  test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
  test.describe.configure({ timeout: 240_000, retries: 0 });

  let uiCreated: UiCreatedWaypoints | undefined;
  let calls: WaypointCallWatch;

  test.beforeAll(async ({ carrierApi, carrierSession }) => {
    await new WaypointsClient(carrierApi, carrierSession, makeRunId()).sweep();
  });

  test.beforeEach(async ({ page, waypointsApi, carrierSession, runId }) => {
    uiCreated = undefined;
    await installMapHook(page);
    calls = watchWaypointCalls(page);
    uiCreated = new UiCreatedWaypoints(waypointsApi, carrierSession.carrierId, runId);
  });

  test.afterEach(async () => {
    await uiCreated?.cleanup();
  });

  test.describe('@P3 @functional @migration', () => {
    test('TM-1815: debería limitar Nombre a 50 y Referencia a 240 caracteres al pegar y al escribir, y guardar los textos truncados', async ({
      page,
      waypointsApi,
      runId
    }, testInfo) => {
      makeAnnotate('TM-1815', ROUTE)('TC10');
      const prefix = `QA AUTO ${runId} `;
      const pastedName = prefix + 'N'.repeat(60 - prefix.length);
      const expectedName = uiCreated!.track(pastedName.slice(0, NAME_MAX));
      const pastedReference = 'ñ'.repeat(300);
      const list = new ReferencePointsPage(page);
      const form = new ReferencePointFormModalPage(page);
      await list.goto();
      await list.newButton.click();
      await form.expectOpen();

      // Pegar 60 y 300 caracteres (insertText respeta maxlength)
      await form.pasteInto(form.nameInput, pastedName);
      await form.pasteInto(form.referenceInput, pastedReference);
      await expect(form.nameInput).toHaveValue(expectedName);
      await expect(form.referenceInput).toHaveValue('ñ'.repeat(REFERENCE_MAX));
      await expect(form.nameCounter).toHaveText(`${NAME_MAX}/${NAME_MAX}`);
      await expect(form.referenceCounter).toHaveText(`${REFERENCE_MAX}/${REFERENCE_MAX}`);

      // Escribir más no se acepta
      await form.nameInput.press('End');
      await page.keyboard.type('ZZZ');
      await form.referenceInput.press('End');
      await page.keyboard.type('ZZZ');
      await expect(form.nameInput).toHaveValue(expectedName);
      await expect(form.referenceInput).toHaveValue('ñ'.repeat(REFERENCE_MAX));
      expect(await form.readCounters()).toEqual({ name: NAME_MAX, reference: REFERENCE_MAX });
      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1815-limites',
        comment:
          `Modal de alta en ${ENV}: al pegar 60 caracteres en Nombre y 300 en Referencia los contadores marcan ` +
          `${NAME_MAX}/${NAME_MAX} y ${REFERENCE_MAX}/${REFERENCE_MAX}; escribir 3 caracteres más no cambia ningún valor.`,
        locator: form.dialog
      });

      // Guardar con pin y leer lo persistido
      await form.placePin(MIAMI.downtown.lat, MIAMI.downtown.lng);
      const created = page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/carriers\/\d+\/waypoint$/.test(r.url())
      );
      await list.expectToastAfter(/Reference point created/i, () => form.save());
      expect((await created).status()).toBe(200);
      await expect(form.dialog).toBeHidden();
      const stored = (await waypointsApi.list()).find((w) => w.name === expectedName);
      expect(stored?.name).toBe(expectedName);
      expect(stored?.reference).toBe('ñ'.repeat(REFERENCE_MAX));
      expect(calls.count('POST')).toBe(1);
    });
  });

  test.describe('@P2 @functional @migration', () => {
    test('TM-1863: debería guardar desde el modal un punto sobre camino rural sin nombre, con y sin localidad, con checkPlace de waypoint ruteable', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1863', ROUTE)('TC5');
      const list = new ReferencePointsPage(page);
      const form = new ReferencePointFormModalPage(page);
      await list.goto();
      const measured: Record<string, unknown> = {};

      for (const [label, spot] of [
        ['F1 con localidad', LOCATIONS.F1],
        ['F2 sin localidad', LOCATIONS.F2]
      ] as const) {
        await test.step(`alta sobre camino rural ${label}`, async () => {
          const name = uiCreated!.track(nameFor(label));
          await list.newButton.click();
          await form.expectOpen();
          await form.fillName(name);
          const ack = await form.placePin(spot.lat, spot.lng);
          expect(ack.url).toContain('waypoint=true');
          expect(ack.status).toBe(200);
          expect(ack.body.routable).toBe(true);
          expect(ack.body.reasons).toEqual(spot.reasonsWithWaypoint);
          await expect(form.saveButton).toBeEnabled();

          const created = page.waitForResponse(
            (r) => r.request().method() === 'POST' && /\/carriers\/\d+\/waypoint$/.test(r.url())
          );
          created.catch(() => undefined);
          const reloaded = list.listResponse();
          await form.save();
          const response = await created;
          expect(response.status()).toBe(200);
          const body = (await response.json()) as WaypointWriteResult;
          expect(parseWaypointPlaceId(body.waypoint.placeId)).toEqual({
            id: body.waypoint.id,
            version: 1
          });
          expect(Math.abs(body.waypoint.latitude - spot.lat)).toBeLessThan(COORD_TOLERANCE);
          expect(Math.abs(body.waypoint.longitude - spot.lng)).toBeLessThan(COORD_TOLERANCE);
          const sent = calls.last('POST', /^carriers\/\d+\/waypoint$/)?.requestBody as
            | { latitude: number; longitude: number }
            | undefined;
          expect(sent?.latitude).toBe(body.waypoint.latitude);
          expect(sent?.longitude).toBe(body.waypoint.longitude);

          // Con advertencias la app abre un diálogo modal que hay que aceptar; sin ellas, un toast.
          if (body.warnings.length > 0) {
            await expect(list.noCityNotice).toContainText(/Reference point created/i);
            await list.noticeAcceptButton.click();
          } else {
            await expect(list.toast(/Reference point created/i).first()).toBeVisible();
          }
          if (label.startsWith('F2')) {
            expect(body.warnings).toContain('NO_CITY');
          } else {
            testInfo.annotations.push({
              type: 'observation',
              description: `TM-1863 F1: warnings=${JSON.stringify(body.warnings)} (Google devuelve ciudad nula; no hay definición de si debe haber NO_CITY)`
            });
          }
          await expect(form.dialog).toBeHidden();

          await list.served(reloaded);
          await list.search(name);
          await expect(list.dataRows).toHaveCount(1);
          await expect(list.rowByName(name)).toBeVisible();
          expect((await waypointsApi.list()).some((w) => w.id === body.waypoint.id)).toBe(true);
          measured[label] = {
            routable: ack.body.routable,
            reasons: ack.body.reasons,
            warnings: body.warnings,
            id: body.waypoint.id
          };
        });
      }
      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1863-camino-rural',
        comment:
          `Alta por modal en ${ENV} con pin sobre camino rural sin nombre: ${JSON.stringify(measured)}. ` +
          'checkPlace con waypoint=true devolvió routable=true y reasons=[] en ambos, «Save» quedó habilitado, ' +
          'el alta guardó (200, placeId MGWP-{id}-1, coordenada a menos de 5e-4° del clic), NO_CITY apareció en el ' +
          'punto sin localidad y los dos figuran en el listado. No se verifican Q-WP ni Q-MP (paso 5, AC5).'
      });
    });
  });
});
