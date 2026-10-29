/**
 * Xray Reporter (fase B — cableado Test ↔ automatización)
 *
 * Emite un archivo en formato **Xray JSON** con el resultado de cada spec que
 * declare su key de Test de Xray. El import posterior (fase C, en CI) matchea por
 * `testKey` de forma determinística — sin duplicar Tests Generic en cada corrida:
 *
 *   bun xray import xray --file evidence/<env>/xray-results.json
 *
 * Binding spec ↔ Test (en este orden de prioridad):
 *   1. annotation `tms`:       test.info().annotations.push({ type: 'tms', description: 'MX-6133' })
 *      (convención existente del org — misma que usan Allure links y carrier-v2)
 *   2. annotation `test_key`:  alias aceptado
 *   3. título:                 test('[MX-6133] ...', ...)   → se parsea la primera key AAA-123
 *
 * Consolidación por testKey (tests/utils/reporters/xray-consolidate.ts): cada test()
 * que acredita una key aporta una FILA (status/skipped/title/skipReason/start/finish/
 * comment). Si hay ≥1 fila EJECUTADA → status = peor estado entre las ejecutadas, orden
 * FAILED > ABORTED > PASSED; las filas con test.skip() estructural (fila no aplicable al
 * entorno, ej. parámetro inexistente en ese ambiente) NO participan de ese cómputo — un
 * skip nunca degrada un testKey que ya tiene evidencia ejecutada. Si TODAS las filas son
 * skip → TODO. El comment conserva el error de la fila fallida ganadora y SIEMPRE suma,
 * si hay skips, una sección auditable con título + motivo de cada fila omitida.
 *
 * Specs SIN key NO se exportan (no están mapeados a un Test de Xray); se reporta
 * el conteo al final para que el gap sea visible y no un drop silencioso.
 *
 * Config (playwright.config.ts):
 *   ['./tests/utils/reporters/xray-reporter.ts', { outputFile: `evidence/${env}/xray-results.json` }]
 *
 * Env opcionales (los setea el step de CI):
 *   XRAY_EXECUTION_KEY  → se escribe como testExecutionKey (importa contra un ATR existente)
 *   XRAY_PROJECT_KEY    → info.project (proyecto Xray donde crear el ATR nuevo, ej. "TM" —
 *                         es el TMS_PROJECT_KEY que aloja las entidades Xray, no necesariamente
 *                         el project_key de producto). Sin XRAY_EXECUTION_KEY, Xray Cloud NO
 *                         rechaza un import sin info.project ni un valor equivocado: crea el ATR
 *                         igual y no matchea ningún testKey si el proyecto es otro — "sincronizado"
 *                         sin acreditar nada. Verificar siempre leyendo Xray, no la salida del import.
 *   XRAY_TEST_PLAN_KEY  → info.testPlanKey (crea/asocia la ejecución al ATP)
 *   XRAY_SUMMARY        → info.summary (si se crea una ejecución nueva)
 *   XRAY_VERSION        → info.version = fixVersion (si se crea una ejecución nueva)
 *   XRAY_KEY_ALLOWLIST  → CSV de keys aceptadas (ej. "TM-1084,TM-1085"). Si está seteada, toda
 *                         key fuera de la lista se DESCARTA (no se emite) y se cuenta en el log:
 *                         evita que el import agregue al ATR un Test que no es miembro o pise
 *                         runs de otra familia. Vacía o ausente = sin filtro.
 *
 * Defecto conocido / observacion (circuito FR 1901, helpers/acceptance.ts):
 *   - annotation `known-issue` (AC-FR-NN + nota): un test EJECUTADO que paso en Playwright se acredita
 *     FAILED en Xray (un defecto conocido nunca deja el run en verde); el comment lista los AC-FR y
 *     las notas. Un test omitido (skip) no hereda ese estado. Playwright puede seguir en verde.
 *   - annotation `observation` (pregunta abierta al PO): se anexa al comment, NO cambia el estado.
 *
 * Verdict gate (evidence-conventions §4): cada key emitida lleva, también en PASSED,
 *   - `comment` de medición en español: veredicto, qué se ejecutó (título + proyecto) y qué
 *     devolvió — el texto que el test empuja como annotation `xray_comment` (una o varias) —,
 *     más hallazgos conocidos (`known-defect`), error redactado si falló, filas omitidas y la
 *     lista de adjuntos. Tope MAX_COMMENT_CHARS (límite práctico de Xray).
 *   - `evidence[]`: adjuntos image/png y application/json del test (`testInfo.attach`), en
 *     base64 con filename y contentType. Los JSON se redactan (claves sensibles por substring +
 *     tokens por forma: Bearer / JWT) ANTES de codificarse. Tope MAX_EVIDENCE_PER_KEY por key.
 *   - Sin evidencia no hay veredicto: un PASSED/FAILED sin ningún adjunto se RETIENE — se emite
 *     TODO con el motivo en el comment, se avisa por consola y onEnd devuelve status 'failed'
 *     (exit code != 0) para que el orquestador no importe un veredicto desnudo.
 *   - Un skip (también el que ocurre al final de un test ya ejecutado, p. ej. TM-1279) conserva
 *     sus adjuntos: si todas las filas de la key son skip, el TODO lleva la medición que cita.
 *   - Un PASSED en reintento (retry > 0) se marca en el comment: el intento previo falló.
 *   - El recorte a MAX_COMMENT_CHARS nunca pierde el veredicto, la línea de Limpieza (datos
 *     huérfanos) ni la lista de adjuntos: se recortan primero el detalle y el error.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { consolidateRows } from './xray-consolidate.js';
import type { ConsolidatedResult, RowResult, XrayStatus } from './xray-consolidate.js';
import { redactSensitiveText } from '../redact.js';
import {
  ENV_DOWN_FLAG,
  ENV_FLAKY_LABEL,
  ENV_RETRY_ANNOTATION,
  isNavigationNetworkError,
  networkErrorCode
} from '../envAvailability.js';

// Adjunto embebido en el import de Xray Cloud (`evidence[]` por test).
interface XrayEvidence {
  data: string;
  filename: string;
  contentType: string;
}

interface XrayTestResult extends ConsolidatedResult {
  testKey: string;
  evidence?: XrayEvidence[];
}

// Datos por corrida que no participan de la consolidación de estado (xray-consolidate.ts)
// pero sí del comment de medición y de la evidencia de la key.
interface RowExtras {
  status: XrayStatus;
  skipped: boolean;
  retry: number;
  title: string;
  project: string;
  measurements: string[];
  knownDefects: string[];
  /** Annotations `known-issue` (AC-FR-NN + nota): el run queda FAILED aunque el test no falle. */
  knownIssues: string[];
  /** Annotations `observation` (preguntas abiertas al PO): se anexan al comment, nunca cambian el estado. */
  observations: string[];
  evidence: XrayEvidence[];
  /** Key con ACs propios (annotation `tms_acs`): resumen de sus AC-FR (PASS/FAIL/sin ejecutar) para el comment. */
  acSummary?: string;
  /** Annotations `env-retry` de BasePage: navegacion inicial reintentada por error de red. */
  envRetries: string[];
  /** Codigo net::ERR_* del intento previo descartado (solo si este resultado es un reintento). */
  priorEnvFailure?: string;
  /** El resultado final fallo por una navegacion sin respuesta del servidor. */
  envFailure?: string;
}

