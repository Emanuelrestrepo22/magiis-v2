// tests/data/carrier-v2/trips/f5-confirm-cases.ts
// Catalogo PURO de los casos de CONFIRMACION irreversible de la rendicion F5 (MG-1027 FE + MG-1024 BE), uno por
// regla de la tabla de decision (`decision-table.md` R01/R03/R04/R05/R06) y la matriz regla x carrier x ambiente
// que declara el plan de la fase 2 (§3 W1). Sin I/O ni Playwright: lo consumen el spec y los unitarios.
// Valores de referencia = handoffs UAT del 10/11/2026 (AR #1-#4, FR-3, US-1) y rendiciones TEST 14184-14188.
import type { F5MoneyFormat } from '../../../helpers/f5-surrender-oracle.js';
import { PREP_SCENARIO_IDS, type PrepScenarioId } from './prep-scenarios.js';

export const CONFIRM_RULES = ['R01', 'R03', 'R04', 'R05', 'R06'] as const;
export type ConfirmRule = (typeof CONFIRM_RULES)[number];

export type ConfirmCaseDef = {
  rule: ConfirmRule;
  /** Titulo humano del caso (el spec lo antepone a la key Xray). */
  title: string;
  /** Test de Xray que se acredita (primera key; el resto son `secondaryKeys`). */
  primaryKey: string;
  /**
   * Otras keys que el MISMO test ejercita, con la nota de cobertura. Las Cucumber de otros epics (TM-1048/1110/
   * 1115/1112) son un mapeo DEBIL (cross-epic): no se acreditan sin revision del lider (decision D-8).
   */
  secondaryKeys: ReadonlyArray<{ key: string; note: string }>;
  /** Escenarios de `f5-prep-trips` que arman el lote de la regla (referencia para el orquestador). */
  prepScenarios: readonly PrepScenarioId[];
  /** `ratio`: entrega parcial (fraccion del monto precargado en «Entregar»). `preload`: no se toca. */
  deliver: { kind: 'preload' } | { kind: 'ratio'; ratio: number };
  /** true = se teclea gasto varios («Other Expenses») y luego se hace clic en «$» para entregar todo lo adeudado. */
  miscellany: boolean;
  /** Doble clic rapido en Confirm: sigue exigiendose UN solo POST (TC12). */
  doubleClick: boolean;
  /** true = la regla exige saldo a favor del chofer («Amount due to Driver») antes del clic. */
  driverBalance: boolean;
  /** true = tarifa 0: sin NaN/Infinity y comisiones 0 (R05). */
  zeroFare: boolean;
  /** Pre-requisito de datos: la confirmacion previa del dia que fija LAST_SURRENDER_DATE (fija 0). */
  needsSameDayPriorSurrender: boolean;
};

