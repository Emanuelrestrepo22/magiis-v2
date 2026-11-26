/**
 * Tipos y constantes compartidos de la captura de red del WebView (y de la inyección de fallas / actividad
 * Google que cuelgan de ella). Portado de V1 `helpers/webViewNetworkCapture.ts` sin cambios de comportamiento.
 */
import type { Browser } from 'webdriverio';

export type WebViewNetworkCaptureRecord = {
  id: number;
  kind: 'fetch' | 'xhr';
  method: string;
  url: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status?: number;
  ok?: boolean;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  error?: string;
  /** True when the request never reached the network because a fault-injection rule matched. */
  injected?: boolean;
  injectedRule?: string;
  injectedMode?: WebViewFaultInjectionMode;
};

export type WebViewNetworkCaptureDump = {
  label: string;
  timestamp: string;
  webview: string | null;
  url: string;
  entries: WebViewNetworkCaptureRecord[];
};

/**
 * `status` returns a synthetic response without touching the network.
 * `timeout` parks the request so the app sees a hung call. It is abort-aware: an `AbortController`
 * on the fetch side, and `abort()` / `xhr.timeout` on the XHR side, settle it with the same
 * error the platform would raise, so the app's degraded state actually renders.
 * `networkError` rejects with a TypeError, exactly like a real fetch network failure.
 */
export type WebViewFaultInjectionMode = 'status' | 'timeout' | 'networkError';

export type WebViewFaultInjectionRule = {
  /** Stable rule identifier used in the capture records and the state report. Defaults to `rule-<n>`. */
  id?: string;
  /** Substring of the request URL, or a serializable regex source when `matchMode` is `regex`. */
  urlPattern: string;
  matchMode?: 'substring' | 'regex';
  /** Flags applied when `matchMode` is `regex` (for example `i`). */
  regexFlags?: string;
  /** Optional HTTP method filter (case-insensitive). Empty means any method. */
  method?: string;
  /** Optional transport filter. Empty means both fetch and XHR. */
  kinds?: Array<'fetch' | 'xhr'>;
  mode: WebViewFaultInjectionMode;
  /**
   * Response status for `mode: 'status'`. Defaults to 503. Must be inside 200-599: the `Response`
   * constructor throws `RangeError` outside that window. To simulate "no response at all" use
   * `mode: 'networkError'`, never `status: 0`.
   */
  status?: number;
  /** Response body for `mode: 'status'`. Defaults to an empty body. */
  body?: string;
  /** Response content type for `mode: 'status'`. Defaults to `application/json`. */
  contentType?: string;
  /** Delay before the fault is applied. For `timeout` this is how long the hang lasts (default 600000 ms). */
  delayMs?: number;
  /**
   * Maximum number of matches. Omit for unlimited. Once exhausted the request passes through untouched.
   * The budget is per install and keyed by rule `id`: reinstalling a rule set re-arms `times`, while the
   * cumulative `hits` counter survives for the evidence report. Auto-generated ids are positional
   * (`rule-1`, `rule-2`), so pass an explicit `id` when a rule must stay distinguishable across installs.
   */
  times?: number;
};

export type WebViewFaultInjectionRuleState = {
  id: string;
  urlPattern: string;
  mode: WebViewFaultInjectionMode;
  times: number | null;
  /** Cumulative matches for this rule id, preserved across rule-set reinstalls. */
  hits: number;
  /** Matches since the current rule set was installed. This is what `times` is measured against. */
  hitsSinceInstall: number;
};

export type WebViewFaultInjectionState = {
  installed: boolean;
  /** Rules still eligible to match. Zero after `clearWebViewFaultInjection`. */
  activeRules: number;
  /**
   * Requests still parked by a fault rule: a hang from a `timeout` rule, or a `status` response
   * still waiting on its `delayMs` timer. Settled requests drain themselves out of this count.
   */
  pending: number;
  /** Cumulative matches for every rule id seen in this page, including rule sets already replaced. */
  totalHits: number;
  /** Only the rules of the CURRENT rule set. `hits` inside each entry is still cumulative. */
  rules: WebViewFaultInjectionRuleState[];
};

/** Serializable shape handed to the WebView. Kept explicit so the in-page rule reader stays typed. */
export type SerializedFaultRule = {
  id: string;
  urlPattern: string;
  matchMode: 'substring' | 'regex';
  regexFlags: string;
  method: string;
  kinds: Array<'fetch' | 'xhr'>;
  mode: WebViewFaultInjectionMode;
  status: number | null;
  body: string | null;
  contentType: string | null;
  delayMs: number | null;
  times: number | null;
};

/**
 * Google Places activity observed OUTSIDE the fetch/XHR hooks.
 * `readWebViewGoogleActivity` is the positive evidence source for the anti-fallback assertion.
 */
export type WebViewGoogleActivity = {
  /**
   * False when the probe itself could not run (no WEBVIEW context, the in-page script threw, or both
   * in-page probes failed). The remaining fields are then MEANINGLESS: an empty report with
   * `available: false` is a harness failure, NOT evidence that Google was never contacted.
   */
  available: boolean;
  /** Why the probe could not run. Only set when `available` is false. */
  unavailableReason?: string;
  /**
   * Probes that failed while the report still ran (partial read). Empty on a clean read.
   * The strict negative assertion requires `available === true` AND `probeErrors.length === 0`.
   */
  probeErrors: string[];
  /** `src` of every Google Maps/Places script tag currently in the DOM. */
  scriptTags: string[];
  /** Resource Timing entries pointing at a Google Maps/Places host, including script and image loads. */
  resourceEntries: { name: string; startTime: number }[];
  /** True when `window.google.maps` exists or a Maps script tag is present in the DOM. */
  sdkPresent: boolean;
};

export const NETWORK_CAPTURE_KEY = '__magiisNetworkCapture__';
export const FAULT_INJECTION_KEY = '__magiisFaultInjection__';
/** Hosts que significan «la app habló con Google Places», pasados al WebView como dato. */
export const GOOGLE_ACTIVITY_HOSTS = [
  'maps.googleapis.com',
  'places.googleapis.com',
  'maps.gstatic.com'
];

export async function switchToWebView(driver: Browser, timeoutMs = 10_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const contexts = (await driver.getContexts().catch(() => [])) as string[];
    const webview = contexts.find((context) => context.startsWith('WEBVIEW'));
    if (webview) {
      await driver.switchContext(webview);
      return webview;
    }

    await driver.pause(250);
  }

  return null;
}