interface ReporterOptions {
  outputFile?: string;
}

const MAX_EVIDENCE_PER_KEY = 3;
const MAX_COMMENT_CHARS = 1500;
/** Tope del error de una corrida dentro del comment (deja lugar a limpieza y adjuntos). */
const MAX_ERROR_CHARS = 500;
/** Tope de cada línea crítica (limpieza) para que una sola no se coma todo el comment. */
const MAX_CRITICAL_LINE_CHARS = 400;
const CLEANUP_MEASUREMENT = /^\s*Limpieza:/;
const EVIDENCE_CONTENT_TYPES = new Set(['image/png', 'application/json']);
const MEASUREMENT_ANNOTATION = 'xray_comment';
const KNOWN_DEFECT_ANNOTATION = 'known-defect';
const KNOWN_ISSUE_ANNOTATION = 'known-issue';
const OBSERVATION_ANNOTATION = 'observation';
/** Resultado por AC-FR (verifyAc): `AC-FR-NN PASS|FAIL`. */
const AC_ANNOTATION = 'ac';
/** Ligadura key -> ACs (makeAnnotate): `TM-1445: AC-FR-01, AC-FR-02`. Sin ella la key usa el estado del test. */
const KEY_ACS_ANNOTATION = 'tms_acs';
const AC_ID = /\bAC-[A-Z]+-\d+\b/g;
/** Tope de lineas y de largo por linea de las notas known-issue / observation dentro del comment. */
const MAX_NOTE_LINES = 5;
const MAX_NOTE_CHARS = 260;
/** Presupuesto de caracteres de cada bloque de notas (el comment total tiene tope MAX_COMMENT_CHARS). */
const KNOWN_ISSUE_BUDGET = 650;
const OBSERVATION_BUDGET = 450;

// Fragmentos de nombre de clave cuyo VALOR se reemplaza en un adjunto JSON, sin importar su
// tipo (string, número, objeto). Match por SUBSTRING sobre el nombre normalizado (minúsculas,
// sin '-' ni '_'): cubre sessionToken, authToken, originToken, x-api-key, client_secret, etc.
// Los valores con forma de token bajo una clave de nombre arbitrario (p. ej. `carrier-0`) los
// tacha redactSensitiveText (Bearer / JWT por forma).
const SENSITIVE_JSON_KEY_FRAGMENTS = [
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'webhook',
  'apikey',
  'privatekey',
  'jwt',
  'bearer'
];
const REDACTED = '[REDACTED]';

