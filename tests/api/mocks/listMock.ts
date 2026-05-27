// tests/api/mocks/listMock.ts
// Helpers de mocking de red via route.fulfill (FW-009).
// Uso: estabilizar specs cuya pantalla depende de datos volatiles (saldos, fechas,
// KPIs) interceptando la respuesta del backend y devolviendo un fixture determinista.
//
// NO es para validar payloads de API (eso es out-of-scope, ver docs/scope-rules.md).
// Es una herramienta para hacer specs (sobre todo visuales) reproducibles.
import type { Page } from '@playwright/test';

/**
 * Intercepta requests GET que matcheen `urlPattern` y responde con `payload`.
 * El resto de metodos (POST/PUT/...) pasan sin tocar via route.continue().
 *
 * @example
 * import data from '@data/carrier-v2/clients/sample-clients.example.json' assert { type: 'json' };
 * await mockListResponse(page, /\/api\/.*\/clients/, data);
 * await clientList.goto(); // la tabla renderiza el fixture, no datos reales
 */
export async function mockListResponse(
  page: Page,
  urlPattern: string | RegExp,
  payload: unknown
): Promise<void> {
  await page.route(urlPattern, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });
}

/**
 * Intercepta `urlPattern` y responde con un status de error simulado.
 * Util para cubrir edge cases (500, 403, timeout) dificiles de provocar via UI.
 *
 * @example
 * await mockErrorResponse(page, /\/api\/.*\/clients/, 500);
 * await clientList.goto(); // valida el empty/error state de la pantalla
 */
export async function mockErrorResponse(
  page: Page,
  urlPattern: string | RegExp,
  status = 500
): Promise<void> {
  await page.route(urlPattern, async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: `mocked-${status}` })
    });
  });
}
