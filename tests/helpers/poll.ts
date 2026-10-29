// tests/helpers/poll.ts
// Espera por estado observable SIN juzgar: devuelve el ultimo valor leido y si el predicado se cumplio.
// Sin Playwright y sin `expect`: el spec asevera `result.settled` con su propio mensaje de negocio.
// Nunca lanza por el predicado; solo propaga errores de `read`.

export type PollResult<T> = { value: T; settled: boolean; attempts: number; elapsedMs: number };

export async function pollUntil<T>(
  read: () => Promise<T>,
  settled: (value: T) => boolean,
  opts: { timeoutMs: number; intervalMs?: number }
): Promise<PollResult<T>> {
  const intervalMs = opts.intervalMs ?? 1_000;
  const start = Date.now();
  let attempts = 0;
  for (;;) {
    const value = await read();
    attempts += 1;
    const ok = settled(value);
    const elapsedMs = Date.now() - start;
    if (ok || elapsedMs + intervalMs > opts.timeoutMs) {
      return { value, settled: ok, attempts, elapsedMs };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}
