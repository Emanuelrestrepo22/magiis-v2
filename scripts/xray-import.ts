/**
 * Import de resultados a Xray Cloud (fase C).
 *
 * Portable (Node/tsx) del step de bash de .github/workflows/regression.yml:136-165
 * (que hoy no corre en ningun pipeline real — ver docs/architecture/CI-STRATEGY.md).
 *
 * 1. Lee evidence/<env>/xray-results.json (emitido por tests/utils/reporters/xray-reporter.ts).
 * 2. Autentica contra Xray Cloud (client_id/client_secret -> JWT).
 * 3. Importa el JSON tal cual contra /api/v2/import/execution.
 *
 * Env requeridas: XRAY_CLIENT_ID, XRAY_CLIENT_SECRET.
 * Env opcional:   XRAY_RESULTS_FILE (mismo nombre que usa el reporter; default segun ENV).
 *
 * Ejecutar: npm run xray:import
 */
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { getCurrentEnv, getEnvFile } from '../tests/config/runtime.js';

dotenv.config({ path: getEnvFile() });

const AUTH_URL = 'https://xray.cloud.getxray.app/api/v2/authenticate';
const IMPORT_URL = 'https://xray.cloud.getxray.app/api/v2/import/execution';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`❌ Falta ${name} en ${getEnvFile()}`);
    process.exit(1);
  }
  return value;
}

async function authenticate(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
  });
  const body = await res.text();
  console.log(`[xray-import] authenticate HTTP ${res.status}`);
  if (!res.ok) {
    console.error(body);
    process.exit(1);
  }
  // El JWT vuelve como string JSON entrecomillado: "eyJ...".
  return JSON.parse(body);
}

async function importExecution(token: string, payload: string): Promise<void> {
  const res = await fetch(IMPORT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: payload
  });
  const body = await res.text();
  console.log(`[xray-import] import/execution HTTP ${res.status}`);
  console.log(body);
  if (!res.ok) process.exit(1);

  try {
    const parsed = JSON.parse(body);
    const key = parsed.key ?? parsed.testExecIssue?.key ?? process.env.XRAY_EXECUTION_KEY;
    if (key) console.log(`✅ https://magiis.atlassian.net/browse/${key}`);
  } catch {
    // Respuesta no-JSON: ya se logueo cruda arriba, no hay key que derivar.
  }
}

async function main(): Promise<void> {
  const clientId = requireEnv('XRAY_CLIENT_ID');
  const clientSecret = requireEnv('XRAY_CLIENT_SECRET');

  const resultsFile =
    process.env.XRAY_RESULTS_FILE ?? `evidence/${getCurrentEnv()}/xray-results.json`;
  let payload: string;
  try {
    payload = readFileSync(resultsFile, 'utf-8');
  } catch (err) {
    console.error(`❌ No se pudo leer ${resultsFile}:`, err);
    process.exit(1);
    return;
  }

  const token = await authenticate(clientId, clientSecret);
  await importExecution(token, payload);
}

main().catch((err) => {
  console.error('[xray-import] error:', err);
  process.exit(1);
});
