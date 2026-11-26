// tests/specs/settings/reference-points.spec.ts
// MG-1132 · ATP TM-1841 · PK-4 — ABM de Configuración › Puntos de referencia (MG-1763): listado, búsqueda,
// alta por modal con pin, baja, concurrencia y filtro tras editar. 1 test() = 1 Test de Xray.
// Ambiente TEST (decisión D2), carrier 1521. Datos propios «QA AUTO <runId> …»: los puntos de partida se
// siembran por API (waypointsApi, limpieza en el finally del fixture) y los que crea la UI se registran
// por nombre exacto (UiCreatedWaypoints) y se borran en afterEach por id leído de la lista. Sin viajes.
// Totales y pines se comparan con el arreglo del MISMO `GET carriers/{id}/waypoint` que pintó la pantalla
// (no con una segunda lectura de la API: otras sesiones crean y borran puntos en el 1521).
// Textos de UI en EN (locale en-US del repo). Mapa del modal = Leaflet (tests/utils/leafletMap.ts).
// Corrida local (sesión guardada, sin login con contraseña):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/settings/reference-points.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { MIAMI, toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { recordKnownIssue } from '../../helpers/known-issue.js';
import { UiCreatedWaypoints } from '../../helpers/waypoint-ui-cleanup.js';
import { watchWaypointCalls, type WaypointCallWatch } from '../../helpers/waypoint-network.js';
import { distanceMeters, parseWaypointPlaceId } from '../../helpers/waypoints-contract.js';
import { attachXrayEvidence } from '../../helpers/xray-evidence.js';
import { makeAnnotate } from '../../utils/traceability.js';
import { ReferencePointFormModalPage } from '../../pages/carrier-v2/settings/ReferencePointFormModalPage.js';
import { ReferencePointsPage } from '../../pages/carrier-v2/settings/ReferencePointsPage.js';
import { installMapHook } from '../../utils/leafletMap.js';

const ENV = getCurrentEnv();
const ROUTE = '/carrier/#/settings/waypoints';
const DATA = waypointsDataFor(ENV);
const PAGE_SIZE = 20;
/** Tolerancia del pin guardado respecto del clic (≈ 55 m = 5e-4°, la de la definición de TM-1863). */
const PIN_TOLERANCE_M = 60;

/** Texto del diálogo de baja de un punto SIN uso (sin aviso de uso adicional). */
const DELETE_PROMPT = (name: string): RegExp =>
  new RegExp(
    `^Are you sure you want to delete "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\?$`
  );

/** Coordenada como la muestra el listado: 6 decimales. */
const asCell = (lat: number, lng: number): string => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

