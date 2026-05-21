// scripts/generate-a11y-report.cjs
// Consume a11y-clean.json y genera docs/qa/release-v2.0.4/a11y-audit-results.md.
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./a11y-clean.json', 'utf8'));

const out = [];
function walk(suite) {
  for (const s of suite.suites || []) walk(s);
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const annotations = test.results?.[0]?.annotations || [];
      const violations = annotations.filter((a) => a.type === 'a11y_violation').map((a) => a.description);
      const jira = annotations.find((a) => a.type === 'jira')?.description || '?';
      const route = annotations.find((a) => a.type === 'route_v2')?.description || '?';
      const unique = [...new Set(violations)];
      out.push({
        spec: spec.file.replace(/^.*[\\/]/, '').replace('.spec.ts', ''),
        jira,
        route,
        violations: unique
      });
    }
  }
}
for (const s of data.suites || []) walk(s);

const ruleStats = {};
for (const r of out) {
  for (const v of r.violations) {
    const m = v.match(/\[(\w+)\] (\S+):/);
    if (m) {
      const rule = m[2];
      ruleStats[rule] = ruleStats[rule] || { impact: m[1], pages: new Set(), totalNodes: 0 };
      ruleStats[rule].pages.add(r.spec);
      const nodeMatch = v.match(/\((\d+) nodes\)/);
      if (nodeMatch) ruleStats[rule].totalNodes += parseInt(nodeMatch[1]);
    }
  }
}

const emoji = { critical: '🔴', serious: '🟡', moderate: '🟠', minor: '🔵' };
const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const diagnostics = {
  'button-name': 'Buttons icon-only sin aria-label (refresh, PDF, config columnas).',
  label: 'Form inputs sin <label for> o aria-label (search, dropdowns ng-select).',
  'color-contrast': 'Texto con contraste < 4.5:1 (theme issue global).',
  'link-name': 'Links con solo icono o texto vacio (config columnas).',
  'html-has-lang': '<html> sin attr lang (Angular index.html).',
  'aria-progressbar-name': 'Spinners role=progressbar sin aria-label.',
  'autocomplete-valid': 'autocomplete attr con valor invalido HTML5.'
};

let md = '# Reporte de Auditoria A11y - Release V2.0.4\n\n';
md += '> **Generado**: 2026-05-21 via `npm run test:a11y`\n';
md += '> **Standard**: WCAG 2.1 AA (axe-core via @axe-core/playwright)\n';
md += '> **Modo**: Soft audit - 16/16 specs pasan, violations expuestas como findings QA\n\n';

md += '## Resumen ejecutivo\n\n';
md += '### Violations por regla (agregado 16 pantallas)\n\n';
md += '| Severity | Regla WCAG | Pantallas afectadas | Total nodos | Diagnostico |\n';
md += '|---|---|---:|---:|---|\n';
const rules = Object.entries(ruleStats).sort(
  (a, b) => order[a[1].impact] - order[b[1].impact] || b[1].totalNodes - a[1].totalNodes
);
for (const [rule, stat] of rules) {
  md += `| ${emoji[stat.impact]} ${stat.impact} | \`${rule}\` | ${stat.pages.size} / 16 | ${stat.totalNodes} | ${diagnostics[rule] || '-'} |\n`;
}

md += '\n## Findings por pantalla\n\n';
for (const r of out.sort((a, b) => a.spec.localeCompare(b.spec))) {
  const critical = r.violations.filter((v) => v.includes('[critical]')).length;
  const serious = r.violations.filter((v) => v.includes('[serious]')).length;
  const niceName = r.spec.replace('-a11y', '').replace(/-/g, ' ');
  md += `### ${r.jira} - ${niceName}\n\n`;
  md += `- **Ruta**: \`${r.route}\`\n`;
  md += `- **Spec**: \`tests/specs/a11y/${r.spec}.spec.ts\`\n`;
  md += `- **Resumen**: ${critical} critical + ${serious} serious = ${r.violations.length} categorias\n\n`;
  if (r.violations.length > 0) {
    md += '| Severity | Rule | Nodos |\n|---|---|---:|\n';
    for (const v of r.violations) {
      const m = v.match(/\[(\w+)\] (\S+): .+ \((\d+) nodes\)/);
      if (m) {
        md += `| ${emoji[m[1]]} ${m[1]} | \`${m[2]}\` | ${m[3]} |\n`;
      }
    }
    md += '\n';
  }
}

