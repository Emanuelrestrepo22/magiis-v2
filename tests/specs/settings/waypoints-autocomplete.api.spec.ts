// tests/specs/settings/waypoints-autocomplete.api.spec.ts
// MG-1132 · ATP TM-1841 · PK-1 «Contrato API» — buscador de Puntos de referencia (`places/autocomplete`).
// 12 Tests Xray, 1 test() = 1 Test: TM-743, TM-1730, TM-1731, TM-1736, TM-1737, TM-1738, TM-1742,
// TM-1749, TM-1750, TM-1752, TM-1753, TM-1754. API pura (excepcion D1 del ADR-0003): el alta y la baja
// de los puntos van por API porque el contrato del buscador es el objeto de la prueba; la pantalla se
// prueba en PK-2 (Nuevo Viaje). Ambiente TEST (D2). Datos propios «QA AUTO <runId> …», limpieza en el
// fixture `waypointsApi` por id propio con verificacion de nombre.
// Regla medida: con `carrierId` (Nuevo Viaje) minimo 2 caracteres y los puntos del carrier primero;
// sin `carrierId` minimo 3 caracteres y nunca puntos. Coincidencia por contenido, sin tildes ni
// mayusculas, la ñ equivale a n.
// Gate WAYPOINTS_CREATE_DATA=1. Corrida local (sesion guardada, sin login con contrasena):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/settings/waypoints-autocomplete.api.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import { PlacesClient, type AutocompleteItem } from '../../api/clients/places.client.js';
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { MIAMI, toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { attachApiEvidence } from '../../helpers/api-evidence.js';
import {
  carrierItems,
  isSortedByNormalizedName,
  itemsOfWaypoints,
  normalizeName
} from '../../helpers/waypoints-contract.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const AUTOCOMPLETE = 'places/autocomplete';

test.skip(
  process.env.WAYPOINTS_CREATE_DATA !== '1',
  'crea y borra puntos de referencia reales; correr con WAYPOINTS_CREATE_DATA=1'
);
test.skip(DATA === null, `sin datos de puntos de referencia para ENV=${ENV} (hoy solo test)`);
// SIN retries: cada intento crea datos reales y un reintento taparia la falla del primero.
test.describe.configure({ timeout: 120_000, retries: 0 });

// Barrido de corridas anteriores: solo puntos «QA AUTO <runId>» con mas de 24 h.
test.beforeAll(async ({ carrierApi, carrierSession }) => {
  await new WaypointsClient(carrierApi, carrierSession, makeRunId()).sweep();
});

/** Coordenada propia distinta por indice (Miami; el alta por API no valida ruteabilidad). */
const spot = (index: number): { latitude: number; longitude: number } =>
  toWaypointCoords({ lat: MIAMI.downtown.lat + index * 0.0006, lng: MIAMI.downtown.lng });

const idsOf = (items: readonly AutocompleteItem[]): string[] => items.map((i) => i.placeId);

test.describe('@P1 @functional @migration MG-1132 buscador de puntos de referencia (API)', () => {
  test('TM-1749: debería no devolver nunca puntos de referencia cuando se busca sin carrierId', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1749', AUTOCOMPLETE)('TC24', 'NEG');
    const name = nameFor('casa qa');
    const created = await waypointsApi.create({ name, ...spot(0) });
    const id = created.waypoint.id;

    const rows = [
      { text: 'ca', kind: 'menos de 3 caracteres' },
      { text: name, kind: 'nombre completo del punto propio' },
      { text: 'casa qa', kind: 'prefijo casa (subcadena real del nombre propio)' },
      { text: 'qwzxvbn', kind: 'texto sin resultados' }
    ];
    const measured: Record<string, unknown> = {};
    // Control positivo: con carrierId las mismas busquedas SI encuentran el punto propio; sin el, la
    // ausencia no es vacua (el punto existe y es buscable por la via que corresponde).
    for (const text of [name, 'casa qa']) {
      const withCarrier = await placesApi.autocomplete({
        address: text,
        carrierId: carrierSession.carrierId
      });
      expect(idsOf(carrierItems(withCarrier)), `control con carrierId: «${text}»`).toContain(
        created.waypoint.placeId
      );
    }
    for (const row of rows) {
      const items = await placesApi.autocomplete({ address: row.text });
      measured[row.kind] = {
        texto: row.text,
        items: items.length,
        fuentes: [...new Set(items.map((i) => i.source))]
      };
      expect.soft(carrierItems(items), `«${row.kind}»: sin source CARRIER`).toEqual([]);
      expect
        .soft(itemsOfWaypoints(items, [id]), `«${row.kind}»: el punto propio no aparece`)
        .toEqual([]);
      expect
        .soft(
          idsOf(items).filter((p) => p.startsWith('MGWP-')),
          `«${row.kind}»: ningun placeId de punto de referencia`
        )
        .toEqual([]);
    }
    const short = await placesApi.autocomplete({ address: 'ca' });
    expect(short, 'dos caracteres sin carrierId devuelven lista vacia').toEqual([]);

    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-sin-carrier',
      comment:
        `GET ${AUTOCOMPLETE} sin carrierId en ${ENV} con el punto propio «${name}» (id ${id}) dado de alta: ` +
        '«ca» devolvio [], y ni el nombre completo, ni «casa qa» ni un texto sin resultados ' +
        'devolvieron items source=CARRIER ni placeId MGWP-*.',
      measurement: measured
    });
  });

  test('TM-1750: debería aislar el buscador de cada carrier: cada sesión ve solo sus propios puntos', async ({
    waypointsApi,
    otherCarrierWaypointsApi,
    placesApi,
    otherCarrierApi,
    otherCarrierId,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1750', AUTOCOMPLETE)('TC25', 'NEG');
    const idB = otherCarrierId;
    const placesB = new PlacesClient(otherCarrierApi);
    const name = nameFor('aislamiento');
    const a = (await waypointsApi.create({ name, ...spot(0) })).waypoint;
    const b = (await otherCarrierWaypointsApi.create({ name, ...spot(1) })).waypoint;
    expect(a.id).not.toBe(b.id);

    const seenByA = await placesApi.autocomplete({
      address: name,
      carrierId: carrierSession.carrierId
    });
    const seenByB = await placesB.autocomplete({ address: name, carrierId: idB });
    expect(idsOf(carrierItems(seenByA)), 'sesion A ve solo su punto').toEqual([a.placeId]);
    expect(idsOf(seenByA), 'sesion A no ve el de B').not.toContain(b.placeId);
    expect(idsOf(carrierItems(seenByB)), 'sesion B ve solo su punto').toEqual([b.placeId]);
    expect(idsOf(seenByB), 'sesion B no ve el de A').not.toContain(a.placeId);

    const listA = (await waypointsApi.list()).map((w) => w.id);
    const listB = (await otherCarrierWaypointsApi.list()).map((w) => w.id);
    expect(listA).toContain(a.id);
    expect(listA).not.toContain(b.id);
    expect(listB).toContain(b.id);
    expect(listB).not.toContain(a.id);
    expect(
      listA.filter((id) => listB.includes(id)),
      'listados disjuntos'
    ).toEqual([]);

    await attachApiEvidence(testInfo, browser, {
      name: 'aislamiento-entre-carriers',
      comment:
        `Dos sesiones (carrier ${carrierSession.carrierId} y ${idB}) dieron de alta un punto del mismo nombre ` +
        `«${name}» (ids ${a.id} y ${b.id}). El autocomplete de cada una devolvio solo su placeId ` +
        `(${a.placeId} / ${b.placeId}) y el listado de cada carrier no incluye el id del otro.`,
      measurement: {
        placeIdA: a.placeId,
        placeIdB: b.placeId,
        autocompleteA: idsOf(carrierItems(seenByA)),
        autocompleteB: idsOf(carrierItems(seenByB)),
        listadosDisjuntos: true
      }
    });
  });

  test('TM-1753: debería reflejar alta, renombre y baja en el buscador sin recargar nada', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1753', AUTOCOMPLETE)('TC28', 'HP');
    const carrierId = carrierSession.carrierId;
    const oldName = nameFor('alfa');
    const newName = nameFor('omega');
    const search = async (text: string): Promise<AutocompleteItem[]> =>
      carrierItems(await placesApi.autocomplete({ address: text, carrierId }));

    const created = (await waypointsApi.create({ name: oldName, ...spot(0) })).waypoint;
    const afterCreate = await search(oldName);
    expect(idsOf(afterCreate), 'tras el alta aparece').toContain(created.placeId);

    await waypointsApi.update(created.id, { name: newName, ...spot(0) });
    const oldAfterRename = await search(oldName);
    const newAfterRename = await search(newName);
    expect(itemsOfWaypoints(oldAfterRename, [created.id]), 'texto viejo: no aparece').toEqual([]);
    expect(itemsOfWaypoints(newAfterRename, [created.id]), 'texto nuevo: aparece').toHaveLength(1);

    await waypointsApi.remove(created.id);
    const afterDelete = await search(newName);
    expect(itemsOfWaypoints(afterDelete, [created.id]), 'tras la baja no aparece').toEqual([]);

    await attachApiEvidence(testInfo, browser, {
      name: 'buscador-sigue-al-punto',
      comment:
        `Punto id ${created.id}: alta «${oldName}» -> el autocomplete lo devolvio; renombre a «${newName}» -> ` +
        'el texto viejo ya no lo devuelve y el nuevo si; baja -> ya no figura. Cada busqueda fue un GET nuevo, ' +
        'sin estado de cliente.',
      measurement: {
        tras_alta: idsOf(afterCreate),
        texto_viejo_tras_renombre: itemsOfWaypoints(oldAfterRename, [created.id]).length,
        texto_nuevo_tras_renombre: idsOf(itemsOfWaypoints(newAfterRename, [created.id])),
        tras_baja: itemsOfWaypoints(afterDelete, [created.id]).length
      }
    });
  });
});

