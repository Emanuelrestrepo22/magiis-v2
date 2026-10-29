// tests/fixtures/factories/otherCostFactory.ts
// Factory de payloads de `POST carriers/{carrierId}/otherCosts/new` (contrato F1, MG-995/MG-996).
// Replica las reglas del ABM del front para que el concepto preparado por API sea el mismo que
// crearia un usuario desde Configuracion > Otros Costos. Fuente (front v2.0.17, rutas relativas a
// src/app/pages/carrier/settings/otherCosts/settings-otherCosts.component.ts):
// - Payload de 12 campos: interfaz OtherCostsPayload (:63-76) y buildPayload() (:671-697).
// - Regla G: con Costo OFF el costo ESPEJA la venta (JSDoc :661-670, codigo :685-690).
// - Costo ON: `conceptValueCost` solo para no-VAR, `maxCostValue` solo para VAR (:668-669).
// - VAR con Costo ON exige tope de costo distinto de 0 (isMaxCostValueMissing, :580-582) y
//   tope de venta distinto de 0 (hasSaleAmount, :566-570).
// - VAR con Costo ON solo se ofrece a CARRIER; VAR sin costo, DRIVER y CARRIER; resto, los tres
//   (rebuildAvailabilityOptions / applyVarIsByCostRule, :229-249).
// - Nombre: conceptPattern (:122) — sin guion ni apostrofe.
// - PCT fuera de 0..100 bloqueado (isPercentageOutOfRange, :594-597); negativos bloqueados en el
//   ABM (isNegative, :633-635; O-UAT-03) → aca solo con `allowNegative` explicito (dato legado).
// Y del alta de viaje: el modal de Nuevo Viaje solo lista conceptos con `apply` CARRIER
// (docs/analysis/migration-evidence/new-trip-other-costs-2026-09-29.md §2, H-4) → todo concepto
// de esta factory incluye CARRIER.

export type OtherCostType = 'FIX' | 'QTY' | 'PCT' | 'VAR';
export type OtherCostApply = 'DRIVER' | 'CARRIER' | 'PAX';
/**
 * Etiqueta de familia que reemplaza al tipo en el nombre: `SMK` = smoke del ABM (ATR TM-1281).
 * El tipo del concepto se ve en la columna Tipo; el nombre solo distingue la familia.
 */
export type OtherCostNameTag = 'SMK';

/** Body de `otherCosts/new` (mismo orden y nombres que el front). */
export type OtherCostPayload = {
  carrierId: number;
  name: string;
  type: OtherCostType;
  conceptValue: number | null;
  maxValue: number | null;
  apply: OtherCostApply[];
  isCommisionable: boolean;
  userId: number;
  isByCost: boolean;
  conceptValueCost: number;
  maxCostValue: number;
  currencyId: number | null;
};

/** Prefijo de todo concepto de la automatizacion (solo letras, digitos y espacios). */
export const OTHER_COST_NAME_PREFIX = 'QA E2E OC ';
/** Tope de largo del nombre (plan §10: tambien legible en la app Chofer). */
export const OTHER_COST_NAME_MAX_LENGTH = 25;
/** Mismo patron que el ABM del front (conceptPattern). */
const CONCEPT_PATTERN = /^[A-Za-z0-9\sáéíóúÁÉÍÓÚñÑüÜ]+$/;
const RUN_ID_PATTERN = /^[0-9A-Z]{8}$/;
const NAME_PARSE_PATTERN =
  /^QA E2E OC (?:FIX|QTY|PCT|VAR|SMK) ([0-9A-Z]{6})[0-9A-Z]{2}(?: [0-9A-Z]{1,2})?$/;

/**
 * Id de corrida de 8 caracteres [0-9A-Z]: 6 de segundos epoch en base 36 + 2 aleatorios.
 * Codificar el instante permite que el sweep sepa la edad de un concepto solo por su nombre.
 */
export function makeRunId(now: number = Date.now(), random: () => number = Math.random): string {
  const time = Math.floor(now / 1000)
    .toString(36)
    .toUpperCase()
    .padStart(6, '0')
    .slice(-6);
  const tail = Array.from({ length: 2 }, () =>
    Math.floor(random() * 36)
      .toString(36)
      .toUpperCase()
  ).join('');
  return `${time}${tail}`;
}

