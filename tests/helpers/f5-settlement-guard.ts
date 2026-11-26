// tests/helpers/f5-settlement-guard.ts
// Guarda de red de la LIQUIDACION F5 (W4). A diferencia de `network-guard.ts` (preparacion de datos, que PROHIBE
// toda ruta de liquidaciones), aqui el unico POST de negocio que puede salir es el de la liquidacion del par:
//   POST carrier{Driver|Owner}Liquidations/{carrierId}/{accountId}  -> UNA sola vez y solo con la guarda ARMADA.
// POST de lectura permitidos: el comprobante `.../getLiquidationTravelsDetails/report/{id}` y los de lectura de
// pantallas ya conocidos por `network-guard`. Todo lo demas que escriba se ABORTA y queda contado.
// `classifySettlementRequest` es puro (unitarios); `installSettlementGuard` lo cablea a un contexto de Playwright.
import type { BrowserContext } from '@playwright/test';
import { classifyWrite, isBusinessWrite } from './network-guard.js';

export type SettlementKind = 'driver' | 'owner';

export type SettlementScope = { kind: SettlementKind; carrierId: number; accountId: number };

export type SettlementRequestClass = 'free' | 'read' | 'confirm' | 'blocked';

const MAGIIS_HOST = /magiis/i;
const REPORT_PATH =
  /\/carrier(?:Driver|Owner)Liquidations\/getLiquidationTravelsDetails\/report\/\d+\/?$/;
const CREATE_PATH = /\/carrier(Driver|Owner)Liquidations\/(\d+)\/(\d+)\/?$/;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0];
  }
}

/** Clasifica una peticion respecto del par a liquidar. Solo mira metodo, host y ruta (nunca query ni cuerpo). */
export function classifySettlementRequest(
  method: string,
  url: string,
  scope: SettlementScope
): SettlementRequestClass {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return 'free';
  try {
    if (!MAGIIS_HOST.test(new URL(url).hostname)) return 'free';
  } catch {
    // url relativa: se trata como del backend
  }
  const path = pathOf(url);
  if (m === 'POST' && REPORT_PATH.test(path)) return 'read';
  const create = CREATE_PATH.exec(path);
  if (m === 'POST' && create) {
    const kind: SettlementKind = create[1] === 'Driver' ? 'driver' : 'owner';
    return kind === scope.kind &&
      Number(create[2]) === scope.carrierId &&
      Number(create[3]) === scope.accountId
      ? 'confirm'
      : 'blocked';
  }
  // Solo los POST de lectura de pantalla; las escrituras de negocio de la preparacion (alta, cierre, tarifa) se bloquean.
  return classifyWrite(m, url) === 'allowed' && !isBusinessWrite(m, url) ? 'read' : 'blocked';
}

export type SettlementGuard = {
  /** Habilita UNA salida del POST de la liquidacion (solo tras pasar el oraculo). */
  arm(): void;
  /** POST de liquidacion intentados desde la pagina (incluye los abortados). */
  confirmAttempts(): number;
  /** POST de liquidacion que efectivamente salieron (esperado 0 o 1). */
  confirmSent(): number;
  /** Escrituras ajenas abortadas (metodo + ruta, sin query). */
  blocked(): ReadonlyArray<{ method: string; path: string }>;
};

/** Instala la guarda en el contexto: sin `arm()` NO sale ninguna liquidacion; con `arm()` sale una sola. */
export async function installSettlementGuard(
  context: BrowserContext,
  scope: SettlementScope
): Promise<SettlementGuard> {
  let armed = false;
  let attempts = 0;
  let sent = 0;
  const blocked: Array<{ method: string; path: string }> = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const klass = classifySettlementRequest(request.method(), request.url(), scope);
    if (klass === 'free' || klass === 'read') {
      await route.continue();
      return;
    }
    if (klass === 'confirm') {
      attempts += 1;
      if (armed && sent === 0) {
        sent += 1;
        await route.continue();
        return;
      }
      blocked.push({ method: request.method().toUpperCase(), path: pathOf(request.url()) });
      await route.abort('blockedbyclient');
      return;
    }
    blocked.push({ method: request.method().toUpperCase(), path: pathOf(request.url()) });
    await route.abort('blockedbyclient');
  });
  return {
    arm: () => {
      armed = true;
    },
    confirmAttempts: () => attempts,
    confirmSent: () => sent,
    blocked: () => blocked
  };
}
