// tests/utils/unitsAssert.ts
// Aserción común de la familia «unidades de medida» (MG-1189): un valor mostrado en pantalla debe
// ser el crudo en km que pidió el front, convertido a millas (imperial) o sin convertir (métrico).
//
// Patrón anti-vacuidad (CONVENTIONS §8): además de igualar al esperado, en imperial con crudo ≥ 1
// el valor mostrado NO puede coincidir con el crudo (si la pantalla mostrara km bajo «Mi» —la
// clase de defecto de MG-1193— el valor igualaría el crudo) y el rótulo de la otra unidad no
// puede aparecer. Si el dato no discrimina (crudo 0 o ausente) el llamador falla la PRECONDICIÓN
// antes de llegar acá: un caso que pasa en vacío no prueba nada.
import { expect } from '@playwright/test';
import {
  DISPLAY_TOLERANCE,
  KM_PER_MILE,
  containsUnit,
  expectedDistance,
  unitLabel,
  type DistanceReading,
  type UnitSystem
} from './units.js';

/** Devuelve el valor o lanza con el mensaje: evita condicionales dentro de los tests. */
export function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export interface DistanceExpectation {
  /** Qué se está midiendo, para el mensaje de falla (p. ej. «Dist/Viaje · Senna Ayrton»). */
  label: string;
  /** Lectura de la pantalla; se reintenta hasta que el valor se actualiza. */
  read: () => Promise<DistanceReading | null>;
  /** Texto completo de la celda/fila (rótulo + valor) para buscar la unidad equivocada. */
  readText?: () => Promise<string>;
  /** Crudo en km del payload que el propio front pidió. */
  rawKm: number;
  system: UnitSystem;
  /** Decimales que imprime la pantalla (2 salvo Destino Abierto, 3). */
  decimals?: number;
  /** Ventana de reintento (ms) hasta que el valor mostrado se actualiza. */
  timeout?: number;
}

/**
 * Espera (con reintentos) que la pantalla muestre `rawKm` convertido según el sistema y devuelve
 * la lectura final. Lanza con el esperado, el obtenido y el crudo si no coincide.
 */
export async function expectDisplayedDistance(
  expectation: DistanceExpectation
): Promise<DistanceReading> {
  const { label, read, readText, rawKm, system, decimals = 2, timeout = 15_000 } = expectation;
  const expected = expectedDistance(rawKm, system, decimals);
  const tolerance = decimals > 2 ? 0.001 : DISPLAY_TOLERANCE;
  let last: DistanceReading | null = null;
  await expect(async () => {
    last = await read();
    expect(last, `${label}: la pantalla no muestra «número + unidad»`).not.toBeNull();
    const reading = last as unknown as DistanceReading;
    expect(reading.unit, `${label}: rótulo de unidad (crudo ${rawKm} km)`).toBe(unitLabel(system));
    expect(
      Math.abs(reading.value - expected),
      `${label}: esperado ${expected} ${unitLabel(system)} (crudo ${rawKm} km), mostrado ${reading.value}`
    ).toBeLessThanOrEqual(tolerance + 1e-9);
    if (system === 'imperial' && rawKm >= 1) {
      expect(
        Math.abs(reading.value - rawKm),
        `${label}: el valor mostrado no puede ser el crudo en km (${rawKm})`
      ).toBeGreaterThan(tolerance);
    }
    if (readText) {
      const text = await readText();
      const otherUnit = system === 'imperial' ? 'km' : 'Mi';
      expect(
        containsUnit(text, otherUnit),
        `${label}: no debe aparecer el rótulo «${otherUnit}» (texto: «${text}»)`
      ).toBe(false);
    }
  }).toPass({ timeout });
  return last as unknown as DistanceReading;
}

/** Tolerancia de las razones por distancia: el API redondea a 2 decimales antes de convertir. */
const RATIO_TOLERANCE: Record<UnitSystem, number> = { imperial: 0.02, metric: 0.01 };

export interface RatioExpectation {
  label: string;
  /** Lectura de la razón en pantalla (valor, unidad del rótulo y texto de la fila). */
  read: () => Promise<{ value: number; unit: string; text: string } | null>;
  /** Valor «por km» crudo del payload (`valuePerKm` / `minsPerKm`). */
  rawPerKm: number;
  system: UnitSystem;
  timeout?: number;
}

/** Separador decimal con el que imprime cada sistema (imperial US `.`, métrico AR `,`). */
export function decimalHint(system: UnitSystem): '.' | ',' {
  return system === 'imperial' ? '.' : ',';
}

/** Texto para el comentario de evidencia: qué relación se verificó. */
export function ratioRule(system: UnitSystem): string {
  return system === 'imperial'
    ? 'valor por km del API × 1,60934 (H-8 corregido)'
    : 'valor por km del API sin convertir (carrier métrico)';
}

/**
 * Espera que una razón por distancia («$ /Mi», «Min/Mi») muestre el valor por km del API
 * convertido (imperial: × 1,60934, es decir facturado ÷ Mi) o sin convertir (métrico), con el
 * rótulo de unidad del carrier. Imperial: el valor mostrado no puede ser el valor por km (el
 * defecto H-8 lo mostraba sin convertir bajo «Mi»). Devuelve el valor mostrado.
 */
export async function expectDisplayedRatio(expectation: RatioExpectation): Promise<number> {
  const { label, read, rawPerKm, system, timeout = 15_000 } = expectation;
  const expected = system === 'imperial' ? rawPerKm * KM_PER_MILE : rawPerKm;
  const tolerance = RATIO_TOLERANCE[system];
  let shown = Number.NaN;
  await expect(async () => {
    const reading = await read();
    expect(reading, `${label}: la fila no existe o no trae número`).not.toBeNull();
    const row = reading as NonNullable<typeof reading>;
    shown = row.value;
    expect(row.unit.toLowerCase(), `${label}: rótulo de unidad (texto «${row.text}»)`).toBe(
      unitLabel(system).toLowerCase()
    );
    expect(
      Math.abs(row.value - expected),
      `${label}: esperado ${expected.toFixed(3)} (por km crudo ${rawPerKm}), mostrado ${row.value}`
    ).toBeLessThanOrEqual(tolerance + 1e-9);
    if (system === 'imperial') {
      expect(
        Math.abs(row.value - rawPerKm),
        `${label}: el valor mostrado no puede ser el valor por km (${rawPerKm})`
      ).toBeGreaterThan(tolerance);
    }
  }).toPass({ timeout });
  return shown;
}