test.describe('@P2 @functional @migration MG-1132 buscador de puntos de referencia (API)', () => {
  test('TM-743: debería devolver lista vacía sin carrierId con 0, 1 y 2 caracteres', async ({
    placesApi,
    browser
  }, testInfo) => {
    makeAnnotate('TM-743', AUTOCOMPLETE)('TC1', 'BVA');
    const measured: Record<string, unknown> = {};
    for (const text of ['', 'a', 'ab']) {
      const items = await placesApi.autocomplete({ address: text });
      measured[`${text.length} caracteres`] = items.length;
      expect.soft(items, `«${text}» (${text.length} caracteres) devuelve []`).toEqual([]);
    }
    const control = await placesApi.autocomplete({ address: 'mia' });
    measured['3 caracteres (control del par)'] = control.length;
    expect(control.length, 'con 3 caracteres se supera el minimo').toBeGreaterThan(0);

    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-minimo-sin-carrier',
      comment:
        `GET ${AUTOCOMPLETE} sin carrierId en ${ENV}: 0, 1 y 2 caracteres devolvieron 200 y [] ; ` +
        `«mia» (3 caracteres, control) devolvio ${control.length} items.`,
      measurement: measured
    });
  });

  test('TM-1730: debería devolver solo puntos propios con 2 caracteres y carrierId', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1730', AUTOCOMPLETE)('TC4', 'HP');
    const created = [];
    for (const [i, label] of ['zq1', 'zq2', 'zq3'].entries()) {
      created.push((await waypointsApi.create({ name: nameFor(label), ...spot(i) })).waypoint);
    }
    const removed = (await waypointsApi.create({ name: nameFor('zq4 baja'), ...spot(3) })).waypoint;
    await waypointsApi.remove(removed.id);

    const items = await placesApi.autocomplete({
      address: 'zq',
      carrierId: carrierSession.carrierId
    });
    expect(items.length).toBeGreaterThan(0);
    expect(
      items.filter((i) => i.source !== 'CARRIER').map((i) => i.source),
      'solo source=CARRIER con 2 caracteres'
    ).toEqual([]);
    expect(idsOf(items)).toEqual(expect.arrayContaining(created.map((w) => w.placeId)));
    expect(itemsOfWaypoints(items, [removed.id]), 'el dado de baja no aparece').toEqual([]);

    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-dos-caracteres',
      comment:
        `GET ${AUTOCOMPLETE}?address=zq&carrierId=${carrierSession.carrierId}: ${items.length} items, todos ` +
        `source=CARRIER; incluye los 3 puntos propios (${created.map((w) => w.placeId).join(', ')}) y no ` +
        `incluye el dado de baja (id ${removed.id}).`,
      measurement: {
        items: items.length,
        fuentes: [...new Set(items.map((i) => i.source))],
        propios: created.map((w) => w.placeId),
        dadoDeBajaPresente: itemsOfWaypoints(items, [removed.id]).length > 0
      }
    });
  });

  test('TM-1731: debería listar los puntos del carrier antes que los aeropuertos', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1731', AUTOCOMPLETE)('TC5', 'HP');
    const name = nameFor('eze');
    const created = (await waypointsApi.create({ name, ...spot(0) })).waypoint;
    const items = await placesApi.autocomplete({
      address: 'eze',
      carrierId: carrierSession.carrierId
    });
    const firstAirport = items.findIndex((i) => i.airport);
    const lastCarrier = items.map((i) => i.source).lastIndexOf('CARRIER');

    expect(idsOf(carrierItems(items)), 'el punto propio esta en la lista').toContain(
      created.placeId
    );
    expect(items[0].source, 'el primer item es un punto del carrier').toBe('CARRIER');
    expect(firstAirport, 'la busqueda trae aeropuertos (control del orden)').toBeGreaterThan(-1);
    expect(lastCarrier, 'todos los CARRIER preceden al primer aeropuerto').toBeLessThan(
      firstAirport
    );
    expect(
      items.filter((i) => i.airport && i.source === 'CARRIER'),
      'un aeropuerto no lleva source CARRIER'
    ).toEqual([]);

    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-orden-puntos-aeropuertos',
      comment:
        `GET ${AUTOCOMPLETE}?address=eze con el punto propio «${name}»: ${items.length} items; ` +
        `el ultimo CARRIER esta en la posicion ${lastCarrier} y el primer aeropuerto en la ${firstAirport}.`,
      measurement: {
        orden: items.map(
          (i, n) => `${n}: ${i.source}${i.airport ? ' (airport)' : ''} ${i.mainText}`
        )
      }
    });
  });

  test('TM-1736: debería encontrar el punto por texto al inicio, medio y final del nombre', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    runId,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1736', AUTOCOMPLETE)('TC11', 'EP');
    const name = nameFor('mxini CENTRAL mxfin');
    const created = (await waypointsApi.create({ name, ...spot(0) })).waypoint;
    const rows = [
      { kind: 'inicio', text: `QA AUTO ${runId}`, expected: true },
      { kind: 'medio', text: 'central', expected: true },
      { kind: 'final', text: 'mxfin', expected: true },
      { kind: 'ajeno', text: 'qwzxvbn', expected: false }
    ];
    const measured: Record<string, unknown> = {};
    for (const row of rows) {
      const items = await placesApi.autocomplete({
        address: row.text,
        carrierId: carrierSession.carrierId
      });
      const found = itemsOfWaypoints(carrierItems(items), [created.id]).length === 1;
      measured[row.kind] = { texto: row.text, encontrado: found };
      expect.soft(found, `${row.kind} «${row.text}»`).toBe(row.expected);
    }
    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-posicion-del-texto',
      comment:
        `Punto «${name}» (id ${created.id}): el autocomplete lo devolvio al buscar ` +
        'por el inicio, el medio (con otra capitalizacion) y el final del nombre, y no lo devolvio con un texto ajeno.',
      measurement: measured
    });
  });

  test('TM-1737: debería buscar sin distinguir mayúsculas ni tildes y con la ñ como n', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1737', AUTOCOMPLETE)('TC12', 'EP');
    const seb = (await waypointsApi.create({ name: nameFor('Sebastián Ávila'), ...spot(0) }))
      .waypoint;
    const ane = (await waypointsApi.create({ name: nameFor('Añelo Éxodo'), ...spot(1) })).waypoint;
    const nan = (await waypointsApi.create({ name: nameFor('Ñandú'), ...spot(2) })).waypoint;
    const rows = [
      { text: 'SEB', point: seb },
      { text: 'sebastián', point: seb },
      { text: 'AVILA', point: seb },
      { text: 'anelo', point: ane },
      { text: 'exodo', point: ane },
      { text: 'ñan', point: nan },
      { text: 'nan', point: nan }
    ];
    const measured: Record<string, unknown> = {};
    for (const row of rows) {
      const items = await placesApi.autocomplete({
        address: row.text,
        carrierId: carrierSession.carrierId
      });
      const found = idsOf(carrierItems(items)).includes(row.point.placeId);
      measured[row.text] = { punto: row.point.placeId, encontrado: found };
      expect.soft(found, `«${row.text}» encuentra ${row.point.placeId}`).toBe(true);
    }
    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-tildes-y-mayusculas',
      comment:
        'Tres puntos propios (Sebastián Ávila, Añelo Éxodo, Ñandú): los 7 textos (SEB, sebastián, AVILA, anelo, ' +
        'exodo, ñan, nan) devolvieron el punto esperado con source=CARRIER.',
      measurement: measured
    });
  });

  test('TM-1738: debería ordenar los puntos del carrier por nombre normalizado', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    runId,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1738', AUTOCOMPLETE)('TC13', 'EP');
    // Alta en orden distinto al esperado: el orden de la respuesta no puede ser el de creacion.
    const labels = ['Ñandú', 'Anzola', 'Nube', 'Añelo'];
    const created = new Map<string, number>();
    for (const [i, label] of labels.entries()) {
      const point = (await waypointsApi.create({ name: nameFor(label), ...spot(i) })).waypoint;
      created.set(label, point.id);
    }
    const expectedOrder = ['Añelo', 'Anzola', 'Ñandú', 'Nube'].map((l) => created.get(l));

    const items = carrierItems(
      await placesApi.autocomplete({ address: runId, carrierId: carrierSession.carrierId })
    );
    const actualOrder = items.map((i) => {
      const id = /^MGWP-(\d+)-/.exec(i.placeId)?.[1];
      return id === undefined ? undefined : Number(id);
    });
    expect(actualOrder, 'orden por nombre normalizado (ñ = n, sin tildes)').toEqual(expectedOrder);
    expect(isSortedByNormalizedName(items.map((i) => i.mainText))).toBe(true);

    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-orden-normalizado',
      comment:
        'Cuatro puntos propios dados de alta como Ñandú, Anzola, Nube y Añelo; el autocomplete con el token del run ' +
        'los devolvio como Añelo, Anzola, Ñandú, Nube (orden por nombre sin tildes y con la ñ como n).',
      measurement: { respuesta: items.map((i) => i.mainText), ids: actualOrder }
    });
  });

  test('TM-1752: debería excluir del buscador al punto dado de baja y conservar al gemelo activo', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1752', AUTOCOMPLETE)('TC27', 'EP');
    const name = nameFor('gemelo');
    const active = (await waypointsApi.create({ name, ...spot(0) })).waypoint;
    const gone = (await waypointsApi.create({ name, ...spot(1) })).waypoint;
    // Estado previo: ambos gemelos son buscables antes de la baja (la ausencia posterior no es vacua).
    const before = await placesApi.autocomplete({
      address: name,
      carrierId: carrierSession.carrierId
    });
    expect(idsOf(carrierItems(before)), 'antes de la baja aparecen los dos').toEqual(
      expect.arrayContaining([active.placeId, gone.placeId])
    );
    await waypointsApi.remove(gone.id);

    const items = await placesApi.autocomplete({
      address: name,
      carrierId: carrierSession.carrierId
    });
    expect(idsOf(carrierItems(items)), 'el activo aparece').toContain(active.placeId);
    expect(itemsOfWaypoints(items, [gone.id]), 'ningun MGWP-{idBaja}-*').toEqual([]);
    expect((await waypointsApi.list()).map((w) => w.id)).not.toContain(gone.id);

    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-gemelo-baja',
      comment:
        `Dos puntos con el mismo nombre «${name}» (ids ${active.id} y ${gone.id}); tras dar de baja el segundo el ` +
        `autocomplete devolvio solo ${active.placeId} y el listado no incluye el id ${gone.id}.`,
      measurement: {
        activo: active.placeId,
        baja: gone.placeId,
        respuesta: idsOf(carrierItems(items))
      }
    });
  });

  test('TM-1754: debería versionar el placeId al mover el pin más de 500 m', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1754', AUTOCOMPLETE)('TC29', 'HP');
    const name = nameFor('mover');
    const from = MIAMI.downtown;
    const to = { lat: from.lat + 0.006, lng: from.lng };
    const created = (await waypointsApi.create({ name, ...toWaypointCoords(from) })).waypoint;
    expect(created.placeId).toBe(`MGWP-${created.id}-1`);

    const moved = (await waypointsApi.update(created.id, { name, ...toWaypointCoords(to) }))
      .waypoint;
    expect(moved.placeId, 'la version sube de 1 a 2').toBe(`MGWP-${created.id}-2`);
    expect(moved.latitude).toBeCloseTo(to.lat, 5);
    expect(moved.longitude).toBeCloseTo(to.lng, 5);
    const stored = (await waypointsApi.list()).find((w) => w.id === created.id);
    expect(stored?.latitude).toBeCloseTo(to.lat, 5);
    expect(stored?.longitude).toBeCloseTo(to.lng, 5);

    const items = await placesApi.autocomplete({
      address: name,
      carrierId: carrierSession.carrierId
    });
    const mine = itemsOfWaypoints(items, [created.id]);
    expect(idsOf(mine), 'una sola aparicion, con la version nueva').toEqual([moved.placeId]);
    // El buscador entrega la ubicacion vigente: coordenadas del ITEM, no solo del PUT/list.
    expect(Number(mine[0].latitude), 'latitud del item = la nueva').toBeCloseTo(to.lat, 5);
    expect(Number(mine[0].longitude), 'longitud del item = la nueva').toBeCloseTo(to.lng, 5);
    expect(Number(mine[0].latitude), 'latitud del item distinta de la original').not.toBeCloseTo(
      from.lat,
      3
    );

    await attachApiEvidence(testInfo, browser, {
      name: 'mover-pin-versiona-placeid',
      comment:
        `Punto id ${created.id} movido ~667 m (lat ${from.lat} -> ${to.lat}) por PUT: el placeId paso de ` +
        `${created.placeId} a ${moved.placeId}; el listado devuelve la coordenada nueva y el autocomplete ` +
        `lo devuelve una sola vez con la version nueva y la coordenada nueva en el item (lat ${mine[0].latitude}, lng ${mine[0].longitude}).`,
      measurement: {
        antes: created.placeId,
        despues: moved.placeId,
        autocomplete: idsOf(mine),
        coordenadaDelItem: { lat: mine[0].latitude, lng: mine[0].longitude }
      }
    });
  });
});

