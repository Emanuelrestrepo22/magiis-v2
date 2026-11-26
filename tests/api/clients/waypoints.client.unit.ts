// tests/api/clients/waypoints.client.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { APIRequestContext } from '@playwright/test';
import { makeRunId } from '../../fixtures/factories/otherCostFactory.js';
import {
  isWaypointSweepCandidate,
  parseWaypointNameTimestamp,
  waypointName,
  WaypointsClient,
  type WaypointDto
} from './waypoints.client.js';
import type { CarrierSession } from './carrierSession.js';

const DAY = 24 * 60 * 60 * 1000;
const RUN = 'ABCDEF12';

type Call = { method: string; path: string };

const EMPTY_USAGE = {
  recurringTripIds: [],
  frequentDestinations: [],
  passengerAddressIds: [],
  passengerFrequentDestinationIds: [],
  scheduledTravelIds: []
};
/** Ids con uso simulado en el `usage` de la API falsa. */
const inUse = new Set<string>();
const usageOf = (path: string): unknown =>
  inUse.has(path.split('/').slice(-2)[0])
    ? { ...EMPTY_USAGE, scheduledTravelIds: [9] }
    : EMPTY_USAGE;

/** API falsa: `rows` es la lista vigente; registra cada llamada. */
function fakeApi(rows: WaypointDto[], calls: Call[]): APIRequestContext {
  const respond = (body: unknown) => ({
    status: () => 200,
    ok: () => true,
    text: async () => JSON.stringify(body)
  });
  return {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path.endsWith('/usage')) return respond(usageOf(path));
      return respond(rows);
    },
    post: async (path: string, o: { data: { name: string } }) => {
      calls.push({ method: 'POST', path });
      const dto = { id: 900, name: o.data.name, placeId: 'MGWP-900-1' } as WaypointDto;
      rows.push(dto);
      return respond({ waypoint: dto, warnings: [] });
    },
    put: async (path: string) => {
      calls.push({ method: 'PUT', path });
      return respond({});
    },
    delete: async (path: string) => {
      calls.push({ method: 'DELETE', path });
      return respond({ scheduledTravelIds: [] });
    }
  } as unknown as APIRequestContext;
}
const session = { carrierId: 1521 } as unknown as CarrierSession;

describe('waypointName', () => {
  it('arma «QA AUTO <runId> <etiqueta>» y rechaza runId invalido o mas de 50 caracteres', () => {
    assert.equal(waypointName(RUN, 'alta'), 'QA AUTO ABCDEF12 alta');
    assert.throws(() => waypointName('abc', 'x'), /runId invalido/);
    assert.throws(() => waypointName(RUN, 'x'.repeat(50)), /supera 50/);
  });
});

describe('edad por runId', () => {
  it('decodifica el instante de makeRunId y decide el sweep', () => {
    const now = Date.now();
    const old = waypointName(makeRunId(now - 2 * DAY), 'viejo');
    const fresh = waypointName(makeRunId(now - 1000), 'nuevo');
    assert.ok(Math.abs((parseWaypointNameTimestamp(old) ?? 0) - (now - 2 * DAY)) < 1500);
    assert.equal(isWaypointSweepCandidate(old, now, DAY), true);
    assert.equal(isWaypointSweepCandidate(fresh, now, DAY), false);
  });
  it('nunca elige nombres ajenos o sin el formato', () => {
    const now = Date.now() + 100 * DAY;
    for (const name of [
      'Casa Rafael',
      'QA AUTO',
      'QA AUTO abc',
      'QA AUTOX ABCDEF12',
      'qa auto ABCDEF12 x'
    ]) {
      assert.equal(isWaypointSweepCandidate(name, now, DAY), false, name);
    }
  });
});