test.describe('MG-1132 PK-4 ABM de Puntos de referencia', () => {
  test.skip(
    process.env.WAYPOINTS_CREATE_DATA !== '1',
    'crea y borra puntos de referencia reales; correr con WAYPOINTS_CREATE_DATA=1'
  );
  test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
  // SIN retries: cada intento crea datos reales y un reintento taparía la falla del primero.
  test.describe.configure({ timeout: 240_000, retries: 0 });

  let uiCreated: UiCreatedWaypoints | undefined;
  let calls: WaypointCallWatch;

  // Barrido de corridas anteriores: solo puntos «QA AUTO <runId>» con más de 24 h.
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

  test.describe('@P1 @functional @migration smoke', () => {
    test('TM-1806: debería listar los puntos de referencia en Configuración con nombre, coordenadas, referencia y acciones, y un total igual al que sirvió el servicio', async ({
      page,
      waypointsApi,
      nameFor,
      runId
    }, testInfo) => {
      makeAnnotate('TM-1806', ROUTE)('TC1');
      const withRef = nameFor('con ref');
      const noRef = nameFor('sin ref');
      const a = await waypointsApi.create({
        name: withRef,
        reference: 'Portón verde, km 118',
        ...toWaypointCoords(MIAMI.downtown)
      });
      const b = await waypointsApi.create({
        name: noRef,
        reference: null,
        ...toWaypointCoords(MIAMI.brickell)
      });

      const list = new ReferencePointsPage(page);
      await page.goto('/carrier/#/dashboard');
      const served = await list.openFromMenuServed();
      await expect(page).toHaveURL(/#\/settings\/waypoints/);
      await expect(list.heading).toContainText('Configuration / Reference points');
      await expect(
        page.getByRole('listitem').filter({ hasText: 'Reference points' }).last()
      ).toBeVisible();
      for (const header of [/Name/, /Reference/, /Actions/]) {
        await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
      }

      // Lo que muestra la pantalla = lo que devolvió el servicio; los dos puntos propios están, por id.
      expect(served.map((w) => w.id)).toEqual(
        expect.arrayContaining([a.waypoint.id, b.waypoint.id])
      );
      await expect(list.totalLabel).toContainText(list.totalPattern(served.length));
      await expect(list.mapMarkers).toHaveCount(served.length);

      await list.search(runId);
      await expect(list.dataRows).toHaveCount(2);
      await expect(list.mapMarkers).toHaveCount(2);
      for (const name of [withRef, noRef]) {
        await expect(list.locationButtonFor(name)).toBeVisible();
        await expect(list.editButtonFor(name)).toBeVisible();
        await expect(list.deleteButtonFor(name)).toBeVisible();
      }
      expect(await list.rowCoordinates(withRef)).toBe(
        asCell(a.waypoint.latitude, a.waypoint.longitude)
      );
      expect(await list.rowReference(withRef)).toBe('Portón verde, km 118');
      expect(await list.rowCoordinates(noRef)).toBe(
        asCell(b.waypoint.latitude, b.waypoint.longitude)
      );
      expect(await list.rowReference(noRef)).toBe('—');

      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1806-listado',
        comment:
          `ABM abierto por el menú Configuración › Waypoints en ${ENV}: breadcrumb «Configuration / Reference points», ` +
          `columnas Name/Reference/Actions, filas «${withRef}» (${asCell(a.waypoint.latitude, a.waypoint.longitude)}, ` +
          `referencia «Portón verde, km 118») y «${noRef}» (sin referencia) con Show Location/Edit/Delete; ` +
          `el pie dice Total: ${served.length} = largo del GET carriers/{id}/waypoint que pintó la pantalla y ` +
          `el mapa tiene ${served.length} pines.`
      });
    });

    test('TM-1812: debería dar de alta un punto con nombre, referencia de dos líneas y pin y reflejarlo en la API y en el listado', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1812', ROUTE)('TC7');
      const name = uiCreated!.track(nameFor('alta ui'));
      const reference = 'Línea uno\nLínea dos';
      const list = new ReferencePointsPage(page);
      const form = new ReferencePointFormModalPage(page);
      await list.goto();

      await list.newButton.click();
      await form.expectOpen();
      await form.fillName(name);
      await form.fillReference(reference);
      const pin = MIAMI.brickell;
      const ack = await form.placePin(pin.lat, pin.lng);
      expect(ack.body.routable).toBe(true);

      const created = page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/carriers\/\d+\/waypoint$/.test(r.url())
      );
      created.catch(() => undefined);
      const reloaded = list.listResponse();
      await list.expectToastAfter(/Reference point created/i, () => form.save());
      const response = await created;
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        waypoint: { id: number; placeId: string; latitude: number; longitude: number };
      };
      const id = body.waypoint.id;
      expect(parseWaypointPlaceId(body.waypoint.placeId)).toEqual({ id, version: 1 });
      const saved = { lat: body.waypoint.latitude, lng: body.waypoint.longitude };
      expect(distanceMeters(saved, pin)).toBeLessThan(PIN_TOLERANCE_M);
      const sent = calls.last('POST', /^carriers\/\d+\/waypoint$/)?.requestBody as
        | { latitude: number; longitude: number }
        | undefined;
      expect(sent?.latitude).toBe(saved.lat);
      expect(sent?.longitude).toBe(saved.lng);

      await expect(form.dialog).toBeHidden();
      await list.served(reloaded);
      await list.search(name);
      await expect(list.dataRows).toHaveCount(1);
      await expect(list.mapMarkers).toHaveCount(1);
      await expect(list.rowByName(name)).toBeVisible();
      expect(await list.rowCoordinates(name)).toBe(asCell(saved.lat, saved.lng));
      expect(await list.rowReference(name)).toBe(reference);

      const stored = (await waypointsApi.list()).find((w) => w.id === id);
      expect(stored?.name).toBe(name);
      expect(stored?.reference).toBe(reference);
      expect(stored?.placeId).toBe(`MGWP-${id}-1`);
      expect(calls.count('POST', /^carriers\/\d+\/waypoint$/)).toBe(1);

      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1812-alta',
        comment:
          `Alta por UI en ${ENV}: «${name}», referencia de dos líneas y pin en (${pin.lat}, ${pin.lng}); ` +
          `POST carriers/{id}/waypoint 200 con placeId ${body.waypoint.placeId} y coordenada ` +
          `${saved.lat}, ${saved.lng} (a ${Math.round(distanceMeters(saved, pin))} m del clic, igual a la enviada); ` +
          'toast «Reference point created»; la fila y el pin aparecen con el filtro del nombre y la API ' +
          'devuelve la referencia con el salto de línea (versión 1). MAGIIS_PLACE no se verifica (sin DB).'
      });
    });

    test('TM-1822: debería dar de baja un punto sin uso consultando el uso antes, sin borrar al cancelar y quitando fila y pin al aceptar', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1822', ROUTE)('TC17');
      const name = nameFor('baja');
      const { waypoint } = await waypointsApi.create({
        name,
        reference: 'Para dar de baja',
        ...toWaypointCoords(MIAMI.downtown)
      });
      const list = new ReferencePointsPage(page);
      await list.goto();
      await list.search(name);
      await expect(list.rowByName(name)).toBeVisible();
      await expect(list.mapMarkers).toHaveCount(1);

      // 1) abrir el diálogo: se consulta el uso y no hay aviso adicional
      const usage = page.waitForResponse(
        (r) => r.request().method() === 'GET' && r.url().endsWith(`/waypoint/${waypoint.id}/usage`)
      );
      await list.deleteButtonFor(name).click();
      expect((await usage).status()).toBe(200);
      await expect(list.deleteDialog).toBeVisible();
      await expect(list.usageNotice).toHaveText(DELETE_PROMPT(name));
      expect(calls.count('DELETE')).toBe(0);

      // 2) cancelar: 0 DELETE y el punto sigue
      await list.deleteCancelButton.click();
      await expect(list.deleteDialog).toBeHidden();
      expect(calls.count('DELETE')).toBe(0);
      await expect(list.rowByName(name)).toBeVisible();
      expect((await waypointsApi.list()).some((w) => w.id === waypoint.id)).toBe(true);

      // 3) eliminar y aceptar
      await list.deleteButtonFor(name).click();
      await expect(list.deleteDialog).toBeVisible();
      const removal = page.waitForResponse(
        (r) => r.request().method() === 'DELETE' && r.url().endsWith(`/waypoint/${waypoint.id}`)
      );
      await list.expectToastAfter(/Reference point deleted/i, () =>
        list.deleteAcceptButton.click()
      );
      expect((await removal).status()).toBe(200);
      expect((await waypointsApi.list()).some((w) => w.id === waypoint.id)).toBe(false);

      // Vista propia tras la baja: pantalla recargada, mismo filtro → ni fila ni pin (control: antes 1 y 1).
      const servedAfter = await list.reloadServed();
      expect(servedAfter.some((w) => w.id === waypoint.id)).toBe(false);
      await list.search(name);
      await expect(list.dataRows).toHaveCount(0);
      await expect(list.mapMarkers).toHaveCount(0);

      const firstUsage = calls.indexOf('GET', /\/usage$/);
      expect(firstUsage).toBeGreaterThanOrEqual(0);
      expect(firstUsage).toBeLessThan(calls.indexOf('DELETE'));
      expect(calls.count('DELETE')).toBe(1);

      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1822-baja',
        comment:
          `Baja por UI en ${ENV} del punto «${name}» (id ${waypoint.id}): GET …/${waypoint.id}/usage 200 antes de ` +
          'cualquier DELETE; diálogo «Delete reference point» sin aviso de uso; Cancelar no llamó a DELETE y el ' +
          'punto siguió en la lista y en la API; al aceptar, DELETE 200, toast «Reference point deleted»; ' +
          'tras recargar con el mismo filtro no hay fila ni pin y la API ya no lo devuelve. ' +
          'DELETED=1 y MAGIIS_PLACE se acreditan por API (sin DB).'
      });
    });
  });

  test.describe('@P2 @functional @migration', () => {
    test('TM-1808: debería filtrar juntos la lista y el mapa al buscar sin distinguir tildes ni mayúsculas, tratar % y _ como texto y restaurar la lista con el buscador vacío', async ({
      page,
      waypointsApi,
      nameFor,
      runId
    }, testInfo) => {
      makeAnnotate('TM-1808', ROUTE)('TC3');
      const anelo = nameFor('Añelo');
      const avila = nameFor('Ávila');
      const a = await waypointsApi.create({ name: anelo, ...toWaypointCoords(MIAMI.downtown) });
      const v = await waypointsApi.create({ name: avila, ...toWaypointCoords(MIAMI.brickell) });
      const list = new ReferencePointsPage(page);
      const served = await list.gotoServed();
      expect(served.map((w) => w.id)).toEqual(
        expect.arrayContaining([a.waypoint.id, v.waypoint.id])
      );
      const expectedRows = Math.min(served.length, PAGE_SIZE);

      const expectUnfiltered = async (): Promise<void> => {
        await expect(list.mapMarkers).toHaveCount(served.length);
        await expect(list.dataRows).toHaveCount(expectedRows);
        await expect(list.totalLabel).toContainText(list.totalPattern(served.length));
      };
      await expectUnfiltered();

      for (const term of ['añelo', 'anelo']) {
        await list.search(`${runId} ${term}`);
        await expect(list.dataRows).toHaveCount(1);
        await expect(list.mapMarkers).toHaveCount(1);
        await expect(list.rowByName(anelo)).toBeVisible();
      }
      await list.search(`${runId} ÁVILA`);
      await expect(list.dataRows).toHaveCount(1);
      await expect(list.mapMarkers).toHaveCount(1);
      await expect(list.rowByName(avila)).toBeVisible();

      // «%» y «_» son texto: si se interpretaran como comodines encontrarían los dos puntos propios.
      for (const wildcard of ['%', '_']) {
        await list.search(`${runId} ${wildcard}`);
        await expect(list.dataRows).toHaveCount(0);
        await expect(list.mapMarkers).toHaveCount(0);
        await expect(list.totalLabel).toContainText(list.totalPattern(0));
      }

      await list.search('');
      await expectUnfiltered();

      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1808-busqueda',
        comment:
          `Búsqueda en el ABM (${ENV}) sobre «${anelo}» y «${avila}»: «añelo» y «anelo» dejan 1 fila y 1 pin ` +
          '(la de Añelo) y «ÁVILA» 1 fila y 1 pin (la de Ávila); «%» y «_» no devuelven filas ni pines ' +
          `(Total: 0, no son comodines); con el buscador vacío vuelven ${served.length} pines, ${expectedRows} filas ` +
          `(página de ${PAGE_SIZE}) y «Total: ${served.length}», el largo del GET que pintó la pantalla.`
      });
    });

    test('TM-1813: debería bloquear el guardado sin pin sin llamar al alta y permitirlo con pin sumando un punto', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1813', ROUTE)('TC8');
      const name = uiCreated!.track(nameFor('sin pin'));
      const list = new ReferencePointsPage(page);
      const form = new ReferencePointFormModalPage(page);
      await list.goto();

      await list.newButton.click();
      await form.expectOpen();
      await form.fillName(name);
      await form.save();
      await expect(form.pinRequiredMessage).toBeVisible();
      await expect(form.dialog).toBeVisible();
      expect(calls.count('POST')).toBe(0);
      // sin pin no se creó nada con el nombre propio (control positivo: tras guardar con pin sí existe)
      expect((await waypointsApi.list()).some((w) => w.name === name)).toBe(false);
      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1813-sin-pin',
        comment:
          `Guardado sin pin en ${ENV}: el modal sigue abierto con «Mark the point on the map», 0 POST a ` +
          `carriers/{id}/waypoint y el punto no figura en la API.`
      });

      await form.placePin(MIAMI.downtown.lat, MIAMI.downtown.lng);
      const created = page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/carriers\/\d+\/waypoint$/.test(r.url())
      );
      await list.expectToastAfter(/Reference point created/i, () => form.save());
      expect((await created).status()).toBe(200);
      await expect(form.dialog).toBeHidden();
      expect(calls.count('POST')).toBe(1);
      const afterSaved = await waypointsApi.list();
      expect(afterSaved.filter((w) => w.name === name)).toHaveLength(1);
    });

    test('TM-1824: debería avisar que el punto ya no existe al guardar su edición desde otra pestaña tras eliminarlo, cerrar el modal y recargar la lista', async ({
      page,
      context,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1824', ROUTE)('TC20');
      const name = nameFor('concurr');
      const { waypoint } = await waypointsApi.create({
        name,
        reference: 'Concurrencia',
        ...toWaypointCoords(MIAMI.downtown)
      });
      const pageB = await context.newPage();
      try {
        const listA = new ReferencePointsPage(page);
        const listB = new ReferencePointsPage(pageB);
        const formB = new ReferencePointFormModalPage(pageB);
        await listA.goto();
        await listA.search(name);
        await listB.goto();
        await listB.search(name);
        await expect(listB.rowByName(name)).toBeVisible();

        // B abre la edición y la deja abierta
        await listB.editButtonFor(name).click();
        await formB.expectOpen();
        await expect(formB.nameInput).toHaveValue(name);

        // A elimina el punto
        await expect(listA.rowByName(name)).toBeVisible();
        await listA.deleteButtonFor(name).click();
        await expect(listA.deleteDialog).toBeVisible();
        await listA.expectToastAfter(/Reference point deleted/i, () =>
          listA.deleteAcceptButton.click()
        );
        expect((await waypointsApi.list()).some((w) => w.id === waypoint.id)).toBe(false);

        // B guarda un cambio de nombre sobre el punto ya inexistente
        await formB.fillName(`${name} B`);
        const put = pageB.waitForResponse(
          (r) => r.request().method() === 'PUT' && r.url().endsWith(`/waypoint/${waypoint.id}`)
        );
        await formB.save();
        expect((await put).status()).toBe(404);
        await expect(listB.toast(/no longer exists/i)).toBeVisible();
        await expect(formB.dialog).toBeHidden();
        await listB.search(name);
        await expect(listB.rowByName(name)).toHaveCount(0);
        await expect(listB.rowByName(`${name} B`)).toHaveCount(0);
        expect((await waypointsApi.list()).some((w) => w.name === `${name} B`)).toBe(false);
        testInfo.annotations.push({
          type: 'observation',
          description:
            'TM-1824: el paso 5 de la definición (B pulsa «Eliminar» sobre una fila ya borrada por A) no está automatizado'
        });

        await attachXrayEvidence(testInfo, pageB, {
          name: 'tm-1824-concurrencia',
          comment:
            `Dos pestañas del mismo usuario en ${ENV}: B abrió «Edit reference point» de «${name}» (id ${waypoint.id}), ` +
            `A lo eliminó (DELETE 200) y al guardar B el PUT devolvió 404; B mostró el aviso «no longer exists», cerró ` +
            'el modal y la lista recargada ya no tiene el punto ni el nombre cambiado. Cobertura parcial: falta el ' +
            'paso 5 (eliminar una fila ya borrada).'
        });
      } finally {
        await pageB.close();
      }
    });
  });

  test.describe('@P3 @functional @migration', () => {
    test('TM-1833: debería conservar el filtro del buscador, la lista y el mapa tras editar la referencia con el filtro activo', async ({
      page,
      waypointsApi,
      nameFor
    }, testInfo) => {
      makeAnnotate('TM-1833', ROUTE)('TC29');
      const target = nameFor('filtro');
      const other = nameFor('otro');
      const { waypoint } = await waypointsApi.create({
        name: target,
        reference: 'Ref original',
        ...toWaypointCoords(MIAMI.downtown)
      });
      await waypointsApi.create({ name: other, ...toWaypointCoords(MIAMI.brickell) });
      const list = new ReferencePointsPage(page);
      const form = new ReferencePointFormModalPage(page);
      await list.goto();
      await list.search(target);
      await expect(list.rowByName(target)).toBeVisible();
      await expect(list.dataRows).toHaveCount(1);
      await expect(list.mapMarkers).toHaveCount(1);

      await list.editButtonFor(target).click();
      await form.expectOpen();
      await form.fillReference('Ref editada');
      const put = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().endsWith(`/waypoint/${waypoint.id}`)
      );
      const reloaded = list.listResponse();
      await list.expectToastAfter(/Reference point updated/i, () => form.save());
      expect((await put).status()).toBe(200);
      const served = await list.served(reloaded);
      await expect(form.dialog).toBeHidden();
      // Estabiliza la lectura: estado filtrado (1 pin, 1 fila) o completo (todos los que sirvió el GET, 1 página).
      await expect
        .poll(
          async () => {
            const markers = await list.mapMarkers.count();
            const rows = await list.dataRows.count();
            return (
              (markers === 1 && rows === 1) ||
              (markers === served.length && rows === Math.min(served.length, PAGE_SIZE))
            );
          },
          { timeout: 15_000 }
        )
        .toBe(true);

      const measured = {
        searchText: await list.searchInput.inputValue(),
        rows: await list.dataRows.count(),
        markers: await list.mapMarkers.count(),
        served: served.length,
        url: new URL(page.url()).hash
      };
      const filterKept =
        measured.searchText === target && measured.rows === 1 && measured.markers === 1;
      const f20Signature =
        measured.searchText === '' &&
        measured.markers === served.length &&
        measured.rows === Math.min(served.length, PAGE_SIZE);
      if (filterKept) {
        await expect(list.rowByName(target)).toBeVisible();
        expect(await list.rowReference(target)).toBe('Ref editada');
      } else if (f20Signature) {
        recordKnownIssue(
          testInfo,
          'F-20',
          `tras editar con filtro activo el buscador quedó vacío, ${measured.rows} filas y ${measured.markers} pines ` +
            `(el GET sirvió ${served.length}; ${measured.url}); la AC pide conservar texto, lista y mapa filtrados`
        );
      } else {
        throw new Error(`desvío que no es F-20: ${JSON.stringify(measured)}`);
      }
      expect((await waypointsApi.list()).find((w) => w.id === waypoint.id)?.reference).toBe(
        'Ref editada'
      );
      await attachXrayEvidence(testInfo, page, {
        name: 'tm-1833-filtro-tras-editar',
        comment:
          `Editar la referencia de «${target}» con el filtro activo en ${ENV}: PUT 200 y toast «Reference point updated»; ` +
          `después el buscador quedó «${measured.searchText}», ${measured.rows} fila(s) y ${measured.markers} pin(es) ` +
          `(el GET de recarga sirvió ${served.length}). ` +
          (filterKept
            ? 'El filtro se conservó (AC cumplida).'
            : 'Defecto conocido F-20: el listado se recarga completo y se pierde el filtro.')
      });
    });
  });
});