test.describe('@P3 @functional @migration MG-1132 buscador de puntos de referencia (API)', () => {
  test('TM-1742: debería tratar comodines, comillas, emojis y HTML como texto literal sin errores', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1742', AUTOCOMPLETE)('TC17', 'NEG');
    const control = (await waypointsApi.create({ name: nameFor('Zona QA'), ...spot(0) })).waypoint;
    const texts = [
      '%%',
      '__',
      'zona_qa',
      'z_na',
      'qa%',
      "''",
      "' or 1=1",
      '\u{1F642}\u{1F642}',
      '<script>alert(1)</script>',
      '-34.6027'
    ];
    const measured: Record<string, unknown> = {};
    for (const text of texts) {
      // placesApi.autocomplete lanza si la respuesta no es 200 (sin 4xx/5xx).
      const items = await placesApi.autocomplete({
        address: text,
        carrierId: carrierSession.carrierId
      });
      // Solo cuenta lo que NO contiene literalmente el texto: un punto ajeno cuyo nombre lo contenga
      // (otra sesion) seria una coincidencia legitima; un comodin interpretado trae nombres sin el texto.
      const fromCarrier = carrierItems(items).filter(
        (i) => !normalizeName(i.mainText).includes(normalizeName(text))
      );
      measured[text] = { items: items.length, carrierSinCoincidenciaLiteral: fromCarrier.length };
      expect
        .soft(fromCarrier, `«${text}»: 0 items CARRIER sin la coincidencia literal`)
        .toEqual([]);
      expect
        .soft(itemsOfWaypoints(items, [control.id]), `«${text}»: no trae el control`)
        .toEqual([]);
    }
    await attachApiEvidence(testInfo, browser, {
      name: 'autocomplete-texto-literal',
      comment:
        `10 textos (comodines % y _, comillas, ' or 1=1, emojis, <script>, coordenada) contra ${AUTOCOMPLETE} con ` +
        `carrierId y el punto de control «Zona QA» (id ${control.id}): todas las respuestas fueron 200 y ninguna ` +
        'trajo items source=CARRIER sin la coincidencia literal del texto buscado (los comodines no se interpretan).',
      measurement: measured
    });
  });
});