describe('WaypointsClient guardas', () => {
  it('create rechaza nombres sin el prefijo del run y registra el id creado', async () => {
    const calls: Call[] = [];
    const client = new WaypointsClient(fakeApi([], calls), session, RUN);
    await assert.rejects(
      client.create({ name: 'Casa Rafael', latitude: 1, longitude: 2 }),
      /no empieza con/
    );
    assert.equal(calls.length, 0);
    await client.create({ name: waypointName(RUN, 'a'), latitude: 1, longitude: 2 });
    assert.deepEqual(client.ownIds, [900]);
  });

  it('create acepta espacios en los extremos del nombre propio (el backend los recorta) y sigue rechazando ajenos', async () => {
    const calls: Call[] = [];
    const client = new WaypointsClient(fakeApi([], calls), session, RUN);
    await client.create({ name: ` ${waypointName(RUN, 'a')} `, latitude: 1, longitude: 2 });
    assert.deepEqual(client.ownIds, [900]);
    await assert.rejects(
      client.create({ name: ' Casa Rafael ', latitude: 1, longitude: 2 }),
      /no empieza con/
    );
  });

  it('remove rechaza ids no creados por la corrida sin llamar a la API', async () => {
    const calls: Call[] = [];
    const client = new WaypointsClient(fakeApi([], calls), session, RUN);
    await assert.rejects(client.remove(13), /no fue creado por esta corrida/);
    assert.equal(calls.length, 0);
  });

  it('remove relee la lista y NO borra si el nombre cambio', async () => {
    const calls: Call[] = [];
    const rows: WaypointDto[] = [];
    const client = new WaypointsClient(fakeApi(rows, calls), session, RUN);
    await client.create({ name: waypointName(RUN, 'a'), latitude: 1, longitude: 2 });
    rows[0].name = 'Nombre ajeno';
    await assert.rejects(client.remove(900), /ya no tiene el nombre registrado/);
    assert.equal(
      calls.some((c) => c.method === 'DELETE'),
      false
    );
  });

  it('remove borra un punto propio tras releer y cleanup tolera la baja previa', async () => {
    const calls: Call[] = [];
    const rows: WaypointDto[] = [];
    const client = new WaypointsClient(fakeApi(rows, calls), session, RUN);
    await client.create({ name: waypointName(RUN, 'a'), latitude: 1, longitude: 2 });
    await client.remove(900);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['POST', 'GET', 'DELETE']
    );
    rows.length = 0;
    await client.cleanup();
  });

  it('sweep borra solo propios viejos y relee antes de cada DELETE', async () => {
    const calls: Call[] = [];
    const now = Date.now();
    const rows = [
      { id: 1, name: waypointName(makeRunId(now - 3 * DAY), 'viejo') },
      { id: 2, name: waypointName(makeRunId(now), 'nuevo') },
      { id: 3, name: 'Casa Rafael' }
    ] as WaypointDto[];
    const client = new WaypointsClient(fakeApi(rows, calls), session, RUN);
    assert.deepEqual(await client.sweep(DAY, now), [1]);
    assert.deepEqual(
      calls.filter((c) => c.method === 'DELETE').map((c) => c.path),
      ['carriers/1521/waypoint/1']
    );
  });

  it('sweep no borra un punto en uso ni nombres con forma de runId fuera de la ventana plausible', async () => {
    const calls: Call[] = [];
    const now = Date.now();
    const rows = [
      { id: 1, name: waypointName(makeRunId(now - 3 * DAY), 'en uso') },
      { id: 2, name: 'QA AUTO PRUEBA01 humano' }
    ] as WaypointDto[];
    inUse.add('1');
    try {
      const client = new WaypointsClient(fakeApi(rows, calls), session, RUN);
      assert.deepEqual(await client.sweep(DAY, now), []);
      assert.equal(
        calls.some((c) => c.method === 'DELETE'),
        false
      );
    } finally {
      inUse.clear();
    }
  });

  it('attempt solo admite rutas de waypoint del carrier de la sesion', async () => {
    const client = new WaypointsClient(fakeApi([], []), session, RUN);
    await assert.rejects(client.attempt('DELETE', 'carriers/1040/waypoint/1'), /solo admite rutas/);
  });
});
