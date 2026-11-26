/**
 * DriverAddressSearchPBO — orquesta la batería de guards del buscador de direcciones de la app Chofer (MG-117).
 * Una corrida (un solo recorrido del dispositivo) produce el resultado de TODOS los casos; el spec lee cada uno.
 *
 * Reutiliza las probes de PAX (`screens/passenger/address/probes`, sin editarlas) para las conductas que el Chofer
 * comparte: B1 -> TM-650, B2 -> TM-654, B3 -> TM-656/TM-657, B4 -> TM-655, B6 -> TM-662. Los veredictos propios del
 * Chofer (TM-651, TM-663, TM-664, TM-665, ORDEN) son funciones puras en `screens/driver/address/driverAddressVerdicts`.
 *
 * REGLAS DE LA BATERÍA
 *  - SOLO LECTURA: se escribe texto en el buscador, nunca se confirma «Editar viaje» ni se guarda una dirección.
 *    TM-663 selecciona una predicción (cambia solo el BORRADOR del modal); `leaveWithoutSaving` cancela al final.
 *  - CADA CASO USA UN TÉRMINO DISTINTO: el buscador aplica `distinctUntilChanged` sobre el último texto emitido, así
 *    que repetir un término en otro caso no genera request y se confundiría con un defecto (V1 lo midió así).
 *  - Aborta si hay más de un buscador abierto: cada modal apilado duplica las llamadas y ninguna medición vale.
 *  - Las fallas inyectadas (TM-665) van AL FINAL y se limpian siempre: una regla colgada contaminaría todo lo demás.
 */

import type { Browser } from 'webdriverio';
import {
  autocompleteCalls,
  clearCapture,
  googleActivity,
  googleCalls,
  installCapture,
  resetField,
  settle
} from '../screens/passenger/address/probes/autocompleteCapture.js';
import { runDebounceProbe } from '../screens/passenger/address/probes/DebounceProbe.js';
import { runDistinctUntilChangedProbe } from '../screens/passenger/address/probes/DistinctUntilChangedProbe.js';
import { parseDtoBody } from '../screens/passenger/address/probes/DtoMappingProbe.js';
import { focusField, typeText } from '../screens/passenger/address/probes/fieldOps.js';
import { runMinLengthProbe } from '../screens/passenger/address/probes/MinLengthProbe.js';
import { DEFAULT_SETTLE_MS, queryParam } from '../screens/passenger/address/probes/measure.js';
import { runOwnEndpointProbe } from '../screens/passenger/address/probes/OwnEndpointProbe.js';
import { runSessionTokenProbe } from '../screens/passenger/address/probes/SessionTokenProbe.js';
import type { MinLengthSample } from '../screens/passenger/address/probes/MinLengthProbe.js';
import type { AddressSearchScreen } from '../screens/driver/address/AddressSearchScreen.js';
import {
  MIN_CHARS_DRIVER,
  ORDER_CASE_KEY,
  caseFrom,
  caseFromProbe,
  deriveMinLengthCases,
  describeOrder,
  evaluateDegradation,
  evaluateDriverTokenRotation,
  evaluateEmptyState,
  evaluateOrder,
  evaluateRequestContract
} from '../screens/driver/address/driverAddressVerdicts.js';
import type {
  DegradationScenario,
  DriverCaseResult,
  OrderRow
} from '../screens/driver/address/driverAddressVerdicts.js';
import {
  clearWebViewFaultInjection,
  installWebViewFaultInjection,
  readWebViewFaultInjectionState
} from '../core/WebViewFaultInjection.js';
import { readWebViewNetworkCapture } from '../core/WebViewNetworkCapture.js';
import { AUTOCOMPLETE_PATH } from '../screens/passenger/address/probes/measure.js';
import type { WebViewGoogleActivity } from '../core/WebViewNetworkCaptureTypes.js';

/** Términos por caso: distintos entre sí a propósito (ver cabecera). */
export const DRIVER_ADDRESS_TERMS = {
  ownEndpoint: 'corr',
  contract: 'corrientes',
  debounce: 'belgrano',
  distinct: 'florida',
  minLength: 'santa fe',
  empty: 'zzzqqqxxx',
  order: 'caza',
  rotationFirst: 'rivadavia',
  rotationAfter: 'maipu'
} as const;

