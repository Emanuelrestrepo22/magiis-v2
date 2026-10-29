// tests/helpers/pom-no-business-asserts.unit.ts
// Guarda: las reglas de negocio se aseveran SOLO en specs. Los POM (tests/pages/**), los steps
// (tests/steps/**) y los helpers no unitarios (tests/helpers/**) pueden usar
// `expect` unicamente para guardas TECNICAS (UI lista/visible, valor tipeado = valor leido, URL,
// conteo de filas/elementos de UI, estado de un control). Cualquier otro matcher (toBe, toEqual,
// toBeCloseTo, ...) o `expect.soft` falla este test salvo excepcion explicita y justificada abajo.
// Los helpers/steps devuelven datos o veredictos (`ok` + `mismatches`); el spec asevera.
// Unica exencion de archivo: tests/helpers/acceptance.ts (envoltorio de steps del lado del spec).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const TESTS_DIR = join(process.cwd(), 'tests');
const PAGES_DIR = join(TESTS_DIR, 'pages');
const STEPS_DIR = join(TESTS_DIR, 'steps');
const HELPERS_DIR = join(TESTS_DIR, 'helpers');

/** Archivos exentos del escaneo (ruta relativa a tests/), con su razon. */
export const EXEMPT_FILES: Readonly<Record<string, string>> = {
  'helpers/acceptance.ts':
    'envoltorio de steps del lado del spec (verifyAc): es parte del spec, no un helper puro'
};

/** Matchers tecnicos permitidos en cualquier POM (estado observable de la UI, no reglas de negocio). */
export const ALLOWED_MATCHERS: ReadonlySet<string> = new Set([
  'toBeVisible',
  'toBeHidden',
  'toBeEnabled',
  'toBeDisabled',
  'toHaveValue', // sanidad de entrada: el campo muestra lo tipeado antes de confirmar
  'toHaveURL',
  'toHaveCount', // filas/elementos de UI presentes o ausentes (readiness, anti-vacuidad)
  'toHaveText', // etiqueta de control tras seleccionar (typeahead, combo, idioma)
  'toContainText',
  'toBeChecked', // estado de un switch/checkbox tras interactuar
  'toHaveAttribute' // aria-selected de pestanas, etc.
]);

/**
 * Excepciones tecnicas explicitas: `archivo::matcher` -> cantidad maxima. `expect.poll` se identifica
 * como `poll:<matcher>`. Cada una tiene su razon; ninguna juzga una regla de negocio.
 */
export const TECHNICAL_EXCEPTIONS: Readonly<Record<string, { max: number; reason: string }>> = {
  'carrier-v2/integrations/IntegrationsAppStorePage.ts::toBe': {
    max: 2,
    reason: 'HTTP ok (status 200) de GET carriers/{id}/preferences para poder continuar el flujo'
  },
  'carrier-v2/settings/BranchesListPage.ts::toBe': {
    max: 1,
    reason: 'HTTP ok de GET branches/paginated para poder leer la grilla'
  },
  'carrier-v2/settings/SettingsParametersPage.ts::toBe': {
    max: 1,
    reason: 'HTTP ok de GET parameters para poder leer la pantalla'
  },
  'carrier-v2/settlements/SettlementPage.ts::toBe': {
    max: 1,
    reason: 'HTTP ok (200) de GET pendientes para poder continuar el flujo'
  },
  'carrier-v2/owners/OwnerEditPage.ts::poll:toBe': {
    max: 1,
    reason: 'el toggle «Collects Cash» refleja el valor clickeado (estado del control)'
  },
  'carrier-v2/trips/NewTripPage.ts::poll:toBeGreaterThan': {
    max: 1,
    reason: 'agregar un destino suma una fila de UI (espera por estado observable)'
  },
  'carrier-v2/trips/NewTripPage.ts::toBeTruthy': {
    max: 1,
    reason:
      'sanidad de entrada: el origen resuelto es el pedido y no el autocompletado por el cliente'
  },
  'shared/FlatpickrCalendar.ts::toBeGreaterThanOrEqual': {
    max: 1,
    reason: 'el mes visible del calendario es reconocible (control de UI)'
  }
};

export type ExpectUse = {
  file: string;
  line: number;
  kind: string;
  matcher: string;
  /** Offset del `expect(` en el fuente. */
  index: number;
};

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts') && !name.endsWith('.unit.ts')) out.push(full);
  }
  return out;
}

/** Indice del `)` que cierra el `(` en `open`, saltando strings/template literals; -1 si no cierra. */
function closingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '`') {
      for (i++; i < src.length && src[i] !== '`'; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '$' && src[i + 1] === '{') {
          const end = closingBrace(src, i + 1);
          if (end < 0) return -1;
          i = end;
        }
      }
    } else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function closingBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Todos los `expect(`, `expect.soft(` y `expect.poll(` de codigo (ignora lineas de comentario). */