/**
 * Nombre unico: «QA E2E OC <TIPO|SMK> <runId>[ <label>]». Valida patron y largo del ABM.
 * `SMK` (smoke del ABM) ocupa el lugar del tipo: el sweep lo reconoce igual.
 */
export function buildOtherCostName(
  type: OtherCostType | OtherCostNameTag,
  runId: string,
  label?: string
): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `otherCostFactory: runId invalido «${runId}» (se esperan 8 caracteres [0-9A-Z])`
    );
  }
  if (label !== undefined && !/^[0-9A-Z]{1,2}$/.test(label)) {
    throw new Error(`otherCostFactory: label invalido «${label}» (1 a 2 caracteres [0-9A-Z])`);
  }
  const name = `${OTHER_COST_NAME_PREFIX}${type} ${runId}${label ? ` ${label}` : ''}`;
  if (!CONCEPT_PATTERN.test(name) || name.length > OTHER_COST_NAME_MAX_LENGTH) {
    throw new Error(`otherCostFactory: nombre fuera de las reglas del ABM «${name}»`);
  }
  return name;
}

/** Instante (ms epoch) codificado en el nombre, o null si el nombre no es de esta factory. */
export function parseOtherCostNameTimestamp(name: string): number | null {
  const match = NAME_PARSE_PATTERN.exec(name);
  if (!match) return null;
  return parseInt(match[1], 36) * 1000;
}

/** Candidato a sweep: nombre de esta factory y mas viejo que `olderThanMs`. */
export function isSweepCandidate(name: string, now: number, olderThanMs: number): boolean {
  const createdAt = parseOtherCostNameTimestamp(name);
  return createdAt !== null && now - createdAt > olderThanMs;
}

/** Datos de la sesion/corrida comunes a todo concepto. */
export type OtherCostContext = {
  carrierId: number;
  /** subUserId de la sesion (el front envia `+identityService.subUserId`). */
  userId: number;
  /** Descubierto del `search` (moneda del carrier); null deja que el backend use la del carrier. */
  currencyId: number | null;
  runId: string;
  /** Sufijo para distinguir varios conceptos del mismo tipo en una corrida (TM-1279). */
  label?: string;
  apply?: OtherCostApply[];
  isCommisionable?: boolean;
  /** Etiqueta de familia en el nombre en lugar del tipo (smoke del ABM: `SMK`). */
  nameTag?: OtherCostNameTag;
};

type AmountOptions = {
  /** Costo (importe o %). undefined/null = interruptor Costo apagado. 0 es valido con Costo ON. */
  cost?: number | null;
  /** Permite importes negativos: el ABM los bloquea, solo para preparar datos legados por API. */
  allowNegative?: boolean;
};

function assertFiniteAmount(value: number, field: string, allowNegative: boolean): void {
  if (!Number.isFinite(value)) {
    throw new Error(`otherCostFactory: ${field} no es un numero finito`);
  }
  if (!allowNegative && value < 0) {
    throw new Error(
      `otherCostFactory: ${field} negativo; el ABM lo bloquea (usar allowNegative solo para datos legados)`
    );
  }
}

function resolveApply(
  type: OtherCostType,
  isByCost: boolean,
  apply?: OtherCostApply[]
): OtherCostApply[] {
  const resolved =
    apply && apply.length > 0 ? [...new Set(apply)] : (['CARRIER'] as OtherCostApply[]);
  if (!resolved.includes('CARRIER')) {
    throw new Error(
      'otherCostFactory: apply debe incluir CARRIER (si no, el concepto no se ofrece en Nuevo Viaje)'
    );
  }
  if (type === 'VAR' && isByCost && resolved.some((a) => a !== 'CARRIER')) {
    throw new Error('otherCostFactory: un VAR con Costo encendido solo admite apply CARRIER');
  }
  if (type === 'VAR' && resolved.includes('PAX')) {
    throw new Error('otherCostFactory: un VAR no admite apply PAX');
  }
  return resolved;
}