/** Escenarios de falla de TM-665, con término propio cada uno. */
export const DEGRADATION_SCENARIOS = [
  { name: '503 Service Unavailable', mode: 'status', status: 503, term: 'corrien' },
  { name: '500 Internal Server Error', mode: 'status', status: 500, term: 'mitre 1' },
  { name: 'error de red', mode: 'networkError', status: undefined, term: 'alsina' }
] as const;

const reliable = (a: WebViewGoogleActivity | null): boolean =>
  !!a && a.available && a.probeErrors.length === 0;

export type DriverAddressRunOptions = {
  settleMs?: number;
  log?: (message: string) => void;
  /**
   * Se invoca INMEDIATAMENTE tras cada caso, con la pantalla aún en el estado que produjo el veredicto: si las
   * capturas se tomaran al final, todas serían el mismo frame.
   */
  onCase?: (result: DriverCaseResult) => Promise<void>;
};

export class DriverAddressSearchPBO {
  private readonly settleMs: number;
  private readonly log: (message: string) => void;

  constructor(
    private readonly screen: AddressSearchScreen,
    private readonly driver: Browser,
    private readonly options: DriverAddressRunOptions = {}
  ) {
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.log = options.log ?? (() => undefined);
  }

  private get selector(): string {
    return this.screen.fieldTarget().fieldSelector();
  }

  /** Escribe `term` y espera la ventana de ausencia; devuelve los requests propios capturados. */
  private async probeTerm(term: string): Promise<Awaited<ReturnType<typeof autocompleteCalls>>> {
    await resetField(this.driver, this.selector);
    await typeText(this.driver, this.selector, term);
    await settle(this.settleMs);
    return autocompleteCalls(this.driver);
  }

  // ---------------------------------------------------------------- casos propios

  private async tm651(): Promise<DriverCaseResult> {
    const calls = await this.probeTerm(DRIVER_ADDRESS_TERMS.contract);
    const urls = calls.map((c) => String(c.url));
    return caseFrom('TM-651', 'Contrato del request', evaluateRequestContract(urls), {
      term: DRIVER_ADDRESS_TERMS.contract,
      calls: urls.length,
      query: urls.at(-1)?.split('?')[1]?.slice(0, 200)
    });
  }

  private async minLength(): Promise<[DriverCaseResult, DriverCaseResult]> {
    const probe = await runMinLengthProbe(this.screen.fieldTarget(), {
      term: DRIVER_ADDRESS_TERMS.minLength,
      maxLen: MIN_CHARS_DRIVER + 1,
      expectedFloor: MIN_CHARS_DRIVER,
      settleMs: this.settleMs
    });
    const perLength = (probe.measured.perLength ?? []) as MinLengthSample[];
    const { tm656, tm657 } = deriveMinLengthCases(perLength);
    const measured = { term: DRIVER_ADDRESS_TERMS.minLength, perLength };
    return [
      caseFrom('TM-656', 'Con 2 caracteres no consulta', tm656, measured),
      caseFrom('TM-657', 'Con 3 caracteres sí consulta', tm657, measured)
    ];
  }

  private async tm664(): Promise<DriverCaseResult> {
    const term = DRIVER_ADDRESS_TERMS.empty;
    const calls = await this.probeTerm(term);
    const last = (await readWebViewNetworkCapture(this.driver)).entries
      .filter((e) => String(e.url).includes(AUTOCOMPLETE_PATH))
      .at(-1);
    const withBody = calls.find((c) => (c.responseBody ?? '').trim().length > 0);
    const parsed = withBody
      ? parseDtoBody(withBody.responseBody as string)
      : { parseError: null, rows: [] };
    const itemsOnScreen = await this.screen.predictionRows();
    const loaders = await this.screen.visibleLoaders();
    const errors = await this.screen.visibleErrors();
    const fieldUsable = (await this.screen.openSearchFields()) > 0;
    const measured = {
      term,
      calls: calls.length,
      httpStatus: last?.status,
      rows: parsed.rows.length,
      itemsOnScreen,
      loaders,
      errors,
      fieldUsable
    };
    return caseFrom(
      'TM-664',
      'Estado vacío controlado',
      evaluateEmptyState({ ...measured, parseError: parsed.parseError }),
      measured
    );
  }

