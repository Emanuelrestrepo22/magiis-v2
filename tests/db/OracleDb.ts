// tests/db/OracleDb.ts
// Adaptador Oracle minimo y SOLO LECTURA (pata DB de la trifuerza UI · API · DB).
// Patron copiado de magiis-api-e2e (tests/components/db/OracleDb.ts): oracledb en modo THIN (JS puro,
// sin Instant Client), import dinamico para no impactar la coleccion si no hay driver/credenciales,
// mismos nombres de variables ORACLE_* con sufijo por ambiente.
//
// Env (gitignored, nunca con valores en .env.example):
//   ENV=test → ORACLE_USER_TEST, ORACLE_PASSWORD_TEST y ORACLE_CONNECT_STRING_TEST
//              (o ORACLE_HOST_TEST + ORACLE_PORT_TEST + ORACLE_SERVICE_TEST)
//   ENV=uat  → las mismas sin sufijo.   ENV=prod → sufijo _PROD (no se declaran a proposito).
//
// Contrato: metodos publicos fail-fast con mensaje accionable; `query` rechaza todo lo que no sea
// una unica sentencia SELECT/WITH (ver `assertReadOnlySql`).
import { getCurrentEnv, type AppEnv } from '../config/runtime.js';

export type OracleReadConfig = { user: string; password: string; connectString: string };

/** Binds posicionales o nombrados. */
export type QueryBinds = Record<string, unknown> | unknown[];

const ENV_SUFFIX: Record<AppEnv, string> = { uat: '', test: '_TEST', prod: '_PROD' };

/**
 * Config Oracle del ambiente, o null si falta algo (→ el fixture `db` entrega null y los specs
 * deben declarar el skip: un skip por credenciales ausentes se ve verde sin haber verificado nada).
 */
export function oracleConfigFromEnv(
  env: AppEnv = getCurrentEnv(),
  source: NodeJS.ProcessEnv = process.env
): OracleReadConfig | null {
  const suffix = ENV_SUFFIX[env];
  const read = (key: string): string | undefined => source[`${key}${suffix}`]?.trim() || undefined;
  const user = read('ORACLE_USER');
  const password = read('ORACLE_PASSWORD');
  if (!user || !password) return null;
  const host = read('ORACLE_HOST');
  const port = read('ORACLE_PORT');
  const service = read('ORACLE_SERVICE');
  const connectString =
    read('ORACLE_CONNECT_STRING') ??
    (host && port && service ? `${host}:${port}/${service}` : undefined);
  return connectString ? { user, password, connectString } : null;
}

/** Quita comentarios y el contenido de literales ('...') para inspeccionar solo la estructura. */
function stripCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

const FORBIDDEN =
  /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|execute|exec|call|begin|declare|commit|rollback|lock|rename)\b|\bfor\s+update\b/i;

/**
 * Guard SELECT-only. Acepta una unica sentencia que empiece con SELECT o WITH (tras comentarios y
 * espacios) y un `;` final opcional. Rechaza sentencias encadenadas y cualquier palabra de escritura/DDL
 * fuera de literales. Es defensa en profundidad: la barrera real es el usuario Oracle de solo lectura.
 */
export function assertReadOnlySql(sql: string): void {
  const structure = stripCommentsAndLiterals(sql).trim().replace(/;\s*$/, '');
  const preview = sql.trim().slice(0, 60);
  if (!/^(select|with)\b/i.test(structure)) {
    throw new Error(`OracleDb es SOLO LECTURA: solo se permite SELECT/WITH. Recibido: ${preview}…`);
  }
  if (structure.includes(';')) {
    throw new Error(`OracleDb rechaza sentencias encadenadas (';'). Recibido: ${preview}…`);
  }
  const forbidden = FORBIDDEN.exec(structure);
  if (forbidden) {
    throw new Error(
      `OracleDb es SOLO LECTURA: palabra no permitida "${forbidden[0]}". Recibido: ${preview}…`
    );
  }
}

/** Superficie minima de oracledb que usamos (el paquete no se tipa aqui: import dinamico). */
type OracleDriver = {
  OUT_FORMAT_OBJECT: number;
  getConnection(config: OracleReadConfig): Promise<{
    callTimeout?: number;
    execute(
      sql: string,
      binds: QueryBinds,
      options: { outFormat: number; maxRows?: number }
    ): Promise<{ rows?: unknown[] }>;
    close(): Promise<void>;
  }>;
};

const DEFAULT_MAX_ROWS = 5000;
const CALL_TIMEOUT_MS = 30_000;

export class OracleDb {
  private readonly config: OracleReadConfig;

  /** @throws si no se pasa config y el env no tiene las variables minimas. */
  constructor(config?: OracleReadConfig | null) {
    const resolved = config ?? oracleConfigFromEnv();
    if (!resolved) {
      throw new Error(
        'OracleDb: falta configuracion de conexion. Defini ORACLE_USER/ORACLE_PASSWORD y ' +
          'ORACLE_CONNECT_STRING (o HOST+PORT+SERVICE) con el sufijo del ambiente (_TEST en ENV=test). ' +
          'Ver .env.example (bloque ORACLE).'
      );
    }
    this.config = resolved;
  }

  /** SELECT con binds; abre y cierra la conexion en cada llamada. Filas como objetos (columnas en MAYUSCULA). */
  async query<T = Record<string, unknown>>(
    sql: string,
    binds: QueryBinds = {},
    maxRows = DEFAULT_MAX_ROWS
  ): Promise<T[]> {
    assertReadOnlySql(sql);
    const driverName = 'oracledb';
    let driver: OracleDriver;
    try {
      driver = ((await import(driverName)) as { default: OracleDriver }).default;
    } catch {
      throw new Error('OracleDb: falta el paquete `oracledb`; ejecutar `npm install`.');
    }
    const connection = await driver.getConnection(this.config);
    try {
      connection.callTimeout = CALL_TIMEOUT_MS;
      const result = await connection.execute(sql, binds, {
        outFormat: driver.OUT_FORMAT_OBJECT,
        maxRows
      });
      return (result.rows ?? []) as T[];
    } catch (error) {
      // No se adjuntan los binds (pueden ser datos de negocio); el SQL no lleva credenciales.
      throw new Error(`OracleDb.query fallo: ${(error as Error).message}\nSQL: ${sql.trim()}`);
    } finally {
      await connection.close().catch(() => undefined);
    }
  }
}

/** `OracleDb` o null si el ambiente no tiene credenciales (el llamador declara el skip). */
export function tryCreateOracleDb(): OracleDb | null {
  const config = oracleConfigFromEnv();
  return config ? new OracleDb(config) : null;
}
