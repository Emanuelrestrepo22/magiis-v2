/**
 * PAX-ADDR-BEHAVIORS — matriz conducta × superficie de los campos de dirección de la app Pasajero (MG-116).
 *
 * QUÉ AFIRMA
 *   MG-116 cambió CÓMO autocompleta una dirección, no una pantalla. El riesgo real es que el campo funcione distinto
 *   en cada superficie. Cada fila de la matriz (`screens/passenger/address/behaviorMatrix.ts`) es UN test que mide una
 *   conducta en una superficie y la compara con el ORÁCULO (el AC), nunca con lo que hoy hace el producto:
 *     B1 endpoint propio y cero a Google (TM-674) · B1b término + sesgo en el request (TM-675)
 *     B2 debounce (TM-678; TM-733 en Perfil) · B3 piso de caracteres (TM-680/681; TM-734 en Perfil: 4)
 *     B4 no reconsulta un texto idéntico (TM-679) · B6 sessionToken único (TM-686)
 *     Sólo en S1 (miden el componente, no la pantalla): B7 rotación del token (TM-687) · B8 5xx y timeout (TM-689)
 *     · B9 sin conexión (TM-697).
 *   Superficies: S1 Home · Origen, S3 Home · Agregar otro destino, S5 Home · Solo Ida, S6 Editar viaje programado,
 *   S7 Perfil › Mis Direcciones. 34 filas.
 *
 * POR QUÉ UN TEST POR FILA Y NO UNO POR SUPERFICIE: el `xray-reporter` deduplica por `testKey` y gana el PEOR estado
 * (`tests/utils/reporters/xray-reporter.ts`). Un test por superficie acreditaría a la vez TM-674, TM-678, TM-679…:
 * el FAIL del debounce de S1 marcaría FAILED a TM-674. Por fila, cada key recibe sólo el estado de lo que mide.
 * B1b se evalúa sobre la MISMA medición de B1 (cache por superficie): no repite el tipeo.
 *
 * FAIL LEGÍTIMOS DEL PRODUCTO: el oráculo no se mueve. Una fila con `knownFail` conserva la aserción (PASS) y queda
 * ROJA mientras el defecto exista; se documenta con la annotation `known-fail` (motivo + base de evidencia). No se usa
 * `test.fail()` ni `known-issue` (ese tipo es del circuito FR 1901 y acredita FAILED a un test que PASÓ). `suspected`
 * = sospecha sin medición propia, annotation informativa.
 *
 * DISCIPLINA DE VEREDICTO: SIN_DATOS / NO_EJERCIDO / superficie inalcanzable / sin sesión ⇒ skip con motivo, NUNCA
 * rojo ni verde. B8/B9 son evidencia de MECANISMO (inyección JS de fallas): annotation `mechanism`, un FAIL no es
 * reportable como bug sin repro con la UI real (red real caída / backend real fallando).
 *
 * POR QUÉ SESIÓN COMPARTIDA + RELANZAMIENTO POR SUPERFICIE: una sola sesión Appium (nueve sesiones tiraban abajo el
 * UiAutomator2 del teléfono) y `terminateApp`/`activateApp` antes de cada superficie, porque `navigate()` parte del
 * home y la superficie anterior puede dejar la app dentro de una página sin tabs (Perfil › Direcciones). Cada fila
 * vuelve a llegar a su superficie antes de medir (re-establecer el campo evitó el SIN_DATOS por contaminación entre
 * conductas, medido el 19/08/2026). No es `serial`: un rojo legítimo no debe cancelar las filas siguientes.
 *
 * PLAN DE CORRIDA
 *   Comando:    ENV=uat npx playwright test -c playwright.mobile.config.ts tests/mobile/appium/passenger/specs/pax-address-behaviors.spec.ts
 *   Dispositivo: FÍSICO (calibrado en Samsung A05). En emulador el resultado NO es concluyente. Con XRAY activo y un
 *               udid `emulator-*` la suite se saltea con motivo (no se publican corridas de emulador en Xray).
 *   Claves de entorno (sólo nombres; nunca se imprimen valores): APPIUM_SERVER_URL, ENV (debe ser `uat`),
 *               ANDROID_UDID / ANDROID_PASSENGER_UDID, ANDROID_PASSENGER_APP_PACKAGE (si el paquete por defecto no es
 *               el de UAT), MG116_SEED_DESTINATION (dirección semilla para fijar el destino en S3; por defecto
 *               «Arenales 1233»), XRAY (activa el reporter Xray).
 *   Precondición: app PAX con SESIÓN iniciada en UAT (`noReset`); S6 necesita un viaje PROGRAMADO preexistente (sin él
 *               S6 queda inalcanzable ⇒ skip). Esta suite no inicia sesión.
 *   Duración:   ≈ 34 filas × ~60 s + 5 relanzamientos; techo de 45 min. Timeout por test 240 s, workers 1.
 *   Efectos:    SOLO LECTURA. Escribe en el campo y mide; no crea viajes, no guarda direcciones, no toca la wallet.
 *   Fuera de alcance: B5 (contrato del DTO, sin Test TM), guards TM-727/729/730/731 (`pax-address-surfaces`), S2 y S4.
 *   Xray:       las keys TM van como annotation `tms`. Sin `@no-xray`; el test final de resumen sí lo lleva.
 */