export const CONFIRM_CASES: Readonly<Record<ConfirmRule, ConfirmCaseDef>> = {
  R01: {
    rule: 'R01',
    title:
      'debería confirmar sin tocar campos un lote en efectivo con otros costos no comisionables',
    primaryKey: 'TM-1655',
    secondaryKeys: [
      {
        key: 'TM-1112',
        note: 'paso 4: confirmar con otros costos aplicados (Cucumber de otro epic: mapeo débil)'
      },
      {
        key: 'TM-1650',
        note: 'importes de PDF vs pantalla (solo-vista; se juzga con los PDF de esta corrida)'
      }
    ],
    prepScenarios: ['EF-NC-COM', 'CC'],
    deliver: { kind: 'preload' },
    miscellany: false,
    doubleClick: false,
    driverBalance: false,
    zeroFare: false,
    needsSameDayPriorSurrender: false
  },
  R03: {
    rule: 'R03',
    title: 'debería confirmar con entrega parcial una segunda rendición del día sin otros costos',
    primaryKey: 'TM-1656',
    secondaryKeys: [],
    prepScenarios: ['EF-PLAIN'],
    deliver: { kind: 'ratio', ratio: 0.6 },
    miscellany: false,
    doubleClick: false,
    driverBalance: false,
    zeroFare: false,
    needsSameDayPriorSurrender: true
  },
  R04: {
    rule: 'R04',
    title: 'debería confirmar con gastos varios y doble clic rápido enviando un solo POST',
    primaryKey: 'TM-1657',
    secondaryKeys: [],
    prepScenarios: ['EF-NC-ONLY'],
    deliver: { kind: 'preload' },
    miscellany: true,
    doubleClick: true,
    driverBalance: false,
    zeroFare: false,
    needsSameDayPriorSurrender: true
  },
  R05: {
    rule: 'R05',
    title: 'debería confirmar un lote con tarifa 0 y solo un no comisionable sin NaN ni Infinity',
    primaryKey: 'TM-1660',
    secondaryKeys: [],
    prepScenarios: ['EF-FARE0'],
    deliver: { kind: 'preload' },
    miscellany: false,
    doubleClick: false,
    driverBalance: false,
    zeroFare: true,
    needsSameDayPriorSurrender: true
  },
  R06: {
    rule: 'R06',
    title: 'debería confirmar con saldo a favor del chofer (comisión mayor al efectivo a rendir)',
    primaryKey: 'TM-1654',
    secondaryKeys: [
      {
        key: 'TM-1110',
        note: 'persistencia de la fila de rendición = pantalla (Cucumber de otro epic: mapeo débil)'
      },
      {
        key: 'TM-1048',
        note: 'conservación de totales vs baseline (Cucumber de otro epic: mapeo débil)'
      }
    ],
    prepScenarios: ['EF-PLAIN', 'CC'],
    deliver: { kind: 'preload' },
    miscellany: false,
    doubleClick: false,
    driverBalance: true,
    zeroFare: false,
    needsSameDayPriorSurrender: false
  }
};

/** Ambientes que gobiernan la matriz (ENV=prod queda FUERA: H-08). */
export type ConfirmEnv = 'uat' | 'test';

/**
 * Matriz regla x carrier x ambiente del plan fase 2 §3 W1: UAT = R01x3, R03x3, R04x3, R05 solo AR, R06 en US y FR;
 * TEST = 1521 R01 y 1901 R04 (con DB). `test:1040` conserva las 4 reglas historicas (rendiciones 14185-14188).
 * Una combinacion fuera de la matriz lanza: no se improvisa una confirmacion irreversible.
 */
export const CONFIRM_MATRIX: Readonly<
  Record<ConfirmEnv, Readonly<Record<string, readonly ConfirmRule[]>>>
> = {
  uat: {
    '1040': ['R01', 'R03', 'R04', 'R05'],
    '1481': ['R01', 'R03', 'R04', 'R06'],
    '2021': ['R01', 'R03', 'R04', 'R06']
  },
  test: {
    '1040': ['R01', 'R03', 'R04', 'R05'],
    '1521': ['R01'],
    '1521b': ['R01'],
    '1901': ['R04']
  }
};

/** `F5_CONFIRM_CASE` -> regla. Vacio -> null; un valor desconocido lanza listando los validos. */
export function parseConfirmCase(raw: string | undefined): ConfirmRule | null {
  const v = raw?.trim().toUpperCase();
  if (!v) return null;
  if ((CONFIRM_RULES as readonly string[]).includes(v)) return v as ConfirmRule;
  throw new Error(`F5_CONFIRM_CASE="${raw}" desconocido; validos: ${CONFIRM_RULES.join(', ')}`);
}

/** Ambiente de la corrida (`ENV`), minusculas; `prod` y cualquier otro valor NO confirman (H-08). */
export function confirmEnvOf(raw: string | undefined): ConfirmEnv {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'uat' || v === 'test') return v;
  throw new Error(
    `[F5 confirm] ENV="${raw ?? ''}" no permite confirmar: la rendición irreversible solo corre en ENV=uat o ENV=test (nunca prod)`
  );
}

