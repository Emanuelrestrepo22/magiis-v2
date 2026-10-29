// tests/specs/integrations/mx6135-appsstore-whatsapp-removed.spec.ts
//
// MX-5840 — "Sacar card WhatsApp de Magiis Apps Store" (capa UI / carrier-v2).
// El Apps Store (Integrations) NO debe listar la card legacy "WhatsApp" (Meta).
// Trazabilidad: ticket MX-5840 · ATP MX-6118 · ATR MX-6121 · Xray Test MX-6135.
//
// Selectores confirmados en exploración en vivo (apps-test, 2026-07-17):
//   ruta      /carrier/#/integrations/list  (componente app-integrations-list)
//   card      .integration-card   → título h6.card-title
//   WhatsApp  título EXACTO "WhatsApp" (distinto de "WhatsApp Business", que SÍ debe seguir)
//
// NOTE(env): el fix fue validado en UAT (ATR MX-6121). En la exploración contra apps-test
//   la card legacy "WhatsApp" SEGUÍA presente (¿fix no desplegado en TEST, o versión de app
//   distinta: exploré carrier-v2 v2.0.5 vs release v1.72.6?). Se deja `fixme` hasta confirmar
//   el env/versión donde debe correr; al habilitar, correr contra el env del release.
// NOTE(perf): la app carrier mantiene websocket RTDB + Google Maps abiertos → NUNCA usar
//   networkidle; navegar por ruta autenticada y esperar por elemento (patrón de este spec).

import { test, expect } from '../../TestBase.js';
import { makeAnnotate } from '../../utils/traceability.js';

// La key canonica (type:'tms') es la del Test de Xray — es la que exporta el xray-reporter, que
// resuelve con annotations.find(type==='tms') y por lo tanto toma UNA sola. El ticket MX-5840 va
// como tag @MX-5840 en el describe, de donde lo levanta el extractor de trazabilidad.
const XRAY_TEST = 'MX-6135';
const ROUTE = '/carrier/#/integrations/list';

const annotate = makeAnnotate(XRAY_TEST, ROUTE);

test.describe('@P2 @functional @MX-5840 Card WhatsApp removida del Magiis Apps Store — carrier-v2', () => {
  test.fixme('[TS-MX5840-WA-REMOVED] la card legacy "WhatsApp" NO aparece en el Apps Store', async ({
    page
  }) => {
    annotate('WA-REMOVED', 'functional');

    await test.step('Given: Apps Store cargado (dashboard → link Magiis Apps Store)', async () => {
      await page.goto('/carrier/#/dashboard', { waitUntil: 'domcontentloaded' });
      const apps = page.getByRole('link', { name: /magiis apps store/i }).first();
      await expect(apps).toBeVisible({ timeout: 60_000 });
      await apps.click();
      await expect(page).toHaveURL(/integrations\/list/, { timeout: 20_000 });
    });

    await test.step('And: las cards de integración renderizaron', async () => {
      await expect(page.locator('app-integrations-list .integration-card').first()).toBeVisible({
        timeout: 45_000
      });
    });

    await test.step('Then: NO existe la card cuyo título exacto es "WhatsApp" (≠ "WhatsApp Business")', async () => {
      const whatsappCard = page.locator('.integration-card', {
        has: page.locator('h6.card-title', { hasText: /^\s*WhatsApp\s*$/ })
      });
      await expect(whatsappCard).toHaveCount(0);
    });
  });
});
