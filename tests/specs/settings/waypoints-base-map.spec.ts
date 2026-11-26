// tests/specs/settings/waypoints-base-map.spec.ts
// MG-1132 · ATP TM-1841 — smoke de la BASE de automatizacion para clicks sobre mapas (leafletMap /
// googleMap). NO acredita ningun Test de Xray (sin clave TM en el titulo) y NO crea datos: abre el
// popover / modal, marca una coordenada y cancela. Ambiente TEST (decision D2).
// Hallazgo de recon (19/11): el mapa de Nuevo Viaje es Google Maps; Leaflet es el de Configuracion ›
// Puntos de referencia. Cada helper se prueba contra su mapa real. Textos de UI en EN (el locale del
// repo es en-US, DEFAULT_LOCALE).
// Corrida local (sesion guardada, sin login con contrasena):
//   npx cross-env ENV=test REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/settings/waypoints-base-map.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import type { Page, Request } from '@playwright/test';
import { test, expect } from '../../TestBase.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { MIAMI } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { NewTripPage } from '../../pages/carrier-v2/trips/NewTripPage.js';
import { clickGoogleMapAndWaitForCheckPlace, installGoogleMapHook } from '../../utils/googleMap.js';
import {
  clickMapAndWaitForCheckPlace,
  installMapHook,
  markerCount
} from '../../utils/leafletMap.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
/** Alta de punto: POST carriers/{id}/waypoint (sin id al final). */
const WAYPOINT_POST = /\/carriers\/\d+\/waypoint$/;

/** Cuenta los POST de alta de punto observados desde que se llama. */
function watchWaypointPosts(page: Page): { count: () => number } {
  let posts = 0;
  page.on('request', (request: Request) => {
    if (request.method() === 'POST' && WAYPOINT_POST.test(request.url().split('?')[0])) posts += 1;
  });
  return { count: () => posts };
}

test.describe('@P3 @functional @migration MG-1132 base de automatizacion: click sobre mapas', () => {
  test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
  test.describe.configure({ timeout: 120_000, retries: 0 });

  test('BASE-WP-04: debería abrir el popover de punto de referencia al marcar un lugar con el puntero de Nuevo Viaje y cancelarlo sin crear nada', async ({
    page
  }) => {
    const posts = watchWaypointPosts(page);
    await installGoogleMapHook(page);
    const trip = new NewTripPage(page);
    await trip.goto();
    await trip.selectClient('Stripe', 'Stripe, Cliente');

    await trip.form
      .locator('.trip-address-row.origin')
      .getByRole('button', { name: 'Select on Map' })
      .click();
    const ack = await clickGoogleMapAndWaitForCheckPlace(
      page,
      page.locator('.nt-map-wrapper .map-container'),
      MIAMI.downtown
    );
    expect(ack.url).toContain('waypoint=true');
    expect(ack.body.routable).toBe(true);

    const popover = page.locator('.nt-waypoint-popover');
    await expect(popover.getByText('Save as reference point')).toBeVisible();
    await popover.getByRole('button', { name: 'Cancel' }).click();
    await expect(popover).toBeHidden();
    expect(posts.count()).toBe(0);
  });

  test('BASE-WP-05: debería marcar un lugar en el mapa del modal del ABM y cancelar sin crear nada', async ({
    page
  }) => {
    const posts = watchWaypointPosts(page);
    await installMapHook(page);
    await page.goto('/carrier/#/settings/waypoints');
    await page.getByRole('button', { name: 'New reference point' }).click();
    const dialog = page.getByRole('dialog');
    const map = dialog.locator('#waypointFormMap');
    await expect(map).toBeVisible();

    const ack = await clickMapAndWaitForCheckPlace(page, map, MIAMI.downtown);
    expect(ack.url).toContain('waypoint=true');
    expect(ack.body.routable).toBe(true);
    await expect.poll(() => markerCount(map)).toBe(1);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(posts.count()).toBe(0);
  });
});
