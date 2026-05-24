/**
 * Utilidades compartidas entre scaffold/page.ts y scaffold/spec.ts.
 * Parsing de args estilo `--key value` o `--key=value`, sin dependencias externas.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ScaffoldArgs = Record<string, string | boolean>;

export function parseArgs(argv: string[]): ScaffoldArgs {
  const out: ScaffoldArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const stripped = tok.slice(2);
    const eq = stripped.indexOf('=');
    if (eq >= 0) {
      out[stripped.slice(0, eq)] = stripped.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[stripped] = next;
        i++;
      } else {
        out[stripped] = true;
      }
    }
  }
  return out;
}

export function requireArg(args: ScaffoldArgs, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Missing required --${key}. Ejemplo: --${key} "valor"`);
  }
  return v;
}

export function optionalArg(args: ScaffoldArgs, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

export function toPascalCase(input: string): string {
  return input
    .replace(/[-_\s]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

export function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function escapeRegexLiteral(input: string): string {
  // Incluye `/` para que sea seguro embeber dentro de un regex literal `/.../`.
  return input.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function writeFileSafe(
  path: string,
  content: string,
  opts: { force: boolean; dry: boolean }
): void {
  if (existsSync(path) && !opts.force) {
    throw new Error(`Ya existe ${path}. Usa --force para sobreescribir o cambia --name.`);
  }
  if (opts.dry) {
    console.log(`\n--- DRY RUN: ${path} ---\n${content}\n--- end ---`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`[scaffold] escrito ${path}`);
}

export function repoRoot(): string {
  // scripts/scaffold/shared.ts -> ../../
  return resolve(import.meta.dirname ?? '.', '..', '..');
}
