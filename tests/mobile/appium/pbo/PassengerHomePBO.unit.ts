// Unit de PassengerHomePBO con deps fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/pbo/PassengerHomePBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HomeMode } from '../screens/passenger/HomeModeScreen.js';
import {
  PassengerHomePBO,
  ProfileModeSwitchError,
  ProfileModeUnavailableError
} from './PassengerHomePBO.js';

type World = {
  /** Lecturas sucesivas del modo; la última se repite. */
  modes: HomeMode[];
  visible: boolean;
  disabled: boolean;
  /** Al tocar el interruptor el modo pasa a este valor (null = la etiqueta no cambia). */
  afterTap: HomeMode | null;
  tapFound: boolean;
};

function build(over: Partial<World> = {}) {
  const w: World = {
    modes: ['personal'],
    visible: true,
    disabled: false,
    afterTap: 'company',
    tapFound: true,
    ...over
  };
  const calls: string[] = [];
  let reads = 0;
  let tapped = false;
  const pbo = new PassengerHomePBO(
    {
      home: {
        readMode: async () => {
          if (tapped && w.afterTap) return w.afterTap;
          return w.modes[Math.min(reads++, w.modes.length - 1)]!;
        },
        isToggleVisible: async () => w.visible,
        isToggleDisabled: async () => w.disabled,
        tapToggle: async () => {
          calls.push('tap');
          tapped = w.tapFound;
          return w.tapFound;
        }
      }
    },
    () => undefined,
    { pollIntervalMs: 1 }
  );
  return { pbo, calls };
}

test('ya está en el modo pedido: no toca el interruptor', async () => {
  const { pbo, calls } = build({ modes: ['company'] });
  assert.deepEqual(await pbo.ensureProfileMode('company'), {
    changed: false,
    from: 'company',
    to: 'company'
  });
  assert.deepEqual(calls, []);
});

test('la etiqueta renderiza tarde: sondea (none, none, company) y no hace toggle', async () => {
  const { pbo, calls } = build({ modes: ['none', 'none', 'company'] });
  const out = await pbo.ensureProfileMode('company');
  assert.equal(out.changed, false);
  assert.deepEqual(calls, []);
});

test('cambia de personal a company: toca una vez y devuelve from/to', async () => {
  const { pbo, calls } = build({ modes: ['personal'], afterTap: 'company' });
  assert.deepEqual(await pbo.ensureProfileMode('company'), {
    changed: true,
    from: 'personal',
    to: 'company'
  });
  assert.deepEqual(calls, ['tap']);
});

test('cambia de company a personal', async () => {
  const { pbo } = build({ modes: ['company'], afterTap: 'personal' });
  assert.deepEqual(await pbo.ensureProfileMode('personal'), {
    changed: true,
    from: 'company',
    to: 'personal'
  });
});

test('interruptor oculto (personalModeDisabled) -> ProfileModeUnavailableError toggle-hidden', async () => {
  const { pbo, calls } = build({ visible: false });
  await assert.rejects(
    () => pbo.ensureProfileMode('company'),
    (e: unknown) =>
      e instanceof ProfileModeUnavailableError &&
      e.reason === 'toggle-hidden' &&
      e.wanted === 'company'
  );
  assert.deepEqual(calls, []);
});

test('interruptor deshabilitado (sin perfil corporativo) -> toggle-disabled, sin tocar', async () => {
  const { pbo, calls } = build({ disabled: true });
  await assert.rejects(
    () => pbo.ensureProfileMode('company'),
    (e: unknown) => e instanceof ProfileModeUnavailableError && e.reason === 'toggle-disabled'
  );
  assert.deepEqual(calls, []);
});

test('la etiqueta nunca cambia tras tocar -> ProfileModeSwitchError', async () => {
  const { pbo, calls } = build({ afterTap: null });
  await assert.rejects(
    () => pbo.ensureProfileMode('company', { timeoutMs: 50 }),
    ProfileModeSwitchError
  );
  assert.deepEqual(calls, ['tap']);
});

test('interruptor no encontrado al tocar -> ProfileModeSwitchError', async () => {
  const { pbo } = build({ tapFound: false });
  await assert.rejects(() => pbo.ensureProfileMode('company'), ProfileModeSwitchError);
});

test('modo ilegible (none) con interruptor visible -> ProfileModeSwitchError, sin tocar', async () => {
  const { pbo, calls } = build({ modes: ['none'] });
  await assert.rejects(
    () => pbo.ensureProfileMode('company', { timeoutMs: 20 }),
    ProfileModeSwitchError
  );
  assert.deepEqual(calls, []);
});
