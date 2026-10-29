/**
 * Generador de la vista del ledger de migracion V1 -> V2.
 *
 * Lee el artefacto rector `docs/migration/LEDGER.json` (de mano, single-writer = orquestador)
 * y lo cruza con `traceability/tc-map.json` (de `scripts/extract-tc-map.ts`) para:
 *   - Calcular los campos derivados `_gen.*` de cada unidad: specExists, tmsResolved, testCount,
 *     inertBySource, inertByList, lastRun.
 *   - Validar las invariantes del programa (ver INVARIANTES abajo). Cualquier violacion => exit 1.
 *   - Calcular la metrica de paridad ACP (y ACP_unblocked) por ola, dominio y total.
 *   - Renderizar `docs/migration/MIGRATION-LEDGER.md` + el sidecar `docs/migration/ledger-gen.json`.
 *
 * El generador NUNCA escribe en LEDGER.json y NUNCA escribe `status`: si los hechos contradicen
 * el status declarado, falla en vez de corregirlo.
 *
 * INVARIANTES (exit != 0):
 *   1. Los conteos de admisibilidad no suman `v1SpecTotal`.
 *   2. Una unidad `port` cuyo destino no es el repo V2.
 *   3. Una unidad `implemented`/`running-green` sin el spec en disco.
 *   4. Una unidad `running-green` sin `evidence`.
 *   5. `inertBySource != inertByList` cuando ambos se conocen.
 *   6. `tmsKeys` ausentes del tc-map para una unidad `implemented`/`running-green`.
 *   7. `targetSpecPath` fuera de `tests/specs/`.
 *   8. Reclasificacion sin `reclassifiedAt` + `reclassifiedReason`.
 *   9. Unidad 1:1 (un unico TC) sin `collapseJustification`.
 *  10. Un spec V1 que no aparece en exactamente una unidad.
 *
 * Ejecutar: npm run migration:ledger
 *   o:       tsx scripts/build-migration-ledger.ts
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Admissibility = 'port' | 'out-of-scope-here' | 'obsolete';

type UnitStatus =
  | 'todo'
  | 'recon'
  | 'ready'
  | 'implementing'
  | 'verifying'
  | 'red'
  | 'review'
  | 'implemented'
  | 'running-green'
  | 'blocked-human'
  | 'gap-accepted'
  | 'dropped'
  | 'out-of-scope';

type Blocker = {
  kind: 'env' | 'data' | 'dev' | 'creds' | 'framework' | 'recon';
  detail: string;
  owner: 'human' | 'agent';
  citation: string;
};

type TargetPom = { path: string; role: 'reuse' | 'extend' | 'new'; touchesBarrel: boolean };

type MigrationUnit = {
  unitId: string;
  title: string;
  admissibility: Admissibility;
  admissibilityRule: string;
  destination: string | null;
  v1SourceSpecs: string[];
  v1TestTitles: string[];
  v1CaseIds: string[];
  v1MgKeys: string[] | null;
  targetSuite: string | null;
  targetDomain: string | null;
  targetSpecPath: string | null;
  targetPoms: TargetPom[];
  routeV2: string | null;
  priority: string | null;
  wave: number | null;
  technique: string[];
  tcRange: string[];
  collapseJustification: string | null;
  tmsKeys: string[];
  blockers: Blocker[];
  status: UnitStatus;
  owner: string | null;
  envGates: { test: string; uat: string };
  evidence: { runRecordPath: string; commit: string } | null;
  reclassifiedAt: string | null;
  reclassifiedReason: string | null;
  notes: string | null;
};

type Ledger = {
  migrationMeta: {
    ledgerVersion: number;
    frozenAt: string;
    v1Repo: string;
    v1RepoPath: string;
    v1Commit: string;
    v1SpecTotal: number;
    v1ListSnapshot: string;
    admissibilityCounts: { port: number; outOfScopeHere: number; obsolete: number };
    generator: string;
    generatedView: string;
    generatedSidecar: string;
    generatedFields: string[];
    plan: string;
    notes: string[];
  };
  migrationUnits: MigrationUnit[];
};

type TcMap = {
  generatedAt: string;
  totalSpecs: number;
  entries: { spec: string; tcIds: string[]; jiraIds: string[] }[];
};

type GenFields = {
  specExists: boolean;
  tmsResolved: boolean;
  testCount: number | null;
  inertBySource: number | null;
  inertByList: number | null;
  lastRun: { runRecordPath: string; date: string } | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

const LEDGER_PATH = 'docs/migration/LEDGER.json';
const TC_MAP_PATH = 'traceability/tc-map.json';
const VIEW_PATH = 'docs/migration/MIGRATION-LEDGER.md';
const SIDECAR_PATH = 'docs/migration/ledger-gen.json';
const RUNS_DIR = 'docs/qa/runs';
const V2_DESTINATION = 'magiis-carrier-v2-e2e';

/**
 * Hook opcional para `inertByList`: un JSON de Playwright (`--list --reporter=json`) del suite V2.
 * Mientras no exista, `inertByList` queda null y la invariante 5 no se puede evaluar.
 * TODO(ola 3+): generarlo en el DoD de cada unidad y dejarlo en docs/qa/runs/<fecha>/.
 */
