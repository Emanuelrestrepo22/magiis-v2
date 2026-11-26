/**
 * Carga de entorno para la capa móvil (Appium): configuración de dispositivo y credenciales.
 *
 * Decisión provisional G-04 (plan de migración Appium, §4 PL-04/PL-05 y §6 decisiones 3 y 4):
 *  1. La shell siempre gana: nunca se pisa una clave presente en el entorno al iniciar el proceso.
 *  2. El overlay de dispositivo (`MOBILE_ENV_OVERLAY`, ej. `.env.emulator-test` de V1) puede pisar
 *     valores que vinieron de `.env.<ENV>`, pero jamás valores de la shell.
 *  3. Solo los prefijos `ANDROID_` y `APPIUM_` se asignan a `process.env`; cualquier otra clave
 *     (incluida `ENV`, URLs, credenciales) se ignora, así el overlay no puede alterar el ambiente de V2.
 *  4. Las credenciales de V1 se leen por NOMBRE de clave desde un archivo externo
 *     (`MOBILE_CREDENTIALS_FILE`) y se devuelven sin escribirlas en `process.env`.
 *
 * Se usa `dotenv.parse` sobre el contenido del archivo; nunca `dotenv.config`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { EOL } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// tests/mobile/appium/config/ -> 4 niveles arriba es la raíz del repo.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Prefijos de claves que se pueden asignar a `process.env`. */
export const DEVICE_ENV_ALLOWED_PREFIXES = ['ANDROID_', 'APPIUM_'] as const;

/** Claves presentes en la shell al cargar este módulo (aprox. "al iniciar el proceso"). */
const INITIAL_SHELL_KEYS: ReadonlySet<string> = new Set(Object.keys(process.env));

export type LoadDeviceEnvOptions = {
  /** Entorno destino. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Claves consideradas "de la shell". Default: snapshot tomado al importar el módulo. */
  shellKeys?: ReadonlySet<string>;
  /** Archivo base (`.env.<ENV>`). Default: `ENV_FILE` o `.env.<ENV|test>` en la raíz del repo. */
  baseFile?: string;
  /** Archivo overlay de dispositivo. Default: `MOBILE_ENV_OVERLAY`. */
  overlayFile?: string;
};

export type LoadDeviceEnvResult = {
  /** Nombres (nunca valores) de las claves asignadas a `process.env`. */
  applied: string[];
  /** Nombres de las claves ignoradas por no estar en la allowlist. */
  ignored: string[];
};

function isAllowedKey(key: string): boolean {
  return DEVICE_ENV_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function resolveFile(file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, file);
}

function parseIfExists(file: string | undefined): Record<string, string> {
  if (!file) return {};
  const resolved = resolveFile(file);
  if (!existsSync(resolved)) return {};
  return dotenv.parse(readFileSync(resolved));
}

/**
 * Aplica la configuración de dispositivo a `env`. Explícita (sin efectos al importar módulos).
 * Archivos inexistentes no fallan: la validación de claves requeridas es de quien las lee.
 */
export function loadDeviceEnv(options: LoadDeviceEnvOptions = {}): LoadDeviceEnvResult {
  const env = options.env ?? process.env;
  const shellKeys = options.shellKeys ?? INITIAL_SHELL_KEYS;
  const baseFile = options.baseFile ?? env.ENV_FILE ?? `.env.${env.ENV ?? 'test'}`;
  const overlayFile = options.overlayFile ?? env.MOBILE_ENV_OVERLAY;

  const applied = new Set<string>();
  const ignored = new Set<string>();

  const merge = (values: Record<string, string>, allowOverrideOfFileValues: boolean): void => {
    for (const [key, value] of Object.entries(values)) {
      if (!isAllowedKey(key)) {
        ignored.add(key);
        continue;
      }
      if (shellKeys.has(key)) continue; // la shell siempre gana
      if (!allowOverrideOfFileValues && env[key] !== undefined) continue;
      env[key] = value;
      applied.add(key);
    }
  };

  merge(parseIfExists(baseFile), false);
  merge(parseIfExists(overlayFile), true);

  return { applied: [...applied], ignored: [...ignored] };
}

export type MobileCredentialsSource = 'v2' | 'v1' | 'custom';

