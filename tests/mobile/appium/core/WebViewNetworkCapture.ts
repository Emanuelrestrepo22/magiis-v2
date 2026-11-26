/**
 * Captura de red del WebView (hooks de fetch / XHR inyectados en la página) + lectura y volcado a evidencia.
 * Los hooks leen las reglas de falla de forma perezosa: ver `WebViewFaultInjection.ts`. Actividad Google
 * fuera de fetch/XHR: ver `WebViewGoogleActivity.ts`. Tipos y claves: `WebViewNetworkCaptureTypes.ts`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'webdriverio';
import {
  FAULT_INJECTION_KEY,
  NETWORK_CAPTURE_KEY,
  switchToWebView,
  type WebViewNetworkCaptureDump,
  type WebViewNetworkCaptureRecord
} from './WebViewNetworkCaptureTypes.js';

export function safeLabel(label: string): string {
  return label
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function formatHeaders(headers: Record<string, string> | undefined): string {
  if (!headers || !Object.keys(headers).length) {
    return '<none>';
  }

  return JSON.stringify(headers, null, 2);
}

export function formatBody(body: string | undefined): string {
  if (!body) {
    return '<empty>';
  }

  return body;
}

export async function installWebViewNetworkCapture(driver: Browser): Promise<void> {
  const webview = await switchToWebView(driver);
  if (!webview) {
    throw new Error('No WEBVIEW context available to install the network capture helper');
  }

  await driver.execute(
    (storageKey: string, faultKey: string) => {
      const win = window as any;
      const existing = win[storageKey] as
        | {
            installed?: boolean;
            clear?: () => void;
            snapshot?: () => unknown[];
          }
        | undefined;

      // The hooks read the fault-injection rules lazily on every request, so rules can be
      // installed, replaced or cleared later without ever reinstalling these hooks.
      if (existing?.installed) {
        return true;
      }

      // Resource Timing keeps only 250 entries by default and then DROPS every new one in silence.
      // `readWebViewGoogleActivity` reads that buffer, so an overflow turns a real Google load into a
      // false negative for the anti-fallback assertion. Widen it at install time: an entry already
      // dropped cannot be recovered afterwards.
      try {
        if (
          typeof performance !== 'undefined' &&
          typeof performance.setResourceTimingBufferSize === 'function'
        ) {
          performance.setResourceTimingBufferSize(1000);
        }
      } catch {
        // Ignore. An old WebView without the API keeps the default 250-entry buffer.
      }

      const entries: Record<string, unknown>[] = [];
      let seq = 0;

      const truncateValue = (value: string, limit = 20_000): string => {
        if (value.length <= limit) {
          return value;
        }

        return `${value.slice(0, limit)}... [truncated ${value.length - limit} chars]`;
      };

      const parseHeaders = (headerBlock: string): Record<string, string> => {
        const output: Record<string, string> = {};
        headerBlock
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .forEach((line) => {
            const separator = line.indexOf(':');
            if (separator > 0) {
              const key = line.slice(0, separator).trim();
              const value = line.slice(separator + 1).trim();
              output[key] = value;
            }
          });
        return output;
      };

      const toRecord = (headers: unknown): Record<string, string> => {
        const output: Record<string, string> = {};
        if (!headers) {
          return output;
        }

        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
          headers.forEach((value, key) => {
            output[key] = value;
          });
          return output;
        }

        if (Array.isArray(headers)) {
          for (const item of headers) {
            if (Array.isArray(item) && item.length >= 2) {
              output[String(item[0])] = String(item[1]);
            }
          }
          return output;
        }

        if (typeof headers === 'object') {
          for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
            output[key] = String(value ?? '');
          }
        }

        return output;
      };

      const bodyToString = async (body: unknown): Promise<string> => {
        if (body === null || typeof body === 'undefined') {
          return '';
        }

        if (typeof body === 'string') {
          return body;
        }

        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
          return body.toString();
        }

        if (typeof FormData !== 'undefined' && body instanceof FormData) {
          const entries = Array.from(
            (body as unknown as { entries(): Iterable<[string, FormDataEntryValue]> }).entries()
          ).map(([key, value]) => {
            if (typeof value === 'string') {
              return `${key}=${value}`;
            }

            const file = value as File;
            const fileName = typeof file?.name === 'string' ? file.name : 'blob';
            return `${key}=[File ${fileName}]`;
          });

          return entries.join('&');
        }

        if (typeof Blob !== 'undefined' && body instanceof Blob) {
          return `[Blob size=${body.size} type=${body.type}]`;
        }

        if (body instanceof ArrayBuffer) {
          return `[ArrayBuffer byteLength=${body.byteLength}]`;
        }

        if (ArrayBuffer.isView(body)) {
          return `[TypedArray byteLength=${body.byteLength}]`;
        }

        if (typeof Request !== 'undefined' && body instanceof Request) {
          try {
            return await body.clone().text();
          } catch {
            return `[Request ${body.method} ${body.url}]`;
          }
        }

        if (typeof body === 'object') {
          try {
            return JSON.stringify(body);
          } catch {
            return String(body);
          }
        }

        return String(body);
      };

      const pushEntry = (entry: Record<string, unknown>): void => {
        entries.push(entry);
      };

      const sleep = (ms: number): Promise<void> =>
        new Promise<void>((resolve) => {
          win.setTimeout(resolve, ms);
        });

      type InjectedMode = 'status' | 'timeout' | 'networkError';

      /** Handle stored on an XHR instance parked by a `timeout` rule, so abort()/open() can settle it. */
      type ParkedFault = {
        settle: (eventType: 'timeout' | 'abort', reason: string) => void;
        discard: () => void;
      };

      /**
       * Handle stored on an XHR instance whose injected `status` response is still waiting on its
       * `delayMs` timer, so open()/abort()/teardown can kill it before it fires on a reused instance.
       */
      type ParkedStatusFault = {
        cancel: () => void;
      };

      /**
       * Own-properties an injected XHR response writes on the instance. They MUST be removed when the
       * instance is reused, otherwise a later real response is read through the stale shadows.
       */
      const shadowedProperties = [
        'readyState',
        'status',
        'statusText',
        'responseText',
        'response',
        'responseURL',
        'getAllResponseHeaders'
      ];

      /** Keeps `injectedMode` a real union instead of an unchecked `String()` cast. */
      const normalizeMode = (value: unknown): InjectedMode => {
        if (value === 'timeout') {
          return 'timeout';
        }

        if (value === 'networkError') {
          return 'networkError';
        }

        return 'status';
      };

      const faultState = (): any => {
        const state = win[faultKey];
        return state && typeof state === 'object' ? state : null;
      };

      /**
       * Returns the first eligible fault rule for this request, or null when the request must
       * pass through untouched. Increments both the cumulative hit counter (evidence, survives a
       * rule-set reinstall) and the per-install budget counter (what `times` is measured against).
       */
      const matchFaultRule = (kind: string, method: string, url: string): any => {
        const state = faultState();
        const rules: any[] = state && Array.isArray(state.rules) ? state.rules : [];
        if (!rules.length) {
          return null;
        }

        const hits: Record<string, number> =
          state.hits && typeof state.hits === 'object' ? state.hits : (state.hits = {});
        const budget: Record<string, number> =
          state.budget && typeof state.budget === 'object' ? state.budget : (state.budget = {});
        const target = String(url ?? '');
        const verb = String(method ?? '').toUpperCase();

        for (const rule of rules) {
          if (!rule || typeof rule.urlPattern !== 'string' || !rule.urlPattern.length) {
            continue;
          }

          if (Array.isArray(rule.kinds) && rule.kinds.length && rule.kinds.indexOf(kind) === -1) {
            continue;
          }

          if (
            typeof rule.method === 'string' &&
            rule.method.length &&
            rule.method.toUpperCase() !== verb
          ) {
            continue;
          }

          let matched = false;
          if (rule.matchMode === 'regex') {
            try {
              matched = new RegExp(
                rule.urlPattern,
                typeof rule.regexFlags === 'string' ? rule.regexFlags : ''
              ).test(target);
            } catch {
              matched = false;
            }
          } else {
            matched = target.indexOf(rule.urlPattern) !== -1;
          }

          if (!matched) {
            continue;
          }

          const ruleId = String(rule.id ?? rule.urlPattern);
          const used = typeof budget[ruleId] === 'number' ? budget[ruleId] : 0;
          if (typeof rule.times === 'number' && used >= rule.times) {
            continue;
          }

          budget[ruleId] = used + 1;
          hits[ruleId] = (typeof hits[ruleId] === 'number' ? hits[ruleId] : 0) + 1;
          return rule;
        }

        return null;
      };

      /**
       * Parks a hung request so `clearWebViewFaultInjection` can settle it and unblock teardown.
       * Returns the drain callback: whoever settles the request MUST call it, otherwise the
       * `pending` count keeps reporting already-settled requests as parked.
       */
      const registerPendingFault = (pendingFault: Record<string, unknown>): (() => void) => {
        const state = faultState();
        if (!state || !Array.isArray(state.pending)) {
          return (): void => {
            // No rule set installed: nothing was parked, so nothing to drain.
          };
        }

        const list: unknown[] = state.pending;
        list.push(pendingFault);

        return (): void => {
          const index = list.indexOf(pendingFault);
          if (index !== -1) {
            list.splice(index, 1);
          }
        };
      };

      const originalFetch = typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
      if (originalFetch) {
        win.fetch = (async (...args: any[]) => {
          const startedAt = new Date().toISOString();
          const started = performance.now();
          const id = ++seq;
          let url = '';
          let method = 'GET';
          let requestHeaders: Record<string, string> = {};
          let requestBody = '';

          try {
            const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];

            if (typeof input === 'string' || input instanceof URL) {
              url = String(input);
            } else if (typeof Request !== 'undefined' && input instanceof Request) {
              url = input.url;
              method = input.method || method;
              requestHeaders = toRecord(input.headers);
              requestBody = await bodyToString(input.clone());
            }

            if (init?.method) {
              method = init.method;
            }

            if (init?.headers) {
              requestHeaders = { ...requestHeaders, ...toRecord(init.headers) };
            }

            if (typeof init?.body !== 'undefined') {
              requestBody = await bodyToString(init.body);
            }

            // Fault injection runs BEFORE the original fetch, so a matched request never
            // reaches the network. It is still recorded, flagged as injected.
            const faultRule = matchFaultRule('fetch', method, url);
            if (faultRule) {
              const faultMode = normalizeMode(faultRule.mode);
              const faultDelay =
                typeof faultRule.delayMs === 'number' && faultRule.delayMs > 0
                  ? faultRule.delayMs
                  : 0;
              const faultBase = {
                id,
                kind: 'fetch',
                method,
                url,
                startedAt,
                requestHeaders,
                requestBody: truncateValue(requestBody),
                injected: true,
                injectedRule: String(faultRule.id ?? faultRule.urlPattern),
                injectedMode: faultMode
              };

              if (faultMode === 'timeout') {
                // A parked request is only useful if the app can still give up on it. An
                // AbortController is the standard way an autocomplete cancels itself, and the
                // degraded state renders on THAT rejection, so the signal must be honoured or
                // the test hangs until the WebdriverIO command timeout instead of observing
                // the degradation. Both `init.signal` and the `Request` signal are covered.
                const abortSignal: AbortSignal | null =
                  init?.signal ??
                  (typeof Request !== 'undefined' && input instanceof Request
                    ? input.signal
                    : null);
                // Kept by reference so the parked entry can be corrected once it settles.
                const timeoutEntry: Record<string, unknown> = {
                  ...faultBase,
                  error: 'Injected fault: request hangs (timeout mode)'
                };
                pushEntry(timeoutEntry);

                return new Promise((_resolve, reject) => {
                  let settled = false;
                  let timer = 0;
                  let drain = (): void => {
                    // Replaced by the pending-list drain once the request is parked.
                  };

                  const abortError = (): Error => {
                    try {
                      return new DOMException('The user aborted a request.', 'AbortError');
                    } catch {
                      // Older WebViews without a constructible DOMException.
                      const fallback = new Error('The user aborted a request.');
                      fallback.name = 'AbortError';
                      return fallback;
                    }
                  };

                  const settle = (failure: Error, reason: string): void => {
                    if (settled) {
                      return;
                    }

                    settled = true;
                    win.clearTimeout(timer);
                    if (abortSignal) {
                      try {
                        abortSignal.removeEventListener('abort', onAbort);
                      } catch {
                        // Ignore. The listener dies with the page anyway.
                      }
                    }

                    drain();
                    timeoutEntry.endedAt = new Date().toISOString();
                    timeoutEntry.durationMs = Math.round(performance.now() - started);
                    timeoutEntry.error = reason;
                    (failure as any).__magiisInjectedFault = true;
                    reject(failure);
                  };

                  const onAbort = (): void => {
                    settle(abortError(), 'Injected fault: hang aborted by the app (AbortError)');
                  };

                  if (abortSignal?.aborted) {
                    settle(
                      abortError(),
                      'Injected fault: signal was already aborted before the hang started'
                    );
                    return;
                  }

                  // Bounded hang: the app sees a stalled request, but the promise always
                  // settles eventually so the teardown is never blocked by this helper.
                  timer = win.setTimeout(
                    () =>
                      settle(
                        new TypeError('Injected fault: timeout elapsed'),
                        'Injected fault: timeout elapsed'
                      ),
                    faultDelay > 0 ? faultDelay : 600000
                  );

                  if (abortSignal) {
                    try {
                      abortSignal.addEventListener('abort', onAbort);
                    } catch {
                      // Ignore. Without the listener the bounded hang still settles.
                    }
                  }

                  drain = registerPendingFault({
                    id,
                    kind: 'fetch',
                    url,
                    cancel: () =>
                      settle(
                        new TypeError('Injected fault: timeout cancelled on teardown'),
                        'Injected fault: timeout cancelled on teardown'
                      )
                  });
                });
              }

              if (faultDelay > 0) {
                await sleep(faultDelay);
              }

              if (faultMode === 'networkError') {
                pushEntry({
                  ...faultBase,
                  endedAt: new Date().toISOString(),
                  durationMs: Math.round(performance.now() - started),
                  error: 'Injected fault: network error'
                });

                const failure = new TypeError('Failed to fetch');
                (failure as any).__magiisInjectedFault = true;
                throw failure;
              }

              const faultStatus = typeof faultRule.status === 'number' ? faultRule.status : 503;
              const faultBody = typeof faultRule.body === 'string' ? faultRule.body : '';
              const faultHeaders: Record<string, string> = {
                'content-type':
                  typeof faultRule.contentType === 'string'
                    ? faultRule.contentType
                    : 'application/json'
              };
              // The Response constructor rejects a body on these statuses.
              const bodylessStatus =
                faultStatus === 204 || faultStatus === 205 || faultStatus === 304;

              pushEntry({
                ...faultBase,
                endedAt: new Date().toISOString(),
                durationMs: Math.round(performance.now() - started),
                status: faultStatus,
                ok: faultStatus >= 200 && faultStatus < 300,
                responseHeaders: faultHeaders,
                responseBody: truncateValue(bodylessStatus ? '' : faultBody)
              });

              if (typeof Response === 'undefined') {
                const failure = new TypeError('Failed to fetch');
                (failure as any).__magiisInjectedFault = true;
                throw failure;
              }

              try {
                return new Response(bodylessStatus ? null : faultBody, {
                  status: faultStatus,
                  headers: faultHeaders
                });
              } catch (responseError) {
                // Safety net for a status the Response constructor refuses (outside 200-599).
                // The record above is already written, so the failure must carry the marker or
                // the outer catch writes a SECOND entry for the same request without it.
                (responseError as any).__magiisInjectedFault = true;
                throw responseError;
              }
            }

            const response = await originalFetch.apply(undefined, args as any);
            const responseText = await response
              .clone()
              .text()
              .catch(() => '');

            pushEntry({
              id,
              kind: 'fetch',
              method,
              url,
              startedAt,
              endedAt: new Date().toISOString(),
              durationMs: Math.round(performance.now() - started),
              status: response.status,
              ok: response.ok,
              requestHeaders,
              requestBody: truncateValue(requestBody),
              responseHeaders: toRecord(response.headers),
              responseBody: truncateValue(responseText)
            });

            return response;
          } catch (error) {
            // Injected failures are already recorded by the injection branch.
            if (error && (error as any).__magiisInjectedFault) {
              throw error;
            }

            pushEntry({
              id,
              kind: 'fetch',
              method,
              url,
              startedAt,
              endedAt: new Date().toISOString(),
              durationMs: Math.round(performance.now() - started),
              requestHeaders,
              requestBody: truncateValue(requestBody),
              error: error instanceof Error ? error.message : String(error)
            });
            throw error;
          }
        }) as typeof win.fetch;
      }

      const xhrProto = XMLHttpRequest.prototype as typeof XMLHttpRequest.prototype & {
        __magiisNetworkCaptureInstalled?: boolean;
      };

      if (!xhrProto.__magiisNetworkCaptureInstalled) {
        const originalOpen = xhrProto.open;
        const originalSend = xhrProto.send;
        const originalSetRequestHeader = xhrProto.setRequestHeader;
        const originalAbort = xhrProto.abort;

        xhrProto.open = function (method: string, url: string, ...rest: unknown[]) {
          const instance = this as typeof this & { __magiisParkedFault?: ParkedFault };

          // CRITICAL: an injected response shadows own-properties on the instance, and the app
          // retrying on the SAME xhr object (exactly what a 503 + retry does) would otherwise read
          // the injected status and body out of those stale shadows. The dump would then report the
          // injected failure for a request that really returned 200, and without `injected: true`.
          for (const property of shadowedProperties) {
            try {
              delete (instance as unknown as Record<string, unknown>)[property];
            } catch {
              // Ignore. The shadows are defined as configurable, so this should not happen.
            }
          }

          // Reusing the instance also discards whatever the previous send parked.
          const parked = instance.__magiisParkedFault;
          if (parked) {
            try {
              parked.discard();
            } catch {
              // Ignore. The parked request is being dropped anyway.
            }
          }

          const parkedStatus = (
            instance as typeof instance & { __magiisParkedStatusFault?: ParkedStatusFault }
          ).__magiisParkedStatusFault;
          if (parkedStatus) {
            try {
              parkedStatus.cancel();
            } catch {
              // Ignore. The parked response is being dropped anyway.
            }
          }

          delete instance.__magiisParkedFault;
          delete (instance as typeof instance & { __magiisParkedStatusFault?: ParkedStatusFault })
            .__magiisParkedStatusFault;

          const context = {
            id: ++seq,
            kind: 'xhr' as const,
            method: method || 'GET',
            url: String(url ?? ''),
            startedAt: new Date().toISOString(),
            requestHeaders: {} as Record<string, string>,
            requestBody: '',
            finalized: false
          };

          (
            this as typeof this & { __magiisNetworkCapture?: typeof context }
          ).__magiisNetworkCapture = context;
          return originalOpen.apply(this, [method, url, ...rest] as any);
        };

        xhrProto.setRequestHeader = function (name: string, value: string) {
          const context = (
            this as typeof this & {
              __magiisNetworkCapture?: { requestHeaders: Record<string, string> };
            }
          ).__magiisNetworkCapture;
          if (context) {
            context.requestHeaders[name] = value;
          }

          return originalSetRequestHeader.call(this, name, value);
        };

        xhrProto.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
          const xhr = this as typeof this & {
            __magiisNetworkCapture?: {
              id: number;
              kind: 'xhr';
              method: string;
              url: string;
              startedAt: string;
              requestHeaders: Record<string, string>;
              requestBody: string;
              finalized: boolean;
            };
          };
          // A bare send() with no preceding open() is LEGAL by spec after an injected response,
          // because originalSend never ran and the send flag was never set (a real 503 would have
          // left the object in DONE, where this would throw). So the shadows have to be cleared here
          // too, or xhr.status keeps reporting the injected value forever.
          for (const property of shadowedProperties) {
            try {
              delete (xhr as unknown as Record<string, unknown>)[property];
            } catch {
              // Ignore. The shadows are defined as configurable, so this should not happen.
            }
          }

          const previousStatusFault = (
            xhr as typeof xhr & { __magiisParkedStatusFault?: ParkedStatusFault }
          ).__magiisParkedStatusFault;
          if (previousStatusFault) {
            try {
              previousStatusFault.cancel();
            } catch {
              // Ignore. The parked response is being dropped anyway.
            }
          }

          delete (xhr as typeof xhr & { __magiisParkedStatusFault?: ParkedStatusFault })
            .__magiisParkedStatusFault;

          let context = xhr.__magiisNetworkCapture;

          // A finalized context already produced its record. Reusing it would make `finalize` return
          // early and silently drop this request from the evidence.
          if (context && context.finalized) {
            context = {
              ...context,
              id: ++seq,
              startedAt: new Date().toISOString(),
              finalized: false
            };
            xhr.__magiisNetworkCapture = context;
          }

          if (context) {
            context.requestBody =
              typeof body === 'string' ? body : body ? truncateValue(String(body)) : '';
          }

          const started = performance.now();

          // Fault injection runs BEFORE the original send, so a matched request never
          // reaches the network. It is still recorded, flagged as injected.
          const faultRule = context ? matchFaultRule('xhr', context.method, context.url) : null;
          if (context && faultRule) {
            const faultMode = normalizeMode(faultRule.mode);
            const faultDelay =
              typeof faultRule.delayMs === 'number' && faultRule.delayMs > 0
                ? faultRule.delayMs
                : 0;
            const faultBase = {
              id: context.id,
              kind: 'xhr',
              method: context.method,
              url: context.url,
              startedAt: context.startedAt,
              requestHeaders: context.requestHeaders,
              requestBody: truncateValue(context.requestBody),
              injected: true,
              injectedRule: String(faultRule.id ?? faultRule.urlPattern),
              injectedMode: faultMode
            };

            // The injected entry is the only record for this request.
            context.finalized = true;

            const shadow = (property: string, value: unknown): void => {
              try {
                Object.defineProperty(xhr, property, { configurable: true, get: () => value });
              } catch {
                // Ignore. Some WebViews refuse to shadow XHR members.
              }
            };

            const dispatch = (type: string): void => {
              let event: Event;
              try {
                event = new ProgressEvent(type, { lengthComputable: false, loaded: 0, total: 0 });
              } catch {
                event = new Event(type);
              }

              try {
                xhr.dispatchEvent(event);
              } catch {
                // Ignore. Listener delivery is best effort on a synthetic response.
              }
            };

            if (faultMode === 'timeout') {
              // Kept by reference so the parked entry can be corrected once it settles.
              const timeoutEntry: Record<string, unknown> = {
                ...faultBase,
                error: 'Injected fault: request hangs (timeout mode)'
              };
              pushEntry(timeoutEntry);

              let settled = false;
              let ownTimer = 0;
              let hangTimer = 0;
              let drain = (): void => {
                // Replaced by the pending-list drain once the request is parked.
              };

              const stop = (reason: string): void => {
                settled = true;
                win.clearTimeout(ownTimer);
                win.clearTimeout(hangTimer);
                drain();
                timeoutEntry.endedAt = new Date().toISOString();
                timeoutEntry.durationMs = Math.round(performance.now() - started);
                timeoutEntry.error = reason;
              };

              /** Settles the hang with the request-error event sequence the app is waiting for. */
              const settle = (eventType: 'timeout' | 'abort', reason: string): void => {
                if (settled) {
                  return;
                }

                stop(reason);
                timeoutEntry.status = 0;
                timeoutEntry.ok = false;
                shadow('readyState', 4);
                shadow('status', 0);
                // Spec order for a request error: readystatechange, then the specific event,
                // then loadend.
                dispatch('readystatechange');
                dispatch(eventType);
                dispatch('loadend');
              };

              const discard = (): void => {
                if (settled) {
                  return;
                }

                stop('Injected fault: hang discarded (instance reused before it settled)');
              };

              (xhr as typeof xhr & { __magiisParkedFault?: ParkedFault }).__magiisParkedFault = {
                settle,
                discard
              };

              // originalSend is never called, so the real `xhr.timeout` timer can never fire and
              // the app's own give-up budget has to be emulated here.
              const ownTimeout =
                typeof xhr.timeout === 'number' && xhr.timeout > 0 ? xhr.timeout : 0;
              if (ownTimeout > 0) {
                ownTimer = win.setTimeout(
                  () =>
                    settle(
                      'timeout',
                      `Injected fault: xhr.timeout (${ownTimeout} ms) elapsed while hanging`
                    ),
                  ownTimeout
                );
              }

              // Bounded hang, mirroring the fetch branch: the app sees a stalled request, but the
              // helper always settles it eventually so teardown is never blocked.
              // `timeout`, not `abort`: an app treats abort as a user cancellation and typically
              // renders nothing, which is exactly the degraded state the test has to observe.
              hangTimer = win.setTimeout(
                () => settle('timeout', 'Injected fault: timeout elapsed'),
                faultDelay > 0 ? faultDelay : 600000
              );

              drain = registerPendingFault({
                id: context.id,
                kind: 'xhr',
                url: context.url,
                cancel: () => settle('abort', 'Injected fault: timeout cancelled on teardown')
              });

              return;
            }

            const isNetworkError = faultMode === 'networkError';
            const faultStatus = isNetworkError
              ? 0
              : typeof faultRule.status === 'number'
                ? faultRule.status
                : 503;
            const faultBody =
              isNetworkError || typeof faultRule.body !== 'string' ? '' : faultRule.body;
            const faultHeaderBlock = isNetworkError
              ? ''
              : `content-type: ${typeof faultRule.contentType === 'string' ? faultRule.contentType : 'application/json'}\r\n`;

            // Stay asynchronous: a real send() returns before any event fires.
            const ownContext = context;
            let statusSettled = false;
            let statusTimer = 0;
            let drainStatus = (): void => {
              // Replaced by the pending-list drain once the response is parked.
            };

            /**
             * Exactly one record per request: either the injected response below, or this discard
             * note. Staying silent would leave `totalHits` disagreeing with the dump, which is its
             * own flavour of corrupt evidence.
             */
            const discardStatus = (reason: string): void => {
              if (statusSettled) {
                return;
              }

              statusSettled = true;
              win.clearTimeout(statusTimer);
              drainStatus();
              pushEntry({
                ...faultBase,
                endedAt: new Date().toISOString(),
                durationMs: Math.round(performance.now() - started),
                status: 0,
                ok: false,
                error: reason
              });
            };

            const deliverStatus = (): void => {
              shadow('readyState', 4);
              shadow('status', faultStatus);
              shadow('statusText', isNetworkError ? '' : 'Injected');

              // `responseType` decides what the app actually reads. Shadowing the raw string
              // unconditionally makes `xhr.response.predictions` throw a TypeError inside the app,
              // which fails the test on the harness instead of on the app under test.
              const responseType = String(xhr.responseType ?? '');
              if (responseType === 'json') {
                let parsedBody: unknown = null;
                try {
                  parsedBody = faultBody.length ? JSON.parse(faultBody) : null;
                } catch {
                  // A deliberately malformed injected body stays null, like a real parse failure.
                  parsedBody = null;
                }

                shadow('response', parsedBody);
                // `responseText` is intentionally NOT shadowed: the real getter throws
                // InvalidStateError for a non-text responseType, and hiding that would mask a
                // genuine app bug.
              } else if (responseType === '' || responseType === 'text') {
                shadow('responseText', faultBody);
                shadow('response', faultBody);
              }
              // blob / arraybuffer / document are left untouched for the same reason: a string
              // would be the wrong type. The body is still in the evidence record either way.

              shadow('responseURL', context.url);
              shadow('getAllResponseHeaders', () => faultHeaderBlock);

              pushEntry({
                ...faultBase,
                endedAt: new Date().toISOString(),
                durationMs: Math.round(performance.now() - started),
                status: faultStatus,
                ok: faultStatus >= 200 && faultStatus < 300,
                responseHeaders: parseHeaders(faultHeaderBlock),
                responseBody: truncateValue(faultBody),
                error: isNetworkError ? 'Injected fault: network error' : undefined
              });

              dispatch('readystatechange');
              dispatch(isNetworkError ? 'error' : 'load');
              dispatch('loadend');
            };

            statusTimer = win.setTimeout(() => {
              if (statusSettled) {
                return;
              }

              // The app may have aborted and reused this very instance while the delay ran. Firing
              // now would shadow the injected status over the request that is actually in flight and
              // steal its `loadend`, so the real response would never be recorded at all.
              if (xhr.__magiisNetworkCapture !== ownContext) {
                discardStatus(
                  'Injected fault: response discarded (instance reused before delivery)'
                );
                return;
              }

              statusSettled = true;
              drainStatus();
              deliverStatus();
            }, faultDelay);

            (
              xhr as typeof xhr & { __magiisParkedStatusFault?: ParkedStatusFault }
            ).__magiisParkedStatusFault = {
              cancel: () => discardStatus('Injected fault: response cancelled before delivery')
            };

            drainStatus = registerPendingFault({
              id: context.id,
              kind: 'xhr',
              url: context.url,
              cancel: () => discardStatus('Injected fault: response cancelled on teardown')
            });

            return;
          }

          const finalize = (): void => {
            if (!context || context.finalized) {
              return;
            }

            context.finalized = true;
            pushEntry({
              id: context.id,
              kind: 'xhr',
              method: context.method,
              url: context.url,
              startedAt: context.startedAt,
              endedAt: new Date().toISOString(),
              durationMs: Math.round(performance.now() - started),
              status: xhr.status,
              ok: xhr.status >= 200 && xhr.status < 300,
              requestHeaders: context.requestHeaders,
              requestBody: truncateValue(context.requestBody),
              responseHeaders: parseHeaders(xhr.getAllResponseHeaders?.() ?? ''),
              responseBody: truncateValue(String(xhr.responseText ?? ''))
            });
          };

          this.addEventListener('loadend', finalize);
          this.addEventListener('error', finalize);
          this.addEventListener('abort', finalize);
          return originalSend.call(this, body);
        };

        xhrProto.abort = function () {
          const instance = this as typeof this & { __magiisParkedFault?: ParkedFault };
          const parked = instance.__magiisParkedFault;

          // originalSend was never called for a parked request, so the send flag is unset and the
          // real abort() is a spec no-op that fires nothing. Without this the app's cancellation is
          // swallowed and the degraded state never renders.
          originalAbort.call(this);

          // An injected `status` response still waiting on its delay has to die with the abort too,
          // or it fires later over whatever request the app starts next on this same instance.
          const parkedStatus = (
            instance as typeof instance & { __magiisParkedStatusFault?: ParkedStatusFault }
          ).__magiisParkedStatusFault;
          if (parkedStatus) {
            try {
              parkedStatus.cancel();
            } catch {
              // Ignore. The parked response is being dropped anyway.
            }
          }

          delete (instance as typeof instance & { __magiisParkedStatusFault?: ParkedStatusFault })
            .__magiisParkedStatusFault;

          if (parked) {
            try {
              parked.settle('abort', 'Injected fault: hang aborted by the app (abort())');
            } catch {
              // Ignore. Synthetic event delivery is best effort.
            }
          }
        };

        xhrProto.__magiisNetworkCaptureInstalled = true;
      }

      win[storageKey] = {
        installed: true,
        clear: () => {
          entries.length = 0;
        },
        snapshot: () => entries.map((entry) => JSON.parse(JSON.stringify(entry)))
      };

      return true;
    },
    NETWORK_CAPTURE_KEY,
    FAULT_INJECTION_KEY
  );
}

