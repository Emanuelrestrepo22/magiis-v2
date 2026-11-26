/**
 * behaviorMatrix — la matriz conducta × superficie de MG-116 (App PAX) como DATO PURO, más la lógica de decisión
 * que traduce el resultado de una probe en el desenlace de una fila del spec (`pax-address-behaviors`).
 *
 * POR QUÉ UNA FILA = UN TEST. El `xray-reporter` deduplica por `testKey` y gana el PEOR estado. Si TM-678 (debounce)
 * se trazara a las cinco superficies en un solo test, el rojo de una arrastraría a todas. Cada fila acredita sólo lo
 * que mide, y las dos conductas propias de Perfil › Mis Direcciones tienen key propia (TM-733, TM-734).
 *
 * ORÁCULO = AC. La expectativa de TODA fila es `PASS`. Un FAIL legítimo del producto se DOCUMENTA (`knownFail`:
 * motivo + base de la evidencia) pero la aserción no se cambia: cuando se arregle el producto la fila pasa a verde
 * sola, y mientras tanto el rojo sigue diciendo la verdad. `suspected` es lo mismo pero sin medición propia (lectura
 * de código develop o dependencia de entorno): informativo, nunca cambia el desenlace.
 *
 * Sin `process.env` ni Appium: se prueba con unit.
 */

import type { SurfaceId } from './surfaces/index.js';
import type { BehaviorId, EvidenceLevel, ProbeResult, Verdict } from './probes/types.js';

/** `B1b` = parámetros del request (TM-675); sale de la MISMA medición de B1 (`measured.requestParams`). */
export type MatrixBehavior = 'B1' | 'B1b' | 'B2' | 'B3' | 'B4' | 'B6' | 'B7' | 'B8' | 'B9';

export type KnownFail = {
  reason: string;
  /** Con qué se sabe: medición V1 en UAT, o build viejo ya migrado en develop. */
  basis: 'v1-medido-uat' | 'build-viejo';
};

export type MatrixRow = {
  surface: SurfaceId;
  behavior: MatrixBehavior;
  /** Conducta de `runProbeBattery` que produce la medición. */
  probe: BehaviorId;
  /** Variante de la conducta (B8: `status` | `timeout`). */
  variant?: 'status' | 'timeout';
  tms: readonly string[];
  /** Resto del título de test, sin prefijo de suite ni key. */
  title: string;
  /** Piso de caracteres esperado en B3 (3 alta de viaje, 4 Perfil). */
  expectedMinLength?: number;
  level: EvidenceLevel;
  /** Veredicto esperado por el oráculo: siempre PASS. */
  expected: 'PASS';
  knownFail?: KnownFail;
  /** Sospecha sin medición propia (lectura de código develop o dependencia de entorno). */
  suspected?: string;
};

export const SURFACE_ORDER: readonly SurfaceId[] = ['S1', 'S3', 'S5', 'S6', 'S7'];

/** Las conductas B7/B8/B9 sólo se ejercen en UNA superficie (miden el componente, no la pantalla). */
export const SINGLE_SURFACE_ID: SurfaceId = 'S1';

/** Todas las keys TM que la matriz debe acreditar (A3 `pax-address-behaviors`). */
export const REQUIRED_TM_KEYS: readonly string[] = [
  'TM-674',
  'TM-675',
  'TM-678',
  'TM-679',
  'TM-680',
  'TM-681',
  'TM-686',
  'TM-687',
  'TM-689',
  'TM-697',
  'TM-733',
  'TM-734'
];

/** Piso de B3 por superficie: 3 en alta de viaje (IATA), 4 en Perfil (acuerdo 2026-08-20). */
export const expectedFloorFor = (surface: SurfaceId): number => (surface === 'S7' ? 4 : 3);

const V1_DEBOUNCE =
  'V1 UAT 22/08/2026: 10 pulsaciones a 80 ms dispararon {n} requests (el AC fija un único request tras ~300 ms). ' +
  'Verificar qué componente monta la superficie (P-41 §6 P1).';
const DEBOUNCE_V1_COUNT: Partial<Record<SurfaceId, number>> = { S1: 2, S5: 5, S7: 2 };

const BIAS_SUSPECTED =
  'El sesgo latitude/longitude depende del entorno: develop no lo envía sin GPS ni coordenadas del carrier (P-41 §4.4). ' +
  'El AC sí lo exige: no se relaja.';