import { test, expect } from '@playwright/test';
import { getPassengerAppConfig } from '../../config/appiumRuntime.js';
import { xrayKeyAnnotations } from '../../harness/DriverSpecKit.js';
import {
  closePassengerSpec,
  environmentSkipReason,
  openPassengerSpec
} from '../../harness/PassengerSpecKit.js';
import type { PassengerSpecContext } from '../../harness/PassengerSpecKit.js';
import { sleep } from '../../core/Waits.js';
import {
  MATRIX_ROWS,
  SURFACE_ORDER,
  evaluateRow,
  rowId,
  rowTitle,
  rowsForSurface,
  runGuardReason
} from '../../screens/passenger/address/behaviorMatrix.js';
import type { MatrixRow } from '../../screens/passenger/address/behaviorMatrix.js';
import {
  runProbeBattery,
  summarizeMatrix
} from '../../screens/passenger/address/probes/runProbeBattery.js';
import type {
  ProbeResult,
  SurfaceProbeReport
} from '../../screens/passenger/address/probes/types.js';
import { surfaceToFieldTarget } from '../../screens/passenger/address/surfaceFieldTarget.js';
import {
  HomeOneWaySurface,
  HomeOriginSurface,
  HomeStopSurface,
  ProfileAddressSurface,
  ScheduledTripEditSurface,
  surfacePortFor
} from '../../screens/passenger/address/surfaces/index.js';
import type { AddressSurface, SurfaceId } from '../../screens/passenger/address/surfaces/index.js';

const SEED_DESTINATION = process.env.MG116_SEED_DESTINATION ?? 'Arenales 1233';

const SURFACE_FACTORIES: Record<SurfaceId, () => AddressSurface> = {
  S1: () => new HomeOriginSurface(),
  S3: () => new HomeStopSurface(SEED_DESTINATION),
  S5: () => new HomeOneWaySurface(),
  S6: () => new ScheduledTripEditSurface(),
  S7: () => new ProfileAddressSurface()
};

