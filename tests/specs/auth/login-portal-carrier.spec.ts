// tests/specs/auth/login-portal-carrier.spec.ts
// MU-001 - piloto del programa de migracion V1->V2: port de la matriz de credenciales del login
// carrier de V1 (TS-AUTH-TC01..TC04 / SMOKE-AUTH-TC01/02) al portal V2.
//
// NO DUPLICA login.spec.ts: alli login.spec.ts:13-27 ya cubre el happy path (la redireccion es
// el assert) y login.spec.ts:29-41 ya cubre el error visible con credenciales invalidas. Aca el
// login exitoso/fallido es el PASO, no el resultado: se assertea supervivencia de sesion tras un
// reload (TC01), copy EXACTO del error (TC02/TC03), no-navegacion fuera del login como control
// (TC02/TC03/TC04) y no-llamada al backend en el caso de formulario vacio (TC04).
//
// SELECTORES: derivados de `git show origin/main:src/app/account/login/carrier/login-carrier.component.html`
// (origin/main = v2.0.13; desplegado en apps-test = v2.0.14 - diff del componente, del comando de
// login y de la clave i18n contra origin/release/v2.0.14: sin cambios, verificado 2026-09-02).
// Nunca del working tree congelado de refs/v2/ (ver CONVENTIONS.md §7/§14).
//
// NOTE(run): npm run test:test -- tests/specs/smoke/auth/login-portal-carrier.spec.ts
//   --project=carrier-v2-desktop --workers=1
//   Sin --reporter (anula el json del config, CONVENTIONS.md §14). --workers=1 obligatorio: la
//   cuenta carrier es la misma que usa global-setup.ts y TC03 consume un intento fallido sobre
//   ella (riesgo de lockout sin politica conocida; ver docs/qa/migration/units/MU-001-plan.md R1).
//
// NOTE(sincronizacion): se usa `toHaveURL` (nunca `expect.poll(page.url)`) - medido: 13 usos de
// toHaveURL y 0 de expect.poll sobre URL en este repo V2; la flakiness de expect.poll era propia
// de V1 (DashboardPage.ts:23-31). En TC01 la espera observable es la respuesta del POST
// auth/login: con el backend lento (>20 s tras una caida, medido 2026-09-02) el timeout ciego
// fallaba y el retry lo enmascaraba; esperar la respuesta separa "backend lento" de "la app no
// ruteo". Sin retries propios: se usa el default del config (RETRIES=0 en test) para que un flake
// futuro se vea, no se absorba (CONVENTIONS.md §10, rama 3).
//
// NOTE(idioma): con storageState limpio (ver test.use de abajo) la UI resuelve el idioma
// client-side a 'en-us' (language.service.ts:18-32, getBrowserLang() sin locale ES en el
// contexto) -> el copy de error se compara en ingles.
import type { Page } from '@playwright/test';
import { test, expect } from '../../TestBase.js';
import { LoginPage } from '../../pages/shared/LoginPage.js';
import { ShellPage } from '../../pages/shared/ShellPage.js';
import { makeAnnotate } from '../../utils/traceability.js';
import {
  resolveCredentials,
  resolveLoginPath,
  resolveDashboardPattern
} from '../../config/runtime.js';

const ROUTE = '/carrier/#/auth/login';

// Tests de Xray (proyecto TM) creados 2026-09-02 bajo la story MG-18, parent epic QA Test Repository.
const TM_TC01 = 'TM-835';
const TM_TC02 = 'TM-836';
const TM_TC03 = 'TM-837';
const TM_TC04 = 'TM-838';

