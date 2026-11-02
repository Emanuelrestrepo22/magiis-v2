// tests/specs/integrations/app-store-gateway-linked.spec.ts
// MU-002 - migracion V1->V2: App Store de integraciones, familia "pasarela vinculada persiste"
// (fuente V1: gateway-pg/specs/authorize/web/carrier/smoke/authorize-linked-smoke.spec.ts,
// TS-AUTHORIZE-SMOKE-01). Solo lectura: sin link/unlink ni modales de credenciales - esa
// superficie queda reservada para MU-003/004/005 (docs/qa/migration/units/MU-002-plan.md).
//
// SELECTORES: derivados de `git show origin/main:src/app/pages/carrier/integrations/list/
// integrations-list.component.html` (origin/main = v2.0.13, identico a origin/release/v2.0.14
// para este componente - solo difieren catalogos i18n sin afectar las 6 claves usadas aca) y
// confirmados en vivo contra apps-test.magiis.com v2.0.14 en
// docs/analysis/migration-evidence/appstore-live-2026-09-02.md y
// docs/analysis/migration-evidence/multiaccount-live-2026-09-02.md. Nunca del working tree
// congelado de refs/v2/ (CONVENTIONS.md §7/§14).
//
// NOTE(datos) - precondicion multi-cuenta (recon 2026-09-03, multiaccount-live-2026-09-02.md):
//   | Cuenta    | Vinculada     | Otras 3 (Stripe/Authorize.Net/eBiz)          | Sirve |
//   |-----------|---------------|-----------------------------------------------|-------|
//   | default   | ninguna       | "Link" (disponibles)                          | no    |
//   | AR        | Mercado Pago  | "Not available in your country" (bloqueo pais)| si    |
//   | US        | ninguna       | "Link" (disponibles)                          | no    |
// APPSTORE_ACCOUNT default = 'AR' (unica con exactamente 1 pasarela vinculada hoy).
// Trampa: resolveCredentials('AR') cae en silencio a USER_CARRIER si falta USER_CARRIER_AR
// (runtime.ts:77-82) - el mensaje del assert de cardsWithUnlink lo nombra explicitamente.
//
// COBERTURA PARCIAL DECLARADA: con la cuenta AR el bloqueo de las otras 3 tarjetas es geografico
// ("Not available in your country"), no por exclusividad (hasSinglePaymentActive). La rama
// "Not Available" (exclusividad real entre Stripe/Authorize.Net/eBizCharge) queda sin cubrir en
// esta unidad - ver docs/qa/migration/units/MU-002-plan.md, gap G-01, para MU-003/004/005.
//
// NOTE(R5 F1): con la cuenta AR el frame optimista ya pinta "Unlink" de MP (isLatamCountry sale de
// la identidad, no del GET preferences) - el solo assert de UI no prueba rehidratacion real. TC01 y
// TC02 cruzan la pasarela que muestra la UI contra el body real de GET carriers/{id}/preferences
// (linkedGatewaysFromPreferences), observacion pasiva sobre la misma request que dispara el front
// (scope-rules.md §1: "excepto si la UI muestra ese dato").
//
// NOTE(run): npm run test:test -- tests/specs/smoke/integrations/app-store-gateway-linked.spec.ts
//   --project=carrier-v2-desktop --workers=1
//   Sin --reporter (anula el json del config, CONVENTIONS.md §14). --workers=1: cuenta AR es
//   compartida entre corridas (dato volatil, R1 del plan).
import type { Page } from '@playwright/test';
import { test, expect } from '../../TestBase.js';
import { LoginPage } from '../../pages/shared/LoginPage.js';
import {
  IntegrationsAppStorePage,
  PAYMENT_GATEWAY_NAMES,
  type CarrierPreferences,
  GATEWAY_FLAG_KEYS,
  linkedGatewaysFromPreferences
} from '../../pages/carrier-v2/integrations/IntegrationsAppStorePage.js';
import { makeAnnotate } from '../../utils/traceability.js';
import {
  resolveCredentials,
  resolveDashboardPattern,
  type CarrierRegion
} from '../../config/runtime.js';

const ROUTE = '/carrier/#/settings/integrations/list';

// Tests de Xray (proyecto TM) creados 2026-09-03 bajo la story MG-920 (parent TM-20).
const TM_TC01 = 'TM-840';
const TM_TC02 = 'TM-841';
const TM_TC03 = 'TM-842';