export async function clearWebViewNetworkCapture(driver: Browser): Promise<void> {
  const webview = await switchToWebView(driver);
  if (!webview) {
    return;
  }

  await driver.execute((storageKey: string) => {
    const win = window as any;
    const capture = win[storageKey] as { clear?: () => void } | undefined;
    capture?.clear?.();
  }, NETWORK_CAPTURE_KEY);
}

export async function readWebViewNetworkCapture(
  driver: Browser
): Promise<WebViewNetworkCaptureDump> {
  const originalContext = await driver.getContext().catch(() => null);
  const webview = await switchToWebView(driver);
  const url = await driver.execute<string, []>(() => window.location.href).catch(() => '');
  const entries = (await driver.execute((storageKey: string) => {
    const win = window as any;
    const capture = win[storageKey] as { snapshot?: () => unknown[] } | undefined;
    return capture?.snapshot?.() ?? [];
  }, NETWORK_CAPTURE_KEY)) as WebViewNetworkCaptureRecord[];

  if (originalContext) {
    try {
      await driver.switchContext(originalContext);
    } catch {
      // Ignore. The capture is already collected.
    }
  }

  return {
    label: 'network-capture',
    timestamp: new Date().toISOString(),
    webview,
    url,
    entries
  };
}

export async function dumpWebViewNetworkCapture(driver: Browser, label: string): Promise<string> {
  const outDir = path.join(process.cwd(), 'evidence', 'network-capture');
  await mkdir(outDir, { recursive: true });

  const capture = await readWebViewNetworkCapture(driver);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = safeLabel(label);
  const jsonPath = path.join(outDir, `${safe}-${timestamp}.json`);
  const textPath = path.join(outDir, `${safe}-${timestamp}.txt`);

  const summary = [
    `Label: ${label}`,
    `Timestamp: ${capture.timestamp}`,
    `WebView: ${capture.webview ?? '<unavailable>'}`,
    `URL: ${capture.url || '<unavailable>'}`,
    `Entries: ${capture.entries.length}`,
    '',
    ...capture.entries.flatMap((entry, index) => {
      // The marker lives in the header line so scanning only headers still distinguishes an
      // injected request from a real one.
      const injectedMarker = entry.injected
        ? ` [INJECTED mode=${entry.injectedMode ?? 'unknown'} rule=${entry.injectedRule ?? 'unknown'}]`
        : '';
      const lines = [
        `#${index + 1} [${entry.kind}]${injectedMarker} ${entry.method} ${entry.url}`,
        `  status: ${typeof entry.status === 'number' ? entry.status : '<n/a>'}`,
        `  ok: ${typeof entry.ok === 'boolean' ? String(entry.ok) : '<n/a>'}`,
        `  startedAt: ${entry.startedAt}`,
        `  endedAt: ${entry.endedAt ?? '<n/a>'}`,
        `  durationMs: ${typeof entry.durationMs === 'number' ? entry.durationMs : '<n/a>'}`,
        `  requestHeaders: ${formatHeaders(entry.requestHeaders)}`,
        `  requestBody: ${formatBody(entry.requestBody)}`,
        `  responseHeaders: ${formatHeaders(entry.responseHeaders)}`,
        `  responseBody: ${formatBody(entry.responseBody)}`
      ];

      if (entry.injected) {
        lines.push(
          `  injected: true (rule: ${entry.injectedRule ?? '<unknown>'}, mode: ${entry.injectedMode ?? '<unknown>'})`
        );
      }

      if (entry.error) {
        lines.push(`  error: ${entry.error}`);
      }

      return [...lines, ''];
    })
  ].join('\n');

  await writeFile(jsonPath, JSON.stringify({ ...capture, label }, null, 2), 'utf-8');
  await writeFile(textPath, summary, 'utf-8');

  return jsonPath;
}
