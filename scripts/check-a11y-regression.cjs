// scripts/check-a11y-regression.cjs
// FW-011 - Gate suave de regresion a11y.
// Lee el resultado del run (evidence/<env>/results.json del reporter json) y agrega
// las violations a11y por regla (annotations type=a11y_violation que pushean los specs
// @a11y). Compara contra tests/fixtures/a11y-baseline.json:
//   - Si una regla SUPERA su baseline -> REGRESION -> exit 1 (falla el job).
//   - Si esta igual o por debajo -> exit 0.
// Reglas nuevas (no en baseline) con nodos > 0 tambien cuentan como regresion.
//
// Uso: node scripts/check-a11y-regression.cjs [path/to/results.json]
// Default: evidence/${ENV:-test}/results.json
const fs = require('fs');
const path = require('path');

const ENV = process.env.ENV || 'test';
const resultsPath = process.argv[2] || `evidence/${ENV}/results.json`;
const baselinePath = path.join('tests', 'fixtures', 'a11y-baseline.json');

function fail(msg) {
  console.error(`[a11y-gate] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(resultsPath)) {
  fail(`No existe ${resultsPath}. Corre la suite @a11y primero (genera el reporter json).`);
}
if (!fs.existsSync(baselinePath)) {
  fail(`No existe ${baselinePath}.`);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

// Extrae todas las annotations a11y_violation del JSON reporter de Playwright.
// Formato annotation.description: "[impact] rule: descripcion (N nodes)".
const current = {};
function visitSuite(suite) {
  for (const s of suite.suites || []) visitSuite(s);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      for (const r of t.results || []) {
        for (const a of r.annotations || []) {
          if (a.type !== 'a11y_violation' || !a.description) continue;
          const m = a.description.match(/\[(\w+)\]\s+(\S+):.*\((\d+)\s+nodes?\)/);
          if (!m) continue;
          const rule = m[2];
          const nodes = parseInt(m[3], 10);
          current[rule] = (current[rule] || 0) + nodes;
        }
      }
    }
  }
}
for (const s of results.suites || []) visitSuite(s);

// Compara contra baseline.
const regressions = [];
const improvements = [];
const allRules = new Set([...Object.keys(baseline.byRule), ...Object.keys(current)]);
for (const rule of allRules) {
  const base = baseline.byRule[rule] || 0;
  const now = current[rule] || 0;
  if (now > base) regressions.push({ rule, base, now, delta: now - base });
  else if (now < base) improvements.push({ rule, base, now, delta: now - base });
}

const totalNow = Object.values(current).reduce((a, b) => a + b, 0);
console.log(`[a11y-gate] baseline total=${baseline.totalNodes} | actual total=${totalNow}`);
console.log(`[a11y-gate] reglas actuales:`, JSON.stringify(current));

if (improvements.length > 0) {
  console.log(
    `[a11y-gate] ✓ mejoras detectadas (bajar baseline en a11y-baseline.json):`,
    improvements.map((i) => `${i.rule} ${i.base}->${i.now}`).join(', ')
  );
}

if (regressions.length > 0) {
  console.error(`[a11y-gate] ✗ REGRESION a11y detectada (${regressions.length} regla/s):`);
  for (const r of regressions) {
    console.error(`  - ${r.rule}: baseline ${r.base} -> actual ${r.now} (+${r.delta} nodos)`);
  }
  console.error(
    `[a11y-gate] El gate falla porque las violations crecieron. Arregla la regresion o,` +
      ` si el aumento es esperado y aceptado, actualiza tests/fixtures/a11y-baseline.json.`
  );
  process.exit(1);
}

console.log(`[a11y-gate] ✓ sin regresiones a11y (todas las reglas <= baseline).`);
process.exit(0);
