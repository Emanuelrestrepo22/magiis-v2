/**
 * Extractor de trazabilidad TC <-> spec.
 *
 * Escanea tests/specs/**\/*.spec.ts buscando:
 *   - Tags @TC-* / @MX-* / @TS-* en titulos de test/describe.
 *   - test.info().annotations.push({ type: 'jira', description: 'MX-XXXX' }).
 *   - test.info().annotations.push({ type: 'route_v2', description: '/path' }).
 *
 * Output: traceability/tc-map.md (tabla markdown) + traceability/tc-map.json (datos).
 *
 * Ejecutar: npm run traceability
 *   o:       tsx scripts/extract-tc-map.ts
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';

type SpecEntry = {
  spec: string;
  tcIds: string[];
  jiraIds: string[];
  routesV2: string[];
  priorities: string[];
  types: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

const TAG_REGEX = /@((?:TC|TS|MX)-[A-Z0-9-]+)/g;
const PRIORITY_REGEX = /@(P[123])\b/g;
const TYPE_REGEX = /@(functional|visual|both|migration|a11y|smoke|regression)\b/g;
const JIRA_ANNOTATION_REGEX =
  /test\.info\(\)\.annotations\.push\(\s*\{\s*type:\s*['"]jira['"]\s*,\s*description:\s*['"]([^'"]+)['"]/g;
const ROUTE_ANNOTATION_REGEX =
  /test\.info\(\)\.annotations\.push\(\s*\{\s*type:\s*['"]route_v2['"]\s*,\s*description:\s*['"]([^'"]+)['"]/g;

async function extractFromFile(absPath: string): Promise<SpecEntry> {
  const src = await readFile(absPath, 'utf8');
  const collect = (re: RegExp): string[] => {
    const out = new Set<string>();
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
    return [...out].sort();
  };
  return {
    spec: relative(repoRoot, absPath).replace(/\\/g, '/'),
    tcIds: collect(TAG_REGEX),
    jiraIds: collect(JIRA_ANNOTATION_REGEX),
    routesV2: collect(ROUTE_ANNOTATION_REGEX),
    priorities: collect(PRIORITY_REGEX),
    types: collect(TYPE_REGEX)
  };
}

function renderMarkdown(entries: SpecEntry[]): string {
  const generatedAt = new Date().toISOString();
  const total = entries.length;
  const withTc = entries.filter((e) => e.tcIds.length + e.jiraIds.length > 0).length;
  const orphan = entries.filter((e) => e.tcIds.length + e.jiraIds.length === 0);

  // Inversion TC -> specs (un TC puede aparecer en varios specs).
  const tcToSpecs = new Map<string, string[]>();
  for (const e of entries) {
    for (const id of [...e.tcIds, ...e.jiraIds]) {
      if (!tcToSpecs.has(id)) tcToSpecs.set(id, []);
      tcToSpecs.get(id)!.push(e.spec);
    }
  }
  const sortedTcs = [...tcToSpecs.keys()].sort();

  const lines: string[] = [];
  lines.push('# Traceability TC <-> Spec', '');
  lines.push(`> Auto-generado por \`scripts/extract-tc-map.ts\` el ${generatedAt}.`, '');
  lines.push(
    `> **NO EDITAR A MANO**. Regenerar con \`npm run traceability\` (o \`tsx scripts/extract-tc-map.ts\`).`,
    ''
  );
  lines.push('## Resumen', '');
  lines.push(`- Specs analizados: **${total}**`);
  lines.push(`- Specs con trazabilidad: **${withTc}** (${Math.round((withTc / total) * 100)}%)`);
  lines.push(`- TCs/issues unicos referenciados: **${sortedTcs.length}**`);
  lines.push(`- Specs huerfanos (sin TC ni jira annotation): **${orphan.length}**`, '');

  lines.push('## Mapping TC -> Spec', '');
  lines.push('| TC / Jira ID | Specs |');
  lines.push('|---|---|');
  for (const id of sortedTcs) {
    const specs = tcToSpecs
      .get(id)!
      .map((s) => `\`${s}\``)
      .join('<br>');
    lines.push(`| ${id} | ${specs} |`);
  }
  lines.push('');

  lines.push('## Mapping Spec -> TC', '');
  lines.push('| Spec | Tags TC | Jira annotations | Rutas V2 | Prioridad | Tipo |');
  lines.push('|---|---|---|---|---|---|');
  for (const e of entries) {
    lines.push(
      `| \`${e.spec}\` | ${e.tcIds.join(', ') || '-'} | ${e.jiraIds.join(', ') || '-'} | ${
        e.routesV2.join(', ') || '-'
      } | ${e.priorities.join(', ') || '-'} | ${e.types.join(', ') || '-'} |`
    );
  }
  lines.push('');

  if (orphan.length > 0) {
    lines.push('## Specs huerfanos (sin TC ni jira annotation)', '');
    lines.push('Estos specs no tienen tag `@TC-*`/`@MX-*` ni annotation `jira`. Revisar:');
    lines.push('');
    for (const e of orphan) lines.push(`- \`${e.spec}\``);
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const patterns = ['tests/specs/**/*.spec.ts'];
  const files = await glob(patterns, { cwd: repoRoot, absolute: true });
  files.sort();
  const entries: SpecEntry[] = [];
  for (const f of files) entries.push(await extractFromFile(f));

  const md = renderMarkdown(entries);
  await mkdir(`${repoRoot}/traceability`, { recursive: true });
  await writeFile(`${repoRoot}/traceability/tc-map.md`, md, 'utf8');
  await writeFile(
    `${repoRoot}/traceability/tc-map.json`,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), totalSpecs: entries.length, entries },
      null,
      2
    ),
    'utf8'
  );

  const withTc = entries.filter((e) => e.tcIds.length + e.jiraIds.length > 0).length;
  console.log(
    `[traceability] ${entries.length} specs analizados, ${withTc} con trazabilidad. Output: traceability/tc-map.{md,json}`
  );
}

main().catch((err) => {
  console.error('[traceability] error:', err);
  process.exit(1);
});