const V2_LIST_JSON = 'docs/migration/v2-list-snapshot.json';

/** Estados en los que la unidad ya declara codigo en disco. */
const IMPLEMENTED_PLUS: UnitStatus[] = ['implemented', 'running-green'];

const TEST_DECL_REGEX = /(?:^|[^.\w])test\s*\(/g;
const TEST_INERT_REGEX = /(?:^|[^.\w])test\.(?:skip|fixme)\s*\(/g;

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(repoRoot, rel), 'utf8')) as T;
}

function countMatches(src: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(src) !== null) n += 1;
  return n;
}

/** Recorre docs/qa/runs/** y devuelve el run record mas reciente de cada spec. */
function collectRunRecords(): Map<string, { runRecordPath: string; date: string }> {
  const out = new Map<string, { runRecordPath: string; date: string }>();
  const root = join(repoRoot, RUNS_DIR);
  if (!existsSync(root)) return out;

  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs)) {
      const childAbs = join(abs, entry);
      const childRel = `${rel}/${entry}`;
      if (statSync(childAbs).isDirectory()) {
        walk(childAbs, childRel);
        continue;
      }
      if (!entry.endsWith('.run.json')) continue;
      let record: { spec?: string } = {};
      try {
        record = JSON.parse(readFileSync(childAbs, 'utf8')) as { spec?: string };
      } catch {
        continue;
      }
      if (!record.spec) continue;
      const date = /(\d{4}-\d{2}-\d{2})/.exec(childRel)?.[1] ?? '';
      const prev = out.get(record.spec);
      if (!prev || prev.date <= date) out.set(record.spec, { runRecordPath: childRel, date });
    }
  };
  walk(root, RUNS_DIR);
  return out;
}