function baseFields(ctx: OtherCostContext, type: OtherCostType, isByCost: boolean) {
  return {
    carrierId: ctx.carrierId,
    name: buildOtherCostName(ctx.nameTag ?? type, ctx.runId, ctx.label),
    type,
    apply: resolveApply(type, isByCost, ctx.apply),
    isCommisionable: ctx.isCommisionable ?? true,
    userId: ctx.userId,
    isByCost,
    currencyId: ctx.currencyId
  };
}

/** Concepto no-VAR (FIX / QTY / PCT): venta en conceptValue; costo segun Regla G. */
function nonVariable(
  ctx: OtherCostContext,
  type: 'FIX' | 'QTY' | 'PCT',
  sale: number,
  options: AmountOptions
): OtherCostPayload {
  const allowNegative = options.allowNegative ?? false;
  assertFiniteAmount(sale, 'la venta', allowNegative);
  if (sale === 0) {
    throw new Error('otherCostFactory: la venta no puede ser 0 (hasSaleAmount del ABM)');
  }
  const isByCost = options.cost !== undefined && options.cost !== null;
  if (isByCost) assertFiniteAmount(options.cost as number, 'el costo', allowNegative);
  if (type === 'PCT') {
    const outOfRange = (v: number) => v < 0 || v > 100;
    if (outOfRange(sale) || (isByCost && outOfRange(options.cost as number))) {
      throw new Error('otherCostFactory: un PCT debe estar entre 0 y 100 (venta y costo)');
    }
  }
  return {
    ...baseFields(ctx, type, isByCost),
    conceptValue: sale,
    maxValue: null,
    // Regla G: Costo OFF → el costo espeja la venta; Costo ON → el costo cargado.
    conceptValueCost: isByCost ? (options.cost as number) : sale,
    maxCostValue: 0
  };
}

/** FIX: importe fijo de venta. */
export function fixedOtherCost(
  ctx: OtherCostContext,
  sale: number,
  options: AmountOptions = {}
): OtherCostPayload {
  return nonVariable(ctx, 'FIX', sale, options);
}

/** QTY: importe unitario de venta (el alta multiplica por la cantidad). */
export function quantityOtherCost(
  ctx: OtherCostContext,
  unitSale: number,
  options: AmountOptions = {}
): OtherCostPayload {
  return nonVariable(ctx, 'QTY', unitSale, options);
}

/** PCT: porcentaje de venta sobre la tarifa (0..100]. */
export function percentageOtherCost(
  ctx: OtherCostContext,
  percent: number,
  options: AmountOptions = {}
): OtherCostPayload {
  return nonVariable(ctx, 'PCT', percent, options);
}

/**
 * VAR: el importe se carga en el alta; el concepto define topes.
 * Con Costo ON (maxCost informado) exige AMBOS topes distintos de 0 (contrato vigente de TM-1277).
 */
export function variableOtherCost(
  ctx: OtherCostContext,
  caps: { maxSale: number; maxCost?: number | null }
): OtherCostPayload {
  assertFiniteAmount(caps.maxSale, 'el tope de venta', false);
  if (caps.maxSale === 0) {
    throw new Error('otherCostFactory: un VAR exige tope de venta distinto de 0 (hasSaleAmount)');
  }
  const isByCost = caps.maxCost !== undefined && caps.maxCost !== null;
  if (isByCost) {
    assertFiniteAmount(caps.maxCost as number, 'el tope de costo', false);
    if (caps.maxCost === 0) {
      throw new Error(
        'otherCostFactory: un VAR con Costo encendido exige tope de costo distinto de 0 (isMaxCostValueMissing)'
      );
    }
  }
  return {
    ...baseFields(ctx, 'VAR', isByCost),
    conceptValue: null,
    maxValue: caps.maxSale,
    // Regla G: Costo OFF → conceptValueCost = venta VAR (0) y maxCostValue = tope de venta.
    conceptValueCost: 0,
    maxCostValue: isByCost ? (caps.maxCost as number) : caps.maxSale
  };
}
