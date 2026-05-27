// tests/specs/explore/p2-p3-discovery.spec.ts
// Spec exploratorio (tag @explore, fuera de smoke).
// Discovery de las 27 pantallas P2/P3 SIN POM (ver docs/audit/p2-coverage-analysis.md
// y p3-coverage-analysis.md). Para cada ruta del backlog:
//   1. goto + espera de red.
//   2. Detecta REBOTE (finalUrl != ruta pedida -> la pantalla no existe o redirige).
//   3. Captura heading visible + presencia de tabla + aria-snapshot del main.
//   4. Loguea un resumen JSON por pantalla.
//
// Objetivo: confirmar cuales de las 27 rutas REALMENTE renderizan (vs solo declaradas
// en ROUTING-V2.0.4.md) antes de crear POMs. NO inventa selectores: solo navega rutas
// conocidas y observa. De aca se derivan los POMs reales (Tier 1 listas primero).
//
// Reemplaza al intento de discovery con MCP Playwright (no disponible en la sesion
// 2026-05-27). Este spec es el mecanismo reproducible del proyecto: corre con el
// global-setup (login + storageState) cuando el backend TEST este arriba.
//
// Ejecutar:  cross-env ENV=test RUN_DISCOVERY=true npx playwright test tests/specs/explore/p2-p3-discovery --project=carrier-v2-desktop --workers=1
import { test, expect } from '../../TestBase.js';

type DiscoveryTarget = { tier: 'P2' | 'P3'; name: string; url: string };

// Rutas directas (sin :id). Las P2 con :id (client/edit, owner/edit) se descubren
// navegando desde su lista padre, no aplican a discovery directo.
const DISCOVERY_TARGETS: DiscoveryTarget[] = [
  // ===== P2 (10 sin POM, las con :id omitidas) =====
  { tier: 'P2', name: 'Client Create', url: '/carrier/#/client/create' },
  { tier: 'P2', name: 'Client Contractors', url: '/carrier/#/client/contractors' },
  { tier: 'P2', name: 'Owner Add', url: '/carrier/#/owner/add' },
  { tier: 'P2', name: 'Owner Create (alt)', url: '/carrier/#/owner/create' },
  { tier: 'P2', name: 'Trip Mappers', url: '/carrier/#/travel/mappers' },
  { tier: 'P2', name: 'Pay Travels', url: '/carrier/#/pay/travels' },
  { tier: 'P2', name: 'Surrenders Report', url: '/carrier/#/pay/surrenders-report' },
  { tier: 'P2', name: 'Management Board', url: '/carrier/#/owner-report' },
  { tier: 'P2', name: 'Heat Map', url: '/carrier/#/owner-heat-map' },
  // ===== P3 (17) =====
  { tier: 'P3', name: 'Settings Parameters', url: '/carrier/#/settings/parameters' },
  { tier: 'P3', name: 'Settings Transport Types', url: '/carrier/#/settings/transportTypes' },
  { tier: 'P3', name: 'Settings Services Type', url: '/carrier/#/settings/servicesType/list' },
  { tier: 'P3', name: 'Settings Taxes & Fees', url: '/carrier/#/settings/taxesAndFees' },
  { tier: 'P3', name: 'Settings Email Templates', url: '/carrier/#/settings/email-templates' },
  { tier: 'P3', name: 'Settings Branches', url: '/carrier/#/settings/branches/list' },
  { tier: 'P3', name: 'Settings Travel Fare List', url: '/carrier/#/settings/travel-fare-list' },
  { tier: 'P3', name: 'Settings Travel Fare Rules', url: '/carrier/#/settings/travel-fare-rules' },
  { tier: 'P3', name: 'Settings Profile Access', url: '/carrier/#/settings/profiles-access' },
  { tier: 'P3', name: 'Settings Profiles', url: '/carrier/#/settings/profiles' },
  { tier: 'P3', name: 'Settings Preferences', url: '/carrier/#/settings/preferences' },
  { tier: 'P3', name: 'Melita AI Branches', url: '/carrier/#/melita/ai-branches' },
  { tier: 'P3', name: 'Affiliate Profile', url: '/carrier/#/affiliate/atc-profile' },
  { tier: 'P3', name: 'Affiliate Offering', url: '/carrier/#/affiliate/offering' },
  { tier: 'P3', name: 'Affiliate Request', url: '/carrier/#/affiliate/request' },
  {
    tier: 'P3',
    name: 'Affiliate Agreements Requested',
    url: '/carrier/#/affiliate/os-agreement-requested'
  },
  { tier: 'P3', name: 'Magiis Apps Store', url: '/carrier/#/integrations/list' }
];

test.describe('@explore P2/P3 discovery', () => {
  // Discovery manual: requiere RUN_DISCOVERY=true para no correr en CI nightly.
  test.skip(
    process.env.RUN_DISCOVERY !== 'true',
    'Discovery manual. Correr con RUN_DISCOVERY=true y backend TEST disponible.'
  );

  test('dumpea estado real de las 25 rutas P2/P3 sin POM', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: 'MX-5711' });

    const results: Array<Record<string, unknown>> = [];

    for (const target of DISCOVERY_TARGETS) {
      const requestedHashPath = target.url.split('#')[1] ?? '';
      await page.goto(target.url, { waitUntil: 'domcontentloaded' });
      // Sin networkidle (regla playwright/no-networkidle). El waitFor del heading
      // da el tiempo de render del SPA; el catch tolera pantallas que rebotan.
      await page
        .getByRole('heading')
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => null);

      const finalUrl = page.url().replace(/^https?:\/\/[^/]+/, '');
      const finalHashPath = finalUrl.split('#')[1] ?? '';
      // Rebote = la URL final no contiene el path pedido (redirige a dashboard u otro).
      const reboted = !finalHashPath.startsWith(requestedHashPath);
      const heading = await page
        .getByRole('heading')
        .first()
        .textContent({ timeout: 3_000 })
        .catch(() => null);
      const hasTable = await page
        .getByRole('table')
        .first()
        .isVisible()
        .catch(() => false);
      const snapshot = await page
        .locator('main, .main-content, .page-content, body')
        .first()
        .ariaSnapshot({ timeout: 5_000 })
        .catch((e) => `(snapshot error: ${(e as Error).message})`);

      const summary = {
        tier: target.tier,
        name: target.name,
        requested: target.url,
        finalUrl,
        reboted,
        renders: !reboted && !!heading,
        heading: heading?.trim() ?? null,
        hasTable
      };
      results.push(summary);

      // eslint-disable-next-line no-console
      console.log(
        `\n=== [${target.tier}] ${target.name} ===\n` +
          `${JSON.stringify(summary, null, 2)}\n--- aria-snapshot ---\n${snapshot}\n`
      );
    }

    // Resumen final: cuantas renderizan vs rebotan. Util para priorizar creacion de POMs.
    const rendering = results.filter((r) => r.renders);
    const reboting = results.filter((r) => r.reboted);
    // eslint-disable-next-line no-console
    console.log(
      `\n===== DISCOVERY P2/P3 RESUMEN =====\n` +
        `Total: ${results.length} | Renderizan: ${rendering.length} | Rebotan: ${reboting.length}\n` +
        `Renderizan (candidatas a POM): ${rendering.map((r) => r.name).join(', ') || '(ninguna)'}\n` +
        `Rebotan (no desarrolladas): ${reboting.map((r) => r.name).join(', ') || '(ninguna)'}\n`
    );

    expect(results).toHaveLength(DISCOVERY_TARGETS.length);
  });
});
