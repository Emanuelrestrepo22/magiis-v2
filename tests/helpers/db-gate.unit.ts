import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OracleDb } from '../db/OracleDb.js';
import { OracleMissingError, requireOracle } from './db-gate.js';

describe('db-gate', () => {
  it('requireOracle: null lanza OracleMissingError con el nombre del spec', () => {
    assert.throws(
      () => requireOracle(null, 'FR S2'),
      (e: unknown) => e instanceof OracleMissingError && /FR S2/.test((e as Error).message)
    );
  });

  it('requireOracle: instancia valida se devuelve tal cual', () => {
    const db = {} as OracleDb;
    assert.equal(requireOracle(db, 'FR S2'), db);
  });
});
