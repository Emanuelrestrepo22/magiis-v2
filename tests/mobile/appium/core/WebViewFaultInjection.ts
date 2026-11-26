/**
 * Inyección de fallas sobre los hooks de la captura (status sintético / timeout / networkError).
 * Requiere la captura instalada: `installWebViewFaultInjection` la instala si falta.
 */
import type { Browser } from 'webdriverio';
import { installWebViewNetworkCapture } from './WebViewNetworkCapture.js';
import {
  FAULT_INJECTION_KEY,
  switchToWebView,
  type SerializedFaultRule,
  type WebViewFaultInjectionRule,
  type WebViewFaultInjectionState
} from './WebViewNetworkCaptureTypes.js';

/** Valida y serializa las reglas (falla fuerte AQUÍ, antes de tocar el WebView). Puro. */
export function serializeFaultRules(rules: WebViewFaultInjectionRule[]): SerializedFaultRule[] {
  return rules.map((rule, index) => {
    const ruleId = typeof rule.id === 'string' && rule.id.length ? rule.id : `rule-${index + 1}`;

    // Fail here, loudly, instead of letting the Response constructor throw a RangeError inside the
    // WebView after the injected record was already written: that produced a DUPLICATE record for
    // the same request, the second one looking like a genuine network failure.
    if (
      rule.mode === 'status' &&
      typeof rule.status === 'number' &&
      (!Number.isInteger(rule.status) || rule.status < 200 || rule.status > 599)
    ) {
      throw new Error(
        `Fault-injection rule "${ruleId}" uses mode 'status' with status ${rule.status}, which is outside the 200-599 range the Response constructor accepts. Use mode: 'networkError' to simulate an absent response.`
      );
    }

    // The in-page normalizer collapses anything unrecognised to 'status', and the mode also picks the
    // execution branch. Without this, a typo like 'timeoutt' silently becomes a mute 503.
    if (rule.mode !== 'status' && rule.mode !== 'timeout' && rule.mode !== 'networkError') {
      throw new Error(
        `Fault-injection rule "${ruleId}" has mode '${String(rule.mode)}'. Valid modes are 'status', 'timeout' and 'networkError'.`
      );
    }

    return {
      id: ruleId,
      urlPattern: rule.urlPattern,
      matchMode: rule.matchMode === 'regex' ? 'regex' : 'substring',
      regexFlags: typeof rule.regexFlags === 'string' ? rule.regexFlags : '',
      method: typeof rule.method === 'string' ? rule.method : '',
      kinds: Array.isArray(rule.kinds) ? rule.kinds.slice() : [],
      mode: rule.mode,
      status: typeof rule.status === 'number' ? rule.status : null,
      body: typeof rule.body === 'string' ? rule.body : null,
      contentType: typeof rule.contentType === 'string' ? rule.contentType : null,
      delayMs: typeof rule.delayMs === 'number' ? rule.delayMs : null,
      times: typeof rule.times === 'number' ? rule.times : null
    };
  });
}

/**
 * Installs (or replaces) the fault-injection rule set consumed by the capture hooks.
 * Rules are plain serializable data: no functions, no regex literals.
 * With an empty rule set the helper observes only, exactly as before.
 *
 * Hit accounting across reinstalls: the cumulative `hits` counter per rule id is PRESERVED, so the
 * evidence of a previous step is never lost, while the `times` budget is re-armed per install
 * (`hitsSinceInstall` is what `times` is compared against). Auto-generated ids are positional
 * (`rule-1`, `rule-2`), so pass explicit ids when two steps must stay distinguishable.
 *
 * `mode: 'status'` limitation on the XHR leg: the synthetic value is only shadowed for a
 * `responseType` of `''`, `'text'` or `'json'`. For `blob` / `arraybuffer` / `document` the app reads
 * the real (empty) response, because fabricating those types faithfully is not possible here. The
 * injected body is always present in the capture record regardless.
 *
 * @throws When `mode: 'status'` carries a status outside 200-599 (the `Response` constructor throws
 * `RangeError` there). Use `mode: 'networkError'` to simulate an absent response.
 */
