import assert from 'node:assert/strict';
import { it } from 'node:test';
import { defaultF5Layers, f5LayerEnabled, resolveF5Layers } from './f5-layers.js';

const L = (env: Record<string, string>): string[] =>
  [...resolveF5Layers(env as NodeJS.ProcessEnv)].sort();

it('default TEST = ui,api,db; sin ENV cae en test', () => {
  assert.deepEqual(L({ ENV: 'test' }), ['api', 'db', 'ui']);
  assert.deepEqual(L({}), ['api', 'db', 'ui']);
});
it('default UAT y PROD = ui,api', () => {
  assert.deepEqual(L({ ENV: 'uat' }), ['api', 'ui']);
  assert.deepEqual([...defaultF5Layers({ ENV: 'prod' })], ['ui', 'api']);
});
it('explícito: TEST puede quitar db; espacios y mayúsculas toleradas', () => {
  assert.deepEqual(L({ ENV: 'test', F5_VERIFY_LAYERS: ' UI , api ' }), ['api', 'ui']);
  assert.equal(
    f5LayerEnabled('db', { ENV: 'test', F5_VERIFY_LAYERS: 'ui,api' } as NodeJS.ProcessEnv),
    false
  );
});
it('UAT con db explícito lanza', () => {
  assert.throws(() => L({ ENV: 'uat', F5_VERIFY_LAYERS: 'ui,api,db' }), /UAT/);
});
it('valor desconocido o sin ui/api lanza', () => {
  assert.throws(() => L({ ENV: 'test', F5_VERIFY_LAYERS: 'ui,sql' }), /inválido/);
  assert.throws(() => L({ ENV: 'test', F5_VERIFY_LAYERS: 'db' }), /ui o api/);
});
