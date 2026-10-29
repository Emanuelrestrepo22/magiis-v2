import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assumedFacts, FR_FACTS } from './fr-facts.js';

describe('fr-facts', () => {
  it('assumedFacts: lista visible y cubre los hechos pendientes', () => {
    const list = assumedFacts();
    console.log(`[fr-facts] assumed (${list.length}): ${list.join(', ')}`);
    for (const p of [
      'bookCodes.driverCc',
      'balanceSign.driver',
      'balanceSign.owner',
      'commissionBase',
      'readOnlyBadge'
    ])
      assert.ok(list.includes(p), p);
  });

  it('todo hecho tiene status valido y evidence no vacia', () => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return;
      const n = node as Record<string, unknown>;
      if (typeof n.status === 'string' && 'evidence' in n) {
        assert.ok(['confirmed', 'assumed'].includes(n.status), path);
        assert.ok(String(n.evidence).trim().length > 0, `${path}: evidence vacia`);
        return;
      }
      for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
    };
    walk(FR_FACTS, 'FR_FACTS');
  });
});
