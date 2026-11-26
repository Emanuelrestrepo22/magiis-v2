import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DriverStatus, FinalizeTravelPayload } from '../api/clients/driverTravels.client.js';
import { ApiDriverChannel, type DriverTravelsPort } from './ApiDriverChannel.js';
import { driverIdleVerdict, resolveDriverChannelKind } from './DriverChannel.js';

const FINALIZE: FinalizeTravelPayload = {
  finalKm: 19,
  tollPrice: 0,
  parking: 0,
  otherCost: 0,
  additionalStop: 0,
  waitTime: 0
};

/** Doble del cliente del chofer: registra el orden de las llamadas. */
function fakeDriverTravels(status: Partial<DriverStatus> = {}): {
  port: DriverTravelsPort;
  calls: string[];
} {
  const calls: string[] = [];
  const port: DriverTravelsPort = {
    getStatus: async (driverId) => {
      calls.push(`getStatus:${driverId}`);
      return { incomingTripId: null, currentTrip: null, ...status };
    },
    confirm: async (travelId, driverId) => {
      calls.push(`confirm:${travelId}:${driverId}`);
    },
    goingToDestination: async ({ travelId }) => {
      calls.push(`goingToDestination:${travelId}`);
    },
    arriveToDestination: async ({ travelId }) => {
      calls.push(`arriveToDestination:${travelId}`);
    },
    finalize: async ({ travelId, payload }) => {
      calls.push(`finalize:${travelId}:${payload.finalKm}`);
    }
  };
  return { port, calls };
}

describe('driverIdleVerdict (precondición: chofer libre antes de crear el viaje)', () => {
  it('libre: sin viaje en curso ni entrante', () => {
    assert.deepEqual(driverIdleVerdict({ incomingTripId: null, currentTrip: null }, null), {
      idle: true
    });
  });

  it('ocupado: con viaje en curso, aunque no tenga entrante', () => {
    const v = driverIdleVerdict({ incomingTripId: null, currentTrip: { id: 1 } }, null);
    assert.equal(v.idle, false);
  });

  it('libre: el entrante quedó apuntando a un viaje terminal (DONE/CANCELLED/CANCELED/LOST)', () => {
    for (const state of ['DONE', 'CANCELLED', 'canceled', 'LOST']) {
      assert.deepEqual(driverIdleVerdict({ incomingTripId: 71215, currentTrip: null }, state), {
        idle: true
      });
    }
  });

  it('ocupado: entrante en un estado no terminal', () => {
    const v = driverIdleVerdict(
      { incomingTripId: 71500, currentTrip: null },
      'WITH_DRIVER_ASSIGNED'
    );
    assert.equal(v.idle, false);
  });

  it('desconocido: el entrante no se pudo leer (se delega al assign)', () => {
    const v = driverIdleVerdict({ incomingTripId: 71215, currentTrip: null }, null);
    assert.equal(v.idle, 'unknown');
  });
});

describe('ApiDriverChannel', () => {
  it('completeTrip recorre confirm → goingToDestination → arriveToDestination → finalize, en orden', async () => {
    const { port, calls } = fakeDriverTravels();
    const closure = await new ApiDriverChannel(port, async () => 'DONE').completeTrip({
      travelId: 71600,
      driverId: 3727,
      finalize: FINALIZE
    });
    assert.deepEqual(calls, [
      'confirm:71600:3727',
      'goingToDestination:71600',
      'arriveToDestination:71600',
      'finalize:71600:19'
    ]);
    assert.equal(closure.channel, 'api');
    assert.deepEqual(closure.checkpoints, [
      'confirm',
      'goingToDestination',
      'arriveToDestination',
      'finalize'
    ]);
  });

  it('ensureIdle falla con BLOCKED si el chofer tiene un entrante abierto', async () => {
    const { port } = fakeDriverTravels({ incomingTripId: 71500 });
    const channel = new ApiDriverChannel(port, async () => 'SEARCHING_DRIVER');
    await assert.rejects(channel.ensureIdle(3727), /BLOCKED.*71500/);
  });

  it('ensureIdle no falla si el detalle del entrante no se puede leer (decide el backend)', async () => {
    const { port } = fakeDriverTravels({ incomingTripId: 71215 });
    const channel = new ApiDriverChannel(port, async () => {
      throw new Error('500');
    });
    await channel.ensureIdle(3727);
  });

  it('ensureIdle no lee el detalle cuando no hay viaje entrante', async () => {
    const { port } = fakeDriverTravels();
    let reads = 0;
    await new ApiDriverChannel(port, async () => {
      reads++;
      return 'DONE';
    }).ensureIdle(3727);
    assert.equal(reads, 0);
  });
});

describe('resolveDriverChannelKind (DRIVER_CHANNEL)', () => {
  it('default api; acepta api|app sin importar mayúsculas ni espacios', () => {
    assert.equal(resolveDriverChannelKind(undefined), 'api');
    assert.equal(resolveDriverChannelKind(''), 'api');
    assert.equal(resolveDriverChannelKind(' APP '), 'app');
  });

  it('rechaza valores desconocidos en vez de caer a la API', () => {
    assert.throws(() => resolveDriverChannelKind('appium'), /DRIVER_CHANNEL invalido/);
  });
});