// Tipos de annotation que portan la key del Test de Xray (orden = prioridad).
// 'tms' es la convención CANÓNICA del portafolio (contrato de consistencia + HUB).
// 'jira' es un PUENTE legacy: gran parte de los specs V2 aún empujan type:'jira'
// (migrar a 'tms' vía tests/utils/traceability.ts). Sin este alias quedaban sin mapear.
const KEY_ANNOTATION_TYPES = ['tms', 'test_key', 'jira'];
const KEY_IN_TITLE = /\b([A-Z][A-Z0-9]+-\d+)\b/;
// Secuencias ANSI de color (ESC[..m). ESC via fromCharCode para evitar escapes de control.
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

// Barrera defensiva de redacción: este repo no tiene un componente de API propio
// (E2E vía UI), pero un error de fetch (auth setup, request directo desde un spec,
// etc.) puede igual traer headers sensibles en su .message -- redactar ACÁ, antes
// de escribir el comment del run de Xray, evita que un token llegue en texto plano
// al destino final del volcado.
function clean(text: string): string {
  return redactSensitiveText(text.replace(ANSI, '')).trim();
}

function mapStatus(status: TestResult['status']): XrayStatus {
  switch (status) {
    case 'passed':
      return 'PASSED';
    case 'failed':
    case 'timedOut':
      return 'FAILED';
    case 'interrupted':
      return 'ABORTED';
    case 'skipped':
      return 'TODO';
    default:
      return 'FAILED';
  }
}

// Todas las keys del test (un test compuesto puede acreditar varios Tests de Xray). Usa el primer
// tipo de annotation que tenga keys (tms > test_key > jira) y, sin ninguna, la [KEY] del título.
function extractTestKeys(test: TestCase, result: TestResult): string[] {
  const all = [...test.annotations, ...(result.annotations ?? [])];
  for (const type of KEY_ANNOTATION_TYPES) {
    const keys = all
      .filter((a) => a.type === type && a.description?.trim())
      .map((a) => (a.description as string).trim());
    if (keys.length > 0) return [...new Set(keys)];
  }
  const m = KEY_IN_TITLE.exec(test.title);
  return m?.[1] ? [m[1]] : [];
}

/** key -> ACs a los que está atada (annotation `tms_acs`). Las keys ausentes usan el estado del test. */
function extractKeyAcs(test: TestCase, result: TestResult): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const text of annotationTexts(test, result, KEY_ACS_ANNOTATION)) {
    const m = /^\s*([A-Z][A-Z0-9]+-\d+)\s*:\s*(.+)$/.exec(text);
    const ids = m ? (m[2].match(AC_ID) ?? []) : [];
    if (m && ids.length > 0) map.set(m[1], [...new Set([...(map.get(m[1]) ?? []), ...ids])]);
  }
  return map;
}

/** AC-FR-NN -> PASS|FAIL según las annotations `ac` (FAIL gana si el id se repite). */
function extractAcOutcomes(test: TestCase, result: TestResult): Map<string, 'PASS' | 'FAIL'> {
  const outcomes = new Map<string, 'PASS' | 'FAIL'>();
  for (const text of annotationTexts(test, result, AC_ANNOTATION)) {
    const m = /^(AC-[A-Z]+-\d+)\s+(PASS|FAIL)\b/.exec(text);
    if (!m) continue;
    const status = m[2] as 'PASS' | 'FAIL';
    if (outcomes.get(m[1]) !== 'FAIL') outcomes.set(m[1], status);
  }
  return outcomes;
}

const KNOWN_ISSUE_AC = /^(AC-[A-Z]+-\d+)/;

interface KeyAcEvaluation {
  /** undefined = ningún AC de la key se ejecutó (TODO). */
  status?: 'PASSED' | 'FAILED';
  summary: string;
  scopedKnownIssues: string[];
}

/**
 * Estado de una key atada a ACs: FAILED si alguno de sus ACs falló o tiene known-issue; PASSED si
 * ejecutó al menos uno y todos los ejecutados pasaron; sin ACs ejecutados -> sin status (TODO).
 * Los known-issue de otros ACs no la afectan.
 */
export function evaluateKeyAcs(
  acs: string[],
  outcomes: Map<string, 'PASS' | 'FAIL'>,
  knownIssues: string[]
): KeyAcEvaluation {
  const scopedKnownIssues = knownIssues.filter((n) =>
    acs.includes(KNOWN_ISSUE_AC.exec(n)?.[1] ?? '')
  );
  const parts = acs.map((id) => `${id} ${outcomes.get(id) ?? 'sin ejecutar'}`);
  const summary = `ACs de la key (${acs.length}): ${parts.join('; ')}`;
  const executed = acs.filter((id) => outcomes.has(id));
  if (executed.length === 0) return { summary, scopedKnownIssues };
  const failed = executed.some((id) => outcomes.get(id) === 'FAIL') || scopedKnownIssues.length > 0;
  return { status: failed ? 'FAILED' : 'PASSED', summary, scopedKnownIssues };
}

