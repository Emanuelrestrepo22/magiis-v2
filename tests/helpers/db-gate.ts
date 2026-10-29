// tests/helpers/db-gate.ts
// Gate de infraestructura: gate cerrado = skip (intencional), infra ausente = fail (accidental).
// Se llama como PRIMERA linea del test, antes de cualquier escritura (crear/confirmar viajes).
import type { OracleDb } from '../db/OracleDb.js';

export class OracleMissingError extends Error {
  constructor(label: string) {
    super(
      `ORACLE_*_TEST ausentes: ${label} valida contra DB; no se crea/confirma nada. ` +
        'Configurar .env.test (ORACLE_USER_TEST, …)'
    );
    this.name = 'OracleMissingError';
  }
}

/** Devuelve la misma instancia o lanza OracleMissingError (error de configuracion, no de negocio). */
export function requireOracle(db: OracleDb | null | undefined, label: string): OracleDb {
  if (db === null || db === undefined) throw new OracleMissingError(label);
  return db;
}