  private async order(): Promise<DriverCaseResult> {
    const term = DRIVER_ADDRESS_TERMS.order;
    const calls = await this.probeTerm(term);
    const withBody = calls.find((c) => (c.responseBody ?? '').trim().length > 0);
    const rows = (withBody ? parseDtoBody(withBody.responseBody as string).rows : []) as OrderRow[];
    const first = calls[0] ? String(calls[0].url) : '';
    const origin = first
      ? { lat: Number(queryParam(first, 'latitude')), lng: Number(queryParam(first, 'longitude')) }
      : null;
    const m = { term, calls: calls.length, rows, origin };
    return caseFrom(
      ORDER_CASE_KEY,
      'Caché cercana por encima de aeropuertos lejanos',
      evaluateOrder(m),
      {
        term,
        calls: calls.length,
        rows: rows.length,
        origin,
        order: describeOrder(m)
      }
    );
  }

  /** TM-663: seleccionar una predicción cierra el buscador; se reabre y se compara el token. */
  private async tm663(): Promise<DriverCaseResult> {
    const sel = this.selector;
    await resetField(this.driver, sel);
    const typed = await typeText(this.driver, sel, DRIVER_ADDRESS_TERMS.rotationFirst);
    await settle(this.settleMs);
    const tokensBefore = (await autocompleteCalls(this.driver))
      .map((c) => queryParam(String(c.url), 'sessionToken'))
      .filter(Boolean);
    const picked = typed ? await this.screen.selectFirstPrediction() : undefined;
    let searchClosed: boolean | undefined;
    let reopened: boolean | undefined;
    let typedAfter: boolean | undefined;
    let tokensAfter: string[] | undefined;
    if (picked) {
      // La selección resuelve la dirección (`places/getPlace`): se deja terminar antes de medir.
      await settle(2600);
      searchClosed = (await this.screen.openSearchFields()) === 0;
      if (searchClosed) {
        await clearCapture(this.driver);
        reopened = await this.screen.reopenFromEdit();
        if (reopened) {
          await focusField(this.driver, sel);
          typedAfter = await typeText(this.driver, sel, DRIVER_ADDRESS_TERMS.rotationAfter);
          await settle(this.settleMs);
          tokensAfter = (await autocompleteCalls(this.driver))
            .map((c) => queryParam(String(c.url), 'sessionToken'))
            .filter(Boolean);
        }
      }
    }
    const m = { typed, tokensBefore, picked, searchClosed, reopened, typedAfter, tokensAfter };
    return caseFrom('TM-663', 'Token nuevo tras seleccionar', evaluateDriverTokenRotation(m), {
      ...m
    });
  }

  /** TM-665: tres escenarios de falla del endpoint propio; limpia la inyección siempre. */
  private async tm665(): Promise<DriverCaseResult> {
    const sel = this.selector;
    const scenarios: DegradationScenario[] = [];
    try {
      for (const esc of DEGRADATION_SCENARIOS) {
        const ruleId = `drv-addr-${esc.mode}-${esc.status ?? 'net'}`;
        const before = await googleActivity(this.driver);
        await installWebViewFaultInjection(this.driver, [
          {
            id: ruleId,
            urlPattern: AUTOCOMPLETE_PATH,
            mode: esc.mode,
            ...(esc.status ? { status: esc.status } : {})
          }
        ]);
        await resetField(this.driver, sel);
        await typeText(this.driver, sel, esc.term);
        await settle(this.settleMs);
        const state = await readWebViewFaultInjectionState(this.driver);
        const hits = state.rules.find((r) => r.id === ruleId)?.hitsSinceInstall ?? null;
        const after = await googleActivity(this.driver);
        scenarios.push({
          name: esc.name,
          faultHits: hits,
          googleNewResources:
            reliable(before) && reliable(after)
              ? Math.max(
                  0,
                  (after?.resourceEntries.length ?? 0) - (before?.resourceEntries.length ?? 0)
                )
              : -1,
          googleXhr: (await googleCalls(this.driver)).length,
          itemsOnScreen: await this.screen.predictionRows(),
          loaderVisible: (await this.screen.visibleLoaders()).length > 0,
          errorShown: (await this.screen.visibleErrors()).length > 0
        });
        await clearWebViewFaultInjection(this.driver).catch(() => undefined);
      }
    } finally {
      await clearWebViewFaultInjection(this.driver).catch(() => undefined);
    }
    return caseFrom(
      'TM-665',
      'Degradación ante 5xx sin caer a Google',
      evaluateDegradation(scenarios),
      {
        escenarios: scenarios,
        note: 'Falla inyectada por JS (mecanismo): un FAIL requiere repro con backend real.'
      },
      'mechanism'
    );
  }

