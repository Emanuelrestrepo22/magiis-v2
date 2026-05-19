// tests/utils/envSchema.ts
// Validacion temprana del .env usando zod.
// Se invoca al arranque (playwright.config.ts) y como script (npm run validate:env).
// Si una variable falta o tiene formato incorrecto, falla con mensaje claro ANTES de cualquier spec.
import { z } from 'zod';
import dotenv from 'dotenv';
import { getEnvFile, SUPPORTED_ENVS } from '../config/runtime.js';

const envSchema = z.object({
  ENV: z.enum(SUPPORTED_ENVS),
  BASE_URL: z.string().url('BASE_URL debe ser una URL valida (http/https)'),
  // LOGIN_PATH y DASHBOARD_URL_PATTERN son opcionales: runtime.ts aplica defaults
  // (/carrier/#/auth/login y /carrier/#/dashboard) si no estan configurados.
  // Esto permite que CI usuarios solo seteen BASE_URL + credenciales.
  LOGIN_PATH: z.string().min(1).optional(),
  DASHBOARD_URL_PATTERN: z.string().min(1).optional(),
  USER_CARRIER: z.string().email('USER_CARRIER debe ser un email valido'),
  PASS_CARRIER: z.string().min(1, 'PASS_CARRIER no puede estar vacio'),

  // Opcionales
  USER_CARRIER_AR: z.string().email().optional(),
  PASS_CARRIER_AR: z.string().min(1).optional(),
  USER_CARRIER_US: z.string().email().optional(),
  PASS_CARRIER_US: z.string().min(1).optional(),
  USER_CARRIER_MX: z.string().email().optional(),
  PASS_CARRIER_MX: z.string().min(1).optional(),

  HEADLESS: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  WORKERS: z.coerce.number().int().positive().optional(),
  RETRIES: z.coerce.number().int().min(0).optional(),

  BASE_URL_V1: z.string().url().optional(),
  LOGIN_PATH_V1: z.string().optional(),
  ENABLE_V1_PARITY_TESTS: z
    .string()
    .optional()
    .transform((v) => v?.toLowerCase() === 'true'),

  FAKER_SEED: z.coerce.number().int().optional()
});

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Valida el .env activo y devuelve el objeto tipado.
 * Llamar desde playwright.config.ts y desde scripts (npm run validate:env).
 */
export function validateEnv(): ValidatedEnv {
  const envFile = getEnvFile();
  dotenv.config({ path: envFile });

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(`\n[envSchema] Validacion fallida en ${envFile}:\n${issues}\n`);
  }
  return result.data;
}

// Modo script: tsx tests/utils/envSchema.ts
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  try {
    const env = validateEnv();
    console.log(`✓ ${getEnvFile()} valido`);
    console.log(`  ENV=${env.ENV}`);
    console.log(`  BASE_URL=${env.BASE_URL}`);
    console.log(`  LOGIN_PATH=${env.LOGIN_PATH}`);
    process.exit(0);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
