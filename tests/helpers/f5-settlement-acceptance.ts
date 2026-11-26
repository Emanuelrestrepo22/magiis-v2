// tests/helpers/f5-settlement-acceptance.ts
// Registro propio de los ACs de las liquidaciones F5 (W4, TM-1701) y su verificador ACUMULATIVO. Mismo patron
// que `verifyF5` (step + anotacion `ac` + adjunto JSON) con ids `AC-F5S-NN`, pero sin lanzar en cada AC: una
// liquidacion no se repite, asi que la falla posterior al clic NO oculta las demas aserciones; el spec lanza
// UNA vez al final con `assertNoFailures()`.
import { test, type TestInfo } from '@playwright/test';

export const F5S_AC = {
  'AC-F5S-01':
    'Previa al Accept: total declarado == oraculo (lista/DB) == pantalla «Settlement Total» == suma de comNeta del GET withoutLiquidations',
  'AC-F5S-02':
    'Pendientes del chofer/propietario = solo el lote propio (sin rendiciones de terceros); la automatica solo en el propietario',
  'AC-F5S-03':
    'Un unico POST de liquidacion (201), con total == oraculo y el detalle = las rendiciones pendientes',
  'AC-F5S-04': 'Tras el Accept: withoutLiquidations vacio y «To Settle» = 0',
  'AC-F5S-05': 'Comprobante PDF de la liquidacion contiene el total mostrado en pantalla',
  'AC-F5S-06':
    'DB (TEST): cabecera PAID, TOTAL, detalle y flags SETTLEMENT_*; sin intentos extra de escritura',
  'AC-F5S-07': 'NOCOM (no comisionable en efectivo) fuera del total de la liquidacion'
} as const;

export type F5sAcId = keyof typeof F5S_AC;

export const f5sLabel = (id: F5sAcId): string => `${id}: ${F5S_AC[id]}`;

export type F5sVerifier = {
  /** Ejecuta `fn` dentro de un `test.step`; anota PASS/FAIL, adjunta la evidencia y ACUMULA la falla (no lanza). */
  verify<T extends Record<string, unknown> | void>(
    id: F5sAcId,
    fn: () => Promise<T> | T
  ): Promise<T | undefined>;
  /** Mensajes de los ACs fallidos hasta ahora. */
  failures(): readonly string[];
  /** Lanza UNA vez con todas las fallas acumuladas (no hace nada si no hubo). */
  assertNoFailures(): void;
};

export function createF5sVerifier(testInfo: TestInfo): F5sVerifier {
  const failed: string[] = [];
  return {
    async verify(id, fn) {
      let evidence: Record<string, unknown> | void | undefined;
      let failure: unknown;
      const softBefore = testInfo.errors.length;
      try {
        await test.step(f5sLabel(id), async () => {
          evidence = (await fn()) as Record<string, unknown> | void;
        });
      } catch (error) {
        failure = error;
      }
      const failedNow = failure !== undefined || testInfo.errors.length > softBefore;
      const message =
        failure === undefined ? null : failure instanceof Error ? failure.message : String(failure);
      testInfo.annotations.push({
        type: 'ac',
        description: `${id} ${failedNow ? 'FAIL' : 'PASS'}`
      });
      await testInfo.attach(`ac-${id}`, {
        body: JSON.stringify(
          {
            id,
            title: F5S_AC[id],
            status: failedNow ? 'FAIL' : 'PASS',
            evidence: evidence ?? null,
            error: message
          },
          null,
          2
        ),
        contentType: 'application/json'
      });
      if (failedNow) failed.push(`${id}: ${message ?? 'aserciones soft fallidas'}`);
      return evidence as never;
    },
    failures: () => failed,
    assertNoFailures() {
      if (failed.length > 0) {
        throw new Error(
          `Liquidacion con ${failed.length} AC fallido(s):\n- ${failed.join('\n- ')}`
        );
      }
    }
  };
}

/** Observacion abierta (no se asevera): queda anotada para el informe, nunca FAILED. */
export function f5sObservation(testInfo: TestInfo, id: F5sAcId, note: string): void {
  testInfo.annotations.push({ type: 'observation', description: `${id} ${F5S_AC[id]}: ${note}` });
}
