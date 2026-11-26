// tests/specs/settings/reference-points-access.spec.ts
// MG-1132 · ATP TM-1841 · PK-4 — TM-1826: un usuario del perfil «Solo PRC R» del carrier 1040 (sin el
// permiso CFG.W de Puntos de referencia) no ve el ítem de menú y la ruta del ABM responde «Access denied»
// sin datos. Sesión propia del usuario: `storage/state-carrier-prc-r-1040-<env>.json`, generada con
//   npx cross-env ENV=test npx tsx scripts/login-prc-r-session.ts
// (lee USER_CARRIER_PRC_R_1040 / PASS_CARRIER_PRC_R_1040 del .env dentro del proceso; el spec nunca
// hace login). Sin ese archivo el test se SALTA con motivo (el reporter emite el run como TODO).
// Siembra: un punto propio en el carrier 1040 por la segunda sesión (otherCarrierWaypointsApi), borrado
// por id propio al terminar. Sin viajes.
// ESTADO 19/11/2026: el .env.test trae PASS_CARRIER_PRC_R_1040 VACÍA → no hay sesión generable; spec NO
// ejecutado. Pendiente además: la parte «Nuevo Viaje lista el punto con badge» del Test (la cubre PK-2).
import { existsSync } from 'node:fs';
import { getCurrentEnv } from '../../config/runtime.js';
import { MIAMI, toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { prcRStorageStatePath } from '../../data/carrier-v2/waypoints/prc-r-session.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { loadCarrierSession } from '../../api/clients/carrierSession.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { watchWaypointCalls } from '../../helpers/waypoint-network.js';
import { attachXrayEvidence } from '../../helpers/xray-evidence.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const ROUTE = '/carrier/#/settings/waypoints';
const DATA = waypointsDataFor(ENV);
const STATE = prcRStorageStatePath(ENV);

test.describe('@P1 @functional @migration MG-1132 PK-4 acceso al ABM sin permiso CFG.W', () => {
  test.skip(
    process.env.WAYPOINTS_CREATE_DATA !== '1',
    'siembra un punto real en el carrier 1040; correr con WAYPOINTS_CREATE_DATA=1'
  );
  test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
  test.skip(
    !existsSync(STATE),
    `falta la sesión del usuario «Solo PRC R» (${STATE}): PASS_CARRIER_PRC_R_1040 está vacía en .env.${ENV}; ` +
      'completarla y correr scripts/login-prc-r-session.ts'
  );
  test.describe.configure({ timeout: 240_000, retries: 0 });
  test.use({ storageState: STATE });

  test('TM-1826: debería ocultar el ítem de menú y responder Acceso denegado sin datos en la ruta del ABM para un usuario sin permiso de puntos de referencia', async ({
    page,
    otherCarrierWaypointsApi,
    otherCarrierId,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1826', ROUTE)('TC22');
    // La sesión del usuario «Solo PRC R» tiene que ser del carrier 1040 (el del punto sembrado).
    expect(loadCarrierSession({ storageStatePath: STATE }).carrierId).toBe(otherCarrierId);
    const calls = watchWaypointCalls(page);
    const name = nameFor('sin permiso');
    const { waypoint } = await otherCarrierWaypointsApi.create({
      name,
      reference: 'No debe verse',
      ...toWaypointCoords(MIAMI.downtown)
    });
    // control positivo: el punto existe y la API del carrier lo devuelve
    expect((await otherCarrierWaypointsApi.list()).some((w) => w.id === waypoint.id)).toBe(true);

    // Menú: se espera un ítem que el perfil SÍ tiene y recién ahí se asevera la ausencia (incluso oculto).
    const sidebarLink = page.getByRole('region', { name: /scrollable content/i }).getByRole('link');
    const waypointsEntry = page.getByRole('link', {
      name: /^(waypoints|reference points|puntos de referencia)$/i,
      includeHidden: true
    });
    await page.goto('/carrier/#/dashboard');
    await expect(sidebarLink.first()).toBeVisible();
    await expect(waypointsEntry).toHaveCount(0);

    for (const hash of ['#/settings/waypoints', `#/settings/waypoints?id=${waypoint.id}`]) {
      await page.goto('/carrier/#/dashboard');
      await expect(sidebarLink.first()).toBeVisible();
      await page.goto(`/carrier/${hash}`);
      await expect(page).toHaveURL(/#\/no-access/);
      await expect(page.getByText(/access denied|acceso denegado/i).first()).toBeVisible();
      await expect(page.getByText(name)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /new reference point/i })).toHaveCount(0);
    }
    // Ninguna llamada de la pantalla a carriers/{id}/waypoint (control positivo: la API sí lo devuelve, arriba).
    expect(calls.calls()).toEqual([]);

    testInfo.annotations.push({
      type: 'observation',
      description:
        'TM-1826: el paso 4 (Nuevo Viaje lista el punto con badge para este usuario) no está cubierto para este usuario'
    });
    await attachXrayEvidence(testInfo, page, {
      name: 'tm-1826-acceso-denegado',
      comment:
        `Usuario «Solo PRC R» del carrier ${otherCarrierId} en ${ENV}: el menú no muestra «Waypoints»; ` +
        `#/settings/waypoints y #/settings/waypoints?id=${waypoint.id} redirigen a #/no-access con «Access denied» sin el punto ` +
        `«${name}» ni el botón de alta, y la pantalla no llamó a carriers/{id}/waypoint. Paso 4 no cubierto para este usuario.`
    });
  });
});