  // ---------------------------------------------------------------- corrida completa

  /** Ejecuta la batería completa. Precondición: exactamente UN buscador editable abierto. */
  async runAll(): Promise<DriverCaseResult[]> {
    const open = await this.screen.openSearchFields();
    if (open !== 1) {
      const abort = caseFrom('PRECONDICION', 'Un solo buscador abierto', {
        status: 'SIN_DATOS',
        detail: `Se esperaba exactamente 1 buscador editable y hay ${open}. Con modales apilados las llamadas se duplican: ninguna medición de frecuencia sería válida.`
      });
      this.log(`ABORTA: ${abort.verdict}`);
      await this.options.onCase?.(abort).catch(() => undefined);
      return [abort];
    }

    await installCapture(this.driver);
    const target = this.screen.fieldTarget();
    const out: DriverCaseResult[] = [];
    const push = async (...results: DriverCaseResult[]): Promise<void> => {
      for (const r of results) {
        out.push(r);
        this.log(`${r.key.padEnd(16)} ${r.status.padEnd(11)} ${r.verdict}`);
        await this.options.onCase?.(r).catch(() => undefined);
      }
    };
    // Cada caso arranca con el buscador abierto: si el anterior lo cerró (selección, teclado o la propia app),
    // se reabre por la misma ruta de usuario (lápiz -> destino). Si no se puede, el caso es NO_EJERCIDO, nunca
    // una medición sobre un campo ausente (corrida UAT 25/11: tras TM-650 el modal se cerró y 10 casos quedaron
    // en SIN_DATOS por escribir en un campo que ya no estaba).
    const ensureOpen = async (label: string): Promise<string | null> => {
      if ((await this.screen.openSearchFields()) === 1) return null;
      this.log(
        `${label}: buscador cerrado (URL ${await this.screen.url()}); se reabre lápiz -> destino`
      );
      const reach = await this.screen.reachSearch();
      if (!reach.reachable) return reach.reason;
      await installCapture(this.driver);
      return null;
    };
    const step = async (
      label: string,
      run: () => Promise<DriverCaseResult | DriverCaseResult[]>
    ): Promise<void> => {
      const notOpen = await ensureOpen(label).catch((e: unknown) =>
        e instanceof Error ? e.message : String(e)
      );
      if (notOpen !== null) {
        await push(
          caseFrom(label, 'buscador no disponible', {
            status: 'NO_EJERCIDO',
            detail: `No se pudo reabrir el buscador antes del caso: ${notOpen}`
          })
        );
        return;
      }
      try {
        const r = await run();
        await push(...(Array.isArray(r) ? r : [r]));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await push(
          caseFrom(`ERROR(${label})`, 'paso con excepción', {
            status: 'SIN_DATOS',
            detail: `El paso lanzó: ${msg}`
          })
        );
      }
    };

    // La inyección de fallas va AL FINAL y TM-663 (que cierra y reabre el buscador) justo antes.
    await step('TM-650', async () =>
      caseFromProbe(
        'TM-650',
        'Cero llamadas a Google (dos canales)',
        await runOwnEndpointProbe(target, {
          term: DRIVER_ADDRESS_TERMS.ownEndpoint,
          settleMs: this.settleMs
        })
      )
    );
    await step('TM-651', () => this.tm651());
    await step('TM-654', async () =>
      caseFromProbe(
        'TM-654',
        'Debounce ~300 ms',
        await runDebounceProbe(target, {
          term: DRIVER_ADDRESS_TERMS.debounce,
          settleMs: this.settleMs
        })
      )
    );
    await step('TM-655', async () =>
      caseFromProbe(
        'TM-655',
        'Término repetido no reconsulta',
        await runDistinctUntilChangedProbe(target, {
          term: DRIVER_ADDRESS_TERMS.distinct,
          settleMs: this.settleMs
        })
      )
    );
    await step('TM-656/657', () => this.minLength());
    await step('TM-662', async () =>
      caseFromProbe(
        'TM-662',
        'sessionToken compartido en la sesión',
        await runSessionTokenProbe(target, { settleMs: this.settleMs })
      )
    );
    await step('TM-664', () => this.tm664());
    await step('ORDEN', () => this.order());
    await step('TM-663', () => this.tm663());

    await step('TM-665', () => this.tm665());
    await clearWebViewFaultInjection(this.driver).catch(() => undefined);
    return out;
  }
}
