// scripts/generate-dashboard.cjs
// FW-015 - Dashboard HTML consolidado (sin dependencias externas).
// Lee el reporter json de Playwright (evidence/<env>/results.json) y genera un
// indice HTML autocontenido con resumen por suite (carpeta de spec) + global:
// passed/failed/flaky/skipped, duracion, y desglose. Se sube como artifact en CI.
//
// Uso: node scripts/generate-dashboard.cjs [path/to/results.json]
// Default: evidence/${ENV:-test}/results.json -> escribe evidence/<env>/dashboard.html
const fs = require('fs');
const path = require('path');

const ENV = process.env.ENV || 'test';
const resultsPath = process.argv[2] || `evidence/${ENV}/results.json`;
const outPath = path.join(path.dirname(resultsPath), 'dashboard.html');

if (!fs.existsSync(resultsPath)) {
  console.error(`[dashboard] No existe ${resultsPath}. Corre la suite primero (reporter json).`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

// Suite = primer segmento de carpeta bajo tests/specs/ (smoke, regression, visual, a11y, ...).
function suiteOf(file) {
  const m = (file || '').replace(/\\/g, '/').match(/tests\/specs\/([^/]+)\//);
  return m ? m[1] : 'otros';
}

const bySuite = {};
let total = 0;
const tally = { passed: 0, failed: 0, flaky: 0, skipped: 0 };

function classify(t) {
  // Playwright json: test.results[].status + test.status (outcome agregado).
  const outcome = t.status || (t.results && t.results[0] && t.results[0].status) || 'unknown';
  if (outcome === 'expected' || outcome === 'passed') return 'passed';
  if (outcome === 'unexpected' || outcome === 'failed') return 'failed';
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'skipped') return 'skipped';
  return 'passed';
}

function visit(suite, file) {
  const f = suite.file || file;
  for (const s of suite.suites || []) visit(s, f);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      const suiteName = suiteOf(spec.file || f);
      bySuite[suiteName] = bySuite[suiteName] || { passed: 0, failed: 0, flaky: 0, skipped: 0 };
      const cls = classify({ status: spec.ok === false ? 'failed' : t.status, results: t.results });
      bySuite[suiteName][cls]++;
      tally[cls]++;
      total++;
    }
  }
}
for (const s of data.suites || []) visit(s, s.file);

const durationMs = (data.stats && data.stats.duration) || 0;
const startTime = (data.stats && data.stats.startTime) || new Date().toISOString();
const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

const suiteRows = Object.entries(bySuite)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([name, s]) => {
    const subtotal = s.passed + s.failed + s.flaky + s.skipped;
    return `<tr>
      <td>${name}</td>
      <td class="num">${subtotal}</td>
      <td class="num ok">${s.passed}</td>
      <td class="num bad">${s.failed}</td>
      <td class="num warn">${s.flaky}</td>
      <td class="num muted">${s.skipped}</td>
    </tr>`;
  })
  .join('\n');

const statusColor = tally.failed > 0 ? '#c0392b' : tally.flaky > 0 ? '#d68910' : '#1e8449';
const statusLabel = tally.failed > 0 ? 'FAILED' : tally.flaky > 0 ? 'FLAKY' : 'PASSED';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA Dashboard — carrier V2 (${ENV})</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f4f6f8; color: #222; }
  header { background: ${statusColor}; color: #fff; padding: 24px 32px; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header .meta { opacity: .85; font-size: 13px; }
  .badge { display: inline-block; background: rgba(255,255,255,.2); padding: 4px 12px; border-radius: 4px; font-weight: 700; letter-spacing: 1px; }
  main { padding: 24px 32px; max-width: 900px; }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
  .card { flex: 1; min-width: 120px; background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .card .n { font-size: 28px; font-weight: 700; }
  .card .l { font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: .5px; }
  .ok { color: #1e8449; } .bad { color: #c0392b; } .warn { color: #d68910; } .muted { color: #888; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #fafafa; font-size: 12px; text-transform: uppercase; color: #888; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  footer { padding: 16px 32px; color: #999; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>QA Dashboard — carrier V2 <span class="badge">${statusLabel}</span></h1>
  <div class="meta">ENV: ${ENV} · ${total} tests · ${(durationMs / 1000).toFixed(1)}s · ${startTime}</div>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="n">${total}</div><div class="l">Total</div></div>
    <div class="card"><div class="n ok">${tally.passed}</div><div class="l">Passed ${pct(tally.passed)}%</div></div>
    <div class="card"><div class="n bad">${tally.failed}</div><div class="l">Failed</div></div>
    <div class="card"><div class="n warn">${tally.flaky}</div><div class="l">Flaky</div></div>
    <div class="card"><div class="n muted">${tally.skipped}</div><div class="l">Skipped</div></div>
  </div>
  <table>
    <thead><tr><th>Suite</th><th class="num">Total</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Flaky</th><th class="num">Skipped</th></tr></thead>
    <tbody>
${suiteRows || '<tr><td colspan="6" class="muted">Sin datos</td></tr>'}
    </tbody>
  </table>
</main>
<footer>Generado por scripts/generate-dashboard.cjs (FW-015) — consume el reporter json de Playwright.</footer>
</body>
</html>`;

fs.writeFileSync(outPath, html);
console.log(
  `[dashboard] ${total} tests (${tally.passed} ok, ${tally.failed} fail, ${tally.flaky} flaky, ${tally.skipped} skip) -> ${outPath}`
);