/** Lee el snapshot --list del suite V2 si existe, e indexa specs inertes por archivo. */
function collectInertByList(): Map<string, number> | null {
  const abs = join(repoRoot, V2_LIST_JSON);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as {
    suites?: unknown[];
  };
  const out = new Map<string, number>();
  const seen = new Set<string>();
  const walk = (suite: {
    specs?: { file: string; line: number; title: string; tests?: { expectedStatus?: string }[] }[];
    suites?: unknown[];
  }): void => {
    for (const spec of suite.specs ?? []) {
      const file = `tests/${String(spec.file).split('\\').join('/')}`;
      const key = `${file}:${spec.line}:${spec.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tests = spec.tests ?? [];
      const inert = tests.length > 0 && tests.every((t) => t.expectedStatus === 'skipped');
      out.set(file, (out.get(file) ?? 0) + (inert ? 1 : 0));
    }
    for (const child of suite.suites ?? []) walk(child as Parameters<typeof walk>[0]);
  };
  for (const suite of parsed.suites ?? []) walk(suite as Parameters<typeof walk>[0]);
  return out;
}

function computeGen(
  unit: MigrationUnit,
  tcMap: TcMap,
  runs: Map<string, { runRecordPath: string; date: string }>,
  inertByListIndex: Map<string, number> | null
): GenFields {
  const specPath = unit.targetSpecPath;
  const specExists = specPath !== null && existsSync(join(repoRoot, specPath));

  let testCount: number | null = null;
  let inertBySource: number | null = null;
  if (specExists && specPath !== null) {
    const src = readFileSync(join(repoRoot, specPath), 'utf8');
    testCount = countMatches(src, TEST_DECL_REGEX);
    inertBySource = countMatches(src, TEST_INERT_REGEX);
  }

  const entry = specPath === null ? undefined : tcMap.entries.find((e) => e.spec === specPath);
  const known = new Set([...(entry?.jiraIds ?? [])]);
  const tmsResolved =
    unit.tmsKeys.length === 0
      ? !IMPLEMENTED_PLUS.includes(unit.status)
      : unit.tmsKeys.every((k) => known.has(k));

  const inertByList =
    inertByListIndex === null || specPath === null || !specExists
      ? null
      : (inertByListIndex.get(specPath) ?? 0);

  return {
    specExists,
    tmsResolved,
    testCount,
    inertBySource,
    inertByList,
    lastRun: specPath === null ? null : (runs.get(specPath) ?? null)
  };
}

function validate(ledger: Ledger, gen: Map<string, GenFields>): string[] {
  const errors: string[] = [];
  const meta = ledger.migrationMeta;
  const units = ledger.migrationUnits;

  // 1. Conteos de admisibilidad.
  const specCounts = { port: 0, outOfScopeHere: 0, obsolete: 0 };
  for (const u of units) {
    const n = u.v1SourceSpecs.length;
    if (u.admissibility === 'port') specCounts.port += n;
    else if (u.admissibility === 'out-of-scope-here') specCounts.outOfScopeHere += n;
    else specCounts.obsolete += n;
  }
  const declared = meta.admissibilityCounts;
  const total = specCounts.port + specCounts.outOfScopeHere + specCounts.obsolete;
  if (total !== meta.v1SpecTotal) {
    errors.push(`[1] los specs clasificados suman ${total}, se esperaban ${meta.v1SpecTotal}.`);
  }
  for (const key of ['port', 'outOfScopeHere', 'obsolete'] as const) {
    if (declared[key] !== specCounts[key]) {
      errors.push(
        `[1] migrationMeta.admissibilityCounts.${key} declara ${declared[key]} pero las filas suman ${specCounts[key]}.`
      );
    }
  }

  // 10. Cada spec V1 en exactamente una unidad.
  const owner = new Map<string, string>();
  for (const u of units) {
    for (const spec of u.v1SourceSpecs) {
      const prev = owner.get(spec);
      if (prev !== undefined) {
        errors.push(`[10] el spec V1 ${spec} aparece en ${prev} y en ${u.unitId}.`);
        continue;
      }
      owner.set(spec, u.unitId);
    }
  }
  if (owner.size !== meta.v1SpecTotal) {
    errors.push(
      `[10] hay ${owner.size} specs V1 distintos referenciados, se esperaban ${meta.v1SpecTotal}.`
    );
  }

  for (const u of units) {
    const g = gen.get(u.unitId);
    if (g === undefined) {
      errors.push(`[gen] falta el calculo _gen de ${u.unitId}.`);
      continue;
    }

    // 2. port siempre aterriza en V2; fuera de alcance necesita destino declarado.
    if (u.admissibility === 'port' && u.destination !== V2_DESTINATION) {
      errors.push(`[2] ${u.unitId} es port pero su destino es ${String(u.destination)}.`);
    }
    if (u.admissibility === 'out-of-scope-here' && !u.destination) {
      errors.push(`[2] ${u.unitId} esta fuera de alcance y no declara destino.`);
    }

    // 3. implemented+ sin spec en disco.
    if (IMPLEMENTED_PLUS.includes(u.status) && !g.specExists) {
      errors.push(
        `[3] ${u.unitId} declara ${u.status} pero ${String(u.targetSpecPath)} no existe.`
      );
    }

    // 4. running-green sin evidencia.
    if (u.status === 'running-green' && u.evidence === null) {
      errors.push(`[4] ${u.unitId} declara running-green sin evidence (run record + commit).`);
    }

    // 5. inertBySource vs inertByList cuando ambos se conocen.
    if (g.inertBySource !== null && g.inertByList !== null && g.inertBySource !== g.inertByList) {
      errors.push(
        `[5] ${u.unitId}: inertBySource=${g.inertBySource} != inertByList=${g.inertByList} en ${String(u.targetSpecPath)}.`
      );
    }

    // 6. tmsKeys resueltas en el tc-map para implemented+.
    if (IMPLEMENTED_PLUS.includes(u.status) && !g.tmsResolved) {
      errors.push(
        `[6] ${u.unitId}: tmsKeys ${u.tmsKeys.join(', ') || '(vacio)'} no resuelven en ${TC_MAP_PATH} para ${String(u.targetSpecPath)}.`
      );
    }

    // 7. targetSpecPath dentro de tests/specs/.
    if (u.targetSpecPath !== null && !u.targetSpecPath.startsWith('tests/specs/')) {
      errors.push(
        `[7] ${u.unitId}: targetSpecPath ${u.targetSpecPath} esta fuera de tests/specs/.`
      );
    }
    if (u.admissibility === 'port' && u.targetSpecPath === null) {
      errors.push(`[7] ${u.unitId} es port y no declara targetSpecPath.`);
    }

    // 8. Reclasificacion trazada.
    const reclassified = u.reclassifiedAt !== null || u.reclassifiedReason !== null;
    if (reclassified && (u.reclassifiedAt === null || u.reclassifiedReason === null)) {
      errors.push(`[8] ${u.unitId} esta reclasificada sin reclassifiedAt + reclassifiedReason.`);
    }

    // 9. 1:1 sin justificacion de colapso.
    if (u.admissibility === 'port' && u.tcRange.length === 1 && !u.collapseJustification) {
      errors.push(`[9] ${u.unitId} colapsa a un unico TC sin collapseJustification.`);
    }

    // Higiene minima transversal.
    if (!u.admissibilityRule) errors.push(`[rule] ${u.unitId} no cita regla de admisibilidad.`);
    for (const b of u.blockers) {
      if (!b.citation) errors.push(`[rule] ${u.unitId} tiene un blocker sin citation.`);
    }
  }

  return errors;
}

type Acp = { numerator: number; denominator: number; value: number };

function acp(units: MigrationUnit[], gen: Map<string, GenFields>): Acp {
  const port = units.filter((u) => u.admissibility === 'port');
  const hit = port.filter((u) => {
    const g = gen.get(u.unitId);
    if (g === undefined) return false;
    return (
      g.specExists &&
      g.tmsResolved &&
      (g.testCount ?? 0) > 0 &&
      g.inertByList === 0 &&
      g.inertBySource === 0 &&
      u.status === 'running-green' &&
      u.evidence !== null
    );
  });
  return {
    numerator: hit.length,
    denominator: port.length,
    value: port.length === 0 ? 0 : Number((hit.length / port.length).toFixed(4))
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}

function pomLabel(unit: MigrationUnit): string {
  if (unit.targetPoms.length === 0) return '-';
  return unit.targetPoms
    .map((p) => `${p.path.split('/').pop() ?? p.path} (${p.role})`)
    .join('<br>');
}

function blockerLabel(unit: MigrationUnit): string {
  if (unit.blockers.length === 0) return '-';
  const human = unit.blockers.filter((b) => b.owner === 'human').length;
  const agent = unit.blockers.filter((b) => b.owner === 'agent').length;
  const kinds = [...new Set(unit.blockers.map((b) => b.kind))].sort().join('/');
  return `${kinds} (h:${human} a:${agent})`;
}

function render(ledger: Ledger, gen: Map<string, GenFields>): string {
  const meta = ledger.migrationMeta;
  const units = ledger.migrationUnits;
  const port = units.filter((u) => u.admissibility === 'port');
  const total = acp(units, gen);
  const unblockedUnits = port.filter((u) => u.status !== 'blocked-human');
  const unblocked = acp(unblockedUnits, gen);
  const reclassifiedCount = units.filter((u) => u.reclassifiedAt !== null).length;

  const lines: string[] = [];
  lines.push('# Ledger de migracion V1 -> V2', '');
  lines.push(`> Auto-generado por \`${meta.generator}\` el ${new Date().toISOString()}.`, '');
  lines.push(
    `> **NO EDITAR A MANO**. Los datos viven en \`${LEDGER_PATH}\` (de mano). Regenerar esta vista con \`npm run migration:ledger\`.`,
    ''
  );

  lines.push('## Denominador congelado', '');
  lines.push(`- Congelado el: **${meta.frozenAt}**`);
  lines.push(`- Origen: \`${meta.v1Repo}\` @ \`${meta.v1Commit}\` (${meta.v1RepoPath})`);
  lines.push(`- Specs V1 totales: **${meta.v1SpecTotal}**`);
  lines.push(`- Snapshot \`--list\`: \`${meta.v1ListSnapshot}\``);
  lines.push(
    `- Clasificacion (specs): **port ${meta.admissibilityCounts.port}** · fuera de alcance ${meta.admissibilityCounts.outOfScopeHere} · obsoletos ${meta.admissibilityCounts.obsolete}`
  );
  lines.push(`- Unidades de trabajo: **${units.length}** (${port.length} portables)`);
  lines.push(`- Reclasificaciones: **${reclassifiedCount}**`, '');

  lines.push('## ACP (paridad de corpus automatizado)', '');
  lines.push(
    '```',
    'ACP = |port & specExists & tmsResolved & testCount>0 & inertByList=0 & inertBySource=0 & status=running-green & evidence!=null| / |port|',
    '```',
    ''
  );
  const inertByListKnown = [...gen.values()].some((f) => f.inertByList !== null);
  if (!inertByListKnown) {
    lines.push(
      '> ⚠ **ACP no evaluable**: falta `docs/migration/v2-list-snapshot.json` (`--list --reporter=json` del suite V2): `inertByList` es null y el numerador queda en 0 aunque haya unidades verdes.',
      ''
    );
  }
  lines.push('| Corte | Numerador | Denominador | ACP |');
  lines.push('|---|---|---|---|');
  lines.push(`| **total** | ${total.numerator} | ${total.denominator} | ${total.value} |`);
  lines.push(
    `| **unblocked** | ${unblocked.numerator} | ${unblocked.denominator} | ${unblocked.value} |`
  );
  const byWave = groupBy(port, (u) => String(u.wave));
  for (const wave of [...byWave.keys()].sort()) {
    const a = acp(byWave.get(wave)!, gen);
    lines.push(`| ola ${wave} | ${a.numerator} | ${a.denominator} | ${a.value} |`);
  }
  const byDomain = groupBy(port, (u) => String(u.targetDomain));
  for (const domain of [...byDomain.keys()].sort()) {
    const a = acp(byDomain.get(domain)!, gen);
    lines.push(`| dominio ${domain} | ${a.numerator} | ${a.denominator} | ${a.value} |`);
  }
  lines.push('');

  lines.push('## Unidades portables por ola', '');
  for (const wave of [...byWave.keys()].sort()) {
    const inWave = byWave.get(wave)!;
    lines.push(`### Ola ${wave} — ${inWave.length} unidades`, '');
    lines.push(
      '| Unidad | Titulo | Fuente V1 | TCs | Spec destino | POM (rol) | Estado | Bloqueos | _gen |'
    );
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const u of inWave) {
      const g = gen.get(u.unitId)!;
      const sources = u.v1SourceSpecs.map((s) => `\`${s.replace(/^tests\//, '')}\``).join('<br>');
      const genLabel = `spec:${g.specExists ? 'si' : 'no'} tms:${g.tmsResolved ? 'ok' : 'no'} tests:${g.testCount ?? '-'} inert:${g.inertBySource ?? '-'}/${g.inertByList ?? '-'}`;
      lines.push(
        `| \`${u.unitId}\` | ${u.title} | ${sources} | ${u.tcRange.length} | \`${String(u.targetSpecPath)}\` | ${pomLabel(u)} | ${u.status} | ${blockerLabel(u)} | ${genLabel} |`
      );
    }
    lines.push('');
  }

  const oos = units.filter((u) => u.admissibility === 'out-of-scope-here');
  lines.push(`## Fuera de alcance aqui — ${oos.length} specs`, '');
  const byDest = groupBy(oos, (u) => String(u.destination));
  for (const dest of [...byDest.keys()].sort()) {
    const rows = byDest.get(dest)!;
    lines.push(`### \`${dest}\` — ${rows.length} specs`, '');
    lines.push('| Unidad | Spec V1 | Regla | Motivo |');
    lines.push('|---|---|---|---|');
    for (const u of rows) {
      lines.push(
        `| \`${u.unitId}\` | \`${u.v1SourceSpecs[0]}\` | \`${u.admissibilityRule}\` | ${u.notes ?? '-'} |`
      );
    }
    lines.push('');
  }

  const dropped = units.filter((u) => u.admissibility === 'obsolete');
  lines.push(`## Obsoletos — ${dropped.length} specs`, '');
  lines.push('| Unidad | Spec V1 | Regla | Motivo |');
  lines.push('|---|---|---|---|');
  for (const u of dropped) {
    lines.push(
      `| \`${u.unitId}\` | \`${u.v1SourceSpecs[0]}\` | \`${u.admissibilityRule}\` | ${u.notes ?? '-'} |`
    );
  }
  lines.push('');

  lines.push('## Gate humano', '');
  const humanBlockers = new Map<string, { detail: string; citation: string; units: string[] }>();
  for (const u of units) {
    for (const b of u.blockers) {
      if (b.owner !== 'human') continue;
      const key = b.detail;
      if (!humanBlockers.has(key)) {
        humanBlockers.set(key, { detail: b.detail, citation: b.citation, units: [] });
      }
      humanBlockers.get(key)!.units.push(u.unitId);
    }
  }
  const blockedUnits = units.filter((u) => u.status === 'blocked-human').length;
  lines.push(
    `Unidades en \`blocked-human\`: **${blockedUnits}** de ${port.length} portables. Cada item necesita una accion humana antes de que su ola pueda cerrar.`,
    ''
  );
  lines.push('| Bloqueo | Cita | Unidades | Afectadas |');
  lines.push('|---|---|---|---|');
  for (const b of [...humanBlockers.values()].sort((a, c) => c.units.length - a.units.length)) {
    lines.push(
      `| ${b.detail} | \`${b.citation}\` | ${b.units.length} | ${b.units.map((u) => `\`${u}\``).join(', ')} |`
    );
  }
  lines.push('');

  const agentBlockers = new Map<string, string[]>();
  for (const u of units) {
    for (const b of u.blockers) {
      if (b.owner !== 'agent') continue;
      if (!agentBlockers.has(b.detail)) agentBlockers.set(b.detail, []);
      agentBlockers.get(b.detail)!.push(u.unitId);
    }
  }
  lines.push('## Recon / bloqueos de agente', '');
  lines.push('| Bloqueo | Unidades |');
  lines.push('|---|---|');
  for (const [detail, ids] of [...agentBlockers.entries()].sort(
    (a, c) => c[1].length - a[1].length
  )) {
    lines.push(`| ${detail} | ${ids.map((i) => `\`${i}\``).join(', ')} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function main(): void {
  const ledger = readJson<Ledger>(LEDGER_PATH);
  const tcMap = readJson<TcMap>(TC_MAP_PATH);
  const runs = collectRunRecords();
  const inertByListIndex = collectInertByList();

  const gen = new Map<string, GenFields>();
  for (const unit of ledger.migrationUnits) {
    gen.set(unit.unitId, computeGen(unit, tcMap, runs, inertByListIndex));
  }

  const errors = validate(ledger, gen);
  if (errors.length > 0) {
    console.error(`[migration:ledger] ${errors.length} violacion(es) de invariante:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const port = ledger.migrationUnits.filter((u) => u.admissibility === 'port');
  const totalAcp = acp(ledger.migrationUnits, gen);
  const unblockedAcp = acp(
    port.filter((u) => u.status !== 'blocked-human'),
    gen
  );
  const sidecar = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/build-migration-ledger.ts',
    source: LEDGER_PATH,
    tcMapGeneratedAt: tcMap.generatedAt,
    inertByListSource: inertByListIndex === null ? null : V2_LIST_JSON,
    acp: {
      total: totalAcp,
      unblocked: unblockedAcp,
      reclassifiedCount: ledger.migrationUnits.filter((u) => u.reclassifiedAt !== null).length
    },
    units: Object.fromEntries([...gen.entries()].map(([id, g]) => [id, g]))
  };

  writeFileSync(join(repoRoot, VIEW_PATH), `${render(ledger, gen)}`, 'utf8');
  writeFileSync(join(repoRoot, SIDECAR_PATH), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');

  console.info(
    `[migration:ledger] ${ledger.migrationUnits.length} unidades (${port.length} port) · ACP ${totalAcp.numerator}/${totalAcp.denominator} · ACP_unblocked ${unblockedAcp.numerator}/${unblockedAcp.denominator}. Output: ${VIEW_PATH} + ${SIDECAR_PATH}`
  );
}

main();
