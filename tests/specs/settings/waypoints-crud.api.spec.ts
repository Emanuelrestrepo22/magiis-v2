// tests/specs/settings/waypoints-crud.api.spec.ts
// MG-1132 · ATP TM-1841 · PK-1 «Contrato API» — alta, edicion, baja y listado de Puntos de referencia
// (`carriers/{id}/waypoint`). 7 Tests Xray, 1 test() = 1 Test: TM-1816, TM-1817, TM-1820, TM-1834,
// TM-1835, TM-1866, TM-1870. API pura (excepcion D1 del ADR-0003): el contrato del servicio es el
// objeto de la prueba; las pantallas del ABM se prueban en PK-4. Ambiente TEST (D2). Datos propios
// «QA AUTO <runId> …», limpieza en el fixture `waypointsApi` por id propio con verificacion de nombre.
// Oraculo DB (Oracle de solo lectura, `MAGIIS.CARRIER_WAYPOINT`): TM-1834, TM-1835 y TM-1870. Sin
// ORACLE_*_TEST el test ejecuta la mitad API, deja la annotation `skip` + `observation` con el motivo y
// el run queda con COBERTURA PARCIAL DECLARADA (no se simula la DB).
// El alta por API NO valida ruteabilidad (Q5): se afirma persistencia y versionado, no rechazo.
// Gate WAYPOINTS_CREATE_DATA=1. Corrida local (sesion guardada, sin login con contrasena):
//   npx cross-env ENV=test WAYPOINTS_CREATE_DATA=1 REUSE_STORAGE_STATE=1 npx playwright test \
//     tests/specs/settings/waypoints-crud.api.spec.ts --project=carrier-v2-desktop --workers=1 --retries=0
import type { TestInfo } from '@playwright/test';
import { WaypointsClient } from '../../api/clients/waypoints.client.js';
import { getCurrentEnv } from '../../config/runtime.js';
import { LOCATIONS, MIAMI, toWaypointCoords } from '../../data/carrier-v2/waypoints/locations.js';
import { waypointsDataFor } from '../../data/carrier-v2/waypoints/waypoints.env.js';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import { test, expect } from '../../fixtures/waypointsFixture.js';
import { attachApiEvidence } from '../../helpers/api-evidence.js';
import {
  carrierItems,
  itemsOfWaypoints,
  parseUtcTimestamp
} from '../../helpers/waypoints-contract.js';
import { makeAnnotate } from '../../utils/traceability.js';

const ENV = getCurrentEnv();
const DATA = waypointsDataFor(ENV);
const ROUTE = 'carriers/{carrierId}/waypoint';
const DB_TABLE = 'MAGIIS.CARRIER_WAYPOINT';
/** Columna TIMESTAMP sin zona (guarda UTC) leida como texto ISO: ver parseUtcTimestamp. */
const TS = (column: string): string =>
  `TO_CHAR(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3') AS ${column}`;
const NO_DB_REASON =
  'ORACLE_*_TEST ausentes: la mitad DB de este Test (columnas de la tabla CARRIER_WAYPOINT) no se verifico; ' +
  'cobertura parcial declarada, solo la mitad API.';

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

/**
 * Oraculo ADICIONAL ausente (la API ya cubre el Test): solo se declara en el comentario del run.
 * Si el oraculo PRINCIPAL del Test es la DB (TM-1834) se usa test.skip real, no esta funcion.
 */
function declareNoDb(testInfo: TestInfo): void {
  testInfo.annotations.push({ type: 'observation', description: NO_DB_REASON });
}

type AuditRow = {
  DELETED: number;
  CREATION_DATE: string | null;
  USER_ID_CREATION: number | null;
  UPDATED_DATE: string | null;
  USER_ID_UPDATE: number | null;
  DELETED_DATE: string | null;
  USER_ID_DELETE: number | null;
};

