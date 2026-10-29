/**
 * Extractor de trazabilidad TC <-> spec.
 *
 * Escanea tests/specs/**\/*.spec.ts buscando:
 *   - Tags @TC-* / @TS-* / @MX-* / @MG-* / @TM-* en titulos de test/describe.
 *   - test.info().annotations.push({ type: 'tms' | 'jira', description: 'MX-XXXX' }).
 *   - test.info().annotations.push({ type: 'route_v2', description: '/path' }).
 *   - Llamadas al helper canonico makeAnnotate('MX-XXXX', '/path') de tests/utils/traceability.ts,
 *     incluyendo la forma indirecta makeAnnotate(MX, ROUTE) con las constantes del propio spec.
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

// Prefijos reconocidos: TC/TS (tags internos) · MX (key Jira historica, pre-migracion) ·
// MG (story/epic Jira-native del proyecto MG) · TM (Test de Xray del proyecto TM, "Test
// Mangement" — typo real del proyecto; ver tests/specs/smoke/trips/new-trip.spec.ts).
//
// TODO(Fase 3): el mapa NO agrupa por Historia. Con el esquema actual la Historia (MG-XX) y
// sus Tests (TM-XXX) entran por el mismo canal — tag en el titulo o key de makeAnnotate — asi
// que MG-19 y TM-538 salen como filas hermanas y se pierde la relacion padre/hijo. Para
// agruparlas hace falta un mapeo TM->MG (los 155 Tests de MG-19 no lo declaran en el spec).
const TAG_REGEX = /@((?:TC|TS|MX|MG|TM)-[A-Z0-9-]+)/g;
const PRIORITY_REGEX = /@(P[123])\b/g;
const TYPE_REGEX = /@(functional|visual|both|migration|a11y|smoke|regression)\b/g;
// Acepta la annotation canónica type:'tms' (contrato de consistencia) Y el legacy type:'jira'.
const JIRA_ANNOTATION_REGEX =
  /test\.info\(\)\.annotations\.push\(\s*\{\s*type:\s*['"](?:tms|jira)['"]\s*,\s*description:\s*['"]([^'"]+)['"]/g;
const ROUTE_ANNOTATION_REGEX =
  /test\.info\(\)\.annotations\.push\(\s*\{\s*type:\s*['"]route_v2['"]\s*,\s*description:\s*['"]([^'"]+)['"]/g;

// Constantes string del propio spec (`const MX = 'MX-5438'`, `const ROUTE = '/carrier/#/x'`),
// para resolver la forma indirecta makeAnnotate(MX, ROUTE).
const CONST_BINDING_REGEX = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g;
// Llamadas al helper canonico: makeAnnotate('MX-XXXX', '/ruta') | makeAnnotate(MX, ROUTE) | makeAnnotate(MX).
const MAKE_ANNOTATE_REGEX = /makeAnnotate\(\s*([^,)]+?)\s*(?:,\s*([^,)]+?)\s*)?\)/g;

/** Resuelve un argumento de makeAnnotate: literal ('MX-1') o nombre de constante del spec. */
function resolveArg(raw: string | undefined, bindings: Map<string, string>): string | undefined {
  if (!raw) return undefined;
  const literal = /^['"]([^'"]+)['"]$/.exec(raw.trim());
  return literal ? literal[1] : bindings.get(raw.trim());
}

// El helper canonico `makeAnnotate` empuja las annotations en RUNTIME, por lo que en el fuente
// del spec ya no queda ningun `annotations.push({ type: 'tms' ... })` que matchear. Sin este
// parseo, cada spec migrado al helper se contaria como huerfano y la trazabilidad se degradaria.
function collectMakeAnnotate(src: string): { keys: string[]; routes: string[] } {
  const bindings = new Map<string, string>();
  CONST_BINDING_REGEX.lastIndex = 0;
  let b: RegExpExecArray | null;
  while ((b = CONST_BINDING_REGEX.exec(src)) !== null) bindings.set(b[1], b[2]);

  const keys = new Set<string>();
  const routes = new Set<string>();
  MAKE_ANNOTATE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MAKE_ANNOTATE_REGEX.exec(src)) !== null) {
    const key = resolveArg(m[1], bindings);
    if (key) keys.add(key);
    const route = resolveArg(m[2], bindings);
    if (route) routes.add(route);
  }
  return { keys: [...keys].sort(), routes: [...routes].sort() };
}

async function extractFromFile(absPath: string): Promise<SpecEntry> {
  const src = await readFile(absPath, 'utf8');
  const collect = (re: RegExp): string[] => {
    const out = new Set<string>();
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.add(m[1]);
    return [...out].sort();
  };
  const helper = collectMakeAnnotate(src);
  const merge = (...groups: string[][]): string[] => [...new Set(groups.flat())].sort();
  return {
    spec: relative(repoRoot, absPath).replace(/\\/g, '/'),
    tcIds: collect(TAG_REGEX),
    jiraIds: merge(collect(JIRA_ANNOTATION_REGEX), helper.keys),
    routesV2: merge(collect(ROUTE_ANNOTATION_REGEX), helper.routes),
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
  lines.push(`- Specs huerfanos (sin TC ni key tms/jira): **${orphan.length}**`, '');

  lines.push('## Mapping TC -> Spec', '');
  lines.push('| TC / issue key | Specs |');
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
  lines.push('| Spec | Tags TC | Keys tms/jira | Rutas V2 | Prioridad | Tipo |');
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
    lines.push('## Specs huerfanos (sin TC ni key tms/jira)', '');
    lines.push(
      'Estos specs no tienen tag `@TC-*`/`@MX-*`/`@MG-*`/`@TM-*`, ni annotation `tms`/`jira`, ni llamada a `makeAnnotate`. Revisar:'
    );
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
