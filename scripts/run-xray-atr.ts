/**
 * Corre una familia de specs con el xray-reporter apuntando a un ATR FIJO
 * (XRAY_EXECUTION_KEY), en vez de crear un Test Execution nuevo por corrida.
 *
 * Decision (2026-09-09): el orquestador ya creo los ATR fijos con sus casos
 * adjuntos -- uno por familia -- para que exista un unico lugar que muestre
 * el estado vigente de la automatizacion. Cada corrida ACTUALIZA los runs de
 * ese ATR (xray-reporter escribe `testExecutionKey` en vez del bloque `info`
 * cuando XRAY_EXECUTION_KEY esta seteada -- ver cabecera de xray-reporter.ts).
 *
 * XRAY_TEST_PLAN_KEY NO se pasa a proposito: con XRAY_EXECUTION_KEY seteada
 * el reporter arma `payload.testExecutionKey` y nunca construye el bloque
 * `info` (que es donde viviria testPlanKey) -- pasarlo seria env muerta. La
 * asociacion Test Plan <-> Test Execution ya quedo fija en Xray al crear el
 * ATR (paso 3 del flujo canonico de /xray-cli: `plan add-tests` +
 * `exec add-tests`), no depende de esta env en cada corrida.
 *
 * Familias registradas:
 *   trips  -> TM-1146 (unico ATR de MG-19, pantalla Nuevo Viaje -- 22 casos:
 *             TM-501, TM-603, TM-604, TM-606, TM-607, TM-610, TM-611, TM-612,
 *             TM-616, TM-508, TM-522, TM-602, TM-605, TM-608, TM-609,
 *             TM-770, TM-783, TM-784, TM-843, TM-844, TM-538)
 *   mg682  -> TM-1147 (MG-682 flags de ruta + destino frecuente: TM-1139..TM-1143)
 *   othercosts -> TM-1280 (MG-995/MG-996 otros costos en Nuevo Viaje, 11 casos: fase 1
 *             automatiza TM-1084, TM-1085, TM-1086, TM-1087, TM-1090, TM-1091, TM-1277,
 *             TM-1279; TM-1088, TM-1092, TM-1093 quedan TO DO hasta la fase 2)
 *   units  -> TM-1362 (MG-1189 unidades de medida metrico/imperial, solo lectura; ola 1 = 8 de
 *             los 13 casos, ver UNITS_ATR_KEYS)
 *   othercosts-smoke -> TM-1281 (MG-995/MG-996 smoke automatizado del ABM de Otros Costos, 6
 *             casos: TM-985, TM-1002, TM-1007, TM-1008, TM-1014, TM-1017; TM-1014 corre pero
 *             queda FUERA de la allowlist -- borrado logico sin firma del PO -- y su run sigue TO DO)
 *
 * Decision (2026-09-09): TM-1146 pasa a ser el UNICO destino de todos los
 * casos automatizados de MG-19. Antes el reporte estaba partido entre
 * TM-1146 (9 casos) y TM-830 (subset de 3, con un --grep obligatorio para no
 * contaminarlo con los 7 tests de Ronda 1/TM-18 que comparten spec). El
 * orquestador amplio TM-1146 a los 22 casos en Xray y el reporte a TM-830 se
 * corta: esa ejecucion queda solo como ronda manual, sin recibir mas runs de
 * este script. Por eso la familia `tm830` fue eliminada -- con ella se va el
 * `--grep` obligatorio que la acompanaba, que ya no aplica a ninguna familia.
 *
 * `new-trip-happy-path.spec.ts` (TM-538) corre siempre en la familia `trips`: crea un viaje
 * real pero lo cancela por UI en su afterEach (politica G5), por eso ya no hay gate
 * `MG19_CREATE_TRIP`.
 *
 * Ejecutar: npm run test:xray:trips [-- <args extra de playwright>]
 *           npm run test:xray:mg682 [-- <args extra de playwright>]
 *           npm run test:xray:othercosts [-- <args extra de playwright>]
 *           npm run test:xray:othercosts-smoke [-- <args extra de playwright>]
 *           npm run test:xray:units [-- <args extra de playwright>]
 *
 * Familia `othercosts-smoke`: mismo criterio que `othercosts` (UAT, carrier-v2-desktop,
 * --workers=1, gate OTHER_COSTS_CREATE_DATA=1, REUSE_STORAGE_STATE=1 por defecto). Escribe su
 * propio archivo de resultados (`resultsFile`) para no pisar el de Nuevo Viaje: el padre importa
 * evidence/<env>/xray-results.othercosts-smoke.json.
 *
 * Familia `othercosts`: corre en UAT por defecto (defaultEnv), un solo project
 * (carrier-v2-desktop) y --workers=1 -- es una sola cuenta/sesion en un ambiente
 * compartido con testers manuales. Fija el gate OTHER_COSTS_CREATE_DATA=1 (sin el
 * gate el spec se skippea y los skips pisarian runs con TO DO) y fija
 * XRAY_KEY_ALLOWLIST con las 11 keys del ATR para que una key ajena no haga
 * crecer TM-1280. REUSE_STORAGE_STATE vale '1' por defecto en esta familia: se
 * reutiliza la sesion guardada y global-setup NO hace login con contrasena; si la
 * sesion vencio, falla pidiendo login humano. El login (CI o humano) es opt-out
 * explicito: REUSE_STORAGE_STATE=0. El resto del entorno se hereda del shell.
 * GIT_SHA se completa con el commit actual si no viene seteada (va al comentario).
 *   ej. verificacion de un solo caso, sin correr toda la familia:
 *   npm run test:xray:trips -- --grep TM-501 --project=carrier-v2-desktop
 */