export type ReadMobileCredentialsOptions = {
  emailKey: string;
  passwordKey: string;
  /** Claves alternativas (en orden) si `emailKey` no está definida. */
  emailFallbackKeys?: readonly string[];
  /** Claves alternativas (en orden) si `passwordKey` no está definida. */
  passwordFallbackKeys?: readonly string[];
  /** Archivo único (compatibilidad). Equivale a `files: [file]`. */
  file?: string;
  /** Archivos en orden de prioridad. Si ni `file` ni `files`: V2 propio y luego V1. */
  files?: readonly string[];
  /** Entorno donde buscar `MOBILE_V2_ENV_FILE`, `ENV_FILE`, `ENV` y `MOBILE_CREDENTIALS_FILE`. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
};

export type MobileCredentials = {
  email: string;
  password: string;
  /** Origen del par: archivo propio de V2, archivo de V1 o uno indicado explícitamente. */
  source: MobileCredentialsSource;
  /** Ruta del archivo del que salió el par (nunca valores). */
  file: string;
};

function pickFirst(values: Record<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined && value.trim() !== '') return value;
  }
  return null;
}

type Candidate = { path: string; source: MobileCredentialsSource };

function candidateFiles(
  options: ReadMobileCredentialsOptions,
  env: NodeJS.ProcessEnv
): Candidate[] {
  const explicit = options.files ?? (options.file ? [options.file] : undefined);
  const raw: Candidate[] = explicit
    ? explicit.map((f) => ({ path: resolveFile(f), source: 'custom' as const }))
    : [];
  if (!explicit) {
    const v2 = env.MOBILE_V2_ENV_FILE ?? env.ENV_FILE;
    raw.push({
      path: v2 ? resolveFile(v2) : path.resolve(process.cwd(), `.env.${env.ENV ?? 'test'}`),
      source: 'v2'
    });
    if (env.MOBILE_CREDENTIALS_FILE) {
      raw.push({ path: resolveFile(env.MOBILE_CREDENTIALS_FILE), source: 'v1' });
    }
  }
  const seen = new Set<string>();
  return raw.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)));
}

/**
 * Lee credenciales por NOMBRE de clave. Orden por defecto: (1) archivo propio de V2
 * (`MOBILE_V2_ENV_FILE`, si no `ENV_FILE`, si no `<cwd>/.env.<ENV|test>`), (2) archivo de V1
 * (`MOBILE_CREDENTIALS_FILE`). El PRIMER archivo que aporta email Y password gana; el par sale
 * siempre del mismo archivo (nunca se mezcla). Archivos inexistentes se omiten. No escribe en
 * `process.env`; los errores nombran archivos y claves, nunca valores.
 */
export function readMobileCredentials(options: ReadMobileCredentialsOptions): MobileCredentials {
  const env = options.env ?? process.env;
  const emailKeys = [options.emailKey, ...(options.emailFallbackKeys ?? [])];
  const passwordKeys = [options.passwordKey, ...(options.passwordFallbackKeys ?? [])];
  const notes: string[] = [];

  for (const candidate of candidateFiles(options, env)) {
    if (!existsSync(candidate.path)) {
      notes.push(`- ${candidate.path}: no existe`);
      continue;
    }
    const values = dotenv.parse(readFileSync(candidate.path));
    const email = pickFirst(values, emailKeys);
    const password = pickFirst(values, passwordKeys);
    if (email !== null && password !== null) {
      return { email, password, source: candidate.source, file: candidate.path };
    }
    const missing = [email === null ? 'email' : null, password === null ? 'password' : null]
      .filter(Boolean)
      .join(' y ');
    notes.push(`- ${candidate.path}: sin par completo (falta ${missing})`);
  }

  const hint =
    !options.file && !options.files && !env.MOBILE_CREDENTIALS_FILE
      ? ' MOBILE_CREDENTIALS_FILE no está definida (archivo de V1).'
      : '';
  throw new Error(
    [
      `No se resolvieron credenciales móviles.${hint}`,
      ...notes,
      `Claves de email buscadas: ${emailKeys.join(' | ')}`,
      `Claves de password buscadas: ${passwordKeys.join(' | ')}`
    ].join(EOL)
  );
}