/** Lanza si la regla no esta permitida para el target en el ambiente (matriz del plan). */
export function assertCaseAllowed(env: ConfirmEnv, targetId: string, rule: ConfirmRule): void {
  const allowed = CONFIRM_MATRIX[env][targetId];
  if (!allowed) {
    throw new Error(
      `[F5 confirm] el target ${targetId} no tiene casos de confirmación en ${env} (declarados: ${Object.keys(CONFIRM_MATRIX[env]).join(', ')})`
    );
  }
  if (!allowed.includes(rule)) {
    throw new Error(
      `[F5 confirm] ${rule} no está en la matriz de ${targetId}/${env} (permitidos: ${allowed.join(', ')})`
    );
  }
}

/** Todas las keys Xray de un caso (primaria primero), para `makeAnnotate`. */
export function confirmCaseKeys(rule: ConfirmRule): string[] {
  const def = CONFIRM_CASES[rule];
  return [def.primaryKey, ...def.secondaryKeys.map((k) => k.key)];
}

/** Importe tecleable en el campo del locale: sin miles, con el decimal del carrier (28350 -> «28350», 10.53 -> «10,53»). */
export function formatTypedAmount(amount: number, fmt: F5MoneyFormat): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`formatTypedAmount: importe invalido (${amount})`);
  }
  const rounded = Math.round(amount * 100) / 100;
  return String(rounded).replace('.', fmt.decimal);
}

/**
 * Entrega parcial: `ratio` del monto precargado en «Entregar», redondeada al centavo. Una entrega 0 o mayor
 * que lo adeudado es el caso Q9 («regla no definida»: observation del TM-1652), NO contrato: aqui lanza.
 */
export function partialDeliverAmount(due: number, ratio: number): number {
  if (!(ratio > 0 && ratio < 1))
    throw new Error(`ratio de entrega parcial fuera de (0,1): ${ratio}`);
  const amount = Math.round(due * ratio * 100) / 100;
  if (!(amount > 0 && amount < due)) {
    throw new Error(`entrega parcial ${amount} fuera de (0, ${due}): no es un caso de contrato`);
  }
  return amount;
}

/** Gasto varios por defecto: solo AR 1040 tiene un valor validado (100, TC12 UAT 10/11); el resto lo declara el orquestador. */
export const DEFAULT_MISCELLANY: Readonly<Record<string, number>> = { '1040': 100 };

/** `F5_CONFIRM_MISC` (decimal con punto) o el default del target; sin ninguno lanza (no se inventa el importe). */
export function miscellanyAmount(targetId: string, raw: string | undefined): number {
  const text = raw?.trim();
  if (text) {
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`F5_CONFIRM_MISC invalido: "${raw}"`);
    return n;
  }
  const dflt = DEFAULT_MISCELLANY[targetId];
  if (dflt === undefined) {
    throw new Error(
      `[F5 confirm] R04 en ${targetId}: declarar F5_CONFIRM_MISC=<gasto varios> (solo AR 1040 tiene default validado)`
    );
  }
  return dflt;
}

/** Contrato de entradas de la corrida: lo que el orquestador DEBE declarar antes del primer clic. */
export const CONFIRM_REQUIRED_ENV = [
  'F5_CONFIRM_SURRENDER',
  'F5_TARGETS',
  'F5_CONFIRM_CASE',
  'F5_CONFIRM_TRIPS',
  'F5_CONFIRM_EXPECT_DUE'
] as const;

/** Defensa: el catalogo solo referencia escenarios de prep existentes. */
export function catalogScenariosAreValid(): boolean {
  return CONFIRM_RULES.every((r) =>
    CONFIRM_CASES[r].prepScenarios.every((s) =>
      (PREP_SCENARIO_IDS as readonly string[]).includes(s)
    )
  );
}