function commonRows(surface: SurfaceId): MatrixRow[] {
  const tripFlow = surface !== 'S7';
  const floor = expectedFloorFor(surface);
  const debounceCount = DEBOUNCE_V1_COUNT[surface];
  const profileDirectGoogle: KnownFail | undefined =
    surface === 'S7'
      ? {
          basis: 'build-viejo',
          reason:
            'TM-729: en el build 2.5.19 Perfil › Mis Direcciones consulta a Google directo (0 llamadas al endpoint propio); ' +
            'develop ya migró la pantalla (MG-116 2.ª etapa): en builds nuevos debe dar PASS.'
        }
      : undefined;
  return [
    {
      surface,
      behavior: 'B1',
      probe: 'B1',
      tms: ['TM-674'],
      title: 'Validar que el campo consulta el endpoint propio y no a Google',
      level: 'real-ui',
      expected: 'PASS',
      ...(profileDirectGoogle ? { knownFail: profileDirectGoogle } : {})
    },
    {
      surface,
      behavior: 'B1b',
      probe: 'B1',
      tms: ['TM-675'],
      title: 'Validar que el request lleva el término y el sesgo de ubicación',
      level: 'real-ui',
      expected: 'PASS',
      suspected: BIAS_SUSPECTED
    },
    {
      surface,
      behavior: 'B2',
      probe: 'B2',
      tms: [tripFlow ? 'TM-678' : 'TM-733'],
      title: 'Validar que el campo agrupa las pulsaciones antes de consultar (debounce)',
      level: 'real-ui',
      expected: 'PASS',
      ...(debounceCount !== undefined
        ? {
            knownFail: {
              basis: 'v1-medido-uat' as const,
              reason: V1_DEBOUNCE.replace('{n}', String(debounceCount))
            }
          }
        : {}),
      ...(surface === 'S6'
        ? {
            suspected:
              'Lectura de código develop: `components/travel-edit-input` usa debounce de 2500 ms (P-41 §4.1); sin medición propia.'
          }
        : {})
    },
    {
      surface,
      behavior: 'B3',
      probe: 'B3',
      tms: tripFlow ? ['TM-680', 'TM-681'] : ['TM-734'],
      title: `Validar que el campo respeta el piso de ${floor} caracteres`,
      expectedMinLength: floor,
      level: 'real-ui',
      expected: 'PASS',
      ...(surface === 'S6'
        ? {
            suspected:
              'Lectura de código develop: los componentes no-home consultan con `> 3` (4 caracteres) y el AC fija 3 (P-41 §4.3); sin medición propia.'
          }
        : {})
    },
    {
      surface,
      behavior: 'B4',
      probe: 'B4',
      tms: ['TM-679'],
      title: 'Validar que el campo no reconsulta un texto idéntico',
      level: 'real-ui',
      expected: 'PASS'
    },
    {
      surface,
      behavior: 'B6',
      probe: 'B6',
      tms: ['TM-686'],
      title: 'Validar que los requests del mismo campo comparten un único sessionToken',
      level: 'real-ui',
      expected: 'PASS'
    }
  ];
}

function singleSurfaceRows(surface: SurfaceId): MatrixRow[] {
  return [
    {
      surface,
      behavior: 'B7',
      probe: 'B7',
      tms: ['TM-687'],
      title: 'Validar que el sessionToken rota al seleccionar una predicción',
      level: 'real-ui',
      expected: 'PASS'
    },
    {
      surface,
      behavior: 'B8',
      probe: 'B8',
      variant: 'status',
      tms: ['TM-689'],
      title: 'Validar que el campo sobrevive a un 5xx del endpoint',
      level: 'mechanism',
      expected: 'PASS'
    },
    {
      surface,
      behavior: 'B8',
      probe: 'B8',
      variant: 'timeout',
      tms: ['TM-689'],
      title: 'Validar que el campo sobrevive a un timeout del endpoint',
      level: 'mechanism',
      expected: 'PASS'
    },
    {
      surface,
      behavior: 'B9',
      probe: 'B9',
      tms: ['TM-697'],
      title: 'Validar que el campo sigue usable sin conexión',
      level: 'mechanism',
      expected: 'PASS'
    }
  ];
}