// Motivo de un test.skip(cond, 'motivo') estructural — Playwright lo guarda como
// annotation type:'skip' (runtime, en result.annotations; a veces también reflejada
// en test.annotations). Sin descripción declarada (skip sin motivo) → texto explícito
// en vez de un comment vacío.
function extractSkipReason(test: TestCase, result: TestResult): string {
  const all = [...test.annotations, ...(result.annotations ?? [])];
  const ann = all.find((a) => a.type === 'skip' && a.description);
  return ann?.description?.trim() || 'sin motivo declarado';
}

// Descripciones de un tipo de annotation, estáticas (test.annotations) y runtime
// (result.annotations), sin duplicados y en orden de aparición.
function annotationTexts(test: TestCase, result: TestResult, type: string): string[] {
  const all = [...test.annotations, ...(result.annotations ?? [])];
  const texts = all
    .filter((a) => a.type === type && a.description?.trim())
    .map((a) => clean(a.description as string));
  return [...new Set(texts)];
}

function projectName(test: TestCase): string {
  return test.parent?.project?.()?.name ?? '';
}

function normalizeKeyName(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function isSensitiveJsonKey(key: string): boolean {
  const normalized = normalizeKeyName(key);
  return SENSITIVE_JSON_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

// Redacción estructural de un JSON: el valor de toda clave sensible se reemplaza por
// completo (cualquier tipo); los strings restantes pasan por redactSensitiveText por si traen
// un header, un "token=...", un Bearer o un JWT suelto.
function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveJsonKey(key) ? REDACTED : redactJsonValue(inner);
    }
    return out;
  }
  if (typeof value === 'string') return redactSensitiveText(value);
  return value;
}

// JSON inválido → se redacta como texto (mejor adjunto redactado que perder la evidencia).
export function redactJsonText(text: string): string {
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(text)), null, 2);
  } catch {
    return redactSensitiveText(text);
  }
}

function evidenceFilename(att: TestResult['attachments'][number]): string {
  if (att.path) return basename(att.path);
  const ext = att.contentType === 'application/json' ? '.json' : '.png';
  const safe = att.name.replace(/[^\w.-]+/g, '_') || 'adjunto';
  return safe.toLowerCase().endsWith(ext) ? safe : `${safe}${ext}`;
}

// Adjuntos png/json del test → evidence[] (base64). Un artefacto ausente en disco
// (ENOENT, típico con OneDrive) se omite sin romper el reporte.
function collectEvidence(result: TestResult): XrayEvidence[] {
  const evidence: XrayEvidence[] = [];
  for (const att of result.attachments) {
    if (!EVIDENCE_CONTENT_TYPES.has(att.contentType)) continue;
    let raw: Buffer;
    try {
      raw = att.body ?? (att.path ? readFileSync(att.path) : Buffer.alloc(0));
    } catch {
      continue;
    }
    if (raw.length === 0) continue;
    const data =
      att.contentType === 'application/json'
        ? Buffer.from(redactJsonText(raw.toString('utf-8')), 'utf-8').toString('base64')
        : raw.toString('base64');
    evidence.push({ data, filename: evidenceFilename(att), contentType: att.contentType });
  }
  return evidence;
}

