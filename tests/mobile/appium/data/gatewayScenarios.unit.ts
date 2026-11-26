// Unit de los escenarios de pasarela PAX (datos puros).
// Run: npx tsx --test tests/mobile/appium/data/gatewayScenarios.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY_NO3DS_DEFAULT_LAST4,
  GATEWAY_SCENARIOS,
  gatewayScenariosFor,
  parseGatewayCardLast4
} from './gatewayScenarios.js';

test('ids únicos y motivo obligatorio en los inactivos', () => {
  const ids = GATEWAY_SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of GATEWAY_SCENARIOS) {
    if (!s.active) assert.ok(s.inactiveReason && s.inactiveReason.length > 10, s.id);
  }
});

test('gatewayScenariosFor filtra por modo y hay un escenario activo por modo', () => {
  for (const mode of ['personal', 'company'] as const) {
    const list = gatewayScenariosFor(mode);
    assert.ok(list.every((s) => s.mode === mode));
    assert.equal(list.filter((s) => s.active).length, 1);
  }
});

test('parseGatewayCardLast4: default, últimos 4 y valor inválido', () => {
  assert.equal(parseGatewayCardLast4(undefined), GATEWAY_NO3DS_DEFAULT_LAST4);
  assert.equal(parseGatewayCardLast4('  '), GATEWAY_NO3DS_DEFAULT_LAST4);
  assert.equal(parseGatewayCardLast4('4000 0566 5566 5556'), '5556');
  assert.equal(parseGatewayCardLast4('1234'), '1234');
  assert.equal(parseGatewayCardLast4('12'), null);
  assert.equal(parseGatewayCardLast4('abc'), null);
});
