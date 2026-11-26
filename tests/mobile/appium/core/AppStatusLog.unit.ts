// Unit del oráculo de estado por log de arranque (sin Appium ni dispositivo).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MobileSession } from './MobileSession.js';
import { parseDriverStatusLines, readBackendDriverStatus, toAvailability } from './AppStatusLog.js';

const LINE = (status: string) =>
  `11-24 15:56:46.943  7670  7670 I chromium: [INFO:CONSOLE:1391] "El Driver Status es:  ${status}", source: https://localhost/x.js (1391)`;

describe('parseDriverStatusLines', () => {
  it('toma el PRIMER estado registrado', () => {
    assert.equal(parseDriverStatusLines(['otra cosa', LINE('OFFLINE'), LINE('ONLINE')]), 'OFFLINE');
  });

  it('sin línea de estado devuelve null', () => {
    assert.equal(
      parseDriverStatusLines(['Driver availability ONLINE', 'refreshStatusButton checked: true']),
      null
    );
  });

  it('acepta otros estados del backend', () => {
    assert.equal(parseDriverStatusLines([LINE('IN_TRAVEL')]), 'IN_TRAVEL');
  });
});

describe('toAvailability', () => {
  it('mapea ONLINE/OFFLINE y deja null el resto', () => {
    assert.equal(toAvailability('ONLINE'), 'available');
    assert.equal(toAvailability('OFFLINE'), 'notAvailable');
    assert.equal(toAvailability('IN_TRAVEL'), null);
  });
});

/** Sesión falsa: logcat programable por lectura; registra recargas y cambios de contexto. */
function fakeSession(batches: string[][]): { session: MobileSession; calls: string[] } {
  const calls: string[] = [];
  let read = 0;
  const driver = {
    getLogs: async () => (batches[read++] ?? []).map((message) => ({ message })),
    execute: async () => void calls.push('reload')
  };
  const session = {
    driver,
    switchContext: async (c: string) => void calls.push(`ctx:${c}`),
    reattachWebview: async () => 'WEBVIEW_x'
  } as unknown as MobileSession;
  return { session, calls };
}

describe('readBackendDriverStatus', () => {
  it('descarta el log previo y devuelve el primer estado tras recargar', async () => {
    const { session, calls } = fakeSession([[LINE('ONLINE')], [], [LINE('OFFLINE')]]);
    const status = await readBackendDriverStatus(session, { timeoutMs: 1_000, intervalMs: 1 });
    assert.equal(status, 'OFFLINE', 'la línea ONLINE previa a la recarga no cuenta');
    assert.ok(calls.includes('reload'));
  });

  it('vence con error explícito si la app no registra el estado', async () => {
    const { session } = fakeSession([]);
    await assert.rejects(
      readBackendDriverStatus(session, { timeoutMs: 20, intervalMs: 1 }),
      /no registró «El Driver Status es»/
    );
  });
});