import { spawnSync } from 'node:child_process';

interface Family {
  executionKey: string;
  specs: string[];
  /** Extra env por familia (ej. MG682_CREATE_TRIP para specs que crean datos). */
  env?: Record<string, string>;
  /**
   * Filtro --grep OBLIGATORIO para familias que no pueden emitir el spec completo
   * (ver aviso de tm830 arriba). Se aplica salvo que extraArgs ya traiga su propio
   * --grep (verificacion puntual de un caso).
   */
  grep?: string;
  /** ENV por defecto de la familia cuando el shell no trae ENV (si no: 'test'). */
  defaultEnv?: string;
  /** Projects de la familia; reemplazan DEFAULT_PROJECTS salvo --project explicito. */
  projects?: string[];
  /** Workers de la familia; se pasa como --workers=N salvo --workers explicito. */
  workers?: number;
  /**
   * Nombre del archivo de resultados dentro de evidence/<env>/ (default: xray-results.json).
   * Se pasa como XRAY_RESULTS_FILE, que playwright.config.ts respeta si esta seteada.
   */
  resultsFile?: string;
}

// Las 11 keys del ATR TM-1280 (fase 1 + las 3 de fase 2 que quedan TO DO).
const OTHER_COSTS_ATR_KEYS = [
  'TM-1084',
  'TM-1085',
  'TM-1086',
  'TM-1087',
  'TM-1088',
  'TM-1090',
  'TM-1091',
  'TM-1092',
  'TM-1093',
  'TM-1277',
  'TM-1279'
];

// Keys del ATR TM-1281 que se acreditan. TM-1014 queda afuera a proposito (decision D-A2 del
// plan smoke ABM): el test corre y adjunta evidencia, pero el borrado logico no tiene firma del PO
// ni es verificable sin base de UAT, asi que su run no recibe veredicto automatizado.
const OTHER_COSTS_SMOKE_ALLOWLIST = ['TM-985', 'TM-1002', 'TM-1007', 'TM-1008', 'TM-1017'];