md += '## Recomendaciones priorizadas\n\n';
md += '### Bugs CRITICOS (bloquean WCAG 2.1 AA)\n\n';
md += '1. **`button-name`** - 16/16 pantallas, 64 nodos. Buttons icon-only del header/topbar (refresh, PDF, config columnas) y dropdowns no tienen accessible name. Fix Angular: agregar `[attr.aria-label]="\'buttons_labels_common.refresh\' | translate"` a cada `<button>` icon-only.\n\n';
md += '2. **`label`** - 10/16 pantallas, 19 nodos. Forms con `<input>` y `<ng-select>` sin label asociado. Fix: envolver con `<label>` o agregar `aria-label`. Para `ng-select`: usar `labelForId` + `<label [for]="...">`.\n\n';

md += '### Bugs SERIOS (deberia arreglar antes de release)\n\n';
md += '1. **`color-contrast`** - 16/16, **320 nodos** (el mayor volumen). Bug GLOBAL del theme: texto secundario (clases `text-muted`, `text-secondary`) con contrast ratio < 4.5:1. Fix: revisar variables CSS y oscurecer los textos secundarios.\n\n';
md += '2. **`html-has-lang`** - 16/16, 16 nodos. Bug GLOBAL Angular: `src/index.html` necesita `<html lang="en">` o dinamico desde `TranslateService` (`<html [attr.lang]="currentLang">`).\n\n';
md += '3. **`link-name`** - 16/16, 36 nodos. Links icon-only (config columnas con `<i class="mdi mdi-tune-variant">` dentro de `<a>`) sin `aria-label`. Idem button-name.\n\n';
md += '4. **`aria-progressbar-name`** - 11/16, 11 nodos. Spinners Bootstrap con `role="status"` o `role="progressbar"` sin `aria-label`. Fix: agregar `aria-label="Loading data"`.\n\n';
md += '5. **`autocomplete-valid`** - 7/16, 12 nodos. `autocomplete=` con valores invalidos HTML5. Usar valores estandar (`name`, `email`, `tel`, `off`).\n\n';

md += '## Cobertura\n\n';
const totalNodes = rules.reduce((acc, [_, s]) => acc + s.totalNodes, 0);
md += `- **16 / 16 pantallas baja-complejidad escaneadas** (Release V2.0.4)\n`;
md += `- **Total violations agregadas**: ${totalNodes} nodos en ${rules.length} reglas WCAG distintas\n`;
md += `- **Workflow CI**: \`.github/workflows/a11y.yml\` weekly lunes 08:00 UTC + workflow_dispatch on-demand\n\n`;

md += '## Trazabilidad\n\n';
md += '| MX | Pantalla | Spec | TC ID |\n|---|---|---|---|\n';
for (const r of out.sort((a, b) => a.jira.localeCompare(b.jira))) {
  const niceName = r.spec.replace('-a11y', '').replace(/-/g, ' ');
  md += `| ${r.jira} | ${niceName} | \`tests/specs/a11y/${r.spec}.spec.ts\` | \`${r.jira}-A11Y01\` |\n`;
}

md += '\n## Proximos pasos\n\n';
md += '1. **Reportar bugs criticos a dev**: abrir tickets Jira por `button-name` + `label` con lista de pantallas afectadas.\n';
md += '2. **Decidir threshold strict**: convertir specs a estrictos (`expect(violations).toEqual([])`) solo despues que dev arregle los 2 criticos globales.\n';
md += '3. **Re-ejecutar audit**: tras cada release UI, correr `npm run test:a11y` o dispatch del workflow y comparar con este baseline.\n';
md += '4. **Extender cobertura**: cuando se migren pantallas alta-complejidad (Map Viewer, Travel Detail, Forms CRUD), generar specs `@a11y` con mismo patron.\n';

fs.writeFileSync('./docs/qa/release-v2.0.4/a11y-audit-results.md', md);
console.log(`Generated ${md.length} chars at docs/qa/release-v2.0.4/a11y-audit-results.md`);