export function scanExpects(file: string, src: string): ExpectUse[] {
  const uses: ExpectUse[] = [];
  const re = /\bexpect(\.soft|\.poll)?\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineText = src.slice(lineStart, src.indexOf('\n', m.index));
    if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const kind = m[1] ? m[1].slice(1) : 'expect';
    const close = closingParen(src, m.index + m[0].length - 1);
    const rest = close < 0 ? '' : src.slice(close + 1, close + 200);
    const matcher = /^\s*\.(?:not\s*\.\s*)?(\w+)\s*\(/.exec(rest)?.[1] ?? '<sin-matcher>';
    uses.push({ file, line, kind, matcher, index: m.index });
  }
  return uses;
}

/** Usos que no son guardas tecnicas permitidas (ni excepciones explicitas dentro de su tope). */
export function violations(uses: readonly ExpectUse[]): ExpectUse[] {
  const counts = new Map<string, number>();
  const bad: ExpectUse[] = [];
  for (const u of uses) {
    if (u.kind === 'soft') {
      bad.push(u);
      continue;
    }
    if (u.kind === 'expect' && ALLOWED_MATCHERS.has(u.matcher)) continue;
    const key = `${u.file}::${u.kind === 'poll' ? 'poll:' : ''}${u.matcher}`;
    const exception = TECHNICAL_EXCEPTIONS[key];
    const used = (counts.get(key) ?? 0) + 1;
    counts.set(key, used);
    if (!exception || used > exception.max) bad.push(u);
  }
  return bad;
}

function scanDir(dir: string, base: string): ExpectUse[] {
  return listTs(dir)
    .map((full) => ({ id: relative(base, full).split(sep).join('/'), full }))
    .filter(({ id }) => !(id in EXEMPT_FILES))
    .flatMap(({ id, full }) => scanExpects(id, readFileSync(full, 'utf8')));
}

function report(bad: readonly ExpectUse[]): string[] {
  return bad.map((u) => `${u.file}:${u.line} ${u.kind}.${u.matcher}`);
}

const SPECS_DIR = join(TESTS_DIR, 'specs');

/**
 * Llamadas cuyo callback puede contener `expect` en un spec FR: `verifyAc` es el unico lugar de reglas de
 * negocio; las demas son guardas tecnicas (precondicion/gate) que no juzgan una regla de negocio.
 */
export const SPEC_ASSERT_SCOPES: Readonly<Record<string, string>> = {
  verifyAc: 'bloque de AC: aqui van las reglas de negocio',
  assertBeforeSubmit: 'guarda tecnica previa a un submit irreversible (datos listos, no regla)',
  gate: 'compuerta tecnica de ambiente/precondicion'
};

