// tests/config/runtime-gates.unit.ts
// Gates F5 por dominio con alias de lectura (fase 2, W0): solo el valor exacto `1` abre.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { F5_GATE_ALIASES, isGateOpen, type F5GateName } from './runtime.js';

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

describe('isGateOpen', () => {
  it('sin variables todos los gates estan cerrados', () => {
    for (const name of Object.keys(F5_GATE_ALIASES) as F5GateName[]) {
      assert.equal(isGateOpen(name, env({})), false, name);
    }
  });

  it('solo el valor exacto 1 abre (no true, 0, vacio ni espacios internos)', () => {
    for (const v of ['true', '0', '', 'yes', '11', ' 1 2']) {
      assert.equal(isGateOpen('F5_AUTO_FIRE', env({ F5_AUTO_FIRE: v })), false, JSON.stringify(v));
    }
    assert.equal(isGateOpen('F5_AUTO_FIRE', env({ F5_AUTO_FIRE: '1' })), true);
    assert.equal(isGateOpen('F5_AUTO_FIRE', env({ F5_AUTO_FIRE: ' 1 ' })), true);
  });

  it('alias de lectura: el gate historico FR abre el nuevo (confirmacion y liquidacion, no la automatica)', () => {
    assert.equal(isGateOpen('F5_CONFIRM_SURRENDER', env({ FR_CONFIRM_SURRENDER: '1' })), true);
    assert.equal(isGateOpen('F5_AUTO_ARM', env({ FR_TOGGLE_AUTO_SURRENDER: '1' })), false);
    assert.equal(isGateOpen('F5_AUTO_FIRE', env({ FR_TOGGLE_AUTO_SURRENDER: '1' })), false);
    assert.equal(isGateOpen('F5_CONFIRM_SETTLEMENT', env({ FR_CONFIRM_SETTLEMENT: '1' })), true);
  });

  it('los gates son independientes: abrir uno no abre otro sin alias comun', () => {
    const e = env({ F5_CONFIRM_SURRENDER: '1' });
    assert.equal(isGateOpen('F5_CONFIRM_SETTLEMENT', e), false);
    assert.equal(isGateOpen('F5_AUTO_ARM', e), false);
    assert.equal(isGateOpen('F5_AUTO_FIRE', env({ F5_AUTO_ARM: '1' })), false);
    assert.equal(isGateOpen('F5_APP_CLOSE', e), false);
  });

  it('gates sin alias: CIRCUIT_PREP_CREATE_TRIPS y F5_APP_CLOSE', () => {
    assert.equal(
      isGateOpen('CIRCUIT_PREP_CREATE_TRIPS', env({ CIRCUIT_PREP_CREATE_TRIPS: '1' })),
      true
    );
    assert.equal(isGateOpen('F5_APP_CLOSE', env({ F5_APP_CLOSE: '1' })), true);
    assert.equal(isGateOpen('F5_APP_CLOSE', env({ FR_CONFIRM_SURRENDER: '1' })), false);
  });
});
