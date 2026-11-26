// tests/helpers/f5-layers.ts
// Capas de verificación de los specs F5 (rendición): ui · api · db. Decisión del QA lead (06/11): en UAT
// solo UI + API (sin DB). TEST conserva las tres. `F5_VERIFY_LAYERS=ui,api[,db]` lo fija explícito; sin él
// el default sale de ENV (test → ui,api,db; uat/prod → ui,api). En UAT pedir `db` lanza: la decisión no
// se revierte por accidente. Lo que la capa DB no puede juzgar se reporta «N/A» con la anotación `ac-na`
// (el xray-reporter solo lee `ac`: un N/A NUNCA cuenta como PASS).
import type { TestInfo } from '@playwright/test';

export const F5_LAYERS = ['ui', 'api', 'db'] as const;
export type F5Layer = (typeof F5_LAYERS)[number];

export const F5_LAYERS_ENV = 'F5_VERIFY_LAYERS';
/** Anotación de «no aplica»: distinta de `ac` para que el reporter no la lea como PASS/FAIL. */
export const F5_NA_ANNOTATION = 'ac-na';
export const DB_NA_UAT = 'N/A en UAT (decisión: solo UI+API)';
export const DB_NA_OFF = 'N/A (F5_VERIFY_LAYERS sin la capa db)';

const envName = (env: NodeJS.ProcessEnv): string => env.ENV?.trim() || 'test';

export function defaultF5Layers(env: NodeJS.ProcessEnv = process.env): readonly F5Layer[] {
  return envName(env) === 'test' ? ['ui', 'api', 'db'] : ['ui', 'api'];
}

/** Capas activas. Valor inválido, vacío o sin `ui`/`api`, o `db` en UAT, lanza (nunca se degrada en silencio). */
export function resolveF5Layers(env: NodeJS.ProcessEnv = process.env): ReadonlySet<F5Layer> {
  const raw = env[F5_LAYERS_ENV]?.trim();
  if (!raw) return new Set(defaultF5Layers(env));
  const out = new Set<F5Layer>();
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase();
    if (!(F5_LAYERS as readonly string[]).includes(name)) {
      throw new Error(
        `${F5_LAYERS_ENV}="${raw}" inválido: "${part.trim()}" (válidas: ${F5_LAYERS.join(', ')})`
      );
    }
    out.add(name as F5Layer);
  }
  if (!out.has('ui') && !out.has('api')) {
    throw new Error(`${F5_LAYERS_ENV}="${raw}" inválido: debe incluir ui o api`);
  }
  if (envName(env) === 'uat' && out.has('db')) {
    throw new Error(`${F5_LAYERS_ENV}="${raw}" inválido en UAT: ${DB_NA_UAT}`);
  }
  return out;
}

export function f5LayerEnabled(layer: F5Layer, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveF5Layers(env).has(layer);
}

export function dbNaReason(env: NodeJS.ProcessEnv = process.env): string {
  return envName(env) === 'uat' ? DB_NA_UAT : DB_NA_OFF;
}

/** Registra un paso/AC de DB como «N/A» (anotación + línea en el log). Nunca suma PASS. */
export function f5DbNotApplicable(
  testInfo: TestInfo,
  what: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  testInfo.annotations.push({ type: F5_NA_ANNOTATION, description: `${what}: ${dbNaReason(env)}` });
}
