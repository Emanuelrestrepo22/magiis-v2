// tests/helpers/waypoint-network.ts
// Observador de las llamadas de la pantalla a `carriers/{id}/waypoint[/{id}[/usage]]` (MG-1132). Sirve
// para aseverar «0 POST», «GET usage antes de cualquier DELETE», el status del PUT, etc. sin mockear:
// solo escucha. Sin aserciones: devuelve datos y el spec asevera.
import type { Page, Request, Response } from '@playwright/test';

export type WaypointCall = {
  method: string;
  /** Ruta sin query, a partir de `carriers/…`. */
  path: string;
  status: number | null;
  /** Cuerpo JSON enviado (POST/PUT), o null. */
  requestBody: unknown;
  /** Cuerpo JSON de la respuesta (solo POST/PUT/DELETE), o null. */
  responseBody: unknown;
};

const WAYPOINT_URL = /\/(carriers\/\d+\/waypoint(?:\/\d+(?:\/usage)?)?)$/;

export type WaypointCallWatch = {
  calls: () => WaypointCall[];
  /** Cantidad de llamadas `method` cuya ruta cumple `pathRe` (default: cualquiera). */
  count: (method: string, pathRe?: RegExp) => number;
  /** Índice (orden de aparición) de la primera llamada `method`/`pathRe`, o -1. */
  indexOf: (method: string, pathRe?: RegExp) => number;
  /** Última llamada `method`/`pathRe`, o undefined. */
  last: (method: string, pathRe?: RegExp) => WaypointCall | undefined;
};

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function watchWaypointCalls(page: Page): WaypointCallWatch {
  const calls: WaypointCall[] = [];
  const byRequest = new Map<Request, WaypointCall>();
  page.on('request', (request: Request) => {
    const match = WAYPOINT_URL.exec(request.url().split('?')[0]);
    if (!match || request.method() === 'OPTIONS') return;
    const call: WaypointCall = {
      method: request.method(),
      path: match[1],
      status: null,
      requestBody: parseJson(request.postData()),
      responseBody: null
    };
    byRequest.set(request, call);
    calls.push(call);
  });
  page.on('response', (response: Response) => {
    const call = byRequest.get(response.request());
    if (!call) return;
    call.status = response.status();
    if (call.method !== 'GET') {
      void response
        .text()
        .then((text) => {
          call.responseBody = parseJson(text);
        })
        .catch(() => undefined);
    }
  });
  const matching = (method: string, pathRe?: RegExp): WaypointCall[] =>
    calls.filter((c) => c.method === method && (!pathRe || pathRe.test(c.path)));
  return {
    calls: () => [...calls],
    count: (method, pathRe) => matching(method, pathRe).length,
    indexOf: (method, pathRe) =>
      calls.findIndex((c) => c.method === method && (!pathRe || pathRe.test(c.path))),
    last: (method, pathRe) => matching(method, pathRe).at(-1)
  };
}
