// tests/utils/env.ts
// Utilidades de logging y debug para identificar contexto de ejecucion.
import { getCurrentEnv } from '../config/runtime.js';

export function logEnvBanner(): void {
  const env = getCurrentEnv();
  console.log(`
================================
 magiis-carrier-v2-e2e
 ENV  : ${env}
 NODE : ${process.version}
 CI   : ${process.env.CI ? 'yes' : 'no'}
================================
`);
}
