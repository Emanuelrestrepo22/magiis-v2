// tests/specs/trips/new-trip-reference-points-search.spec.ts
// MG-1132 · ATP TM-1841 · PK-2 «Buscador en Nuevo Viaje» (parte 1) — TM-1727, TM-1733, TM-1748
// (1 test() = 1 Test de Xray). Hibrido: el alta/baja de los puntos va por API (`waypointsApi`, datos
// propios «QA AUTO <runId> …», limpieza por id propio en el fixture) y el buscador se maneja por la UI
// real de Nuevo Viaje (carrier 1521, atajo «Marcela Usa»). NO crea viajes y NO guarda nada en
// Clientes / Sucursales / Mi Compania / Areas. Ambiente TEST (D2); textos de UI en EN (en-US).
// Regla medida (v2.0.22): con `carrierId` (Nuevo Viaje) minimo 2 caracteres y los puntos del carrier
// primero con badge «Reference point»; sin `carrierId` (resto de pantallas) minimo 3 caracteres y
// nunca puntos. Elegir un punto no llama a `places/getPlace` ni a Google: las coordenadas vienen en la lista.
// Gate WAYPOINTS_CREATE_DATA=1. Corrida local (sesion guardada, sin login con contrasena):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/trips/new-trip-reference-points-search.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import type { Page } from '@playwright/test';
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { MIAMI, toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { parseWaypointPlaceId } from '../../helpers/waypoints-contract.js';
import { attachXrayEvidence } from '../../helpers/xray-evidence.js';
import { NewTripPage, type PlaceField } from '../../pages/carrier-v2/trips/NewTripPage.js';
import {
  ADDRESS_SCREEN_LABEL,
  ADDRESS_SCREENS,
  closeAddressScreen,
  openAddressSearch
} from '../../steps/places/addressSearchScreens.steps.js';
import { installMapHook } from '../../utils/leafletMap.js';
import { watchPlacesTraffic } from '../../utils/networkWatch.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const ROUTE = '/carrier/#/travel/create';
const GOOGLE_TEXT = '1200 Brickell Ave';
/** Vista del mapa de Areas para que el poligono contenga «1200 Brickell Ave». */
const BRICKELL_VIEW = { lat: 25.7599, lng: -80.1903, zoom: 15 };

test.skip(
  process.env.WAYPOINTS_CREATE_DATA !== '1',
  'crea y borra puntos de referencia reales; correr con WAYPOINTS_CREATE_DATA=1'
);
test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
// SIN retries: cada intento crea datos reales y un reintento taparia la falla del primero.
test.describe.configure({ timeout: 240_000, retries: 0 });

// Barrido de corridas anteriores: solo puntos «QA AUTO <runId>» con mas de 24 h.
test.beforeAll(async ({ carrierApi, carrierSession }) => {
  await new WaypointsClient(carrierApi, carrierSession, makeRunId()).sweep();
});

const carrierIdOf = (): number => (DATA as NonNullable<typeof DATA>).primary.carrierId;
const shortcutOf = (): string => (DATA as NonNullable<typeof DATA>).primary.shortcut;

/** Nuevo Viaje con el atajo del perfil primario (habilita Origen / Destino). */
async function openNewTrip(page: Page): Promise<NewTripPage> {
  // Un goto a la misma ruta con hash no recarga la SPA: se parte de una pagina en blanco para un formulario limpio.
  const reopened = page.url().includes('travel/create');
  if (reopened) await page.goto('about:blank');
  const trip = new NewTripPage(page);
  await trip.goto();
  // Al reabrir, la app ofrece retomar el borrador del viaje anterior: se descarta (formulario limpio).
  if (reopened) await page.getByRole('button', { name: 'Start Over' }).click();
  await trip.pickPassengerShortcut(shortcutOf());
  return trip;
}

const spot = (index: number): { latitude: number; longitude: number } =>
  toWaypointCoords({ lat: MIAMI.downtown.lat + index * 0.0006, lng: MIAMI.downtown.lng });

type GetPlaceSeen = {
  placeId: string | null;
  status: number;
  lat: number | null;
  lng: number | null;
};

/** Registra las respuestas de `places/getPlace?placeId=` (estado y coordenadas del cuerpo) para aserciones posteriores. */
function collectGetPlace(page: Page): { seen: GetPlaceSeen[] } {
  const seen: GetPlaceSeen[] = [];
  page.on('response', (response) => {
    if (!/\/places\/getPlace\?placeId=/.test(response.url())) return;
    const placeId = new URL(response.url()).searchParams.get('placeId');
    void response
      .json()
      .then((body: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>) => {
        const location = body?.[0]?.geometry?.location;
        seen.push({
          placeId,
          status: response.status(),
          lat: location?.lat ?? null,
          lng: location?.lng ?? null
        });
      })
      .catch(() => {
        seen.push({ placeId, status: response.status(), lat: null, lng: null });
      });
  });
  return { seen };
}

type OwnPoint = { placeId: string; coords: { latitude: number; longitude: number } };

/** Tras cotizar: solo getPlace del propio placeId MGWP, 200 y con las coordenadas del punto; 0 ajenos y 0 Google. */
async function expectQuoteGetPlace(
  watch: { sinceUrls(mark: number): string[] },
  quoteMark: number,
  collector: { seen: GetPlaceSeen[] },
  collectorMark: number,
  points: OwnPoint[],
  where: string
): Promise<void> {
  // El colector es VIVO: se relee en cada reintento (no una copia tomada al llamar).
  const seenNow = (): GetPlaceSeen[] => collector.seen.slice(collectorMark);
  // Las respuestas llegan despues de capturar el request de simulateAll: se espera una por cada punto propio.
  await expect
    .poll(
      () =>
        points
          .filter((pt) => !seenNow().some((g) => g.placeId === pt.placeId))
          .map((pt) => pt.placeId)
          .join(',') || 'todos resueltos',
      {
        message: `${where}: al cotizar debe resolverse cada placeId MGWP propio por getPlace`,
        timeout: 20_000
      }
    )
    .toBe('todos resueltos');
  const ownIds = points.map((pt) => pt.placeId);
  const foreign = watch
    .sinceUrls(quoteMark)
    .filter((u) => !ownIds.some((id) => u.includes(`/places/getPlace?placeId=${id}`)));
  expect(foreign, `${where}: 0 getPlace ajenos y 0 llamadas a Google al cotizar`).toEqual([]);
  for (const g of seenNow()) {
    const point = points.find((pt) => pt.placeId === g.placeId);
    expect(point, `${where}: getPlace de un placeId ajeno ${String(g.placeId)}`).toBeDefined();
    expect(String(g.placeId), `${where}: placeId MGWP`).toMatch(/^MGWP-/);
    expect(g.status, `${where}: getPlace ${String(g.placeId)} responde 200`).toBe(200);
    expect(g.lat, `${where}: latitud de getPlace = la del punto`).toBeCloseTo(
      point?.coords.latitude ?? Number.NaN,
      9
    );
    expect(g.lng, `${where}: longitud de getPlace = la del punto`).toBeCloseTo(
      point?.coords.longitude ?? Number.NaN,
      9
    );
  }
}

const near = (value: unknown, expected: number): boolean =>
  Math.abs(Number(value) - expected) < 1e-9;

test.describe('@P1 @functional @migration MG-1132 buscador de puntos de referencia en Nuevo Viaje', () => {
  test('TM-1727: debería listar primero y con badge el punto propio al escribir el mínimo y más caracteres en Origen, Destino y parada', async ({
    page,
    waypointsApi,
    runId,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1727', ROUTE)('TC1', 'HP');
    const tail = runId.slice(-4);
    const label = `Zx${tail}`;
    const name = nameFor(label);
    const reference = `Referencia QA TM-1727 ${tail}`;
    const created = await waypointsApi.create({ name, reference, ...spot(0) });
    const placeId = created.waypoint.placeId;
    expect(parseWaypointPlaceId(placeId), 'placeId con formato MGWP-{id}-{version}').not.toBeNull();
    const trip = await openNewTrip(page);

    const measured: string[] = [];
    // 2 caracteres = minimo con carrierId (puede compartirse con puntos ajenos: se filtra por placeId);
    // etiqueta completa = unica del run, el punto debe ir primero de la lista.
    const texts = [
      { text: 'Zx', unique: false },
      { text: label, unique: true }
    ];
    const checkRow = async (field: PlaceField, rowName: string): Promise<void> => {
      for (const { text, unique } of texts) {
        const { options, autocomplete, requestUrl } = await trip.typeInPlaceField(field, text);
        const params = new URL(requestUrl).searchParams;
        expect(params.get('address'), `${rowName}/${text}: address del request`).toBe(text);
        expect(params.get('carrierId'), `${rowName}/${text}: carrierId del request`).toBe(
          String(carrierIdOf())
        );
        const ownIdx = autocomplete.findIndex((i) => i.placeId === placeId);
        expect(
          ownIdx,
          `${rowName}/${text}: la respuesta debe traer el punto propio ${placeId}`
        ).toBeGreaterThanOrEqual(0);
        const own = autocomplete[ownIdx];
        expect(own.source, `${rowName}/${text}: source del punto propio`).toBe('CARRIER');
        expect(own.airport, `${rowName}/${text}: airport del punto propio`).toBe(false);
        expect(own.reference, `${rowName}/${text}: referencia en la respuesta`).toBe(reference);
        const firstOther = autocomplete.findIndex((i) => i.source !== 'CARRIER');
        const carrierBlock = firstOther === -1 ? autocomplete.length : firstOther;
        expect(
          ownIdx,
          `${rowName}/${text}: el punto propio va dentro del bloque CARRIER inicial`
        ).toBeLessThan(carrierBlock);
        if (unique) expect(ownIdx, `${rowName}/${text}: unico del run => primero`).toBe(0);
        // Con 2 caracteres solo hay puntos del carrier (sin direcciones de Google: ese es el costo que se evita).
        if (text.length === 2) {
          expect(
            autocomplete.filter((i) => i.source !== 'CARRIER').map((i) => i.placeId),
            `${rowName}/${text}: con 2 caracteres solo puntos del carrier`
          ).toEqual([]);
        }
        // UI: mismo orden que la respuesta; badge solo en los puntos del carrier (control positivo y negativo).
        expect(options, `${rowName}/${text}: cantidad de opciones`).toHaveLength(
          autocomplete.length
        );
        expect(options[ownIdx].text, `${rowName}/${text}: etiqueta de la opcion propia`).toBe(name);
        expect(options[ownIdx].hasBadge, `${rowName}/${text}: badge del punto propio`).toBe(true);
        expect(
          options.map((o) => o.hasBadge),
          `${rowName}/${text}: badge exactamente en los items CARRIER`
        ).toEqual(autocomplete.map((i) => i.source === 'CARRIER'));
        measured.push(
          `${rowName} «${text}»: indice ${ownIdx} de ${autocomplete.length}, badge, carrierId=${carrierIdOf()}`
        );
      }
      await page.keyboard.press('Escape');
    };

    await checkRow('origin', 'Origen');
    await checkRow('destination', 'Destino');
    // La parada solo existe con el destino cargado: se carga con el propio punto (sin Google).
    await trip.pickReferencePoint('destination', label.slice(0, -1), placeId);
    await trip.addStop();
    await checkRow({ stop: 1 }, 'Parada 1');

    testInfo.annotations.push({
      type: 'observation',
      description:
        'la mitad DB de TC1 (fila CARRIER, lat/lng sin redondeo) la cubre PK-1 a nivel API (TM-1835); este test no consulta la base'
    });
    await trip.typeInPlaceField({ stop: 1 }, 'Zx');
    await attachXrayEvidence(testInfo, page, {
      name: 'tm-1727-parada-lista',
      comment:
        `Nuevo Viaje (carrier ${carrierIdOf()}, ${ENV}): punto propio «${name}» (${placeId}) con referencia. ` +
        `En Origen, Destino y Parada 1 se escribió «Zx» (2 caracteres) y «${label}»: ${measured.join(' | ')}. ` +
        'El request lleva address y carrierId y la respuesta source=CARRIER, airport=false y el placeId propio; con 2 caracteres no hay direcciones de Google.'
    });
  });

  test('TM-1733: debería cargar el punto en Origen, Destino y parada sin llamadas a getPlace ni a Google y con sus coordenadas en la cotización', async ({
    page,
    waypointsApi,
    nameFor,
    runId
  }, testInfo) => {
    // Acredita TM-1733 y, con su parte A (cotizar sin destino, sin Google; TC9), TM-1735 (plan §6, credito multiple).
    makeAnnotate(['TM-1733', 'TM-1735'], ROUTE)('TC7', 'HP');
    const tail = runId.slice(-4);
    const points = [
      { label: `Xa${tail}`, coords: spot(1) },
      { label: `Xb${tail}`, coords: spot(2) },
      { label: `Xc${tail}`, coords: spot(3) }
    ];
    const created = [] as Array<{
      name: string;
      placeId: string;
      label: string;
      coords: (typeof points)[number]['coords'];
    }>;
    for (const p of points) {
      const name = nameFor(p.label);
      const result = await waypointsApi.create({
        name,
        reference: `Referencia QA TM-1733 ${p.label}`,
        ...p.coords
      });
      created.push({ name, placeId: result.waypoint.placeId, label: p.label, coords: p.coords });
    }
    const [pa, pb, pc] = created;

    // Parte A: «cotizar sin destino» (Destino Abierto) con el punto en Origen.
    let trip = await openNewTrip(page);
    let watch = watchPlacesTraffic(page);
    let mark = watch.mark();
    const getPlaceA = collectGetPlace(page);
    const originA = await trip.pickReferencePoint('origin', pa.label, pa.placeId);
    expect(originA.outboundCalls, 'Origen: sin getPlace ni Google al elegir el punto').toEqual([]);
    expect(await trip.placeValue('origin')).toBe(pa.name);
    await trip.toggleOpenDestination();
    // Ventana de la seleccion: hasta justo antes de cotizar no hay NINGUN getPlace ni llamada a Google.
    expect(watch.since(mark), 'parte A: sin getPlace ni Google hasta antes de cotizar').toEqual([]);
    const quoteMarkA = watch.mark();
    const gpMarkA = getPlaceA.seen.length;
    const openBody = await trip.selectVehicleAndCaptureSimulateAllBody();
    const openOrigin = openBody.origin as Record<string, unknown>;
    expect(openOrigin.placeId, 'simulateAll (sin destino): placeId de origen').toBe(pa.placeId);
    expect(
      String(openOrigin.latitude),
      'simulateAll (sin destino): latitud = item de la lista'
    ).toBe(originA.item.latitude);
    expect(
      String(openOrigin.longitude),
      'simulateAll (sin destino): longitud = item de la lista'
    ).toBe(originA.item.longitude);
    // Desde cotizar: solo el getPlace del propio placeId MGWP (backend, no Google), 200 y con las coordenadas del punto (TC9).
    await expectQuoteGetPlace(watch, quoteMarkA, getPlaceA, gpMarkA, [pa], 'parte A');
    watch.dispose();

    // Parte B: tres puntos DISTINTOS en Origen, Destino y parada, y cotizacion con las tres filas.
    trip = await openNewTrip(page);
    watch = watchPlacesTraffic(page);
    mark = watch.mark();
    const getPlaceB = collectGetPlace(page);
    const outbound: Record<string, string[]> = {};
    const oPick = await trip.pickReferencePoint('origin', pa.label, pa.placeId);
    outbound.Origen = oPick.outboundCalls;
    const dPick = await trip.pickReferencePoint('destination', pb.label, pb.placeId);
    outbound.Destino = dPick.outboundCalls;
    await trip.addStop();
    const sPick = await trip.pickReferencePoint({ stop: 1 }, pc.label, pc.placeId);
    outbound['Parada 1'] = sPick.outboundCalls;
    for (const [row, calls] of Object.entries(outbound)) {
      expect(calls, `${row}: sin getPlace ni Google al elegir el punto`).toEqual([]);
    }
    expect(await trip.placeValue('origin')).toBe(pa.name);
    expect(await trip.placeValue('destination')).toBe(pb.name);
    expect(await trip.placeValue({ stop: 1 })).toBe(pc.name);
    await expect(
      trip.fieldErrors,
      'sin errores de validacion tras elegir los tres puntos'
    ).toHaveCount(0);

    // Ventana de la seleccion: hasta justo antes de cotizar no hay NINGUN getPlace ni llamada a Google.
    expect(watch.since(mark), 'parte B: sin getPlace ni Google hasta antes de cotizar').toEqual([]);
    const quoteMarkB = watch.mark();
    const gpMarkB = getPlaceB.seen.length;
    const body = await trip.selectVehicleAndCaptureSimulateAllBody();
    const origin = body.origin as Record<string, unknown>;
    const destination = body.destination as Record<string, unknown>;
    expect(origin.placeId, 'simulateAll: placeId de origen').toBe(pa.placeId);
    expect(String(origin.latitude), 'simulateAll: latitud de origen = item').toBe(
      oPick.item.latitude
    );
    expect(String(origin.longitude), 'simulateAll: longitud de origen = item').toBe(
      oPick.item.longitude
    );
    expect(near(origin.latitude, pa.coords.latitude), 'origen = alta').toBe(true);
    expect(destination.placeId, 'simulateAll: placeId de destino').toBe(pb.placeId);
    expect(String(destination.latitude), 'simulateAll: latitud de destino = item').toBe(
      dPick.item.latitude
    );
    expect(String(destination.longitude), 'simulateAll: longitud de destino = item').toBe(
      dPick.item.longitude
    );
    expect(near(destination.longitude, pb.coords.longitude), 'destino = alta').toBe(true);
    const stops = body.waypoints as Array<Record<string, unknown>> | null;
    const stop = Array.isArray(stops) ? stops.find((w) => w.placeId === pc.placeId) : undefined;
    expect(
      stop,
      'simulateAll: la parada viaja en waypoints con el placeId del punto'
    ).toBeDefined();
    expect(String(stop?.latitude), 'simulateAll: latitud de la parada = item').toBe(
      sPick.item.latitude
    );
    expect(String(stop?.longitude), 'simulateAll: longitud de la parada = item').toBe(
      sPick.item.longitude
    );
    // Ruta completa (coordenadas conocidas): al cotizar NO hay ningun getPlace ni llamada a Google (medido).
    await expectQuoteGetPlace(watch, quoteMarkB, getPlaceB, gpMarkB, [], 'parte B');

    // Control positivo (X7): elegir una direccion de Google SI emite getPlace; prueba que el observador funciona.
    const control = await trip.pickGoogleAddress({ stop: 1 }, GOOGLE_TEXT);
    expect(
      control.outboundCalls.some((c) => /\/places\/getPlace/.test(c)),
      'control: elegir una direccion de Google debe emitir places/getPlace'
    ).toBe(true);
    watch.dispose();

    testInfo.annotations.push({
      type: 'observation',
      description:
        'el marcador del mapa en la posicion del punto y la ausencia de error de validacion visual del origen no se automatizan (queda en la captura)'
    });
    await attachXrayEvidence(testInfo, page, {
      name: 'tm-1733-filas-cargadas',
      comment:
        `Nuevo Viaje (carrier ${carrierIdOf()}, ${ENV}): tres puntos propios distintos en Origen («${pa.name}»), Destino («${pb.name}») y Parada 1 («${pc.name}»). ` +
        'Al elegirlos (selección) no se emitió ningún places/getPlace ni llamada de Google desde el navegador; cada campo quedó con su nombre. ' +
        'Con la ruta completa, al cotizar (simulateAll) tampoco hubo getPlace ni llamadas a Google; simulateAll llevó cada placeId con la lat/lng exactas del ítem de la lista. ' +
        'En la cotización sin destino (Destino Abierto, TC9) el front emitió, solo al cotizar, places/getPlace?placeId=MGWP-… del punto propio (resolución por el backend de la app, no Google), con status 200 y la lat/lng del punto; 0 getPlace ajenos y 0 llamadas a Google. Control: elegir «' +
        `${GOOGLE_TEXT}» en la parada sí emitió ${control.outboundCalls.length} llamada(s) vigiladas.`
    });
  });
});

test.describe('@P2 @functional @migration MG-1132 buscador de direcciones sin puntos de referencia en otras pantallas', () => {
  test('TM-1748: debería buscar y elegir direcciones sin carrierId, sin puntos y con sus avisos en Clientes, Sucursales, Mi Compañía y Áreas', async ({
    page,
    waypointsApi,
    placesApi,
    nameFor
  }, testInfo) => {
    makeAnnotate('TM-1748')('TC23', 'EP');
    await installMapHook(page);
    // El punto propio se llama como el texto buscado: si la pantalla enviara carrierId, apareceria.
    const text = GOOGLE_TEXT;
    const created = await waypointsApi.create({ name: nameFor(text), ...spot(4) });
    const ownPlaceId = created.waypoint.placeId;

    // Control positivo (X7): con carrierId el mismo texto SI devuelve el punto propio.
    const withCarrier = await placesApi.autocomplete({ address: text, carrierId: carrierIdOf() });
    expect(
      withCarrier.some((i) => i.placeId === ownPlaceId && i.source === 'CARRIER'),
      'control: con carrierId el texto debe devolver el punto propio'
    ).toBe(true);

    const autocompleteRequests: string[] = [];
    const placeStatuses: Array<{ url: string; status: number }> = [];
    page.on('request', (request) => {
      if (request.method() === 'GET' && /\/places\/autocomplete\?/.test(request.url())) {
        autocompleteRequests.push(request.url());
      }
    });
    page.on('response', (response) => {
      if (/\/places\//.test(response.url())) {
        placeStatuses.push({ url: response.url().split('?')[0], status: response.status() });
      }
    });
    const measured: string[] = [];

    for (const screen of ADDRESS_SCREENS) {
      const label = ADDRESS_SCREEN_LABEL[screen];
      autocompleteRequests.length = 0;
      placeStatuses.length = 0;
      const field = await openAddressSearch(page, screen, BRICKELL_VIEW);
      await field.click();

      // 1) menos de 3 caracteres: aviso de minimo (el conteo de requests se cierra al final de la pantalla).
      await field.fill('ca');
      await expect(
        page.locator('.ng-dropdown-panel .ng-option-disabled', {
          hasText: /Type at least 3 characters to search/i
        }),
        `${label}: aviso de minimo de caracteres`
      ).toBeVisible();

      // 2) texto largo: autocomplete 200 SIN carrierId, 0 items CARRIER y sin badge.
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) =>
            /\/places\/autocomplete\?/.test(res.url()) &&
            new URL(res.url()).searchParams.get('address') === text
        ),
        field.fill(text)
      ]);
      expect(response.status(), `${label}: autocomplete 200`).toBe(200);
      expect(
        new URL(response.url()).searchParams.has('carrierId'),
        `${label}: request sin carrierId`
      ).toBe(false);
      const items = (await response.json()) as Array<{ placeId: string; source: string }>;
      expect(items.length, `${label}: el texto largo devuelve direcciones`).toBeGreaterThan(0);
      expect(
        items.filter((i) => i.source === 'CARRIER' || i.placeId === ownPlaceId),
        `${label}: 0 items CARRIER`
      ).toEqual([]);
      const firstOption = page
        .locator('.ng-dropdown-panel .ng-option:not(.ng-option-disabled)')
        .first();
      await expect(firstOption).toBeVisible();
      await expect(page.locator('.place-option__badge'), `${label}: sin badge`).toHaveCount(0);

      // 3) elegir la primera direccion: getPlace 200 y el campo queda cargado.
      const [resolved] = await Promise.all([
        page.waitForResponse((res) => /\/places\/getPlace\?/.test(res.url()), { timeout: 30_000 }),
        firstOption.click()
      ]);
      expect(resolved.status(), `${label}: getPlace 200 al elegir la direccion`).toBe(200);
      const chip = field
        .locator('xpath=ancestor::app-input-search-place')
        .locator('.ng-value-label');
      await expect(chip, `${label}: el campo queda con la direccion elegida`).toContainText(
        /1200 Brickell Ave/i,
        { timeout: 15_000 }
      );
      if (screen === 'areas') {
        await expect(
          page.getByText(/inside the area|dentro del área/i),
          `${label}: el punto elegido cae dentro del poligono (sin aviso de area)`
        ).toHaveCount(0);
      }

      // 4) texto sin resultados.
      await field.click();
      await Promise.all([
        page.waitForResponse(
          (res) =>
            /\/places\/autocomplete\?/.test(res.url()) &&
            new URL(res.url()).searchParams.get('address') === 'zzqxjw93kk'
        ),
        field.fill('zzqxjw93kk')
      ]);
      await expect(
        page.locator('.ng-dropdown-panel .ng-option-disabled', { hasText: /No Results Found/i }),
        `${label}: aviso sin resultados`
      ).toBeVisible();

      // 5) cierre de la pantalla (ya paso el debounce): 0 requests con menos de 3 caracteres y ningun 4xx/5xx de places/*.
      expect(
        autocompleteRequests.filter(
          (u) => (new URL(u).searchParams.get('address') ?? '').length < 3
        ),
        `${label}: 0 requests de autocomplete con menos de 3 caracteres`
      ).toEqual([]);
      expect(
        placeStatuses.filter((s) => s.status >= 400),
        `${label}: ningun 4xx/5xx de places/*`
      ).toEqual([]);

      measured.push(
        `${label}: «ca» -> aviso y 0 requests; «${text}» -> ${items.length} items sin carrierId ni badge; primera direccion -> getPlace 200 y campo cargado; sin resultados -> aviso; sin 4xx/5xx`
      );
      if (screen === 'areas') {
        await attachXrayEvidence(testInfo, page, {
          name: 'tm-1748-areas-seleccion',
          comment:
            `Carrier ${carrierIdOf()} (${ENV}). Se escribió «ca», «${text}» (y se eligió la primera dirección) y «zzqxjw93kk» en las 4 pantallas SIN guardar nada: ${measured.join(' | ')}. ` +
            `Control: con carrierId el mismo texto devolvió el punto propio ${ownPlaceId} (source CARRIER).`
        });
      }
      await closeAddressScreen(page, screen);
    }
  });
});