// Los 13 Tests del ATR TM-1362 (unidades de medida, epica MG-1189). La ola 1 automatiza 8
// (TM-1312, TM-1325, TM-1330, TM-1331, TM-1343, TM-1350, TM-1352, TM-1356); los otros 5
// (TM-1305, TM-1307, TM-1340, TM-1345, TM-1346) quedan TO DO hasta la ola 2.
const UNITS_ATR_KEYS = [
  'TM-1305',
  'TM-1307',
  'TM-1312',
  'TM-1325',
  'TM-1330',
  'TM-1331',
  'TM-1340',
  'TM-1343',
  'TM-1345',
  'TM-1346',
  'TM-1350',
  'TM-1352',
  'TM-1356'
];

const FAMILIES: Record<string, Family> = {
  trips: {
    executionKey: 'TM-1146',
    specs: [
      'tests/specs/trips/new-trip-carrier-defaults.spec.ts',
      'tests/specs/trips/new-trip-open-destination.spec.ts',
      'tests/specs/trips/new-trip.spec.ts',
      'tests/specs/trips/new-trip-flight-accept-enablement.spec.ts',
      // TM-538: crea un viaje y lo cancela por UI (G5); sin gate (ver cabecera del archivo).
      'tests/specs/trips/new-trip-happy-path.spec.ts',
      // TM-772 / TM-817 / TM-789, TM-802, TM-819: ya viven en TM-1146 (MR !13); entran a la
      // familia para que cada corrida del ATR los actualice y no queden en el estado de septiembre.
      'tests/specs/trips/new-trip-simulation.spec.ts',
      'tests/specs/trips/new-trip-context.spec.ts',
      'tests/specs/trips/new-trip-ui-contract.spec.ts'
    ]
  },
  mg682: {
    executionKey: 'TM-1147',
    specs: [
      'tests/specs/trips/new-trip-route-flags.spec.ts',
      'tests/specs/trips/new-trip-frequent-destination.spec.ts'
    ],
    // Estos specs crean un viaje real en el entorno que despues hay que
    // cancelar a mano (no hay endpoint de limpieza).
    env: { MG682_CREATE_TRIP: process.env.MG682_CREATE_TRIP ?? '1' }
  },
  othercosts: {
    executionKey: 'TM-1280',
    specs: ['tests/specs/trips/new-trip-other-costs.spec.ts'],
    defaultEnv: 'uat',
    projects: ['--project=carrier-v2-desktop'],
    workers: 1,
    // Crea conceptos y viajes reales en UAT; el spec los limpia en su finally.
    env: {
      OTHER_COSTS_CREATE_DATA: process.env.OTHER_COSTS_CREATE_DATA ?? '1',
      XRAY_KEY_ALLOWLIST: OTHER_COSTS_ATR_KEYS.join(','),
      // Default seguro: sesion guardada, sin login con contrasena (opt-out: =0).
      REUSE_STORAGE_STATE: process.env.REUSE_STORAGE_STATE ?? '1'
    }
  },
  'othercosts-smoke': {
    executionKey: 'TM-1281',
    specs: ['tests/specs/settings/other-costs-smoke-abm.spec.ts'],
    defaultEnv: 'uat',
    projects: ['--project=carrier-v2-desktop'],
    workers: 1,
    resultsFile: 'xray-results.othercosts-smoke.json',
    // Crea y borra conceptos reales en UAT; el spec los limpia en su finally.
    env: {
      OTHER_COSTS_CREATE_DATA: process.env.OTHER_COSTS_CREATE_DATA ?? '1',
      XRAY_KEY_ALLOWLIST: OTHER_COSTS_SMOKE_ALLOWLIST.join(','),
      // Default seguro: sesion guardada, sin login con contrasena (opt-out: =0).
      REUSE_STORAGE_STATE: process.env.REUSE_STORAGE_STATE ?? '1'
    }
  },
  units: {
    executionKey: 'TM-1362',
    specs: [
      'tests/specs/reports/daily-report-units.spec.ts',
      'tests/specs/reports/owner-report-units.spec.ts',
      'tests/specs/reports/ranking-drivers-units.spec.ts',
      'tests/specs/reports/ranking-vehicles-units.spec.ts',
      'tests/specs/settings/branches-radius-units.spec.ts',
      'tests/specs/trips/new-trip-open-destination-units.spec.ts'
    ],
    // Solo lectura contra UAT (carrier 1481, imperial). Las filas de TEST (1521 imperial, 1040
    // metrico) corren con ENV=test y reportan al mismo ATR: el reporter deduplica por key y
    // gana el peor estado.
    defaultEnv: 'uat',
    projects: ['--project=carrier-v2-desktop'],
    workers: 1,
    resultsFile: 'xray-results.units.json',
    env: {
      XRAY_KEY_ALLOWLIST: UNITS_ATR_KEYS.join(','),
      // Default seguro: sesion guardada, sin login con contrasena (opt-out: =0).
      REUSE_STORAGE_STATE: process.env.REUSE_STORAGE_STATE ?? '1'
    }
  }
};

