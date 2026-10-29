import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { SessionRejectedError } from './carrierSession.js';
import { DriverSession } from './driverSession.js';
import { DriverTravelsClient } from './driverTravels.client.js';

type Call = { method: 'GET' | 'PUT'; url: string; options: Record<string, unknown> | undefined };

function response(status: number, body: string): APIResponse {
  return {
    status: () => status,
    ok: () => status >= 200 && status < 300,
    text: async () => body
  } as unknown as APIResponse;
}

function mockApi(reply: APIResponse): { api: APIRequestContext; calls: Call[] } {
  const calls: Call[] = [];
  const api = {
    put: async (url: string, options?: Record<string, unknown>) => {
      calls.push({ method: 'PUT', url, options });
      return reply;
    },
    get: async (url: string, options?: Record<string, unknown>) => {
      calls.push({ method: 'GET', url, options });
      return reply;
    }
  } as unknown as APIRequestContext;
  return { api, calls };
}

const session = new DriverSession(10804, 'https://example.test/magiis-v0.2/', 'token-no-real');
const client = (api: APIRequestContext): DriverTravelsClient =>
  new DriverTravelsClient(api, session, 1521);

describe('DriverTravelsClient.cancelByDriver (contrato de la app driver v2)', () => {
  it('hace PUT carriers/{carrierId}/travels/{id}/cancel con el body exacto de la app', async () => {
    const { api, calls } = mockApi(response(200, ''));
    await client(api).cancelByDriver(71500);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'PUT');
    assert.equal(calls[0]?.url, 'carriers/1521/travels/71500/cancel');
    assert.deepEqual(calls[0]?.options, {
      data: {
        travelId: 71500,
        carrierUserId: 1521,
        reasonForCancellation: 'CANNOT_COVER',
        canceledBy: 'DRIVER'
      }
    });
  });

  it('falla rapido ante un no-2xx (no lo traga)', async () => {
    const { api } = mockApi(response(400, '{"errorCode":"ACTION_NOT_ALLOWED"}'));
    await assert.rejects(() => client(api).cancelByDriver(71500), /respondio 400/);
  });

  it('rechaza un travelId invalido sin llamar a la API', async () => {
    const { api, calls } = mockApi(response(200, ''));
    await assert.rejects(() => client(api).cancelByDriver(0), /travelId invalido/);
    assert.equal(calls.length, 0);
  });
});

describe('DriverTravelsClient.listProgrammed (URL y parametros de la app)', () => {
  it('hace GET paginated-driver con driverId, programmed=true y devuelve la pagina 2xx', async () => {
    const { api, calls } = mockApi(
      response(200, JSON.stringify({ page: { content: [{ travelId: 71500 }], totalElements: 1 } }))
    );
    const list = await client(api).listProgrammed({ driverId: 3727 });
    assert.equal(calls[0]?.method, 'GET');
    assert.equal(calls[0]?.url, 'carriers/1521/travels/paginated-driver');
    assert.deepEqual(calls[0]?.options, {
      params: { driverId: 3727, page: 1, size: 10, column: 'id', sort: 'DESC', programmed: true }
    });
    assert.equal(list.status, 200);
    assert.deepEqual(list.items, [{ travelId: 71500 }]);
  });

  it('un 500 NO lanza: devuelve el status y items null para que el spec lo asevere', async () => {
    const { api } = mockApi(response(500, '{"errorCode":"INTERNAL_ERROR"}'));
    const list = await client(api).listProgrammed({ driverId: 3727 });
    assert.equal(list.status, 500);
    assert.equal(list.items, null);
    assert.match(list.bodyExcerpt, /INTERNAL_ERROR/);
  });

  it('401/403 si lanzan (sesion rechazada, STOP)', async () => {
    const { api } = mockApi(response(401, ''));
    await assert.rejects(
      () => client(api).listProgrammed({ driverId: 3727 }),
      SessionRejectedError
    );
  });

  it('rechaza un driverId invalido sin llamar a la API', async () => {
    const { api, calls } = mockApi(response(200, '{}'));
    await assert.rejects(() => client(api).listProgrammed({ driverId: -1 }), /driverId invalido/);
    assert.equal(calls.length, 0);
  });
});
