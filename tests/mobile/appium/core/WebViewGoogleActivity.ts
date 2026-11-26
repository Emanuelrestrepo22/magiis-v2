/**
 * Actividad de Google Places observada FUERA de los hooks fetch/XHR (DOM + Resource Timing).
 */
import type { Browser } from 'webdriverio';
import {
  GOOGLE_ACTIVITY_HOSTS,
  switchToWebView,
  type WebViewGoogleActivity
} from './WebViewNetworkCaptureTypes.js';

/**
 * Reports Google Places activity through channels the fetch/XHR hooks CANNOT see.
 *
 * KNOWN LIMITATION of the capture, and the reason this function exists: the hooks only wrap
 * `window.fetch` and `XMLHttpRequest.prototype.send`. Script injection, `sendBeacon`, `EventSource`
 * and `WebSocket` are NOT hooked, so the Google Maps JS SDK (`AutocompleteService`, which loads by
 * injecting a `<script>` and talks to Google from inside the SDK) is INVISIBLE to the capture.
 *
 * Therefore the anti-fallback assertion ("the app must not fall back to Google when our endpoint
 * fails") MUST NOT be built only on "no capture entry has a Google URL": that predicate passes green
 * even when the fallback happened. Assert on this function instead, which observes the DOM and
 * Resource Timing (`performance.getEntriesByType('resource')` does see script and image loads):
 *
 *   - `available === true` AND `probeErrors.length === 0` AND `sdkPresent === false` AND
 *     `resourceEntries.length === 0` is positive evidence of no fallback. The first two conjuncts are
 *     NOT optional: an unavailable report carries the same empty findings as a clean one, so dropping
 *     them turns a harness failure into a green anti-fallback assertion.
 *   - `sdkPresent === true` means the SDK is reachable; combine with `resourceEntries` timestamps
 *     taken before and after the fault window to tell an idle SDK from an SDK that was actually used.
 *
 * Resource Timing caps its buffer (250 entries by default, raised to 1000 when the capture installs).
 * Once full, new entries are dropped SILENTLY, so run the fallback case early in a long session.
 *
 * Residual gap: a fallback over an unhooked transport to a NON-Google host would still be invisible.
 * This narrows the blind spot, it does not eliminate it.
 */
export async function readWebViewGoogleActivity(driver: Browser): Promise<WebViewGoogleActivity> {
  const originalContext = await driver.getContext().catch(() => null);
  const webview = await switchToWebView(driver);

  // An unavailable report carries EMPTY findings, which is byte-identical to "Google was never
  // contacted". `available: false` is the only thing telling the two apart, so it is never omitted.
  const unavailable = (reason: string): WebViewGoogleActivity => ({
    available: false,
    unavailableReason: reason,
    probeErrors: [],
    scriptTags: [],
    resourceEntries: [],
    sdkPresent: false
  });

  if (!webview) {
    return unavailable('No WEBVIEW context was reachable.');
  }

  const raw = (await driver
    .execute((hostList: string[]) => {
      const win = window as any;
      const matchesHost = (value: string): boolean =>
        hostList.some((host) => value.indexOf(host) !== -1);
      const probeErrors: string[] = [];

      let scriptTags: string[] = [];
      try {
        scriptTags = Array.from(document.querySelectorAll('script[src]'))
          .map((node) => String(node.getAttribute('src') ?? ''))
          .filter((src) => matchesHost(src));
      } catch (error) {
        probeErrors.push('dom: ' + String((error as Error)?.message ?? error));
        scriptTags = [];
      }

      let resourceEntries: { name: string; startTime: number }[] = [];
      try {
        resourceEntries = performance
          .getEntriesByType('resource')
          .filter((entry) => matchesHost(String(entry.name)))
          .map((entry) => ({ name: String(entry.name), startTime: Math.round(entry.startTime) }));
      } catch (error) {
        // Resource Timing is unavailable in this WebView: the DOM scan is the only signal left.
        probeErrors.push('resourceTiming: ' + String((error as Error)?.message ?? error));
        resourceEntries = [];
      }

      const maps = win.google && typeof win.google === 'object' ? win.google.maps : null;

      return {
        probeErrors,
        scriptTags,
        resourceEntries,
        sdkPresent: Boolean(maps) || scriptTags.length > 0
      };
    }, GOOGLE_ACTIVITY_HOSTS)
    .catch((error: Error) => ({ executeError: String(error?.message ?? error) }))) as
    | {
        probeErrors: string[];
        scriptTags: string[];
        resourceEntries: { name: string; startTime: number }[];
        sdkPresent: boolean;
      }
    | { executeError: string };

  if (originalContext) {
    try {
      await driver.switchContext(originalContext);
    } catch {
      // Ignore. The activity report is already collected.
    }
  }

  if ('executeError' in raw) {
    return unavailable('The in-page probe threw: ' + raw.executeError);
  }

  // Both probes failing means nothing was actually observed, so the empty findings are not evidence.
  if (raw.probeErrors.length >= 2) {
    return { ...raw, available: false, unavailableReason: 'Every in-page probe failed.' };
  }

  return { ...raw, available: true };
}