/** Motivo para saltear toda la suite (sólo UAT, sin emulador+XRAY). `null` = puede correr. */
function suiteSkipReason(): string | null {
  if (!process.env.APPIUM_SERVER_URL?.trim()) {
    return runGuardReason({
      appiumServerUrl: undefined,
      environmentReason: null,
      environment: '',
      udid: null,
      xray: undefined
    });
  }
  try {
    const config = getPassengerAppConfig();
    return runGuardReason({
      appiumServerUrl: process.env.APPIUM_SERVER_URL,
      environmentReason: environmentSkipReason(config.environment),
      environment: config.environment,
      udid: config.udid,
      xray: process.env.XRAY
    });
  } catch (error) {
    return `Configuración PAX inválida: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Relanza la app dentro de la sesión Appium abierta y espera el home. Devuelve el motivo de inalcanzable, o `null`.
 * `terminateApp`/`activateApp` no tocan los datos de la app: la sesión del usuario sobrevive (`noReset`).
 * Tras relanzar, chromedriver puede seguir enganchado al target muerto: se reintenta el attach con prueba de vida.
 */
async function relaunchToHome(ctx: PassengerSpecContext): Promise<string | null> {
  const pkg = ctx.config.appPackage ?? '';
  if (!pkg) return 'Sin appPackage configurado: no se puede relanzar la app.';
  const driver = ctx.session.driver;
  await ctx.session.switchContext('native').catch(() => undefined);
  await driver.terminateApp(pkg).catch(() => undefined);
  await sleep(1500);
  await driver.activateApp(pkg).catch(() => undefined);
  await sleep(5000); // arranque en frío: primero el proceso, después la WebView

  const deadline = Date.now() + 45_000;
  let attached = false;
  while (!attached && Date.now() < deadline) {
    try {
      await ctx.session.switchContext('webview');
      await driver.getUrl(); // prueba de vida: el nombre del contexto existe antes que la página sea navegable
      attached = true;
    } catch {
      await ctx.session.switchContext('native').catch(() => undefined);
      await sleep(1500);
    }
  }
  if (!attached)
    return 'La app no volvió a montar su vista web tras el relanzamiento (WEBVIEW no utilizable).';

  const state = await ctx.pbo.waitForStableSessionState().catch(() => null);
  if (!state || state.kind !== 'home') {
    return `Tras relanzar la app el estado no es el home (estado: ${state?.kind ?? 'desconocido'}): sin sesión iniciada o pantalla inesperada.`;
  }
  return null;
}

function rowAnnotations(row: MatrixRow): Array<{ type: string; description: string }> {
  const notes = [
    ...row.tms.flatMap((key) => xrayKeyAnnotations(key)),
    { type: 'surface', description: row.surface }
  ];
  if (row.level === 'mechanism') {
    notes.push({
      type: 'mechanism',
      description:
        'Evidencia de MECANISMO (inyección JS de fallas): un FAIL NO es reportable como bug sin repro con la UI real.'
    });
  }
  if (row.knownFail) {
    notes.push({
      type: 'known-fail',
      description: `[${row.knownFail.basis}] ${row.knownFail.reason}`
    });
  }
  if (row.suspected) notes.push({ type: 'suspected-fail', description: row.suspected });
  return notes;
}

test.describe('@mobile App Pasajero · matriz de conductas de direcciones (MG-116)', () => {
  const skipReason = suiteSkipReason();
  test.skip(skipReason !== null, skipReason ?? '');
  test.describe.configure({ timeout: 240_000 });

  let ctx: PassengerSpecContext | null = null;
  let sessionReason: string | null = null;
  /** Resultados de probes por superficie (cache: B1 y B1b comparten la misma medición). */
  const cache = new Map<string, ProbeResult[]>();
  const reports = new Map<SurfaceId, SurfaceProbeReport>();

  test.beforeAll(async () => {
    try {
      ctx = await openPassengerSpec('pax-address-behaviors');
    } catch (error) {
      sessionReason = `No se pudo abrir la sesión Appium: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  test.afterAll(async () => {
    await closePassengerSpec(ctx);
    ctx = null;
  });

  for (const surfaceId of SURFACE_ORDER) {
    test.describe(`${surfaceId}`, () => {
      const surface = SURFACE_FACTORIES[surfaceId]();
      let unreachable: string | null = null;

      test.beforeAll(async () => {
        cache.clear();
        if (!ctx) {
          unreachable = sessionReason ?? 'Sin sesión Appium.';
          return;
        }
        unreachable = await relaunchToHome(ctx);
      });

      test.afterAll(async () => {
        if (ctx) await surface.cleanup(surfacePortFor(ctx.session)).catch(() => undefined);
      });

      for (const row of rowsForSurface(surfaceId)) {
        // Título generado desde la matriz (dato puro): una fila = un test, con su key TM en el título.
        test(
          // eslint-disable-next-line playwright/valid-title
          rowTitle(row),
          {
            annotation: rowAnnotations(row),
            tag: ['@mobile', '@regression', '@mg116']
          },
          async ({}, testInfo) => {
            test.skip(unreachable !== null, `${unreachable ?? ''} Fila no ejercida.`);
            const active = ctx as PassengerSpecContext;
            const evidence = active.session.evidence(`${active.runLabel}-${rowId(row)}`);
            const key = `${row.surface}:${row.probe}`;

            let results = cache.get(key);
            if (!results) {
              // Re-establecer la superficie ANTES de cada conducta (sin esto el campo de Perfil deja de aceptar texto).
              const port = surfacePortFor(active.session);
              const reach = await surface.navigate(port);
              if (!reach.reachable) test.skip(true, `${reach.reason} Fila no ejercida.`);
              if (!reach.reachable) return;
              const target = surfaceToFieldTarget(surface, port, reach, active.session.driver);
              const report = await runProbeBattery(target, {
                behaviors: [row.probe],
                includeSingleSurface: row.level === 'mechanism' || row.behavior === 'B7',
                expectedMinLength: row.expectedMinLength
              });
              results = report.results;
              cache.set(key, results);
              const previous = reports.get(surfaceId);
              reports.set(surfaceId, {
                ...report,
                results: [...(previous?.results ?? []), ...results]
              });
            }

            const outcome = evaluateRow(row, results);
            testInfo.annotations.push({ type: 'xray_comment', description: outcome.message });
            await evidence.capture(rowId(row)).catch(() => undefined);
            await testInfo.attach(`${rowId(row)}-medicion.json`, {
              body: JSON.stringify({ row: rowId(row), tms: row.tms, outcome, results }, null, 2),
              contentType: 'application/json'
            });
            await evidence.attachTo(testInfo, rowId(row)).catch(() => []);

            // SIN_DATOS / NO_EJERCIDO: límite del harness, no del producto.
            test.skip(outcome.kind === 'skip', outcome.message);
            expect(outcome.kind, outcome.message).toBe('pass');
          }
        );
      }
    });
  }

  test(
    'PAX-ADDR-BEHAVIORS · Resumen de la matriz conducta × superficie (evidencia, no acredita Test)',
    { tag: ['@mobile', '@mg116', '@no-xray'] },
    async ({}, testInfo) => {
      const ordered = SURFACE_ORDER.flatMap((s) => reports.get(s) ?? []);
      const lines =
        ordered.length > 0
          ? summarizeMatrix(ordered)
          : ['Sin mediciones: ninguna fila llegó a ejercerse (ver los motivos de skip).'];
      console.info(
        `[pax-address-behaviors] matriz MG-116 (${MATRIX_ROWS.length} filas)\n${lines.join('\n')}`
      );
      await testInfo.attach('matriz-mg116.md', {
        body: lines.join('\n'),
        contentType: 'text/markdown'
      });
      expect(lines.length).toBeGreaterThan(0);
    }
  );
});