test.describe('@P1 @functional @migration MG-1132 contrato de puntos de referencia (API)', () => {
  test('TM-1816: debería aceptar un nombre de 50 y una referencia de 240 caracteres con ñ y tildes', async ({
    waypointsApi,
    placesApi,
    carrierSession,
    runId,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1816', ROUTE)('TC11', 'BVA');
    const name = nameFor('ñáéíóú'.repeat(6).slice(0, 33));
    const reference = 'Referencia con ñ y tildes áéíóú. '.repeat(10).slice(0, 240);
    expect(name).toHaveLength(50);
    expect(reference).toHaveLength(240);

    // create() lanza si la respuesta no es 200: un 500 (H1/N1) falla aqui con el cuerpo redactado.
    const created = (await waypointsApi.create({ name, reference, ...spot(0) })).waypoint;
    expect(created.name).toHaveLength(50);
    expect(created.reference).toHaveLength(240);

    const stored = (await waypointsApi.list()).find((w) => w.id === created.id);
    expect(stored?.name, 'el GET devuelve el nombre intacto').toBe(name);
    expect(stored?.reference, 'el GET devuelve la referencia intacta').toBe(reference);

    const found = itemsOfWaypoints(
      carrierItems(
        await placesApi.autocomplete({ address: runId, carrierId: carrierSession.carrierId })
      ),
      [created.id]
    );
    expect(found, 'la busqueda lo encuentra').toHaveLength(1);
    expect(found[0].mainText, 'el buscador devuelve el nombre completo').toBe(name);
    expect(found[0].reference, 'el buscador devuelve la referencia completa').toBe(reference);

    await attachApiEvidence(testInfo, browser, {
      name: 'alta-limites-50-240',
      comment:
        `POST ${ROUTE} con nombre de ${name.length} y referencia de ${reference.length} caracteres (ñ y tildes) en ${ENV}: ` +
        `200 (no 500), id ${created.id}; el GET devolvio longitudes ${stored?.name.length}/${stored?.reference?.length} ` +
        'intactas y la busqueda lo encontro.',
      measurement: {
        id: created.id,
        placeId: created.placeId,
        longitudNombre: stored?.name.length,
        longitudReferencia: stored?.reference?.length,
        encontradoPorBusqueda: found.length === 1
      }
    });
  });

  test('TM-1835: debería listar los puntos del carrier con los mismos datos que devolvió el alta', async ({
    waypointsApi,
    db,
    carrierSession,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1835', ROUTE)('TC2', 'HP');
    const twins = [];
    for (const [i, label] of ['lista 1', 'lista 2', 'lista 3'].entries()) {
      const point = (
        await waypointsApi.create({ name: nameFor(label), reference: `Ref ${label}`, ...spot(i) })
      ).waypoint;
      twins.push(point);
    }

    const list = await waypointsApi.list();
    expect(list.length).toBeGreaterThanOrEqual(twins.length);
    expect(new Set(list.map((w) => w.id)).size, 'sin ids repetidos').toBe(list.length);
    for (const twin of twins) {
      const row = list.find((w) => w.id === twin.id);
      expect.soft(row, `el listado contiene el id ${twin.id}`).toEqual(twin);
    }
    expect(
      list.filter((w) => !/^MGWP-\d+-\d+$/.test(w.placeId)),
      'todos con placeId de punto de referencia'
    ).toEqual([]);

    const measured: Record<string, unknown> = {
      totalApi: list.length,
      propios: twins.map((t) => t.id)
    };
    if (db) {
      const count = async (): Promise<number> =>
        Number(
          (
            await db.query<{ N: number }>(
              `SELECT COUNT(*) AS N FROM ${DB_TABLE} WHERE CARRIERACCOUNT_ID = :c AND DELETED = 0`,
              { c: carrierSession.carrierId }
            )
          )[0].N
        );
      let apiTotal = (await waypointsApi.list()).length;
      let dbTotal = await count();
      // Otra sesion puede dar de alta o de baja entre ambas lecturas: se relee una vez antes de fallar.
      if (apiTotal !== dbTotal) {
        apiTotal = (await waypointsApi.list()).length;
        dbTotal = await count();
      }
      measured.totalDb = dbTotal;
      expect(apiTotal, 'conteo API = conteo DB').toBe(dbTotal);
    } else {
      declareNoDb(testInfo);
    }

    await attachApiEvidence(testInfo, browser, {
      name: 'listado-puntos-del-carrier',
      comment:
        `GET ${ROUTE} en ${ENV}: 200 con ${list.length} puntos; los 3 puntos propios (${twins
          .map((t) => t.id)
          .join(', ')}) figuran con datos identicos a la respuesta del alta.` +
        (db
          ? ` Conteo DB = ${String(measured.totalDb)}.`
          : ' DB no verificada (sin ORACLE_*_TEST).'),
      measurement: measured
    });
  });
});

test.describe('@P2 @functional @migration MG-1132 contrato de puntos de referencia (API)', () => {
  test('TM-1820: debería conservar la versión del placeId al editar sin mover el pin', async ({
    waypointsApi,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1820', ROUTE)('TC15', 'EP');
    const name = nameFor('editar');
    const renamed = nameFor('editado');
    const coords = spot(0);
    const first = await waypointsApi.create({ name, reference: 'ref inicial', ...coords });
    const placeId = first.waypoint.placeId;
    expect(placeId).toBe(`MGWP-${first.waypoint.id}-1`);

    const id = first.waypoint.id;
    const identical = await waypointsApi.update(id, { name, reference: 'ref inicial', ...coords });
    const onlyName = await waypointsApi.update(id, {
      name: renamed,
      reference: 'ref inicial',
      ...coords
    });
    const onlyRef = await waypointsApi.update(id, {
      name: renamed,
      reference: 'ref nueva',
      ...coords
    });

    for (const [kind, result] of [
      ['PUT identico', identical],
      ['PUT solo nombre', onlyName],
      ['PUT solo referencia', onlyRef]
    ] as const) {
      expect.soft(result.waypoint.placeId, `${kind}: version intacta`).toBe(placeId);
      expect
        .soft(result.warnings, `${kind}: warnings coherentes con el alta`)
        .toEqual(first.warnings);
    }
    expect(onlyName.waypoint.name).toBe(renamed);
    expect(onlyRef.waypoint.reference).toBe('ref nueva');
    const stored = (await waypointsApi.list()).find((w) => w.id === id);
    expect(stored).toMatchObject({
      name: renamed,
      reference: 'ref nueva',
      placeId,
      latitude: coords.latitude,
      longitude: coords.longitude
    });

    await attachApiEvidence(testInfo, browser, {
      name: 'editar-sin-mover-conserva-version',
      comment:
        `Punto id ${id}: PUT identico, PUT solo nombre y PUT solo referencia devolvieron 200 y el placeId siguio ` +
        `${placeId} (version 1); el listado refleja el nombre y la referencia nuevos; warnings ${JSON.stringify(first.warnings)} ` +
        'iguales a los del alta en las tres.',
      measurement: {
        placeIdTrasIdentico: identical.waypoint.placeId,
        placeIdTrasSoloNombre: onlyName.waypoint.placeId,
        placeIdTrasSoloReferencia: onlyRef.waypoint.placeId,
        warningsAlta: first.warnings,
        warningsEdiciones: [identical.warnings, onlyName.warnings, onlyRef.warnings]
      }
    });
  });

  test('TM-1834: debería registrar la auditoría de alta, edición y baja sin pisar las columnas anteriores', async ({
    waypointsApi,
    carrierSession,
    db,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1834', ROUTE)('TC1', 'HP');
    const name = nameFor('auditoria');
    const windowStart = Date.now() - 60_000;
    // Con DB la fila DEBE existir: ausencia de fila = falla, nunca un salto silencioso.
    const readAudit = async (id: number): Promise<AuditRow | null> => {
      if (!db) return null;
      const rows = await db.query<AuditRow>(
        `SELECT DELETED, ${TS('CREATION_DATE')}, USER_ID_CREATION, ${TS('UPDATED_DATE')}, USER_ID_UPDATE, ${TS('DELETED_DATE')}, USER_ID_DELETE
         FROM ${DB_TABLE} WHERE ID = :id`,
        { id }
      );
      expect(rows, `una fila de ${DB_TABLE} para el id ${id}`).toHaveLength(1);
      return rows[0];
    };
    // Usuario de la sesion = subUserId (verificado en DB TEST por la revision: 6715 en el carrier 1521, 1380 en el 1040).
    const actor = carrierSession.subUserId;
    const inRunWindow = (text: string | null): boolean => {
      const ms = parseUtcTimestamp(text);
      return ms !== null && ms >= windowStart && ms <= Date.now() + 60_000;
    };
    const ms = (text: string | null): number => parseUtcTimestamp(text) as number;

    // Alta
    const created = (await waypointsApi.create({ name, reference: 'ref', ...spot(0) })).waypoint;
    expect(Number.isNaN(Date.parse(created.creationDate)), 'creationDate es una fecha').toBe(false);
    expect(created.updatedDate, 'sin edicion updatedDate es null').toBeNull();
    const dbCreated = await readAudit(created.id);
    if (dbCreated) {
      expect(dbCreated.DELETED).toBe(0);
      expect(dbCreated.USER_ID_CREATION, 'usuario de la sesion en el alta').toBe(actor);
      expect(inRunWindow(dbCreated.CREATION_DATE), 'CREATION_DATE dentro de la corrida').toBe(true);
      expect([
        dbCreated.UPDATED_DATE,
        dbCreated.USER_ID_UPDATE,
        dbCreated.DELETED_DATE,
        dbCreated.USER_ID_DELETE
      ]).toEqual([null, null, null, null]);
    }

    // Edicion
    const edited = (
      await waypointsApi.update(created.id, { name, reference: 'ref editada', ...spot(0) })
    ).waypoint;
    expect(edited.creationDate, 'creationDate no cambia al editar').toBe(created.creationDate);
    expect(edited.updatedDate, 'updatedDate informado tras editar').not.toBeNull();
    expect(Date.parse(edited.updatedDate as string)).toBeGreaterThanOrEqual(
      Date.parse(created.creationDate)
    );
    const dbEdited = await readAudit(created.id);
    if (dbEdited && dbCreated) {
      expect(dbEdited.USER_ID_UPDATE, 'usuario de la sesion en la edicion').toBe(actor);
      expect(inRunWindow(dbEdited.UPDATED_DATE), 'UPDATED_DATE dentro de la corrida').toBe(true);
      expect(ms(dbEdited.UPDATED_DATE)).toBeGreaterThanOrEqual(ms(dbEdited.CREATION_DATE));
      expect(dbEdited.CREATION_DATE).toEqual(dbCreated.CREATION_DATE);
      expect(dbEdited.USER_ID_CREATION).toBe(dbCreated.USER_ID_CREATION);
      expect([dbEdited.DELETED_DATE, dbEdited.USER_ID_DELETE]).toEqual([null, null]);
    }

    // Baja
    await waypointsApi.remove(created.id);
    expect((await waypointsApi.list()).map((w) => w.id)).not.toContain(created.id);
    const dbDeleted = await readAudit(created.id);
    if (dbDeleted && dbEdited) {
      expect(dbDeleted.DELETED, 'baja logica').toBe(1);
      expect(dbDeleted.USER_ID_DELETE, 'usuario de la sesion en la baja').toBe(actor);
      expect(inRunWindow(dbDeleted.DELETED_DATE), 'DELETED_DATE dentro de la corrida').toBe(true);
      expect(ms(dbDeleted.DELETED_DATE)).toBeGreaterThanOrEqual(ms(dbDeleted.UPDATED_DATE));
      expect(dbDeleted.CREATION_DATE).toEqual(dbEdited.CREATION_DATE);
      expect(dbDeleted.USER_ID_CREATION).toBe(dbEdited.USER_ID_CREATION);
      expect(dbDeleted.UPDATED_DATE).toEqual(dbEdited.UPDATED_DATE);
      expect(dbDeleted.USER_ID_UPDATE).toBe(dbEdited.USER_ID_UPDATE);
    }

    await attachApiEvidence(testInfo, browser, {
      name: 'auditoria-alta-edicion-baja',
      comment:
        `Punto id ${created.id}: alta con creationDate ${created.creationDate} y updatedDate null; edicion con ` +
        `updatedDate ${edited.updatedDate} y creationDate intacta; baja -> ya no figura en el listado. ` +
        (db
          ? 'DB verificada en los tres momentos (USER_ID_*, *_DATE, DELETED).'
          : 'DB NO verificada (sin ORACLE_*_TEST): el oraculo del Test es la DB, el run queda TO DO.'),
      measurement: {
        creationDateAlta: created.creationDate,
        updatedDateAlta: created.updatedDate,
        updatedDateEdicion: edited.updatedDate,
        creationDateEdicion: edited.creationDate,
        db: db
          ? { alta: dbCreated, edicion: dbEdited, baja: dbDeleted }
          : 'no verificada: sin ORACLE_*_TEST'
      }
    });

    // El oraculo principal de este Test es la auditoria en DB: sin ella no se puede acreditar.
    // Skip REAL (el reporter lo emite TODO conservando la evidencia ya adjunta), no PASSED.
    test.skip(!db, NO_DB_REASON);
  });

  test('TM-1866: debería persistir y versionar el punto al moverlo a un camino rural', async ({
    waypointsApi,
    carrierSession,
    db,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1866', ROUTE)('TC8', 'EP');
    const name = nameFor('mover rural');
    const rural = LOCATIONS.F2;
    const noCountry = LOCATIONS.F5a;
    const created = (await waypointsApi.create({ name, ...toWaypointCoords(MIAMI.downtown) }))
      .waypoint;

    // Tramo rural: update() lanza si el servicio no responde 200. Se asevera persistencia y version.
    const toRural = await waypointsApi.update(created.id, { name, ...toWaypointCoords(rural) });
    expect(toRural.waypoint.placeId).toBe(`MGWP-${created.id}-2`);
    expect(toRural.waypoint.latitude).toBeCloseTo(rural.lat, 5);
    expect(toRural.waypoint.longitude).toBeCloseTo(rural.lng, 5);
    const storedRural = (await waypointsApi.list()).find((w) => w.id === created.id);
    expect(storedRural?.latitude).toBeCloseTo(rural.lat, 5);
    expect(storedRural?.longitude).toBeCloseTo(rural.lng, 5);

    // Con DB: la version 1 (MGWP-{id}-1) conserva la coordenada ORIGINAL en MAGIIS_PLACE (solo SELECT).
    // Sin DB es un oraculo adicional ausente: se declara en el comentario del run, no hay PASSED falso.
    if (db) {
      const original = await db.query<{ LATITUDE: string | number; LONGITUDE: string | number }>(
        'SELECT LATITUDE, LONGITUDE FROM MAGIIS.MAGIIS_PLACE WHERE PLACE_ID = :p',
        { p: created.placeId }
      );
      expect(original, `MAGIIS_PLACE conserva ${created.placeId}`).toHaveLength(1);
      expect(Number(original[0].LATITUDE)).toBeCloseTo(MIAMI.downtown.lat, 5);
      expect(Number(original[0].LONGITUDE)).toBeCloseTo(MIAMI.downtown.lng, 5);
    } else {
      declareNoDb(testInfo);
    }

    // Q5 (abierta con Dev): que debe hacer el servicio al mover a una ubicacion SIN pais. Se MIDE y se
    // registra como observation; NO se asevera como esperado (si Dev decide rechazar, este test no debe
    // ponerse rojo ante el arreglo correcto). El rechazo/conservacion se acredita por pantalla (TM-1864).
    const toSea = await waypointsApi.attempt(
      'PUT',
      `carriers/${carrierSession.carrierId}/waypoint/${created.id}`,
      { name, reference: null, ...toWaypointCoords(noCountry) }
    );
    const after = (await waypointsApi.list()).find((w) => w.id === created.id);
    testInfo.annotations.push({
      type: 'observation',
      description:
        `Q5 abierta: PUT a ubicacion sin pais (${noCountry.lat}, ${noCountry.lng}) -> HTTP ${toSea.status}; ` +
        `placeId tras el PUT ${after?.placeId}. Cobertura PARCIAL: la conservacion o el rechazo ante «sin pais» ` +
        'se acredita por pantalla (PK-4 / TM-1864), no por este Test.'
    });

    await attachApiEvidence(testInfo, browser, {
      name: 'mover-a-rural',
      comment:
        `Punto id ${created.id}: PUT a camino rural (${rural.lat}, ${rural.lng}) -> 200, placeId ${toRural.waypoint.placeId} y coordenada persistida. ` +
        `Medicion de Q5 (no asertada): PUT a ubicacion sin pais -> HTTP ${toSea.status}, placeId ${after?.placeId}. ` +
        'Cobertura parcial: el comportamiento ante «sin pais» queda para la pantalla (TM-1864).',
      measurement: {
        versiones: [created.placeId, toRural.waypoint.placeId],
        warningsRural: toRural.warnings,
        q5PutSinPais: { status: toSea.status, placeIdDespues: after?.placeId }
      }
    });
  });

  test('TM-1870: debería devolver avisos al dar de alta en coordenadas sin localidad y sobre agua', async ({
    waypointsApi,
    placesApi,
    db,
    nameFor,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1870', ROUTE)('TC12', 'EP');
    const rural = LOCATIONS.F2;
    const water = LOCATIONS.F4a;

    const noCity = await waypointsApi.create({
      name: nameFor('sin localidad'),
      ...toWaypointCoords(rural)
    });
    expect(noCity.warnings, 'sin localidad: NO_CITY').toContain('NO_CITY');

    const waterPlace = await placesApi.getPlaceByCoords(water.lat, water.lng);
    const onWater = await waypointsApi.create({
      name: nameFor('agua'),
      ...toWaypointCoords(water)
    });
    // NATURAL_FEATURE solo corresponde si Google clasifica el punto como natural_feature.
    const googleSaysNatural = waterPlace.types.includes('natural_feature');
    if (googleSaysNatural) {
      expect(onWater.warnings, 'sobre agua: NATURAL_FEATURE').toContain('NATURAL_FEATURE');
    } else {
      testInfo.annotations.push({
        type: 'observation',
        description: `NATURAL_FEATURE no evaluado: Google no informo natural_feature para F4a (tipos ${JSON.stringify(waterPlace.types)}); warnings obtenidos ${JSON.stringify(onWater.warnings)}.`
      });
    }
    expect(noCity.waypoint.placeId).toBe(`MGWP-${noCity.waypoint.id}-1`);
    expect(onWater.waypoint.placeId).toBe(`MGWP-${onWater.waypoint.id}-1`);

    const listing = await waypointsApi.list();
    for (const [point, loc] of [
      [noCity.waypoint, rural],
      [onWater.waypoint, water]
    ] as const) {
      const row = listing.find((w) => w.id === point.id);
      expect(row, `el listado contiene el id ${point.id}`).toBeDefined();
      expect(row?.latitude).toBeCloseTo(loc.lat, 5);
      expect(row?.longitude).toBeCloseTo(loc.lng, 5);
    }

    const removed = await waypointsApi.remove(noCity.waypoint.id);
    expect(removed, 'la baja respondio 200 con el objeto de uso').not.toBeNull();
    expect((await waypointsApi.list()).map((w) => w.id)).not.toContain(noCity.waypoint.id);
    if (db) {
      const rows = await db.query<{ DELETED: number }>(
        `SELECT DELETED FROM ${DB_TABLE} WHERE ID = :id`,
        { id: noCity.waypoint.id }
      );
      expect(rows[0]?.DELETED, 'DELETED = 1 tras la baja').toBe(1);
    } else {
      declareNoDb(testInfo);
    }

    await attachApiEvidence(testInfo, browser, {
      name: 'alta-con-avisos',
      comment:
        `POST ${ROUTE} en camino sin localidad (${rural.lat}, ${rural.lng}) -> 200, warnings ${JSON.stringify(noCity.warnings)}; ` +
        `sobre agua (${water.lat}, ${water.lng}; tipos Google ${JSON.stringify(waterPlace.types)}) -> 200, warnings ` +
        `${JSON.stringify(onWater.warnings)}. Ambos figuran en el listado; baja del primero 200 y ya no figura. ` +
        (db
          ? 'DELETED = 1 verificado en DB.'
          : 'DB no verificada (sin ORACLE_*_TEST): la baja se comprobo por el listado.'),
      measurement: {
        warningsSinLocalidad: noCity.warnings,
        warningsAgua: onWater.warnings,
        tiposGoogleAgua: waterPlace.types,
        natFeatureEvaluado: googleSaysNatural
      }
    });
  });
});

test.describe('@P3 @functional @migration MG-1132 contrato de puntos de referencia (API)', () => {
  test('TM-1817: debería guardar literal nombres con espacios, HTML, comillas y emoji y recortar los espacios de los extremos', async ({
    waypointsApi,
    runId,
    browser
  }, testInfo) => {
    makeAnnotate('TM-1817', ROUTE)('TC12', 'EP');
    const prefix = `QA AUTO ${runId}`;
    const rows = [
      {
        kind: 'espacios en los extremos',
        sent: ` ${prefix} espacios `,
        expected: `${prefix} espacios`,
        reference: '   ',
        expectedReference: null
      },
      {
        kind: 'HTML',
        sent: `${prefix} <b>negrita</b>`,
        expected: `${prefix} <b>negrita</b>`,
        reference: null,
        expectedReference: null
      },
      {
        kind: 'comillas y ampersand',
        sent: `${prefix} 'Comillas' &`,
        expected: `${prefix} 'Comillas' &`,
        reference: null,
        expectedReference: null
      },
      {
        kind: 'emoji',
        sent: `${prefix} \u{1F642} emoji`,
        expected: `${prefix} \u{1F642} emoji`,
        reference: null,
        expectedReference: null
      }
    ];
    const measured: Record<string, unknown> = {};
    for (const row of rows) {
      const created = (
        await waypointsApi.create({
          name: row.sent,
          reference: row.reference,
          ...spot(rows.indexOf(row))
        })
      ).waypoint;
      const stored = (await waypointsApi.list()).find((w) => w.id === created.id);
      measured[row.kind] = { id: created.id, nombre: stored?.name, referencia: stored?.reference };
      expect.soft(created.name, `${row.kind}: respuesta del alta`).toBe(row.expected);
      expect.soft(stored?.name, `${row.kind}: listado`).toBe(row.expected);
      expect.soft(stored?.reference, `${row.kind}: referencia`).toBe(row.expectedReference);
    }
    await attachApiEvidence(testInfo, browser, {
      name: 'alta-texto-literal',
      comment:
        'Cuatro altas con nombre con espacios en los extremos, HTML, comillas con ampersand y emoji: se guardaron ' +
        'literales (sin interpretar HTML), el nombre volvio sin espacios de los extremos y la referencia de solo ' +
        'espacios volvio null.',
      measurement: measured
    });
  });
});