/** Rangos [inicio, fin) de los argumentos de cada llamada a un scope permitido. */
function scopeRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const names = Object.keys(SPEC_ASSERT_SCOPES).join('|');
  const re = new RegExp(String.raw`\b(?:${names})\s*\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(src, open);
    if (close > 0) ranges.push([open, close]);
  }
  return ranges;
}

/**
 * `expect` de specs FR fuera de un callback de `verifyAc` (o scope tecnico permitido). Heuristica
 * lexica: LIMITES — (1) no resuelve alias ni wrappers propios (un `expect` en un helper local invocado
 * desde verifyAc cuenta como fuera); (2) `expect(...).toBeVisible()` y demas matchers tecnicos de
 * ALLOWED_MATCHERS se toleran siempre fuera; (3) comentarios y strings se ignoran solo por linea de
 * comentario; (4) solo audita los archivos fr-circuit-* y reports/fr-*.
 */
export function expectsOutsideAcScope(file: string, src: string): ExpectUse[] {
  const ranges = scopeRanges(src);
  const all = scanExpects(file, src);
  return all.filter((u) => {
    if (u.kind === 'expect' && ALLOWED_MATCHERS.has(u.matcher)) return false;
    return !ranges.some(([a, b]) => u.index > a && u.index < b);
  });
}

/**
 * Excepciones por archivo: `expect` fuera de verifyAc que son PRECONDICIONES tecnicas (sesion del carrier
 * correcta, handoff presente, aislamiento del vehiculo, fila existente antes de leerla, `assertBeforeSubmit`
 * del alta). Tope por archivo: un expect nuevo fuera de verifyAc rompe el guard hasta justificarlo aqui.
 */
export const SPEC_TECHNICAL_EXCEPTIONS: Readonly<Record<string, { max: number; reason: string }>> =
  {
    'specs/trips/fr-circuit-s1.spec.ts': {
      max: 2,
      reason: 'assertBeforeSubmit del alta (origen!=destino, cotizacion>0)'
    },
    'specs/trips/fr-circuit-s2.spec.ts': {
      max: 2,
      reason: 'assertBeforeSubmit del alta (origen!=destino, cotizacion>0)'
    },
    'specs/trips/fr-circuit-s3-prepare.spec.ts': {
      max: 2,
      reason: 'assertBeforeSubmit del alta (origen!=destino, cotizacion>0)'
    },
    'specs/trips/fr-circuit-s6.spec.ts': {
      max: 2,
      reason: 'assertBeforeSubmit del alta (origen!=destino, cotizacion>0)'
    },
    'specs/trips/fr-circuit-s4-auto-prepare.spec.ts': {
      max: 4,
      reason: 'sesion del carrier, S4 no duplicado y assertBeforeSubmit del alta'
    },
    'specs/trips/fr-circuit-s4-auto-verify.spec.ts': {
      max: 2,
      reason: 'handoff de prepare presente y asignado'
    },
    'specs/trips/fr-circuit-s5-auto.spec.ts': {
      max: 7,
      reason:
        'sesion, handoff, flag CASHCOLLECTOR/lote ajeno (preflight), alta, estado del toggle y expectNoMismatch local'
    },
    'specs/trips/fr-circuit-settlement.spec.ts': {
      max: 6,
      reason: 'sesion del carrier y filas existentes antes de leerlas (precondiciones de datos)'
    }
  };

function frSpecFiles(): string[] {
  const out: string[] = [];
  const tripsDir = join(SPECS_DIR, 'trips');
  const reportsDir = join(SPECS_DIR, 'reports');
  for (const name of readdirSync(tripsDir))
    if (/^fr-circuit-.*\.spec\.ts$/.test(name)) out.push(join(tripsDir, name));
  for (const name of readdirSync(reportsDir))
    if (/^fr-.*\.spec\.ts$/.test(name)) out.push(join(reportsDir, name));
  return out;
}

describe('POM, steps y helpers sin reglas de negocio', () => {
  it('tests/pages/** solo usa expect para guardas tecnicas', () => {
    const uses = scanDir(PAGES_DIR, PAGES_DIR);
    assert.ok(uses.length > 0, 'el escaner no encontro ningun expect: ruta o regex rotos');
    assert.deepEqual(
      report(violations(uses)),
      [],
      'las reglas de negocio se aseveran en el spec: el POM devuelve datos (ver auditoria-pom-reglas-negocio)'
    );
  });

  it('tests/steps/** y tests/helpers/** (no unit) solo usan expect para guardas tecnicas', () => {
    const steps = scanDir(STEPS_DIR, TESTS_DIR);
    const helpers = scanDir(HELPERS_DIR, TESTS_DIR);
    assert.ok(
      steps.length > 0,
      'el escaner no encontro ningun expect en steps: ruta o regex rotos'
    );
    assert.deepEqual(
      report(violations([...steps, ...helpers])),
      [],
      'las reglas de negocio se aseveran en el spec: steps y helpers devuelven datos o veredictos (evaluate*)'
    );
  });

  it('acceptance.ts es la unica exencion de archivo y existe', () => {
    assert.deepEqual(Object.keys(EXEMPT_FILES), ['helpers/acceptance.ts']);
    assert.ok(statSync(join(TESTS_DIR, 'helpers', 'acceptance.ts')).isFile());
  });

  it('detecta un expect de negocio sintetico', () => {
    const src = "await expect(page.locator('x')).toBeVisible();\nexpect(total, 'm').toBe(5);\n";
    const bad = violations(scanExpects('x.ts', src));
    assert.deepEqual(
      bad.map((u) => u.matcher),
      ['toBe']
    );
  });

  it('prohibe expect.soft aunque el matcher sea permitido', () => {
    const bad = violations(scanExpects('x.ts', 'expect.soft(a).toBeVisible();'));
    assert.equal(bad.length, 1);
  });

  it('ignora expects dentro de comentarios', () => {
    assert.equal(scanExpects('x.ts', '// expect(a).toBe(1)\n * expect(b).toBe(2)\n').length, 0);
  });

  it('specs FR: todo expect de negocio vive dentro de verifyAc (o scope tecnico permitido)', () => {
    const files = frSpecFiles();
    assert.ok(files.length > 0, 'no se encontro ningun spec FR: ruta o patron rotos');
    const bad = files.flatMap((full) => {
      const id = relative(TESTS_DIR, full).split(sep).join('/');
      const outside = expectsOutsideAcScope(id, readFileSync(full, 'utf8'));
      const allowed = SPEC_TECHNICAL_EXCEPTIONS[id]?.max ?? 0;
      return outside.slice(allowed);
    });
    assert.deepEqual(
      report(bad),
      [],
      'mover el expect a un verifyAc (regla de negocio) o a una guarda tecnica permitida (SPEC_ASSERT_SCOPES)'
    );
  });

  it('expectsOutsideAcScope distingue dentro/fuera de verifyAc', () => {
    const src = [
      "await verifyAc(ti, 'AC-1', async () => {",
      '  expect(a).toBe(1);',
      '});',
      'expect(b).toBe(2);',
      'expect(page.locator("x")).toBeVisible();'
    ].join('\n');
    const bad = expectsOutsideAcScope('x.spec.ts', src);
    assert.deepEqual(
      bad.map((u) => u.line),
      [4]
    );
  });
});