/** Decodifica el json (ya redactado) de un adjunto de evidencia; null si no es JSON válido. */
function decodeJsonEvidence(ev: XrayEvidence): unknown {
  try {
    return JSON.parse(Buffer.from(ev.data, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

// Medición consolidada de una key con varias filas ejecutadas: una entrada por fila (título,
// proyecto, estado y los json de medición que adjuntó). Se arma de los adjuntos ya redactados.
function consolidatedMeasurement(testKey: string, source: RowExtras[]): XrayEvidence | undefined {
  const rows = source.filter((e) => !e.skipped);
  const hasJson = rows.some((e) => e.evidence.some((ev) => ev.contentType === 'application/json'));
  if (rows.length < 2 || !hasJson) return undefined;
  const payload = {
    testKey,
    rows: rows.map((e) => ({
      title: e.title,
      project: e.project,
      status: e.status,
      measurements: e.evidence
        .filter((ev) => ev.contentType === 'application/json')
        .map((ev) => ({ file: ev.filename, data: decodeJsonEvidence(ev) }))
    }))
  };
  const data = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8').toString('base64');
  return {
    data,
    filename: `medicion-consolidada${testKey ? `-${testKey}` : ''}.json`,
    contentType: 'application/json'
  };
}

// Evidencia de la key: primero las corridas que determinaron el veredicto (en un FAILED,
// la evidencia del fallo), luego el resto de las ejecutadas; sin repetir filename ni contenido y con
// tope. Dos pasadas: (1) el primer png de CADA fila (dos tests que comparten key, p. ej. dos
// variantes, publican una imagen cada uno); (2) el resto. El tope es absoluto. En FAILED, antes de
// todo, va la evidencia completa de las filas fallidas.
// Si TODAS las filas son skip (TODO), la evidencia sale de ellas: un skip al final de un test
// ya ejecutado (TM-1279) conserva la medición que su motivo cita.
function pickEvidence(extras: RowExtras[], status: XrayStatus, testKey = ''): XrayEvidence[] {
  const executed = extras.filter((e) => !e.skipped);
  const source = executed.length > 0 ? executed : extras;
  const ordered = [
    ...source.filter((e) => e.status === status),
    ...source.filter((e) => e.status !== status)
  ];
  const picked: XrayEvidence[] = [];
  const seenNames = new Set<string>();
  const seenData = new Set<string>();
  const take = (ev: XrayEvidence): void => {
    if (picked.length >= MAX_EVIDENCE_PER_KEY) return;
    seenNames.add(ev.filename);
    seenData.add(ev.data);
    picked.push(ev);
  };
  const isNew = (ev: XrayEvidence): boolean =>
    !seenNames.has(ev.filename) && !seenData.has(ev.data);
  // Varias filas ejecutadas con la misma key: UN json consolidado con la medición de TODAS las
  // filas va primero y siempre (el tope de 3 no lo desplaza); los png por fila rellenan el resto.
  const consolidatedJson = consolidatedMeasurement(testKey, source);
  if (consolidatedJson) take(consolidatedJson);
  // FAILED: toda la evidencia de las filas que fallaron va primero (png + json, en orden).
  if (status === 'FAILED') {
    for (const e of ordered.filter((r) => r.status === status)) {
      for (const ev of e.evidence) if (isNew(ev)) take(ev);
    }
  }
  for (const e of ordered) {
    const firstPng = e.evidence.find((ev) => ev.contentType === 'image/png' && isNew(ev));
    if (firstPng) take(firstPng);
  }
  for (const e of ordered) {
    for (const ev of e.evidence) if (isNew(ev)) take(ev);
  }
  return picked;
}

const VERDICT_LABEL: Record<XrayStatus, string> = {
  PASSED: 'PASSED (aprobado)',
  FAILED: 'FAILED (fallido)',
  ABORTED: 'ABORTED (interrumpido)',
  TODO: 'TODO (no ejecutado: todas las corridas omitidas)'
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(max - 1, 0))}…` : text;
}

/** Lista acotada de notas (una por linea, `- `), con el resto resumido en una linea final. */
function noteLines(notes: string[], maxLines: number, budget: number): string {
  const shown = notes.slice(0, maxLines).map((n) => `- ${truncate(n, MAX_NOTE_CHARS)}`);
  const fitted = fitFairShare(shown, budget);
  if (notes.length > maxLines) fitted.push(`- (+${notes.length - maxLines} más)`);
  return fitted.join('\n');
}

/**
 * Un defecto conocido (annotation `known-issue`) nunca deja el run en verde: un test ejecutado que
 * pasó en Playwright se acredita FAILED en Xray. Un test omitido (skip) no hereda el estado: no corrió.
 */
export function applyKnownIssueStatus(
  status: XrayStatus,
  skipped: boolean,
  knownIssues: string[]
): XrayStatus {
  return !skipped && status === 'PASSED' && knownIssues.length > 0 ? 'FAILED' : status;
}

// Clasificación de ambiente (capa 1 del plan de remediación de flaky, 2026-10-08). Distingue el
// servidor sin respuesta de una falla del test: `env-flaky` cuando el resultado final pasó pero
// hubo un error de red en la navegación (reintento de BasePage o intento previo descartado), y
// `ambiente` cuando el resultado final cayó por esa misma causa.
export function classifyEnvironment(
  extras: Pick<RowExtras, 'skipped' | 'envRetries' | 'priorEnvFailure' | 'envFailure'>[]
): string | undefined {
  const executed = extras.filter((e) => !e.skipped);
  const finalEnvFailures = [
    ...new Set(extras.flatMap((e) => (e.envFailure ? [e.envFailure] : [])))
  ];
  if (finalEnvFailures.length > 0 && executed.length === 0) {
    return (
      `Clasificación: ambiente (${finalEnvFailures.join(', ')} en la navegación inicial). ` +
      'El servidor no respondió; no es un resultado del producto ni del test. Re-ejecutar con el ambiente disponible.'
    );
  }
  const signals = [
    ...finalEnvFailures.map((code) => `otra corrida de la key cayó con ${code}`),
    ...executed.flatMap((e) =>
      e.priorEnvFailure ? [`intento previo con ${e.priorEnvFailure}`] : []
    ),
    ...executed.flatMap((e) => e.envRetries)
  ];
  if (signals.length === 0) return undefined;
  return `Clasificación: ${ENV_FLAKY_LABEL} (${[...new Set(signals)].join('; ')}). El resultado vale: la falla previa fue del ambiente, no del test.`;
}

/** Recorta cada texto a un tope común tal que la suma (más saltos de línea) entre en `budget`. */
export function fitFairShare(items: string[], budget: number): string[] {
  const available = Math.max(budget - (items.length - 1), 0);
  if (items.reduce((sum, t) => sum + t.length, 0) <= available) return items;
  let lo = 1;
  let hi = Math.max(...items.map((t) => t.length));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const total = items.reduce((sum, t) => sum + Math.min(t.length, mid), 0);
    if (total <= available) lo = mid;
    else hi = mid - 1;
  }
  return items.map((t) => truncate(t, lo));
}

// Comment de medición del run (español). Presupuesto de MAX_COMMENT_CHARS: el veredicto (y la
// retención, si la hay) va primero; la línea de Limpieza y la lista de adjuntos van al final y
// NUNCA se recortan (salvo su tope por línea); el detalle del medio (ejecutado, medición,
// hallazgos, error, filas omitidas) se recorta para caber.
function buildRunComment(
  consolidated: ConsolidatedResult,
  extras: RowExtras[],
  evidence: XrayEvidence[],
  withheldStatus?: XrayStatus
): string {
  const executed = extras.filter((e) => !e.skipped);
  const source = executed.length > 0 ? executed : extras;
  const executedLines = source.map(
    (e) =>
      `- ${e.title}${e.project ? ` [${e.project}]` : ''}` +
      (e.retry > 0
        ? e.priorEnvFailure
          ? ` (reintento ${e.retry}: el intento previo falló por el ambiente, ${e.priorEnvFailure} en la navegación inicial)`
          : ` (reintento ${e.retry}: el intento previo NO pasó)`
        : '')
  );
  const measurements = [...new Set(source.flatMap((e) => e.measurements))];
  const cleanupLines = measurements.filter((m) => CLEANUP_MEASUREMENT.test(m));
  const otherMeasurements = measurements.filter((m) => !CLEANUP_MEASUREMENT.test(m));
  const knownDefects = [...new Set(extras.flatMap((e) => e.knownDefects))];
  const knownIssues = [...new Set(executed.flatMap((e) => e.knownIssues))];
  const observations = [...new Set(source.flatMap((e) => e.observations))];

  const head: string[] = [`Veredicto: ${VERDICT_LABEL[consolidated.status]}`];
  head.push(...new Set(extras.flatMap((e) => (e.acSummary ? [e.acSummary] : []))));
  if (knownIssues.length > 0) {
    head.push(
      `Defecto conocido (${knownIssues.length}): el run queda FAILED aunque el test de Playwright no falle; ` +
        `pasa a verde solo cuando se corrige el defecto.\n${noteLines(knownIssues, MAX_NOTE_LINES, KNOWN_ISSUE_BUDGET)}`
    );
  }
  const envClassification = classifyEnvironment(extras);
  if (envClassification) head.push(envClassification);
  if (withheldStatus) {
    head.push(
      `Veredicto retenido: la corrida dio ${withheldStatus} pero no adjuntó evidencia (png/json); ` +
        'sin evidencia publicada no se emite PASSED ni FAILED (evidence-conventions §4).'
    );
  }
  const executedSection = `Ejecutado (${source.length} corrida(s)):\n${executedLines.join('\n')}`;
  const trailing: string[] = [];
  if (knownDefects.length > 0) {
    trailing.push(`Hallazgos conocidos:\n${knownDefects.map((d) => `- ${d}`).join('\n')}`);
  }
  if (observations.length > 0) {
    trailing.push(
      `Observaciones al PO (no cambian el estado del run):\n${noteLines(observations, 8, OBSERVATION_BUDGET)}`
    );
  }
  if (consolidated.comment) trailing.push(consolidated.comment);
  const tail: string[] = [
    ...cleanupLines.map((line) => truncate(line.trim(), MAX_CRITICAL_LINE_CHARS)),
    evidence.length > 0
      ? `Evidencia adjunta: ${evidence.map((e) => e.filename).join(', ')}`
      : 'Evidencia adjunta: ninguna (el test no adjuntó png/json).'
  ];

  const separator = '\n\n';
  const fixed = [...head, ...tail].join(separator).length + 2 * separator.length;
  // Las mediciones comparten el presupuesto en partes iguales (las cortas conservan todo): una key
  // con varias filas no pierde la última fila por recorte del final.
  const measurementHeader = 'Medición (qué devolvió):\n';
  const measurementBudget =
    MAX_COMMENT_CHARS -
    fixed -
    [executedSection, ...trailing].join(separator).length -
    (trailing.length + 2) * separator.length -
    measurementHeader.length;
  const measurementSection =
    otherMeasurements.length > 0
      ? `${measurementHeader}${fitFairShare(otherMeasurements, measurementBudget).join('\n')}`
      : 'Medición (qué devolvió): el test no declaró medición (annotation xray_comment).';
  const middle = [executedSection, measurementSection, ...trailing];
  const middleText = truncate(middle.join(separator), Math.max(MAX_COMMENT_CHARS - fixed, 0));
  const text = [...head, ...(middleText ? [middleText] : []), ...tail].join(separator);
  return truncate(text, MAX_COMMENT_CHARS);
}

function parseAllowlist(raw: string | undefined): Set<string> | undefined {
  const keys = (raw ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.length > 0 ? new Set(keys) : undefined;
}

class XrayReporter implements Reporter {
  private readonly outputFile: string;
  private readonly rows = new Map<string, RowResult[]>();
  private readonly extras = new Map<string, RowExtras[]>();
  private readonly allowlist: Set<string> | undefined;
  private readonly discarded = new Set<string>();
  private discardedRows = 0;
  private unmapped = 0;
  // Causa de red del último intento descartado por retry, por test (título + proyecto). La lee el
  // reintento siguiente para clasificar env-flaky.
  private readonly priorEnvFailures = new Map<string, string>();

  constructor(options: ReporterOptions = {}) {
    this.outputFile =
      options.outputFile ?? process.env.XRAY_RESULTS_FILE ?? 'evidence/xray-results.json';
    this.allowlist = parseAllowlist(process.env.XRAY_KEY_ALLOWLIST);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Ignorar corridas intermedias de retry: solo el resultado final cuenta. Un 'skipped' nunca
    // se reintenta (Playwright), así que siempre es final aunque retry < retries: se conserva.
    const attemptKey = `${test.title}|${projectName(test)}`;
    if (result.status !== 'passed' && result.status !== 'skipped' && result.retry < test.retries) {
      const message = result.error?.message;
      if (isNavigationNetworkError(message)) {
        this.priorEnvFailures.set(attemptKey, networkErrorCode(message) as string);
      } else {
        this.priorEnvFailures.delete(attemptKey);
      }
      return;
    }
    const priorEnvFailure = result.retry > 0 ? this.priorEnvFailures.get(attemptKey) : undefined;
    this.priorEnvFailures.delete(attemptKey);
    const envFailure =
      result.status !== 'passed' &&
      result.status !== 'skipped' &&
      isNavigationNetworkError(result.error?.message)
        ? (networkErrorCode(result.error?.message) as string)
        : undefined;

    const testKeys = extractTestKeys(test, result);
    if (testKeys.length === 0) {
      this.unmapped++;
      return;
    }
    const keyAcs = extractKeyAcs(test, result);
    const outcomes = extractAcOutcomes(test, result);
    const evidence = collectEvidence(result);
    for (const testKey of testKeys) {
      if (this.allowlist && !this.allowlist.has(testKey)) {
        this.discarded.add(testKey);
        this.discardedRows++;
        continue;
      }
      this.recordKey(test, result, testKey, {
        acs: keyAcs.get(testKey),
        outcomes,
        evidence,
        priorEnvFailure,
        envFailure
      });
    }
  }

  private recordKey(
    test: TestCase,
    result: TestResult,
    testKey: string,
    ctx: {
      acs: string[] | undefined;
      outcomes: Map<string, 'PASS' | 'FAIL'>;
      evidence: XrayEvidence[];
      priorEnvFailure?: string;
      envFailure?: string;
    }
  ): void {
    const { priorEnvFailure, envFailure } = ctx;
    // Una caída del servidor en la navegación inicial no es un FAILED del producto: la corrida se
    // trata como omitida por entorno (no degrada a las demás corridas de la key y, si es la única,
    // la key queda TODO con el motivo). El veredicto describe al sistema bajo prueba, no al ambiente.
    let skipped = result.status === 'skipped' || envFailure !== undefined;
    const allKnownIssues = annotationTexts(test, result, KNOWN_ISSUE_ANNOTATION);
    let knownIssues = allKnownIssues;
    let status: XrayStatus = envFailure
      ? 'TODO'
      : applyKnownIssueStatus(mapStatus(result.status), skipped, allKnownIssues);
    let acSummary: string | undefined;
    let acSkipReason: string | undefined;
    // Key atada a ACs: su estado sale SOLO de sus ACs (no del test completo ni de known-issue ajenos).
    if (ctx.acs) {
      const ev = evaluateKeyAcs(ctx.acs, ctx.outcomes, allKnownIssues);
      acSummary = ev.summary;
      knownIssues = ev.scopedKnownIssues;
      if (!skipped) {
        if (ev.status) {
          status = ev.status;
        } else {
          status = 'TODO';
          skipped = true;
          acSkipReason = `ninguno de los ACs de la key se ejecutó (${ctx.acs.join(', ')})`;
        }
      }
    }
    const start = result.startTime.toISOString();
    const finish = new Date(result.startTime.getTime() + result.duration).toISOString();
    const comment =
      !skipped && status === 'FAILED' && result.status !== 'passed'
        ? truncate(clean(result.error?.message ?? `status=${result.status}`), MAX_ERROR_CHARS)
        : undefined;
    const skipReason = envFailure
      ? `ambiente sin respuesta (${envFailure} en la navegación inicial)`
      : (acSkipReason ?? (skipped ? extractSkipReason(test, result) : undefined));

    // Una fila por corrida — la consolidación final (peor estado ENTRE LAS EJECUTADAS,
    // skip nunca degrada) vive en consolidateRows (onEnd).
    const row: RowResult = {
      status,
      skipped,
      title: test.title,
      skipReason,
      start,
      finish,
      comment
    };
    const list = this.rows.get(testKey);
    if (list) list.push(row);
    else this.rows.set(testKey, [row]);

    const acIds = ctx.acs ? new Set(ctx.acs) : undefined;
    const extra: RowExtras = {
      status,
      skipped,
      retry: result.retry,
      title: test.title,
      project: projectName(test),
      measurements: annotationTexts(test, result, MEASUREMENT_ANNOTATION),
      knownDefects: annotationTexts(test, result, KNOWN_DEFECT_ANNOTATION),
      knownIssues,
      observations: annotationTexts(test, result, OBSERVATION_ANNOTATION),
      // Key atada a ACs: solo la evidencia `ac-AC-FR-NN` de sus ACs (más lo que no es de un AC).
      evidence: acIds
        ? ctx.evidence.filter((ev) => {
            const id = /^ac-(AC-[A-Z]+-\d+)/i.exec(ev.filename)?.[1]?.toUpperCase();
            return !id || acIds.has(id);
          })
        : ctx.evidence,
      envRetries: annotationTexts(test, result, ENV_RETRY_ANNOTATION),
      ...(acSummary ? { acSummary } : {}),
      ...(priorEnvFailure ? { priorEnvFailure } : {}),
      ...(envFailure ? { envFailure } : {})
    };
    const extraList = this.extras.get(testKey);
    if (extraList) extraList.push(extra);
    else this.extras.set(testKey, [extra]);
  }

  // Devuelve Promise (contrato de Reporter.onEnd): con status 'failed' Playwright sale != 0.
  onEnd(_result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    // Ambiente caído (gate de global-setup): no se escribe resultado publicable y se borra el de
    // una corrida anterior para que nadie importe datos viejos como si fueran de esta.
    if (process.env[ENV_DOWN_FLAG] === '1') {
      rmSync(this.outputFile, { force: true });
      console.warn(
        '[31m%s[0m',
        `⛔ Xray: ambiente no disponible (ENVIRONMENT_DOWN) → no se genera ${this.outputFile}. Nada para importar.`
      );
      return Promise.resolve({ status: 'failed' });
    }
    const withheld: string[] = [];
    const tests: XrayTestResult[] = [...this.rows.entries()].map(([testKey, rows]) => {
      const measured = consolidateRows(rows);
      const extras = this.extras.get(testKey) ?? [];
      const evidence = pickEvidence(extras, measured.status, testKey);
      // Gate evidence-before-verdict: PASSED/FAILED sin adjuntos → TODO retenido.
      const withheldStatus =
        evidence.length === 0 && (measured.status === 'PASSED' || measured.status === 'FAILED')
          ? measured.status
          : undefined;
      if (withheldStatus) withheld.push(`${testKey} (${withheldStatus})`);
      const consolidated: ConsolidatedResult = withheldStatus
        ? { ...measured, status: 'TODO' }
        : measured;
      return {
        testKey,
        ...consolidated,
        comment: buildRunComment(consolidated, extras, evidence, withheldStatus),
        ...(evidence.length > 0 ? { evidence } : {})
      };
    });

    const payload: Record<string, unknown> = { tests };
    if (process.env.XRAY_EXECUTION_KEY) {
      payload.testExecutionKey = process.env.XRAY_EXECUTION_KEY;
    } else {
      // Sin ejecución existente: describir una para que el import cree el ATR.
      const info: Record<string, unknown> = {};
      if (process.env.XRAY_PROJECT_KEY) info.project = process.env.XRAY_PROJECT_KEY;
      if (process.env.XRAY_SUMMARY) info.summary = process.env.XRAY_SUMMARY;
      if (process.env.XRAY_VERSION) info.version = process.env.XRAY_VERSION;
      // Default TM-1283 = ATP-AUTO (stock de automatización); override por campaña con XRAY_TEST_PLAN_KEY.
      info.testPlanKey = process.env.XRAY_TEST_PLAN_KEY || 'TM-1283';
      if (Object.keys(info).length > 0) payload.info = info;
    }

    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, JSON.stringify(payload, null, 2), 'utf-8');

    const target = process.env.XRAY_EXECUTION_KEY
      ? `execution ${process.env.XRAY_EXECUTION_KEY}`
      : 'nueva ejecución (info)';
    console.log(
      '\n\x1b[36m%s\x1b[0m',
      `🧾 Xray: ${tests.length} test(s) mapeados → ${this.outputFile} (${target})`
    );
    if (this.unmapped > 0) {
      console.log(
        '\x1b[33m%s\x1b[0m',
        `⚠️  Xray: ${this.unmapped} spec(s) sin key → NO exportados. Añade annotation type:'tms' (o [KEY] en el título).`
      );
    }
    if (this.discarded.size > 0) {
      console.warn(
        '\x1b[33m%s\x1b[0m',
        `⚠️  Xray: ${this.discardedRows} corrida(s) de ${this.discarded.size} key(s) fuera de XRAY_KEY_ALLOWLIST → descartadas: ${[...this.discarded].join(', ')}`
      );
    }
    if (withheld.length > 0) {
      console.warn(
        '\x1b[31m%s\x1b[0m',
        `⛔ Xray: veredicto retenido por falta de evidencia adjunta en ${withheld.join(', ')} → emitidos como TODO. No importar como verdes/rojos: revisar la corrida.`
      );
      return Promise.resolve({ status: 'failed' });
    }
    return Promise.resolve(undefined);
  }
}

export default XrayReporter;
