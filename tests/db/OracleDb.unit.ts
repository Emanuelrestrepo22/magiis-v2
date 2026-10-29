import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertReadOnlySql, oracleConfigFromEnv } from './OracleDb.js';

describe('assertReadOnlySql', () => {
  it('acepta SELECT, WITH, comentarios y un ; final', () => {
    assert.doesNotThrow(() => assertReadOnlySql('SELECT 1 FROM dual'));
    assert.doesNotThrow(() => assertReadOnlySql('  select a from t where x = :id;  '));
    assert.doesNotThrow(() =>
      assertReadOnlySql('-- nota\nWITH x AS (SELECT 1 n FROM dual) SELECT n FROM x')
    );
    assert.doesNotThrow(() => assertReadOnlySql('/*+ hint */ SELECT 1 FROM dual'));
  });

  it('acepta columnas que contienen palabras de escritura y literales con ;', () => {
    assert.doesNotThrow(() =>
      assertReadOnlySql('SELECT LAST_UPDATE_DATE, CREATIONDATE FROM travelssurrender')
    );
    assert.doesNotThrow(() => assertReadOnlySql("SELECT 'a;b DELETE' AS x FROM dual"));
  });

  it('rechaza lo que no sea SELECT/WITH', () => {
    for (const sql of [
      'DELETE FROM travel',
      'update travel set state = 1',
      'INSERT INTO t VALUES (1)',
      'MERGE INTO t USING s ON (1=1)',
      'BEGIN NULL; END;',
      'drop table t',
      ''
    ]) {
      assert.throws(() => assertReadOnlySql(sql), /SOLO LECTURA/, sql);
    }
  });

  it('rechaza sentencias encadenadas y escritura camuflada', () => {
    assert.throws(() => assertReadOnlySql('SELECT 1 FROM dual; DELETE FROM travel'), /encadenadas/);
    assert.throws(() => assertReadOnlySql('SELECT 1 FROM dual; SELECT 2 FROM dual'), /encadenadas/);
    assert.throws(() => assertReadOnlySql('SELECT * FROM travel FOR UPDATE'), /no permitida/);
    assert.throws(
      () => assertReadOnlySql('WITH x AS (SELECT 1 FROM dual) DELETE FROM t'),
      /no permitida/
    );
  });
});

describe('oracleConfigFromEnv', () => {
  const full = {
    ORACLE_USER_TEST: 'u',
    ORACLE_PASSWORD_TEST: 'p',
    ORACLE_HOST_TEST: 'h',
    ORACLE_PORT_TEST: '1521',
    ORACLE_SERVICE_TEST: 's'
  } as NodeJS.ProcessEnv;

  it('resuelve el sufijo por ambiente y arma el connect string', () => {
    assert.deepEqual(oracleConfigFromEnv('test', full), {
      user: 'u',
      password: 'p',
      connectString: 'h:1521/s'
    });
  });

  it('devuelve null si falta algo o si el ambiente no tiene credenciales propias', () => {
    assert.equal(oracleConfigFromEnv('uat', full), null);
    assert.equal(oracleConfigFromEnv('prod', full), null);
    assert.equal(oracleConfigFromEnv('test', { ...full, ORACLE_PASSWORD_TEST: '' }), null);
    assert.equal(
      oracleConfigFromEnv('test', { ORACLE_USER_TEST: 'u', ORACLE_PASSWORD_TEST: 'p' }),
      null
    );
  });
});