export const MATRIX_ROWS: readonly MatrixRow[] = SURFACE_ORDER.flatMap((surface) => [
  ...commonRows(surface),
  ...(surface === SINGLE_SURFACE_ID ? singleSurfaceRows(surface) : [])
]);

export const rowsForSurface = (surface: SurfaceId): MatrixRow[] =>
  MATRIX_ROWS.filter((r) => r.surface === surface);

/** Identificador único de la fila: superficie + conducta (+ variante). */
export const rowId = (row: Pick<MatrixRow, 'surface' | 'behavior' | 'variant'>): string =>
  [row.surface, row.behavior, row.variant].filter(Boolean).join('-');

export const rowTitle = (row: MatrixRow): string =>
  `PAX-ADDR-BEHAVIORS · ${row.surface} · ${row.title} [${row.tms.join(', ')}]`;

export type RowOutcome =
  | { kind: 'pass'; status: 'PASS'; message: string }
  | { kind: 'fail'; status: 'FAIL'; message: string }
  | { kind: 'skip'; status: Verdict | 'SIN_RESULTADO'; message: string };

/**
 * Traduce lo medido en el desenlace de la fila.
 *  - PASS -> pass; FAIL -> fail (con el valor medido en el mensaje).
 *  - SIN_DATOS / NO_EJERCIDO / ausencia del resultado -> skip con motivo: límite del harness, NUNCA un rojo ni un verde.
 *  - B1b: la decisión sale de `measured.requestParams` de B1 (misma medición, otra mirada).
 */
export function evaluateRow(row: MatrixRow, results: readonly ProbeResult[]): RowOutcome {
  const hit = results.find(
    (r) => r.behavior === row.probe && (row.variant === undefined || r.variant === row.variant)
  );
  if (!hit) {
    return {
      kind: 'skip',
      status: 'SIN_RESULTADO',
      message: `La batería no devolvió resultado para ${rowId(row)}: conducta no ejercida.`
    };
  }
  const view =
    row.behavior === 'B1b' ? paramsView(hit) : { status: hit.status, detail: hit.detail };
  const message = `${rowId(row)}: ${view.status} — ${view.detail}`;
  if (view.status === 'PASS') return { kind: 'pass', status: 'PASS', message };
  if (view.status === 'FAIL') return { kind: 'fail', status: 'FAIL', message };
  return { kind: 'skip', status: view.status, message };
}

function paramsView(b1: ProbeResult): { status: Verdict; detail: string } {
  const p = b1.measured.requestParams as { status?: Verdict; detail?: string } | undefined;
  if (!p?.status) {
    return {
      status: 'SIN_DATOS',
      detail: 'B1 no dejó `requestParams`: no se puede verificar el sesgo.'
    };
  }
  return { status: p.status, detail: p.detail ?? '' };
}

/** `true` para un udid de emulador Android (`emulator-5554`). */
export const isEmulatorUdid = (udid: string | null | undefined): boolean =>
  !!udid && udid.trim().toLowerCase().startsWith('emulator-');

export type RunGuardInput = {
  appiumServerUrl: string | undefined;
  /** Resultado de `environmentSkipReason` (producción u otro ambiente vedado). */
  environmentReason: string | null;
  environment: string;
  udid: string | null;
  /** `process.env.XRAY` crudo (cualquier valor no vacío = publicando en Xray). */
  xray: string | undefined;
};

/** Motivo para saltear TODA la suite, o `null` si puede correr. Sólo UAT; emulador no publica en Xray. */
export function runGuardReason(input: RunGuardInput): string | null {
  if (!input.appiumServerUrl?.trim()) {
    return 'Requiere APPIUM_SERVER_URL y el dispositivo conectado.';
  }
  if (input.environmentReason) return input.environmentReason;
  if (input.environment !== 'uat') {
    return `Matriz calibrada en UAT: requiere ENV=uat (ambiente actual: ${input.environment}).`;
  }
  if (input.xray?.trim() && isEmulatorUdid(input.udid)) {
    return (
      'XRAY activo con un emulador (udid emulator-*): el resultado en emulador NO es concluyente ' +
      '(Places/geolocalización/red difieren) y no se publica en Xray. Correr en dispositivo físico o sin XRAY.'
    );
  }
  return null;
}