export async function installWebViewFaultInjection(
  driver: Browser,
  rules: WebViewFaultInjectionRule[]
): Promise<void> {
  // The interception engine lives inside the capture hooks, so they must exist first.
  await installWebViewNetworkCapture(driver);

  const payload = serializeFaultRules(rules);

  const webview = await switchToWebView(driver);
  if (!webview) {
    throw new Error('No WEBVIEW context available to install the fault-injection rules');
  }

  await driver.execute(
    (faultKey: string, ruleList: SerializedFaultRule[]) => {
      const win = window as any;
      const previous = win[faultKey] as
        | { pending?: { cancel?: () => void }[]; hits?: Record<string, number> }
        | undefined;

      // Settle anything a previous rule set left hanging before replacing it.
      if (previous && Array.isArray(previous.pending)) {
        for (const item of previous.pending.slice()) {
          try {
            item?.cancel?.();
          } catch {
            // Ignore. The request is being discarded anyway.
          }
        }
      }

      const incoming: SerializedFaultRule[] = Array.isArray(ruleList) ? ruleList.slice() : [];
      // `activeRules` drives matching and is emptied by clear(); `registry` keeps the
      // metadata so the state report survives a clear.
      const activeRules: SerializedFaultRule[] = incoming.slice();
      const registry: SerializedFaultRule[] = incoming.slice();
      const pending: { cancel?: () => void }[] = [];
      // `hits` is cumulative evidence carried over from previous rule sets; `budget` is the
      // per-install counter `times` is measured against.
      const hits: Record<string, number> = {};
      const budget: Record<string, number> = {};
      const previousHits: Record<string, number> =
        previous && previous.hits && typeof previous.hits === 'object' ? previous.hits : {};

      for (const key of Object.keys(previousHits)) {
        const value = previousHits[key];
        hits[key] = typeof value === 'number' ? value : 0;
      }

      for (const rule of registry) {
        const ruleId = String(rule?.id ?? rule?.urlPattern ?? '');
        if (typeof hits[ruleId] !== 'number') {
          hits[ruleId] = 0;
        }

        budget[ruleId] = 0;
      }

      const cancelPending = (): void => {
        // Iterate a copy: each cancel() drains its own item out of `pending`.
        for (const item of pending.slice()) {
          try {
            item?.cancel?.();
          } catch {
            // Ignore. Teardown must not fail on a discarded request.
          }
        }

        pending.length = 0;
      };

      win[faultKey] = {
        installed: true,
        rules: activeRules,
        hits,
        budget,
        pending,
        clear: () => {
          cancelPending();
          activeRules.length = 0;
        },
        state: () => ({
          installed: true,
          activeRules: activeRules.length,
          pending: pending.length,
          totalHits: Object.keys(hits).reduce((total, key) => total + (hits[key] ?? 0), 0),
          rules: registry.map((rule) => {
            const ruleId = String(rule?.id ?? rule?.urlPattern ?? '');
            return {
              id: ruleId,
              urlPattern: String(rule?.urlPattern ?? ''),
              mode:
                rule?.mode === 'timeout' || rule?.mode === 'networkError' ? rule.mode : 'status',
              times: typeof rule?.times === 'number' ? rule.times : null,
              hits: hits[ruleId] ?? 0,
              hitsSinceInstall: budget[ruleId] ?? 0
            };
          })
        })
      };

      return true;
    },
    FAULT_INJECTION_KEY,
    payload
  );
}

/**
 * Drops every active rule and settles requests parked by a `timeout` rule.
 * After this call the capture behaves exactly as an observation-only helper.
 */
export async function clearWebViewFaultInjection(driver: Browser): Promise<void> {
  const webview = await switchToWebView(driver);
  if (!webview) {
    return;
  }

  await driver.execute((faultKey: string) => {
    const win = window as any;
    const state = win[faultKey] as { clear?: () => void } | undefined;
    state?.clear?.();
  }, FAULT_INJECTION_KEY);
}

/** Reports how many times each rule fired, for the evidence attached to the test run. */
export async function readWebViewFaultInjectionState(
  driver: Browser
): Promise<WebViewFaultInjectionState> {
  const originalContext = await driver.getContext().catch(() => null);
  const webview = await switchToWebView(driver);
  const empty: WebViewFaultInjectionState = {
    installed: false,
    activeRules: 0,
    pending: 0,
    totalHits: 0,
    rules: []
  };

  if (!webview) {
    return empty;
  }

  const raw = (await driver.execute((faultKey: string) => {
    const win = window as any;
    const state = win[faultKey] as { state?: () => unknown } | undefined;
    return state?.state?.() ?? null;
  }, FAULT_INJECTION_KEY)) as WebViewFaultInjectionState | null;

  if (originalContext) {
    try {
      await driver.switchContext(originalContext);
    } catch {
      // Ignore. The state is already collected.
    }
  }

  return raw ?? empty;
}