const [familyName, ...extraArgs] = process.argv.slice(2);
const family = familyName ? FAMILIES[familyName] : undefined;

if (!family) {
  const known = Object.keys(FAMILIES).join(', ');
  console.error(`Familia desconocida: "${familyName ?? ''}". Familias registradas: ${known}`);
  process.exit(1);
}

// Projects por defecto: mismo criterio que regression.yml -- excluye 'visual' y
// 'codegen' (sesion sin login). Un --project explicito pasado por argv (verificacion
// de un solo caso) reemplaza esta lista via extraArgs, no se acumula con ella.
const DEFAULT_PROJECTS = ['--project=carrier-v2-desktop', '--project=carrier-v2-laptop'];
const hasProjectOverride = extraArgs.some((a) => a.startsWith('--project'));
const projectArgs = hasProjectOverride ? [] : (family.projects ?? DEFAULT_PROJECTS);

const hasWorkersOverride = extraArgs.some((a) => a.startsWith('--workers') || a === '-j');
const workersArgs =
  family.workers !== undefined && !hasWorkersOverride ? [`--workers=${family.workers}`] : [];

// Commit de la corrida para el comentario de medicion; silencioso si git no responde.
function currentGitSha(): string | undefined {
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  const sha = git.status === 0 ? git.stdout.trim() : '';
  return sha || undefined;
}
const gitSha = process.env.GIT_SHA ?? currentGitSha();

// Filtro --grep de la familia (Family.grep, hoy sin uso -- ninguna familia
// vigente lo necesita): si estuviera seteado, se respeta un --grep explicito
// en extraArgs (verificacion puntual) en vez de acumularse con el de la familia.
const hasGrepOverride = extraArgs.some((a) => a.startsWith('--grep'));
// spawnSync usa shell:true en win32 (cmd.exe), que interpreta `(` `|` `)` como
// metacaracteres si el valor no llega entre comillas -- por eso el quoting es
// condicional al platform (en posix no hay shell de por medio: comillas serian
// literales del regex).
const grepArgs =
  family.grep && !hasGrepOverride
    ? ['--grep', process.platform === 'win32' ? `"${family.grep}"` : family.grep]
    : [];

const runEnv = process.env.ENV ?? family.defaultEnv ?? 'test';

const env = {
  ...process.env,
  ...family.env,
  ...(gitSha ? { GIT_SHA: gitSha } : {}),
  ...(family.resultsFile ? { XRAY_RESULTS_FILE: `evidence/${runEnv}/${family.resultsFile}` } : {}),
  ENV: runEnv,
  XRAY: '1',
  XRAY_PROJECT_KEY: process.env.XRAY_PROJECT_KEY ?? 'TM',
  XRAY_EXECUTION_KEY: family.executionKey
};

const result = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    ...family.specs,
    ...projectArgs,
    ...workersArgs,
    ...grepArgs,
    ...extraArgs
  ],
  {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32'
  }
);

process.exit(result.status ?? 1);