// src/assets/i18n/en-us.json:90 (clave login.error_sign_in; es-ar.json:90 = "Usuario o Contraseña Incorrecto").
const ERROR_SIGN_IN_EN = 'Email or Password is Incorrect.';
const UNKNOWN_EMAIL = 'qa_e2e_unknown_user@magiis-invalid.test';
const WRONG_PASSWORD = 'qa_e2e_WrongPass_0000';
// logIn.command.ts:14-15 - POST 'auth/login' sobre apiUrl (.../magiis-v0.2/auth/login).
const AUTH_LOGIN = /\/auth\/login(?:$|[?#])/;

const toUrlRegex = (p: string) => new RegExp(p.replace(/[#/]/g, '\\$&'));

/**
 * Observacion pasiva de red aprobada por el owner (MU-001-plan.md, decision del 2026-09-02):
 * cuenta los POST al endpoint de login. No emite requests, no mockea y no lee payloads, por lo
 * que es compatible con docs/scope-rules.md §1. Debe registrarse ANTES del goto().
 */
function trackAuthCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && AUTH_LOGIN.test(r.url())) calls.push(r.url());
  });
  return calls;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('@P1 @functional @migration MG-18 Login portal carrier - credenciales', () => {
  test('TC01 La sesion iniciada con credenciales validas sobrevive una recarga del dashboard', async ({
    page
  }) => {
    makeAnnotate(TM_TC01, ROUTE)('TC01', 'HP');
    // Que lo haria fallar: que el token no persista en el contexto (o que el guard NeedLoggin lo
    // expulse) y el reload aterrice de vuelta en /auth/login sin shell autenticado.
    const { username, password } = resolveCredentials();
    const login = new LoginPage(page);
    await login.goto();

    // Espera observable: la respuesta del POST auth/login, no una ventana ciega.
    const authDone = page.waitForResponse(
      (r) => r.request().method() === 'POST' && AUTH_LOGIN.test(r.url()),
      { timeout: 30_000 }
    );
    await login.login(username, password);
    const authResponse = await authDone;
    // Un 401/429 tambien resuelve la espera: se clasifica aca (rate limit / credencial) y no como
    // "no redirigio al dashboard" (riesgo R5 del plan: 429 = precondicion de ambiente).
    expect(authResponse.status(), 'auth/login debe responder 200').toBe(200);

    await expect(
      page,
      'debe redirigir al dashboard (si aterriza en /authentication/login/terms es estado de la cuenta o latencia del gate de Terminos, no drift de selector)'
    ).toHaveURL(toUrlRegex(resolveDashboardPattern()), { timeout: 20_000 });

    await page.reload();

    // Con hash-routing la URL ya coincide antes de que Angular arranque y el guard es asincrono:
    // el oraculo real de la sesion es el shell autenticado; la URL queda como control posterior.
    await new ShellPage(page).expectShellReady();
    await expect(page, 'la sesion debe sobrevivir la recarga').toHaveURL(
      toUrlRegex(resolveDashboardPattern())
    );
  });

  test('TC02 Email desconocido muestra el error de credenciales y no navega fuera del login', async ({
    page
  }) => {
    makeAnnotate(TM_TC02, ROUTE)('TC02', 'NEG');
    // Que lo haria fallar: un mensaje de error distinto al copy contractual, o que el backend
    // acepte un email inexistente (el span de error solo existe dentro del template del login).
    const login = new LoginPage(page);
    await login.goto();
    await login.login(UNKNOWN_EMAIL, WRONG_PASSWORD);

    // login-carrier.component.html:78, condicion showErrorUser (ts:166).
    await expect(page.locator('span.error-sign-in')).toHaveText(ERROR_SIGN_IN_EN, {
      timeout: 15_000
    });
    // Control, no oraculo independiente: si hubiera navegado, el assert anterior ya habria fallado.
    await expect(page).toHaveURL(toUrlRegex(resolveLoginPath()));
  });

  test('TC03 Password incorrecta de un usuario existente devuelve el mismo error generico', async ({
    page
  }) => {
    makeAnnotate(TM_TC03, ROUTE)('TC03', 'NEG');
    // Que lo haria fallar: un copy de error distinto al de TC02 (filtraria si el email existe,
    // habilitando enumeracion de usuarios), o que el intento nunca llegue al backend.
    const authCalls = trackAuthCalls(page);

    const login = new LoginPage(page);
    await login.goto();
    await login.login(resolveCredentials().username, WRONG_PASSWORD);

    // Mismo copy que TC02: anti-enumeracion de usuarios.
    await expect(page.locator('span.error-sign-in')).toHaveText(ERROR_SIGN_IN_EN, {
      timeout: 15_000
    });
    // Control, no oraculo independiente.
    await expect(page).toHaveURL(toUrlRegex(resolveLoginPath()));

    // showErrorUser solo se prende en el callback de error HTTP (ts:166): el request precede al
    // error visible, asi que este conteo no compite con la red. Ademas valida la regex AUTH_LOGIN
    // que TC04 usa en negativo: si este assert desaparece, TC04 queda vacuo.
    expect(authCalls.length, 'el intento debe llegar al backend').toBeGreaterThan(0);
  });

  test('TC04 Enviar el formulario vacio muestra el error sin llamar al backend', async ({
    page
  }) => {
    makeAnnotate(TM_TC04, ROUTE)('TC04', 'EC');
    // Que lo haria fallar: que quiten Validators.required o el early-return client-side y el
    // formulario vacio salga a la red, o que el boton quede deshabilitado por un loadingSignIn
    // que nunca se resetea.
    const authCalls = trackAuthCalls(page);

    const login = new LoginPage(page);
    await login.goto();
    await login.login('', '');

    // Resolucion client-side (ts:98-101) - no requiere timeout de red.
    await expect(page.locator('span.error-sign-in')).toHaveText(ERROR_SIGN_IN_EN);
    // Control, no oraculo independiente.
    await expect(page).toHaveURL(toUrlRegex(resolveLoginPath()));
    // html:88 - [disabled] depende solo de loadingSignIn, no de la validez del form.
    await expect(page.getByRole('button', { name: /sign\s*in/i })).toBeEnabled();

    // Assert negativo al final: los round-trips anteriores drenan cualquier evento request
    // pendiente, asi que un falso verde por carrera queda descartado. La regex AUTH_LOGIN la
    // valida TC03 (>0 llamadas); si TC03 se borra, este assert queda vacuo.
    expect(authCalls, 'el form invalido no debe salir a la red').toHaveLength(0);
  });
});