// authorize/web login POST - logIn.command.ts:14-15.
const AUTH_LOGIN = /\/auth\/login(?:$|[?#])/;

const toUrlRegex = (p: string) => new RegExp(p.replace(/[#/]/g, '\\$&'));

/** Mapea APPSTORE_ACCOUNT ('default'|'AR'|'US') a la CarrierRegion de runtime.ts ('' es default). */
function resolveAccountRegion(value: string): CarrierRegion {
  if (value === 'default') return '';
  if (value === 'AR' || value === 'US') return value;
  throw new Error(`APPSTORE_ACCOUNT invalida: "${value}" (esperado default|AR|US)`);
}

const ACCOUNT = process.env.APPSTORE_ACCOUNT ?? 'AR';
const REGION = resolveAccountRegion(ACCOUNT);
const EXPECTED_GATEWAY = process.env.APPSTORE_LINKED_GATEWAY?.trim();
// TC01: universo de nombres validos - si hay override por env, el universo colapsa a ese unico
// nombre; si no, cualquiera de los 4 literales conocidos. Un solo expect, sin condicional en el test.
const EXPECTED_NAMES: readonly string[] = EXPECTED_GATEWAY
  ? [EXPECTED_GATEWAY]
  : PAYMENT_GATEWAY_NAMES;
// TC03: el bloqueo de las otras 3 pasarelas es geografico en AR (docs/qa/migration/units/MU-002-plan.md
// H11); en otras regiones no hay bloqueo por pais confirmado en esta unidad, se mantiene el copy
// generico de exclusividad como universo.
const BLOCK_COPY =
  REGION === 'AR'
    ? /^\s*(not available in your country|no disponible en tu regi[oó]n)\s*$/i
    : /^\s*(not available|no disponible)\s*$/i;

async function loginAs(page: Page): Promise<void> {
  const { username, password } = resolveCredentials(REGION);
  const login = new LoginPage(page);
  await login.goto();

  // R5-3 M1: version desplegada medida una vez antes de enviar el login (footer + ng-version),
  // adjuntada como evidencia - sin assert nuevo (CONVENTIONS.md §13 exige la version en el run
  // record, no en el spec). Transcrita a mano al run record tras la corrida.
  const footerText = await page
    .locator('[role="contentinfo"], footer')
    .first()
    .textContent()
    .catch(() => null);
  await test.info().attach('login-footer-version', {
    body: (footerText ?? '').trim(),
    contentType: 'text/plain'
  });
  const ngVersion = await page
    .locator('[ng-version]')
    .first()
    .getAttribute('ng-version')
    .catch(() => null);
  await test.info().attach('login-ng-version', {
    body: ngVersion ?? '',
    contentType: 'text/plain'
  });

  const authDone = page.waitForResponse(
    (r) => r.request().method() === 'POST' && AUTH_LOGIN.test(r.url()),
    { timeout: 30_000 }
  );
  await login.login(username, password);
  const authResponse = await authDone;
  expect(authResponse.status(), 'auth/login debe responder 200').toBe(200);

  await expect(
    page,
    'debe redirigir al dashboard (si aterriza en /authentication/login/terms es estado de la cuenta o latencia del gate de Terminos, no drift de selector)'
  ).toHaveURL(toUrlRegex(resolveDashboardPattern()), { timeout: 20_000 });
}

/**
 * Precondicion de datos: la familia solo aplica si la cuenta tiene una pasarela vinculada. Sin
 * ninguna (GET preferences, la misma fuente que rehidrata la UI) el caso se OMITE con el motivo
 * nombrado; no pasa en vacio. Con mas de una sigue corriendo y falla en las aserciones de
 * exclusividad: eso si es un hallazgo (desvinculacion en curso o doble vinculo).
 * Medido 2026-10-30/11-02: la cuenta AR de TEST quedo sin Mercado Pago vinculado.
 */
function skipWhenNoGatewayLinked(prefs: CarrierPreferences): void {
  // eslint-disable-next-line playwright/no-skipped-test -- omision por precondicion de datos, con motivo nombrado
  test.skip(
    linkedGatewaysFromPreferences(prefs).length === 0,
    `precondicion de datos: la cuenta APPSTORE_ACCOUNT=${ACCOUNT} no tiene pasarela vinculada ` +
      'en GET preferences; se omite hasta que se vuelva a vincular (p. ej. Mercado Pago en AR)'
  );
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('@P1 @functional @migration MG-920 App Store de integraciones - pasarela vinculada', () => {
  test('TC01 Tras iniciar sesion en una sesion nueva, el App Store muestra la pasarela vinculada con su control de desvinculacion', async ({
    page
  }) => {
    makeAnnotate(TM_TC01, ROUTE)('TC01', 'HP');
    // Que lo haria fallar: el estado no se rehidrata desde el backend (GET preferences), la
    // pantalla cae al iframe puente V1, la respuesta de preferences no es 200, o cambio el copy
    // de i18n del boton/footer.
    await loginAs(page);

    const appStore = new IntegrationsAppStorePage(page);
    const prefs = await appStore.goto();
    skipWhenNoGatewayLinked(prefs);
    // R5-3 G1: shape del body medido en vivo (docs/qa/migration/units/MU-002-plan.md, seccion
    // "Forma medida del body de preferences") - invariante anti-drift antes de leer las flags.
    expect(
      Object.keys(prefs),
      'el body de preferences debe declarar las 4 flags de pasarela que las tarjetas muestran'
    ).toEqual(expect.arrayContaining([...GATEWAY_FLAG_KEYS]));
    await appStore.expectMainSectionsReady();

    await expect(
      appStore.cardsWithUnlink,
      `debe haber exactamente 1 pasarela vinculada en la cuenta APPSTORE_ACCOUNT=${ACCOUNT}. 0 tarjetas con ` +
        'Unlink es precondicion de datos (cuenta compartida y volatil - multiaccount-live-2026-09-02.md; ' +
        'resolveCredentials cae en silencio a USER_CARRIER/PASS_CARRIER si falta ' +
        `USER_CARRIER_${ACCOUNT}/PASS_CARRIER_${ACCOUNT}, runtime.ts:77-82); mas de 1 o footer ` +
        '"Unlinking in progress" senala una desvinculacion en curso (poll unlinkingInProgress, ts:263-268).'
    ).toHaveCount(1);

    const linkedName = (await appStore.linkedGatewayName())?.trim();
    // R5-3 M2: guarda de copy/typo del h6 literal (universo cerrado de 4 nombres conocidos); el
    // oraculo de identidad real es el cruce API<->UI de abajo, no este expect.
    expect(EXPECTED_NAMES, `nombre esperado ∈ ${EXPECTED_NAMES.join(' | ')}`).toContain(linkedName);

    // Cruce API<->UI (scope-rules.md §1, la UI muestra ese dato): con la cuenta AR el frame
    // optimista ya pinta "Unlink" de MP porque isLatamCountry sale de la identidad, no de este GET
    // - el assert de arriba solo prueba que la UI se ve bien, no que se rehidrato desde backend.
    const linked = linkedGatewaysFromPreferences(prefs);
    expect(linked, 'el backend debe declarar la pasarela que la UI muestra vinculada').toContain(
      linkedName
    );
    expect(
      linked,
      'el backend no debe declarar mas de una pasarela vinculada (exclusividad; MP fuera de la ' +
        'regla - con AR + otra flag en true seria un segundo vinculo enmascarado)'
    ).toHaveLength(1);
    // R5-3 G1: la clave existe en el body medido (MU-002-plan.md) - assert estricto, sin fallback.
    expect(prefs.unlinkingInProgress, 'no debe haber desvinculacion en curso').toBe(false);

    const linkedCard = appStore.cardsWithUnlink.first();
    await expect(appStore.unlinkLinkIn(linkedCard)).toBeVisible();
    // toHaveText no normaliza espacios con RegExp (si con string) - el template deja whitespace incidental.
    await expect(appStore.statusTextIn(linkedCard)).toHaveText(/^\s*(unlink|desvincular)\s*$/i);
  });

  test('TC02 La pasarela vinculada sigue vinculada despues de recargar la pagina', async ({
    page
  }) => {
    makeAnnotate(TM_TC02, ROUTE)('TC02', 'HP');
    // Que lo haria fallar: el estado vive solo en memoria del componente (no se rehidrata en
    // ngOnInit tras el reload), el reload dispara una desvinculacion en curso, o el GET
    // preferences post-reload no vuelve a resolver 200.
    await loginAs(page);

    const appStore = new IntegrationsAppStorePage(page);
    skipWhenNoGatewayLinked(await appStore.goto());
    await appStore.expectMainSectionsReady();
    await expect(
      appStore.cardsWithUnlink,
      'precondicion: 1 pasarela vinculada antes del reload'
    ).toHaveCount(1);
    const nameBefore = (await appStore.linkedGatewayName())?.trim();

    const prefsAfterReload = await appStore.reloadAndWaitState();
    // R5-3 G1: shape del body medido en vivo, ver TC01 y MU-002-plan.md.
    expect(
      Object.keys(prefsAfterReload),
      'el body de preferences debe declarar las 4 flags de pasarela que las tarjetas muestran'
    ).toEqual(expect.arrayContaining([...GATEWAY_FLAG_KEYS]));
    await appStore.expectMainSectionsReady();

    await expect(
      appStore.cardsWithUnlink,
      'la pasarela vinculada debe seguir siendo exactamente 1 tras el reload'
    ).toHaveCount(1);
    const nameAfter = (await appStore.linkedGatewayName())?.trim();
    expect(nameAfter, 'debe ser la misma pasarela antes y despues del reload').toBe(nameBefore);

    // Cruce API<->UI tras el reload (scope-rules.md §1): el reload es exactamente el escenario
    // donde ngOnInit debe volver a consultar el backend, no arrastrar estado de memoria.
    const linkedAfterReload = linkedGatewaysFromPreferences(prefsAfterReload);
    expect(
      linkedAfterReload,
      'el backend debe seguir declarando la misma pasarela vinculada tras el reload'
    ).toContain(nameAfter);
    expect(
      linkedAfterReload,
      'el backend no debe declarar mas de una pasarela vinculada tras el reload (exclusividad; MP ' +
        'fuera de la regla - con AR + otra flag en true seria un segundo vinculo enmascarado)'
    ).toHaveLength(1);
    // R5-3 G1: la clave existe en el body medido (MU-002-plan.md) - assert estricto, sin fallback.
    expect(
      prefsAfterReload.unlinkingInProgress,
      'no debe haber desvinculacion en curso tras el reload'
    ).toBe(false);

    // Control, no oraculo independiente: la URL no cambia con el reload (hash routing).
    await expect(page).toHaveURL(toUrlRegex(ROUTE));
  });

  test('TC03 Ninguna otra pasarela de pago ofrece el control de vinculacion mientras una esta vinculada', async ({
    page
  }) => {
    makeAnnotate(TM_TC03, ROUTE)('TC03', 'NEG');
    // Que lo haria fallar: una regresion de la regla de exclusividad/pais deja "Link" visible en
    // una segunda pasarela, o el footer de las otras 3 queda vacio en lugar del texto de bloqueo.
    await loginAs(page);

    const appStore = new IntegrationsAppStorePage(page);
    const prefs = await appStore.goto();
    skipWhenNoGatewayLinked(prefs);
    // R5-3 G1: shape del body medido en vivo, ver TC01 y MU-002-plan.md.
    expect(
      Object.keys(prefs),
      'el body de preferences debe declarar las 4 flags de pasarela que las tarjetas muestran'
    ).toEqual(expect.arrayContaining([...GATEWAY_FLAG_KEYS]));
    await appStore.expectMainSectionsReady();

    await expect(
      appStore.cardsWithUnlink,
      'precondicion: exactamente 1 pasarela vinculada'
    ).toHaveCount(1);
    await expect(
      appStore.cardsWithLink,
      'ninguna otra pasarela debe ofrecer el control de vinculacion (Link/Vincular) mientras hay una vinculada'
    ).toHaveCount(0);
    // R5-3 G2: el ancla Link/Unlink SI expone role=link (tiene href="javascript:void(0)", getByRole
    // la captura sin problema - cardsWithLink/cardsWithUnlink del POM ya lo prueban arriba). Este
    // segundo assert cruza tambien por el texto del footer porque el texto de la tarjeta COMPLETA
    // incluye tambien el h6.card-title - un regex de vinculacion anclado ahi nunca matchearia
    // (html:173-194), por eso se escopea a `.card-footer` (unico nodo que solo contiene el copy).
    await expect(
      appStore.paymentSection
        .locator('.card-footer')
        .filter({ hasText: /^\s*(link|vincular)\s*$/i }),
      'ningun pie de tarjeta debe mostrar el copy de vinculacion'
    ).toHaveCount(0);

    const linkedName = (await appStore.linkedGatewayName())?.trim();

    // Cruce API<->UI (scope-rules.md §1): la misma verificacion de rehidratacion real de TC01/TC02,
    // aplicada al oraculo de exclusividad de este caso.
    const linked = linkedGatewaysFromPreferences(prefs);
    expect(linked, 'el backend debe declarar la pasarela que la UI muestra vinculada').toContain(
      linkedName
    );
    expect(
      linked,
      'el backend no debe declarar mas de una pasarela vinculada (exclusividad; MP fuera de la ' +
        'regla - con AR + otra flag en true seria un segundo vinculo enmascarado)'
    ).toHaveLength(1);

    const blockedNames = PAYMENT_GATEWAY_NAMES.filter((name) => name !== linkedName);
    for (const name of blockedNames) {
      const card = appStore.cardByName(name);
      await expect(
        appStore.statusTextIn(card),
        `${name} debe mostrar el texto de bloqueo (exclusividad o pais), no un control accionable`
      ).toHaveText(BLOCK_COPY);
    }
  });
});
